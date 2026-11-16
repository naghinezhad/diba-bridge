/**
 * فهرست پروکسی‌ها و انتخاب خودکار سریع‌ترین.
 *
 * هر پروکسی چند بار و روی چند مقصد سنجیده می‌شود. از نمونه‌ها یک «امتیاز» ساخته می‌شود
 * (کمتر = بهتر) که هم سرعت را می‌بیند، هم پایداری و هم سابقه:
 *
 *   امتیاز = EWMA(میانه‌ی تأخیر) × (۱ + ۴ × نرخ خطا) + ۰٫۵ × لرزش
 *
 *   - میانه به‌جای میانگین: یک نمونه‌ی کند اتفاقی نتیجه را خراب نمی‌کند.
 *   - EWMA: سنجش تازه وزن بیشتری دارد ولی سابقه یک‌باره دور ریخته نمی‌شود.
 *   - جریمه‌ی خطا: پروکسی سریع ولی ناپایدار از پروکسی کمی کندتر و مطمئن عقب می‌افتد.
 *   - لرزش (پراکندگی نمونه‌ها): اتصال یکنواخت به اتصال پرنوسان ترجیح دارد.
 *
 * جابه‌جایی هم «هیسترزیس» دارد: پروکسی فعال فقط وقتی عوض می‌شود که گزینه‌ی تازه دست‌کم
 * ۱۵٪ بهتر باشد، مگر اینکه پروکسی فعال از کار افتاده باشد. این جلوی رفت‌وبرگشت بی‌دلیل را می‌گیرد.
 */
import { createHash } from "node:crypto";

export type ProxyKind = "http" | "socks5";

export interface ProxyStats {
  /** میانگین نمایی تأخیر (میلی‌ثانیه) */
  ewmaMs?: number;
  /** لرزش آخرین سنجش (میلی‌ثانیه) */
  jitterMs?: number;
  /** نرخ خطا در پنجره‌ی اخیر، بین ۰ و ۱ */
  failRate: number;
  /** تعداد سنجش‌های پیاپیِ کاملاً ناموفق */
  consecutiveFailures: number;
  checks: number;
  lastCheckedAt?: string;
  lastError?: string;
}

export interface ProxyEntry {
  id: string;
  /** نشانی کامل، شامل نام کاربری و رمز در صورت وجود */
  url: string;
  kind: ProxyKind;
  label?: string;
  enabled: boolean;
  stats: ProxyStats;
}

export interface ProbeSample {
  ok: boolean;
  ms: number;
  error?: string;
}

export const PROXY_POOL_LIMIT = 50;
/** وزن سنجش تازه در EWMA */
const EWMA_ALPHA = 0.4;
/** وزن سنجش تازه در نرخ خطا */
const FAIL_ALPHA = 0.5;
const FAIL_PENALTY = 4;
const JITTER_WEIGHT = 0.5;
/** گزینه‌ی تازه باید دست‌کم این نسبت بهتر باشد تا جای پروکسی فعال را بگیرد */
export const SWITCH_MARGIN = 0.15;
/** پس از این تعداد سنجش ناموفق پیاپی، پروکسی از کار افتاده حساب می‌شود */
export const DEAD_AFTER = 2;

export class ProxyUrlError extends Error {}

/** نشانی پروکسی را بررسی و یکدست می‌کند؛ فقط http، https و socks5 پذیرفته می‌شود */
export function normalizeProxyUrl(raw: string): { url: string; kind: ProxyKind } {
  const text = String(raw ?? "").trim();
  if (!text) throw new ProxyUrlError("نشانی پروکسی خالی است");
  if (text.length > 500) throw new ProxyUrlError("نشانی پروکسی خیلی طولانی است");
  // «host:port» بدون پروتکل، پروکسی HTTP فرض می‌شود
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    throw new ProxyUrlError(`نشانی پروکسی معتبر نیست: ${text.slice(0, 60)}`);
  }
  const protocol = u.protocol.toLowerCase();
  const kind: ProxyKind | null = protocol === "http:" || protocol === "https:" ? "http" : protocol === "socks5:" || protocol === "socks5h:" || protocol === "socks:" ? "socks5" : null;
  if (!kind) throw new ProxyUrlError("پروتکل پروکسی باید http، https یا socks5 باشد");
  if (!u.hostname) throw new ProxyUrlError("نام میزبان پروکسی مشخص نیست");
  const port = u.port || (kind === "socks5" ? "1080" : protocol === "https:" ? "443" : "8080");
  const auth = u.username ? `${u.username}${u.password ? `:${u.password}` : ""}@` : "";
  const scheme = kind === "socks5" ? "socks5" : protocol.slice(0, -1);
  return { url: `${scheme}://${auth}${u.hostname}:${port}`, kind };
}

/** شناسه‌ی پایدار از روی نشانی؛ افزودن دوباره‌ی همان پروکسی تکراری نمی‌سازد */
export function proxyId(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 12);
}

/** رمز را پنهان می‌کند؛ هر چیزی که به مرورگر یا لاگ می‌رود باید از همین تابع رد شود */
export function maskProxyUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

/** متن چندخطی (هر خط یک پروکسی) را به فهرست تبدیل می‌کند؛ خط‌های نامعتبر جدا گزارش می‌شوند */
export function parseProxyList(text: string): { entries: { url: string; kind: ProxyKind }[]; invalid: string[] } {
  const entries: { url: string; kind: ProxyKind }[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const line of String(text ?? "").split(/[\r\n,;]+/)) {
    const raw = line.trim();
    if (!raw || raw.startsWith("#")) continue;
    try {
      const item = normalizeProxyUrl(raw);
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      entries.push(item);
    } catch {
      invalid.push(maskProxyUrl(raw).slice(0, 80));
    }
  }
  return { entries, invalid };
}

export function emptyStats(): ProxyStats {
  return { failRate: 0, consecutiveFailures: 0, checks: 0 };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** میانگین قدر مطلق فاصله از میانه؛ در برابر نمونه‌ی پرت مقاوم‌تر از انحراف معیار است */
function jitter(values: number[], center: number): number {
  if (values.length < 2) return 0;
  return values.reduce((sum, v) => sum + Math.abs(v - center), 0) / values.length;
}

/** آمار پروکسی را با نمونه‌های یک دور سنجش به‌روز می‌کند (آمار قبلی دست نمی‌خورد) */
export function updateStats(prev: ProxyStats, samples: ProbeSample[], now = new Date()): ProxyStats {
  const ok = samples.filter((s) => s.ok).map((s) => s.ms);
  const roundFail = samples.length ? (samples.length - ok.length) / samples.length : 1;
  const next: ProxyStats = {
    ...prev,
    checks: prev.checks + 1,
    lastCheckedAt: now.toISOString(),
    failRate: prev.checks === 0 ? roundFail : prev.failRate * (1 - FAIL_ALPHA) + roundFail * FAIL_ALPHA,
    consecutiveFailures: ok.length ? 0 : prev.consecutiveFailures + 1,
    lastError: ok.length === samples.length ? undefined : samples.find((s) => !s.ok)?.error,
  };
  if (ok.length) {
    const mid = median(ok);
    next.ewmaMs = Math.round(prev.ewmaMs === undefined ? mid : prev.ewmaMs * (1 - EWMA_ALPHA) + mid * EWMA_ALPHA);
    next.jitterMs = Math.round(jitter(ok, mid));
  }
  return next;
}

/** امتیاز یک پروکسی؛ کمتر بهتر است. پروکسی سنجیده‌نشده یا ازکارافتاده امتیاز بی‌نهایت می‌گیرد */
export function proxyScore(stats: ProxyStats): number {
  if (stats.ewmaMs === undefined || stats.consecutiveFailures >= DEAD_AFTER) return Number.POSITIVE_INFINITY;
  return stats.ewmaMs * (1 + FAIL_PENALTY * stats.failRate) + JITTER_WEIGHT * (stats.jitterMs ?? 0);
}

export function isAlive(stats: ProxyStats): boolean {
  return Number.isFinite(proxyScore(stats));
}

/** پروکسی‌های روشن و سالم، از بهترین به بدترین */
export function rankProxies(pool: ProxyEntry[]): ProxyEntry[] {
  return pool
    .filter((p) => p.enabled && isAlive(p.stats))
    .sort((a, b) => proxyScore(a.stats) - proxyScore(b.stats) || a.id.localeCompare(b.id));
}

/**
 * پروکسی فعال بعدی را انتخاب می‌کند.
 * اگر پروکسی فعال سالم باشد، فقط وقتی کنار می‌رود که بهترین گزینه دست‌کم SWITCH_MARGIN بهتر باشد.
 * خروجی undefined یعنی هیچ پروکسی سالمی نیست.
 */
export function chooseProxy(pool: ProxyEntry[], currentId?: string): { id?: string; reason: "none" | "keep" | "first" | "faster" | "failover" } {
  const ranked = rankProxies(pool);
  const best = ranked[0];
  if (!best) return { id: undefined, reason: "none" };
  const current = currentId ? pool.find((p) => p.id === currentId) : undefined;
  if (!current) return { id: best.id, reason: "first" };
  if (!current.enabled || !isAlive(current.stats)) return { id: best.id, reason: "failover" };
  if (best.id === current.id) return { id: current.id, reason: "keep" };
  const improvement = 1 - proxyScore(best.stats) / proxyScore(current.stats);
  return improvement >= SWITCH_MARGIN ? { id: best.id, reason: "faster" } : { id: current.id, reason: "keep" };
}

export type ProbeFn = (proxyUrl: string, target: string, timeoutMs: number) => Promise<ProbeSample>;

export interface ProbeOptions {
  targets: string[];
  rounds: number;
  timeoutMs: number;
  /** چند پروکسی هم‌زمان سنجیده شوند */
  concurrency: number;
}

export const DEFAULT_PROBE: ProbeOptions = {
  targets: ["https://www.gstatic.com/generate_204", "https://cp.cloudflare.com/generate_204"],
  rounds: 3,
  timeoutMs: 8000,
  concurrency: 6,
};

/**
 * همه‌ی پروکسی‌های روشن را می‌سنجد و فهرست را با آمار تازه برمی‌گرداند.
 * نمونه‌های هر پروکسی پشت‌سرهم گرفته می‌شوند (تا خودش را کند نکند) ولی پروکسی‌ها موازی‌اند.
 */
export async function probePool(pool: ProxyEntry[], probe: ProbeFn, opts: Partial<ProbeOptions> = {}): Promise<ProxyEntry[]> {
  const o = { ...DEFAULT_PROBE, ...opts };
  const result = pool.map((p) => ({ ...p, stats: { ...p.stats } }));
  const queue = result.filter((p) => p.enabled);
  const worker = async () => {
    for (let entry = queue.shift(); entry; entry = queue.shift()) {
      const samples: ProbeSample[] = [];
      for (let round = 0; round < o.rounds; round++) {
        const target = o.targets[round % o.targets.length];
        try {
          samples.push(await probe(entry.url, target, o.timeoutMs));
        } catch (err: any) {
          samples.push({ ok: false, ms: o.timeoutMs, error: String(err?.message ?? err) });
        }
        // پروکسی‌ای که دو بار پشت‌سرهم جواب نداده را بیشتر معطل نمی‌کنیم
        if (samples.length >= 2 && samples.every((s) => !s.ok)) break;
      }
      entry.stats = updateStats(entry.stats, samples);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency, queue.length)) }, worker));
  return result;
}
