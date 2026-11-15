import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { AssistantMemory, normalizePersonName } from "../../src/core/memory.ts";

function withMemory(fn: (memory: AssistantMemory, dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "diba-memory-"));
  try {
    fn(new AssistantMemory(dir), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("AssistantMemory", () => {
  test("نام‌های فارسی/عربی نرمال می‌شوند", () => {
    assert.equal(normalizePersonName("علي"), normalizePersonName("علی"));
    assert.equal(normalizePersonName("  علی   رضایی "), "علی رضایی");
    assert.equal(normalizePersonName("مـــهمان"), normalizePersonName("مهمان"));
  });

  test("واقعیت‌های کاربر ذخیره، تکرارزدایی و بعد از ری‌استارت خوانده می‌شوند", () => {
    const dir = mkdtempSync(join(tmpdir(), "diba-memory-"));
    try {
      const a = new AssistantMemory(dir);
      const f1 = a.rememberFact("اسم من عماد است", ["profile"]);
      assert.ok(f1);
      const f2 = a.rememberFact("اسم من عماد است", ["name"]);
      assert.equal(f2?.id, f1?.id);
      assert.deepEqual(f2?.tags.sort(), ["name", "profile"]);
      assert.equal(a.facts().length, 1);

      const b = new AssistantMemory(dir);
      assert.equal(b.facts().length, 1);
      assert.match(b.promptContext("اسم من"), /عماد/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("مخاطب با نام جایگزین پیدا می‌شود و شمارنده‌ی ارسال زیاد می‌شود", () => {
    withMemory((memory) => {
      memory.upsertRecipient({
        provider: "telegram_client",
        chatId: "42",
        title: "علی رضایی",
        type: "private",
        aliases: ["علی"],
        increment: true,
      });
      const found = memory.findRecipients("علي");
      assert.equal(found.length, 1);
      assert.equal(found[0].provider, "telegram_client");
      assert.equal(found[0].sendCount, 1);
      const again = memory.upsertRecipient({
        provider: "telegram_client",
        chatId: "42",
        title: "علی رضایی",
        increment: true,
      });
      assert.equal(again.sendCount, 2);
    });
  });

  test("گفتگو ذخیره، تکرار نشود و با clearHistory پاک شود", () => {
    withMemory((memory) => {
      memory.appendTurn({ role: "user", content: "سلام" });
      memory.appendTurn({ role: "user", content: "سلام" });
      assert.equal(memory.history().length, 1);
      memory.appendTurn({ role: "assistant", content: "سلام، چطور کمک کنم؟", tools: ["list_services"] });
      assert.equal(memory.history().length, 2);
      assert.equal(memory.history()[1].tools?.[0], "list_services");
      assert.equal(memory.clearHistory(), 2);
      assert.equal(memory.history().length, 0);
    });
  });

  test("ارسال تکراری تشخیص داده می‌شود و زمینه‌ی پرامپت ساخته می‌شود", () => {
    withMemory((memory) => {
      memory.rememberFact("لحن کاربر رسمی و کوتاه است");
      memory.upsertRecipient({ provider: "whatsapp", chatId: "98912@s.whatsapp.net", title: "مریم", increment: true });
      memory.recordSend({
        provider: "whatsapp",
        chatId: "98912@s.whatsapp.net",
        title: "مریم",
        text: "سلام مریم، گزارش فردا آماده است.",
        ok: true,
      });
      assert.equal(memory.hasRecentText("whatsapp", "98912@s.whatsapp.net", "سلام مریم، گزارش فردا آماده است."), true);
      assert.equal(memory.hasRecentText("whatsapp", "98912@s.whatsapp.net", "متن دیگر"), false);
      const ctx = memory.promptContext("مریم");
      assert.match(ctx, /مریم/);
      assert.match(ctx, /سلام مریم/);
      assert.ok(!ctx.includes("98912@s.whatsapp.net"));
      assert.match(memory.promptContext("لحن"), /لحن کاربر/);
      assert.equal(memory.stats().sends, 1);
    });
  });
});
