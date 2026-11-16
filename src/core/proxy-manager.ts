/**
 * مدیریت فهرست پروکسی: افزودن و حذف، سنجش دوره‌ای و فعال کردن سریع‌ترین.
 * خودِ الگوریتم امتیازدهی و انتخاب در proxy-pool.ts است؛ این کلاس آن را به ذخیره‌سازی و شبکه وصل می‌کند.
 */
import {
  chooseProxy,
  DEFAULT_PROBE,
  emptyStats,
  isAlive,
  maskProxyUrl,
  parseProxyList,
  probePool,
  PROXY_POOL_LIMIT,
  proxyId,
  proxyScore,
  type ProbeFn,
  type ProbeOptions,
  type ProxyEntry,
} from "./proxy-pool.js";
import type { AppProxyType, ProxyPoolStored } from "./store.js";

export interface ProxyPoolHost {
  proxyPool: () => ProxyPoolStored;
  saveProxyPool: (pool: ProxyPoolStored) => ProxyPoolStored;
}

export interface ProxyManagerOptions {
  store: ProxyPoolHost;
  probe: ProbeFn;
  /** پروکسی انتخاب‌شده را برای کل برنامه فعال می‌کند */
  apply: (settings: { proxyType: AppProxyType; proxyUrl: string }) => void;
  probeOptions?: Partial<ProbeOptions>;
  /** فاصله‌ی سنجش خودکار (میلی‌ثانیه) */
  intervalMs?: number;
}

export class ProxyPoolError extends Error {}

/** نمای امن یک پروکسی برای داشبورد */
export interface ProxyView {
  id: string;
  /** نشانی با رمز پنهان‌شده */
  url: string;
  kind: ProxyEntry["kind"];
  enabled: boolean;
  active: boolean;
  alive: boolean;
  score: number | null;
  ewmaMs: number | null;
  jitterMs: number | null;
  successRate: number | null;
  checks: number;
  lastCheckedAt: string | null;
  lastError: string | null;
}

export interface ProxyPoolView {
  auto: boolean;
  activeId: string | null;
  entries: ProxyView[];
  limit: number;
  testing: boolean;
}

export class ProxyManager {
  private timer?: NodeJS.Timeout;
  private running?: Promise<ProxyPoolView & { switched: { id: string; reason: string } | null }>;

  constructor(private opts: ProxyManagerOptions) {}

  /** نمای امن برای داشبورد: رمز پروکسی‌ها پنهان است */
  describe(): ProxyPoolView {
    const pool = this.opts.store.proxyPool();
    const entries = pool.entries.map((p) => {
      const score = proxyScore(p.stats);
      return {
        id: p.id,
        url: maskProxyUrl(p.url),
        kind: p.kind,
        enabled: p.enabled,
        active: p.id === pool.activeId,
        alive: isAlive(p.stats),
        score: Number.isFinite(score) ? Math.round(score) : null,
        ewmaMs: p.stats.ewmaMs ?? null,
        jitterMs: p.stats.jitterMs ?? null,
        successRate: p.stats.checks ? Math.round((1 - p.stats.failRate) * 100) : null,
        checks: p.stats.checks,
        lastCheckedAt: p.stats.lastCheckedAt ?? null,
        lastError: p.stats.lastError ?? null,
      };
    });
    // سریع‌ترین‌ها بالا، سنجیده‌نشده‌ها و ازکارافتاده‌ها پایین
    entries.sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity));
    return { auto: pool.auto, activeId: pool.activeId ?? null, entries, limit: PROXY_POOL_LIMIT, testing: Boolean(this.running) };
  }

  /** متن چندخطی را اضافه می‌کند؛ پروکسی تکراری دوباره ساخته نمی‌شود */
  add(text: string) {
    const { entries, invalid } = parseProxyList(text);
    const pool = this.opts.store.proxyPool();
    const known = new Set(pool.entries.map((p) => p.id));
    let added = 0;
    for (const item of entries) {
      const id = proxyId(item.url);
      if (known.has(id)) continue;
      if (pool.entries.length >= PROXY_POOL_LIMIT) throw new ProxyPoolError(`حداکثر ${PROXY_POOL_LIMIT} پروکسی قابل ثبت است`);
      known.add(id);
      pool.entries.push({ id, url: item.url, kind: item.kind, enabled: true, stats: emptyStats() });
      added++;
    }
    if (!entries.length && !invalid.length) throw new ProxyPoolError("نشانی پروکسی را وارد کنید");
    this.opts.store.saveProxyPool(pool);
    return { added, duplicates: entries.length - added, invalid };
  }

  remove(id: string) {
    const pool = this.opts.store.proxyPool();
    const before = pool.entries.length;
    pool.entries = pool.entries.filter((p) => p.id !== id);
    if (pool.entries.length === before) throw new ProxyPoolError("پروکسی پیدا نشد");
    if (pool.activeId === id) this.deactivate(pool);
    this.opts.store.saveProxyPool(pool);
  }

  setEnabled(id: string, enabled: boolean) {
    const pool = this.opts.store.proxyPool();
    const entry = pool.entries.find((p) => p.id === id);
    if (!entry) throw new ProxyPoolError("پروکسی پیدا نشد");
    entry.enabled = enabled;
    if (!enabled && pool.activeId === id) this.deactivate(pool);
    this.opts.store.saveProxyPool(pool);
  }

  /** فعال کردن دستی یک پروکسی؛ انتخاب خودکار را خاموش می‌کند تا انتخاب کاربر عوض نشود */
  activate(id: string) {
    const pool = this.opts.store.proxyPool();
    const entry = pool.entries.find((p) => p.id === id);
    if (!entry) throw new ProxyPoolError("پروکسی پیدا نشد");
    entry.enabled = true;
    pool.auto = false;
    this.use(pool, entry);
    this.opts.store.saveProxyPool(pool);
    this.schedule();
  }

  setAuto(auto: boolean) {
    const pool = this.opts.store.proxyPool();
    pool.auto = auto;
    this.opts.store.saveProxyPool(pool);
    this.schedule();
  }

  /** همه‌ی پروکسی‌های روشن را می‌سنجد؛ با روشن بودن انتخاب خودکار، سریع‌ترین را فعال می‌کند */
  test() {
    // دو سنجش هم‌زمان نتیجه‌ی همدیگر را خراب می‌کنند؛ درخواست دوم منتظر همان اولی می‌ماند
    this.running ??= this.runTest().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async runTest(): Promise<ProxyPoolView & { switched: { id: string; reason: string } | null }> {
    const snapshot = this.opts.store.proxyPool();
    const probed = await probePool(snapshot.entries, this.opts.probe, { ...DEFAULT_PROBE, ...this.opts.probeOptions });
    // در فاصله‌ی سنجش ممکن است فهرست عوض شده باشد؛ فقط آمار پروکسی‌های موجود به‌روز می‌شود
    const pool = this.opts.store.proxyPool();
    const stats = new Map(probed.map((p) => [p.id, p.stats]));
    for (const entry of pool.entries) {
      const fresh = stats.get(entry.id);
      if (fresh && entry.enabled) entry.stats = fresh;
    }
    let switched: { id: string; reason: string } | null = null;
    if (pool.auto) {
      const choice = chooseProxy(pool.entries, pool.activeId);
      const next = pool.entries.find((p) => p.id === choice.id);
      if (next && next.id !== pool.activeId) {
        this.use(pool, next);
        switched = { id: next.id, reason: choice.reason };
      }
    }
    this.opts.store.saveProxyPool(pool);
    return { ...this.describe(), switched };
  }

  private use(pool: ProxyPoolStored, entry: ProxyEntry) {
    pool.activeId = entry.id;
    this.opts.apply({ proxyType: entry.kind, proxyUrl: entry.url });
  }

  /** پروکسی فعالِ حذف‌شده یا خاموش‌شده دیگر نباید استفاده شود */
  private deactivate(pool: ProxyPoolStored) {
    pool.activeId = undefined;
    const fallback = pool.auto ? pool.entries.find((p) => p.id === chooseProxy(pool.entries).id) : undefined;
    if (fallback) this.use(pool, fallback);
    else this.opts.apply({ proxyType: "none", proxyUrl: "" });
  }

  /** سنجش دوره‌ای را مطابق وضعیت فعلی روشن یا خاموش می‌کند */
  schedule() {
    clearInterval(this.timer);
    this.timer = undefined;
    const pool = this.opts.store.proxyPool();
    if (!pool.auto || !pool.entries.some((p) => p.enabled)) return;
    this.timer = setInterval(() => {
      this.test().catch((err: unknown) => console.error("[diba-mcp] سنجش پروکسی‌ها ناموفق بود", err));
    }, this.opts.intervalMs ?? 5 * 60_000);
    // سنجش پس‌زمینه نباید جلوی خاموش شدن برنامه را بگیرد
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
