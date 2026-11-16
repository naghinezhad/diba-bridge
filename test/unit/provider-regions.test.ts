import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { DibaMcpEngine } from "../../src/core/engine.ts";
import type { ProviderDef } from "../../src/core/types.ts";
import { builtinProviders } from "../../src/providers/index.ts";

/** منطقه و دسته‌ای که داشبورد برای چیدن تب‌ها و زیرمنوی ایرانی/خارجی به آن تکیه می‌کند */
const EXPECTED: Record<string, { category: string; region: string }> = {
  bale_client: { category: "messenger", region: "iran" },
  eitaa_client: { category: "messenger", region: "iran" },
  rubika_client: { category: "messenger", region: "iran" },
  soroush_client: { category: "messenger", region: "iran" },
  telegram_client: { category: "messenger", region: "international" },
  whatsapp: { category: "messenger", region: "international" },
  instagram: { category: "messenger", region: "international" },
  x: { category: "messenger", region: "international" },
  linkedin: { category: "messenger", region: "international" },
  wordpress: { category: "utility", region: "international" },
  blubank: { category: "banking", region: "iran" },
};

describe("دسته و منطقه‌ی سرویس‌ها", () => {
  test("هر سرویس داخلی منطقه‌ی صریح و دسته‌ی مورد انتظار دارد", () => {
    for (const p of builtinProviders) {
      const expected = EXPECTED[p.id];
      assert.ok(expected, `سرویس ${p.id} در جدول انتظار این تست نیست؛ دسته و منطقه‌اش را اضافه کنید`);
      assert.equal(p.category, expected.category, `دسته‌ی ${p.id}`);
      assert.equal(p.region, expected.region, `منطقه‌ی ${p.id}`);
    }
    assert.deepEqual(builtinProviders.map((p) => p.id).sort(), Object.keys(EXPECTED).sort());
  });

  test("سرویس‌های بانکی از پیام‌رسان‌ها جدا هستند", () => {
    const banking = builtinProviders.filter((p) => p.category === "banking").map((p) => p.id);
    assert.deepEqual(banking, ["blubank"]);
  });

  test("describeProviders دسته، منطقه و غیررسمی بودن را به داشبورد می‌دهد", () => {
    const base = { name: "T", nameFa: "ت", color: "#000", glyph: "ت", description: "", fields: [], tools: [] };
    const providers: ProviderDef[] = [
      { ...base, id: "bank_ir", category: "banking", region: "iran", unofficial: true },
      { ...base, id: "bank_intl", category: "banking", region: "international" },
      { ...base, id: "no_region", category: "utility" },
    ];
    const engine = new DibaMcpEngine({ dataDir: mkdtempSync(join(tmpdir(), "diba-region-")), providers, env: {} });
    const described = engine.describeProviders().map(({ id, category, region, unofficial }) => ({ id, category, region, unofficial }));
    assert.deepEqual(described, [
      { id: "bank_ir", category: "banking", region: "iran", unofficial: true },
      { id: "bank_intl", category: "banking", region: "international", unofficial: false },
      // بدون منطقه‌ی صریح، سرویس «خارجی» حساب می‌شود
      { id: "no_region", category: "utility", region: "international", unofficial: false },
    ]);
  });
});
