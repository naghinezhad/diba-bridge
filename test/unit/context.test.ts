import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, test } from "node:test";
import {
  compactConversation,
  compactToolResult,
  estimateRequestTokens,
  estimateTokens,
  extractContextLimit,
  fitContextToBudget,
  isContextLimitError,
  selectAndCompactTools,
  summarizeContextError,
} from "../../src/core/context.ts";
import { dibaRouterChat } from "../../src/core/dibarouter.ts";

describe("context management", () => {
  test("گفتگوی کوتاه بدون تغییر نگه داشته می‌شود", () => {
    const res = compactConversation([
      { role: "user", content: "سلام" },
      { role: "assistant", content: "سلام! چطور کمک کنم؟" },
    ]);
    assert.equal(res.compacted, false);
    assert.equal(res.summary, undefined);
    assert.equal(res.messages.length, 2);
  });

  test("گفتگوی طولانی خلاصه می‌شود و شناسه‌های مهم حفظ می‌شوند", () => {
    const turns = [];
    for (let i = 1; i <= 12; i++) {
      turns.push({
        role: "user",
        content: `پیام شماره ${i} برای چت 987654321 و کاربر @user_${i} با متن تست طولانی‌تر برای بررسی خلاصه‌سازی`,
      });
      turns.push({
        role: "assistant",
        content: `پاسخ شماره ${i} انجام شد.`,
      });
    }
    const res = compactConversation(turns, { keepRecent: 4, maxHistoryChars: 2000, maxSummaryChars: 900 });
    assert.equal(res.compacted, true);
    assert.ok(res.summary && res.summary.includes("خلاصه‌ی"));
    assert.ok(res.summary!.includes("987654321") || res.summary!.includes("@user_1"));
    assert.equal(res.messages.length, 4);
    assert.ok(res.stats.finalChars < res.stats.originalChars);
  });

  test("compactToolResult خروجی بزرگ ابزار را به JSON معتبر و کوتاه تبدیل می‌کند", () => {
    const big = {
      chats: Array.from({ length: 40 }, (_, i) => ({
        id: `1000${i}`,
        title: `گفتگوی آزمایشی شماره ${i} با عنوان نسبتاً طولانی`,
        photo: { dataUrl: "data:image/png;base64," + "A".repeat(5000) },
        raw: { huge: "X".repeat(5000) },
      })),
    };
    const out = compactToolResult(big, 1500);
    assert.ok(out.length <= 1500);
    const parsed = JSON.parse(out);
    assert.ok(Array.isArray(parsed.chats));
    assert.ok(parsed.chats.length < 40);
    assert.equal(parsed.chats[0].raw, undefined);
  });

  test("تشخیص و خلاصه‌سازی خطای Context Limit (8192 tokens)", () => {
    const errMsg = "request (9162 tokens) exceeds the available context size (8192 tokens), try increasing it";
    assert.equal(isContextLimitError(new Error(errMsg)), true);
    assert.equal(extractContextLimit(errMsg), 8192);
    const summary = summarizeContextError(errMsg);
    assert.match(summary, /9162/);
    assert.match(summary, /8192/);
    assert.equal(isContextLimitError(new Error("invalid api key")), false);
  });

  test("selectAndCompactTools ابزارهای مرتبط را انتخاب و در سقف توکن نگه می‌دارد", () => {
    const manyTools = Array.from({ length: 80 }, (_, i) => ({
      type: "function" as const,
      function: {
        name: i === 55 ? "telegram_send_message" : `bale_tool_${i}`,
        description: "A very long description ".repeat(10),
        parameters: {
          type: "object",
          properties: {
            chat_id: { type: "string", description: "Target chat identifier ".repeat(4) },
            text: { type: "string", description: "Message text ".repeat(4) },
          },
          additionalProperties: false,
        },
      },
    }));
    const selected = selectAndCompactTools(manyTools, "به تلگرام پیام بفرست", { maxTools: 15, maxToolTokens: 1600 });
    assert.ok(selected.length <= 15);
    assert.equal(selected[0].function.name, "telegram_send_message");
    assert.ok(estimateTokens(JSON.stringify(selected)) <= 1650);
  });

  test("selectAndCompactTools ابزارهای سیستمی را همیشه دارد و ابزار نوشتنی بی‌درخواست را حذف می‌کند", () => {
    const tool = (name: string) => ({
      type: "function" as const,
      function: { name, description: "", parameters: { type: "object", properties: {} } },
    });
    const tools = [
      tool("list_services"),
      tool("list_chats"),
      tool("bale_client_get_me"),
      tool("bale_client_send_message"),
      tool("bale_client_leave_chat"),
      ...Array.from({ length: 30 }, (_, i) => tool(`rubika_client_get_tool_${i}`)),
    ];
    const status = selectAndCompactTools(tools, "وضعیت سرویس‌ها چطور است؟", { maxTools: 10, maxToolTokens: 2400 });
    const statusNames = status.map((t) => t.function.name);
    assert.ok(statusNames.includes("list_services"));
    assert.ok(statusNames.includes("list_chats"));
    assert.ok(!statusNames.includes("bale_client_send_message"));
    assert.ok(!statusNames.includes("bale_client_leave_chat"));

    const send = selectAndCompactTools(tools, "به بله پیام بفرست", { maxTools: 10, maxToolTokens: 2400 });
    const sendNames = send.map((t) => t.function.name);
    assert.ok(sendNames.includes("list_services"));
    assert.ok(sendNames.includes("bale_client_send_message"));
    assert.ok(!sendNames.includes("bale_client_leave_chat"));

    const remove = selectAndCompactTools(tools, "عضو را از گروه حذف کن", { maxTools: 10, maxToolTokens: 2400 });
    assert.ok(remove.map((t) => t.function.name).includes("bale_client_leave_chat"));
  });

  test("fitContextToBudget درخواست بزرگ‌تر از سقف را به زیر بودجه می‌آورد", () => {
    const messages = [
      { role: "system", content: "سیستم پرامپت" },
      { role: "user", content: "پیام اول ".repeat(300) },
      { role: "assistant", content: "", tool_calls: [{ id: "1" }] },
      { role: "tool", content: JSON.stringify({ data: "متن طولانی ".repeat(600) }) },
      { role: "user", content: "آخرین سوال من" },
    ];
    const tools = Array.from({ length: 20 }, (_, i) => ({
      type: "function",
      function: { name: `t_${i}`, description: "desc ".repeat(20), parameters: { type: "object", properties: {} } },
    }));
    const fitted = fitContextToBudget(messages, tools, 2500);
    assert.equal(fitted.trimmed, true);
    assert.ok(estimateRequestTokens(fitted.messages, fitted.tools) <= 2500);
    assert.equal(fitted.messages.at(-1)?.content, "آخرین سوال من");
  });

  test("dibaRouterChat استریم SSE را پارس می‌کند و deltaها را زنده برمی‌گرداند", async () => {
    const server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      res.write('data: {"model":"test-model","choices":[{"delta":{"content":"سلام "}}]}\n\n');
      res.write('data: {"model":"test-model","choices":[{"delta":{"content":"دنیا!"},"finish_reason":"stop"}]}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as any;
    try {
      const deltas: string[] = [];
      const out = await dibaRouterChat(
        {
          baseUrl: `http://127.0.0.1:${addr.port}`,
          apiKey: "sk-test",
          model: "test-model",
        },
        [{ role: "user", content: "hi" }],
        { onDelta: (d) => deltas.push(d) },
      );
      assert.deepEqual(deltas, ["سلام ", "دنیا!"]);
      assert.equal(out.reply, "سلام دنیا!");
      assert.equal(out.model, "test-model");
    } finally {
      server.close();
    }
  });
});
