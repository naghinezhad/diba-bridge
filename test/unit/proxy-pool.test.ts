import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ProxyManager, ProxyPoolError } from "../../src/core/proxy-manager.ts";
import {
  chooseProxy,
  emptyStats,
  maskProxyUrl,
  normalizeProxyUrl,
  parseProxyList,
  probePool,
  proxyId,
  proxyScore,
  ProxyUrlError,
  rankProxies,
  updateStats,
  type ProbeFn,
  type ProxyEntry,
  type ProxyStats,
} from "../../src/core/proxy-pool.ts";
import type { ProxyPoolStored } from "../../src/core/store.ts";

const ok = (ms: number) => ({ ok: true, ms });
const fail = () => ({ ok: false, ms: 8000, error: "timeout" });
const entry = (name: string, stats: Partial<ProxyStats> = {}, enabled = true): ProxyEntry => ({
  id: name,
  url: `http://${name}.example:8080`,
  kind: "http",
  enabled,
  stats: { ...emptyStats(), ...stats },
});

describe("نشانی پروکسی", () => {
  test("پروتکل‌های مجاز، پورت پیش‌فرض و شکل یکدست", () => {
    assert.deepEqual(normalizeProxyUrl("10.0.0.1:3128"), { url: "http://10.0.0.1:3128", kind: "http" });
    assert.deepEqual(normalizeProxyUrl("socks5://user:p%40ss@host.example"), { url: "socks5://user:p%40ss@host.example:1080", kind: "socks5" });
    assert.equal(normalizeProxyUrl("HTTPS://proxy.example").url, "https://proxy.example:443");
    for (const bad of ["", "ftp://host:21", "file:///etc/passwd", "javascript:alert(1)", "http://"]) {
      assert.throws(() => normalizeProxyUrl(bad), ProxyUrlError, bad);
    }
  });

  test("رمز در نمای داشبورد پنهان می‌شود", () => {
    assert.equal(maskProxyUrl("socks5://user:secret@host.example:1080"), "socks5://user:***@host.example:1080");
    assert.equal(maskProxyUrl("http://host.example:8080"), "http://host.example:8080");
  });

  test("فهرست چندخطی: تکراری حذف و خط نامعتبر جدا گزارش می‌شود", () => {
    const { entries, invalid } = parseProxyList("http://a.example:1\n# توضیح\nsocks5://b.example\nhttp://a.example:1\nftp://c.example\n\n");
    assert.deepEqual(entries.map((e) => e.url), ["http://a.example:1", "socks5://b.example:1080"]);
    assert.equal(invalid.length, 1);
    assert.equal(proxyId("http://a.example:1"), proxyId("http://a.example:1"));
  });
});

describe("امتیازدهی پروکسی", () => {
  test("میانه در برابر یک نمونه‌ی کند مقاوم است و EWMA سابقه را نگه می‌دارد", () => {
    const first = updateStats(emptyStats(), [ok(100), ok(110), ok(2000)]);
    assert.equal(first.ewmaMs, 110);
    const second = updateStats(first, [ok(210), ok(210), ok(210)]);
    assert.equal(second.ewmaMs, 150, "۶۰٪ سابقه + ۴۰٪ سنجش تازه");
    assert.equal(second.failRate, 0);
  });

  test("پروکسی ناپایدار از پروکسی کمی کندتر ولی مطمئن عقب می‌افتد", () => {
    const flaky = updateStats(emptyStats(), [ok(80), fail(), fail()]);
    const steady = updateStats(emptyStats(), [ok(140), ok(150), ok(145)]);
    assert.ok(proxyScore(steady) < proxyScore(flaky));
  });

  test("سنجیده‌نشده و ازکارافتاده رتبه نمی‌گیرند", () => {
    assert.equal(proxyScore(emptyStats()), Infinity);
    let dead = updateStats(updateStats(emptyStats(), [ok(100)]), [fail(), fail()]);
    assert.ok(Number.isFinite(proxyScore(dead)), "یک دور خطا هنوز فرصت دوباره دارد");
    dead = updateStats(dead, [fail(), fail()]);
    assert.equal(proxyScore(dead), Infinity);
    assert.ok(Number.isFinite(proxyScore(updateStats(dead, [ok(120)]))));
    const pool = [entry("dead", dead), entry("off", { ewmaMs: 10, checks: 1 }, false), entry("fast", { ewmaMs: 90, checks: 1 }), entry("slow", { ewmaMs: 300, checks: 1 })];
    assert.deepEqual(rankProxies(pool).map((p) => p.id), ["fast", "slow"]);
  });
});

describe("انتخاب پروکسی فعال", () => {
  const stats = (ewmaMs: number): Partial<ProxyStats> => ({ ewmaMs, checks: 3 });

  test("بدون پروکسی سالم چیزی انتخاب نمی‌شود و اولین انتخاب سریع‌ترین است", () => {
    assert.deepEqual(chooseProxy([entry("a")]), { id: undefined, reason: "none" });
    assert.deepEqual(chooseProxy([entry("a", stats(200)), entry("b", stats(100))]), { id: "b", reason: "first" });
  });

  test("برتری کمتر از ۱۵٪ باعث جابه‌جایی نمی‌شود", () => {
    const pool = [entry("current", stats(100)), entry("other", stats(92))];
    assert.deepEqual(chooseProxy(pool, "current"), { id: "current", reason: "keep" });
    pool[1].stats.ewmaMs = 80;
    assert.deepEqual(chooseProxy(pool, "current"), { id: "other", reason: "faster" });
  });

  test("با از کار افتادن پروکسی فعال، بی‌درنگ جایگزین می‌شود", () => {
    const pool = [entry("current", { ewmaMs: 50, checks: 4, consecutiveFailures: 2 }), entry("backup", stats(400))];
    assert.deepEqual(chooseProxy(pool, "current"), { id: "backup", reason: "failover" });
  });
});

describe("سنجش و مدیریت فهرست", () => {
  const speeds: Record<string, number | null> = { "http://fast.example:8080": 60, "http://slow.example:8080": 300, "http://down.example:8080": null };
  const probe: ProbeFn = async (url) => {
    const ms = speeds[url];
    return ms === null || ms === undefined ? { ok: false, ms: 5, error: "اتصال رد شد" } : { ok: true, ms };
  };

  function manager() {
    let pool: ProxyPoolStored = { auto: false, entries: [] };
    const applied: { proxyType: string; proxyUrl: string }[] = [];
    const m = new ProxyManager({
      store: { proxyPool: () => structuredClone(pool), saveProxyPool: (p) => (pool = structuredClone(p)) },
      probe,
      apply: (s) => applied.push(s),
      probeOptions: { rounds: 3, concurrency: 2 },
    });
    return { m, applied, pool: () => pool };
  }

  test("probePool پروکسی خاموش را نمی‌سنجد و ورودی را تغییر نمی‌دهد", async () => {
    const input = [entry("fast"), entry("down"), entry("slow", {}, false)];
    const out = await probePool(input, probe, { rounds: 3, concurrency: 2 });
    assert.equal(out[0].stats.ewmaMs, 60);
    assert.equal(out[1].stats.consecutiveFailures, 1);
    assert.equal(out[2].stats.checks, 0);
    assert.equal(input[0].stats.checks, 0);
  });

  test("با انتخاب خودکار، سریع‌ترین پروکسی سالم فعال می‌شود و رمز بیرون نمی‌رود", async () => {
    const { m, applied } = manager();
    const added = m.add("http://slow.example:8080\nhttp://fast.example:8080\nhttp://down.example:8080\nhttp://fast.example:8080\nnot a proxy url");
    assert.deepEqual({ added: added.added, duplicates: added.duplicates, invalid: added.invalid.length }, { added: 3, duplicates: 0, invalid: 1 });
    m.setAuto(true);
    const result = await m.test();
    m.stop();
    assert.equal(result.switched?.reason, "first");
    assert.deepEqual(applied.at(-1), { proxyType: "http", proxyUrl: "http://fast.example:8080" });
    assert.deepEqual(result.entries.map((e) => [e.url, e.active, e.alive]), [
      ["http://fast.example:8080", true, true],
      ["http://slow.example:8080", false, true],
      ["http://down.example:8080", false, false],
    ]);
    assert.equal(result.entries[2].successRate, 0);

    speeds["http://fast.example:8080"] = null;
    await m.test();
    const after = await m.test();
    speeds["http://fast.example:8080"] = 60;
    assert.deepEqual(applied.at(-1), { proxyType: "http", proxyUrl: "http://slow.example:8080" });
    assert.equal(after.entries.find((e) => e.active)?.url, "http://slow.example:8080");
  });

  test("فعال‌سازی دستی انتخاب خودکار را خاموش می‌کند و حذف پروکسی فعال آن را برمی‌دارد", async () => {
    const { m, applied, pool } = manager();
    m.add("socks5://user:secret@fast.example:1080");
    const id = pool().entries[0].id;
    assert.equal(m.describe().entries[0].url, "socks5://user:***@fast.example:1080");
    m.setAuto(true);
    m.activate(id);
    m.stop();
    assert.equal(pool().auto, false);
    assert.deepEqual(applied.at(-1), { proxyType: "socks5", proxyUrl: "socks5://user:secret@fast.example:1080" });
    m.remove(id);
    assert.deepEqual(applied.at(-1), { proxyType: "none", proxyUrl: "" });
    assert.throws(() => m.remove(id), ProxyPoolError);
    assert.throws(() => m.add("   "), ProxyPoolError);
  });
});
