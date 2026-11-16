import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { TriggerEngine, TRIGGER_SEED_VERSION, defaultTriggers } from "../../src/core/triggers.ts";

function mockHost(overrides: Record<string, unknown> = {}) {
  return {
    store: {
      dibarouter: () => ({ baseUrl: "", apiKey: "", model: "" }),
      resolve: () => ({ values: {} }),
      isReady: () => false,
    },
    provider: () => undefined,
    callTool: async () => ({ ok: true }),
    ...overrides,
  };
}

const CATEGORIES = new Set(["social", "ai", "mcp", "forward", "webhook"]);
const EVENTS = new Set(["incoming_message", "tool_called", "tool_error"]);
const ACTIONS = new Set(["reply_template", "ai_reply", "forward", "call_tool", "webhook"]);

describe("TriggerEngine", () => {
  test("کتابخانه‌ی نمونه‌ها کامل، یکتا و به‌صورت پیش‌فرض خاموش است", () => {
    const presets = defaultTriggers();
    assert.ok(presets.length >= 30, `انتظار نمونه‌های بیشتر، دریافت: ${presets.length}`);
    assert.equal(new Set(presets.map((p) => p.id)).size, presets.length, "شناسه‌ها باید یکتا باشند");

    for (const p of presets) {
      assert.ok(CATEGORIES.has(p.category), `دسته‌ی نامعتبر: ${p.id}`);
      assert.ok(EVENTS.has(p.event), `رویداد نامعتبر: ${p.id}`);
      assert.ok(ACTIONS.has(p.action.type), `اقدام نامعتبر: ${p.id}`);
      // تنها استثنا «دستیار هوشمند پیش‌فرض» است که فقط وقتی هیچ تریگر دیگری جواب نداده اجرا می‌شود
      assert.equal(p.enabled, p.id === "ai-assistant-default", `فقط دستیار پیش‌فرض خودکار روشن است: ${p.id}`);
      assert.ok(p.name.trim() && p.description.trim(), `نام/توضیح خالی: ${p.id}`);
      if (p.action.type === "reply_template") assert.ok(p.action.template?.trim(), `قالب خالی: ${p.id}`);
      if (p.action.type === "ai_reply") assert.ok(p.action.systemPrompt?.trim(), `پرامپت خالی: ${p.id}`);
      if (p.action.type === "call_tool") assert.ok(p.action.toolName?.trim(), `ابزار خالی: ${p.id}`);
    }

    // هر پنج دسته باید نمونه داشته باشند تا فیلترهای صفحه خالی نمانند
    for (const cat of CATEGORIES) {
      assert.ok(presets.some((p) => p.category === cat), `دسته‌ی بدون نمونه: ${cat}`);
    }
  });

  test("نصب تازه: همه‌ی نمونه‌ها + گزارش‌های نمونه ساخته می‌شوند", () => {
    const fresh = mkdtempSync(join(tmpdir(), "diba-trg-fresh-"));
    try {
      const engine = new TriggerEngine(fresh, mockHost() as any);
      const { triggers, logs, seedVersion } = engine.list();
      assert.equal(triggers.length, defaultTriggers().length);
      assert.equal(seedVersion, TRIGGER_SEED_VERSION);
      assert.ok(logs.length >= 10, "گزارش‌های نمونه برای نمایش صفحه لازم است");
      assert.ok(logs.every((l) => l.demo === true), "گزارش‌های اولیه باید demo باشند");
      assert.ok(logs.some((l) => !l.ok), "باید چند خطای نمونه هم وجود داشته باشد");
      // آمار اجرا از گزارش‌های نمونه ساخته می‌شود
      assert.ok(triggers.some((t) => (t.hitCount ?? 0) > 0 && t.lastRunAt));
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  test("فعال، تست، ساخت و حذف تریگر", () => {
    const work = mkdtempSync(join(tmpdir(), "diba-trg-crud-"));
    try {
      const engine = new TriggerEngine(work, mockHost() as any);
      const total = engine.list().triggers.length;

      const updated = engine.update("social-welcome", { enabled: true });
      assert.equal(updated?.enabled, true);

      assert.equal(engine.update("nope", { enabled: true }), undefined);
      assert.equal(engine.remove("nope"), false);

      const custom = engine.create({
        name: "تست سفارشی",
        description: "desc",
        category: "social",
        enabled: true,
        event: "incoming_message",
        match: { provider: "bale_client", contains: "سلام" },
        action: { type: "reply_template", template: "علیک سلام {{sender}}" },
      });
      assert.equal(engine.list().triggers.length, total + 1);
      assert.equal(engine.remove(custom.id), true);
      assert.equal(engine.list().triggers.length, total);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  test("تریگر پیام ورودی و خطای MCP هنگام تطابق اجرا می‌شوند", async () => {
    const work = mkdtempSync(join(tmpdir(), "diba-trg-exec-"));
    try {
      const calls: Array<{ name: string; args: any }> = [];
      const engine = new TriggerEngine(
        work,
        mockHost({
          store: {
            dibarouter: () => ({ baseUrl: "", apiKey: "", model: "" }),
            resolve: () => ({ values: { defaultChatId: "999" } }),
            isReady: () => true,
          },
          provider: (id: string) => ({ id }),
          callTool: async (name: string, args: unknown) => {
            calls.push({ name, args });
            return { ok: true };
          },
        }) as any,
      );
      engine.clearLogs();
      engine.update("social-welcome", { enabled: true });
      engine.update("mcp-tool-error-alert", { enabled: true });

      await engine.onIncomingMessage({
        key: "bale_client:100:1",
        provider: "bale_client",
        chatId: "100",
        chatType: "private",
        messageId: "1",
        from: { name: "علی" },
        text: "سلام وقت بخیر",
        kind: "text",
        date: new Date().toISOString(),
        direction: "in",
      });

      await engine.onToolEvent({
        tool: "telegram_client_send_message",
        args: { chat_id: "1" },
        ok: false,
        error: "timeout",
        source: "mcp",
      });

      assert.equal(calls.length, 2);
      assert.equal(calls[0].name, "bale_client_send_message");
      assert.equal(calls[0].args.chat_id, "100");
      assert.match(calls[0].args.text, /علی/);

      assert.equal(calls[1].name, "bale_client_send_message");
      assert.equal(calls[1].args.chat_id, "999");
      assert.match(calls[1].args.text, /telegram_client_send_message/);
      assert.equal(engine.list().logs.length, 2);
      assert.ok(engine.list().logs.every((l) => !l.demo));
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  test("نصب قدیمی: نمونه‌های تازه اضافه می‌شوند و تنظیمات کاربر حفظ می‌شود", () => {
    const work = mkdtempSync(join(tmpdir(), "diba-trg-upgrade-"));
    try {
      const legacy = {
        triggers: [
          {
            id: "social-welcome",
            name: "نام دلخواه کاربر",
            description: "ویرایش‌شده",
            category: "social",
            enabled: true,
            builtin: true,
            event: "incoming_message",
            match: { provider: "*" },
            action: { type: "reply_template", template: "سلام سفارشی" },
          },
        ],
        logs: [],
      };
      writeFileSync(join(work, "triggers.json"), JSON.stringify(legacy), "utf8");

      const engine = new TriggerEngine(work, mockHost() as any);
      const { triggers, logs } = engine.list();
      assert.equal(triggers.length, defaultTriggers().length, "نمونه‌های جامانده باید اضافه شوند");

      const kept = triggers.find((t) => t.id === "social-welcome");
      assert.equal(kept?.name, "نام دلخواه کاربر", "ویرایش کاربر نباید بازنویسی شود");
      assert.equal(kept?.enabled, true);
      assert.ok(logs.length > 0, "برای نصب قدیمی بدون گزارش هم نمونه ساخته می‌شود");

      // بار دوم نباید چیزی دوباره اضافه شود
      const again = new TriggerEngine(work, mockHost() as any);
      assert.equal(again.list().triggers.length, triggers.length);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
