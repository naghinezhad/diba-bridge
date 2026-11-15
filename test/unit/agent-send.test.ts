import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { z } from "zod";
import { handleSendReply, parseSendIntent, prepareSend } from "../../src/core/agent-send.ts";
import type { DibaRouterConfig } from "../../src/core/dibarouter.ts";
import { DibaMcpEngine } from "../../src/core/engine.ts";
import { defineTool, type ProviderDef } from "../../src/core/types.ts";

function setup(chats: Array<Record<string, unknown>>) {
  let sends = 0;
  let lastText = "";
  const provider: ProviderDef = {
    id: "telegram_client",
    name: "Telegram Client",
    nameFa: "تلگرام (حساب کاربری)",
    category: "messenger",
    color: "#000",
    glyph: "ت",
    description: "",
    fields: [{ key: "session", label: "session", type: "secret", required: true }],
    tools: [
      defineTool({
        name: "telegram_client_get_chats",
        title: "چت‌ها",
        description: "chats",
        input: { limit: z.number().int().min(1).max(100).optional() },
        handler: async () => ({ chats }),
      }),
      defineTool({
        name: "telegram_client_send_message",
        title: "ارسال",
        description: "send",
        input: { chat_id: z.string().min(1), text: z.string().min(1).max(4096) },
        handler: async (a) => {
          sends++;
          lastText = a.text;
          return { ok: true, chat_id: a.chat_id, message_id: String(sends) };
        },
      }),
    ],
  };
  const dataDir = mkdtempSync(join(tmpdir(), "diba-agent-send-"));
  const engine = new DibaMcpEngine({ dataDir, providers: [provider], env: {} });
  engine.store.update("telegram_client", { enabled: true, values: { session: "s".repeat(24) } });
  return {
    engine,
    sends: () => sends,
    lastText: () => lastText,
    close: () => {
      engine.inbox.stop();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

async function mockModel(reply: string) {
  const server = createServer((req, res) => {
    req.on("data", () => undefined);
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model: "mock", choices: [{ message: { role: "assistant", content: reply } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as any;
  const config: DibaRouterConfig = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    apiKey: "test",
    model: "mock",
  };
  return { config, close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); }) };
}

const now = new Date().toISOString();
const intentFor = (recipient: string, instruction = "فردا جلسه داریم.") => ({
  recipient,
  instruction,
  raw: `به ${recipient} پیام بده که ${instruction}`,
});

describe("agent send prepare/confirm", () => {
  test("الگوی «به X پیام بده» را از متن بیرون می‌کشد", () => {
    assert.equal(parseSendIntent("به علی رضایی پیام بده که فردا جلسه داریم.")?.recipient, "علی رضایی");
    assert.equal(parseSendIntent("برای علی پیام بفرست که فردا می‌بینمت")?.recipient, "علی");
    assert.equal(parseSendIntent("پیام به علی بده")?.recipient, "علی");
    assert.equal(parseSendIntent("پیام بده به علی که فردا می‌بینمت")?.recipient, "علی");
    assert.equal(parseSendIntent("به علی بگو فردا ساعت ۱۰ بیا")?.recipient, "علی");
    assert.equal(parseSendIntent("به من بگو چه سرویس‌هایی آماده‌اند"), undefined);
    assert.equal(parseSendIntent("به علی پیام بده؟"), undefined);
    assert.equal(parseSendIntent("وضعیت سرویس‌ها را بگو"), undefined);
  });

  test("مخاطب یکتا: پیش‌نویس ساخته می‌شود، چیزی ارسال نمی‌شود و پس از «بله» ارسال می‌شود", async () => {
    const s = setup([{ chat_id: "42", title: "علی رضایی", type: "private", last_message: "سلام", last_date: now }]);
    const model = await mockModel("سلام علی جان، فردا جلسه داریم. وقتت بخیر.");
    try {
      const prep = await prepareSend(s.engine, model.config, intentFor("علی"), { conversationId: "c1" });
      assert.equal(prep.ok, true, prep.reply);
      assert.equal(prep.pending, true);
      assert.match(prep.reply, /ارسال شود/);
      assert.match(prep.reply, /علی رضایی/);
      assert.ok(!prep.reply.includes("42"));
      assert.equal(s.sends(), 0);
      assert.ok(s.engine.memory.getPending("c1"));

      const [approved, duplicate] = await Promise.all([
        handleSendReply(s.engine, model.config, "c1", "بله"),
        handleSendReply(s.engine, model.config, "c1", "بله"),
      ]);
      assert.ok(approved);
      assert.equal(approved.ok, true, approved.reply);
      assert.equal(duplicate, undefined);
      assert.equal(s.sends(), 1);
      assert.match(s.lastText(), /جلسه/);
      assert.match(approved.reply, /ارسال شد/);
      assert.equal(s.engine.memory.getPending("c1"), undefined);
      assert.equal(s.engine.memory.recipient("telegram_client", "42")?.sendCount, 1);
    } finally {
      await model.close();
      s.close();
    }
  });

  test("چند مخاطب: گزینه‌ها بدون شناسه نمایش داده می‌شوند و انتخاب با شماره ادامه می‌یابد", async () => {
    const s = setup([
      { chat_id: "42", title: "علی رضایی", type: "private", last_date: now },
      { chat_id: "43", title: "علی محمدی", type: "private", last_date: now },
    ]);
    const model = await mockModel("سلام علی جان، فردا جلسه داریم.");
    try {
      const prep = await prepareSend(s.engine, model.config, intentFor("علی"), { conversationId: "c2" });
      assert.equal(prep.ok, true);
      assert.match(prep.reply, /۱\)/);
      assert.match(prep.reply, /۲\)/);
      assert.ok(!prep.reply.includes("42"));
      assert.ok(!prep.reply.includes("43"));
      assert.equal(s.sends(), 0);

      const selected = await handleSendReply(s.engine, model.config, "c2", "۲");
      assert.ok(selected);
      assert.match(selected.reply, /ارسال شود/);
      assert.match(selected.reply, /علی محمدی/);
      assert.equal(s.sends(), 0);

      const approved = await handleSendReply(s.engine, model.config, "c2", "بله");
      assert.ok(approved);
      assert.equal(approved.ok, true, approved.reply);
      assert.equal(s.sends(), 1);
    } finally {
      await model.close();
      s.close();
    }
  });

  test("نام نامشخص/فلانی: نزدیک‌ترین چت‌های اخیر برگردانده می‌شوند، نه خطای «نام دقیق بده»", async () => {
    const s = setup([
      { chat_id: "42", title: "مریم احمدی", type: "private", last_date: now },
      { chat_id: "43", title: "رضا کریمی", type: "private", last_date: now },
    ]);
    const model = await mockModel("سلام، وقتت بخیر.");
    try {
      const fallback = await prepareSend(s.engine, model.config, intentFor("کسی که وجود ندارد"), { conversationId: "c3" });
      assert.equal(fallback.ok, true);
      assert.match(fallback.reply, /نزدیک‌ترین/);
      assert.match(fallback.reply, /مریم احمدی/);
      assert.match(fallback.reply, /رضا کریمی/);
      assert.equal(fallback.pending, true);
      assert.equal(s.sends(), 0);

      const placeholder = await prepareSend(s.engine, model.config, intentFor("فلانی"), { conversationId: "c4" });
      assert.equal(placeholder.ok, true);
      assert.match(placeholder.reply, /نزدیک‌ترین/);
      assert.ok(!placeholder.reply.includes("42"));
    } finally {
      await model.close();
      s.close();
    }
  });

  test("لغو، متن بی‌کیفیت و گروه بدون اجازه ارسال نمی‌کنند", async () => {
    const s = setup([
      { chat_id: "42", title: "علی رضایی", type: "private", last_date: now },
      { chat_id: "-100", title: "گروه تست", type: "group", last_date: now },
    ]);
    const good = await mockModel("سلام علی جان، فردا جلسه داریم.");
    try {
      const prep = await prepareSend(s.engine, good.config, intentFor("علی"), { conversationId: "c5" });
      assert.equal(prep.ok, true);
      const cancelled = await handleSendReply(s.engine, good.config, "c5", "لغو");
      assert.ok(cancelled);
      assert.equal(s.sends(), 0);
      assert.equal(s.engine.memory.getPending("c5"), undefined);

      const group = await prepareSend(s.engine, good.config, intentFor("گروه تست"), { conversationId: "c6" });
      assert.equal(group.ok, false);
      assert.match(group.reply, /گروه|کانال/);
      assert.equal(s.sends(), 0);
    } finally {
      await good.close();
    }

    const bad = await mockModel("سلام");
    try {
      const prep = await prepareSend(s.engine, bad.config, intentFor("علی", "سلام"), { conversationId: "c7" });
      assert.equal(prep.ok, false);
      assert.match(prep.reply, /کیفیت|مناسب|سلام/);
      assert.equal(s.sends(), 0);
    } finally {
      await bad.close();
      s.close();
    }
  });
});
