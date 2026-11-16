import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { CATEGORY_OF_ACTION, normalizeTrigger, TriggerValidationError } from "../../src/core/trigger-schema.ts";
import { defaultTriggers, TriggerEngine } from "../../src/core/triggers.ts";

const base = {
  name: "پاسخ سلام",
  event: "incoming_message",
  match: { provider: "*", chatType: "private", contains: "سلام" },
  action: { type: "reply_template", template: "سلام {{sender}}" },
};
const rejects = (body: unknown, field: string) =>
  assert.throws(() => normalizeTrigger(body), (e: unknown) => e instanceof TriggerValidationError && e.field === field, `انتظار خطا روی ${field}`);

describe("اعتبارسنجی تریگر", () => {
  test("ورودی درست تمیز می‌شود و دسته از روی اقدام پر می‌شود", () => {
    const t = normalizeTrigger({ ...base, name: "  پاسخ\u0000سلام  ", description: undefined });
    assert.equal(t.name, "پاسخ سلام", "کاراکتر کنترلی به فاصله تبدیل و دو سر متن تمیز می‌شود");
    assert.equal(t.category, "social");
    assert.equal(t.enabled, true);
    assert.deepEqual(t.match, { provider: "*", chatType: "private", contains: "سلام", toolName: "*" });
    assert.deepEqual(t.action, { type: "reply_template", template: "سلام {{sender}}" });
    for (const [type, category] of Object.entries(CATEGORY_OF_ACTION)) {
      const action = { type, template: "x", targetProvider: "bale_client", toolName: "list_services", webhookUrl: "https://example.com/hook" };
      assert.equal(normalizeTrigger({ ...base, action }).category, category);
    }
  });

  test("فقط فیلدهای همان نوع اقدام نگه داشته می‌شوند", () => {
    const t = normalizeTrigger({ ...base, action: { type: "webhook", webhookUrl: "https://example.com/hook", template: "جامانده", toolName: "x", systemPrompt: "y" } });
    assert.deepEqual(t.action, { type: "webhook", webhookUrl: "https://example.com/hook" });
  });

  test("فیلدهای الزامی و مقدارهای نامعتبر با نام فیلد رد می‌شوند", () => {
    rejects({ ...base, name: " " }, "name");
    rejects({ ...base, name: "x".repeat(81) }, "name");
    rejects({ ...base, event: "on_boot" }, "event");
    rejects({ ...base, category: "other" }, "category");
    rejects({ ...base, match: { provider: "bale client!" } }, "match.provider");
    rejects({ ...base, match: { chatType: "dm" } }, "match.chatType");
    rejects({ ...base, action: { type: "shell" } }, "action.type");
    rejects({ ...base, action: { type: "reply_template", template: "  " } }, "action.template");
    rejects({ ...base, action: { type: "forward", targetProvider: "" } }, "action.targetProvider");
    rejects({ ...base, action: { type: "call_tool", toolName: "" } }, "action.toolName");
    rejects({ ...base, action: { type: "call_tool", toolName: "rm -rf" } }, "action.toolName");
    rejects(null, "name");
  });

  test("آرگومان‌های ابزار باید با وجود متغیرها یک شیء JSON معتبر باشند", () => {
    const tool = (toolArgs: string) => ({ ...base, action: { type: "call_tool", toolName: "bale_client_send_message", toolArgs } });
    assert.ok(normalizeTrigger(tool('{"chat_id":"{{chatId}}","text":"{{text}}"}')));
    assert.ok(normalizeTrigger(tool("")));
    rejects(tool('{"text": {{text}} '), "action.toolArgs");
    rejects(tool('["a"]'), "action.toolArgs");
    rejects(tool('"just text"'), "action.toolArgs");
  });

  test("آدرس Webhook فقط http/https و بدون نام کاربری پذیرفته می‌شود", () => {
    const hook = (webhookUrl: string) => ({ ...base, action: { type: "webhook", webhookUrl } });
    assert.equal(normalizeTrigger(hook("https://example.com/hook?x=1")).action.webhookUrl, "https://example.com/hook?x=1");
    for (const bad of ["", "example.com/hook", "ftp://example.com", "javascript:alert(1)", "file:///etc/passwd", "https://user:pass@example.com/hook"]) {
      rejects(hook(bad), "action.webhookUrl");
    }
  });

  test("پاسخ به چت برای رویدادهای ابزار رد می‌شود ولی فوروارد و Webhook مجازند", () => {
    rejects({ ...base, event: "tool_error", action: { type: "reply_template", template: "x" } }, "action.type");
    rejects({ ...base, event: "tool_called", action: { type: "ai_reply" } }, "action.type");
    const t = normalizeTrigger({ ...base, event: "tool_error", match: { toolName: "*_send_*", provider: "bale_client", contains: "سلام" }, action: { type: "forward", targetProvider: "bale_client" } });
    // شرط‌های پیام ورودی برای رویداد ابزار معنا ندارند و پاک می‌شوند
    assert.deepEqual(t.match, { provider: "*", chatType: "*", contains: "", toolName: "*_send_*" });
    rejects({ ...base, event: "tool_error", match: { toolName: "a;b" }, action: { type: "forward", targetProvider: "bale_client" } }, "match.toolName");
    assert.ok(normalizeTrigger({ ...base, event: "manual", action: { type: "reply_template", template: "x" } }));
  });

  test("نمونه‌های آماده معتبرند؛ فقط نمونه‌های Webhook منتظر آدرس کاربر می‌مانند", () => {
    let waitingForUrl = 0;
    for (const preset of defaultTriggers()) {
      if (preset.action.type === "webhook" && !preset.action.webhookUrl) {
        // آدرس را کاربر هنگام ویرایش وارد می‌کند؛ تنها ایراد همین فیلد است
        rejects(preset, "action.webhookUrl");
        assert.doesNotThrow(() => normalizeTrigger({ ...preset, action: { ...preset.action, webhookUrl: "https://example.com/hook" } }), `نمونه‌ی ${preset.id}`);
        waitingForUrl++;
        continue;
      }
      assert.doesNotThrow(() => normalizeTrigger(preset), `نمونه‌ی ${preset.id}`);
    }
    assert.ok(waitingForUrl > 0);
  });
});

describe("TriggerEngine.replace", () => {
  test("اقدام قبلی کامل جایگزین می‌شود ولی شناسه و آمار اجرا می‌ماند", () => {
    const dir = mkdtempSync(join(tmpdir(), "diba-trg-replace-"));
    try {
      const host = { store: { dibarouter: () => ({ baseUrl: "", apiKey: "", model: "" }), resolve: () => ({ values: {} }), isReady: () => false }, provider: () => undefined, callTool: async () => ({ ok: true }) };
      const engine = new TriggerEngine(dir, host as any);
      const before = engine.list().triggers.find((t) => (t.hitCount ?? 0) > 0)!;
      const input = normalizeTrigger({ ...base, action: { type: "webhook", webhookUrl: "https://example.com/hook" } });
      const after = engine.replace(before.id, { ...input, enabled: false })!;
      assert.equal(after.id, before.id);
      assert.equal(after.hitCount, before.hitCount);
      assert.equal(after.builtin, before.builtin);
      assert.deepEqual(after.action, { type: "webhook", webhookUrl: "https://example.com/hook" });
      assert.equal(after.enabled, false);
      assert.equal(engine.replace("missing", input), undefined);
      // روی دیسک هم همین است
      assert.deepEqual(new TriggerEngine(dir, host as any).list().triggers.find((t) => t.id === before.id)?.action, after.action);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
