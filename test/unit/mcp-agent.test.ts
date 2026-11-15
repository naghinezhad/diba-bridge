import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { DibaMcpEngine } from "../../src/core/engine.ts";
import { McpAgent } from "../../src/core/mcp-agent.ts";
import { enrichChatTitles } from "../../src/core/resolver.ts";
import { defineTool, type ProviderDef } from "../../src/core/types.ts";

const now = new Date().toISOString();
const hasChatKeys = (value: unknown) => /"chatId"|"chat_id"|"jid"|"peer_id"/.test(JSON.stringify(value));

function setup(seedInbox = false) {
  let sends = 0;
  let lastText = "";
  let lastChat = "";
  const provider: ProviderDef = {
    id: "telegram_client",
    name: "Telegram Client",
    nameFa: "تلگرام",
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
        annotations: { readOnlyHint: true },
        handler: async () => ({
          chats: [
            { chat_id: "42", title: "جان اسمیت", type: "private", last_message: "سلام جان", last_date: now },
            { chat_id: "43", title: "علی رضایی", type: "private", last_date: now },
            { chat_id: "44", title: "علی محمدی", type: "private", last_date: now },
            { chat_id: "47", title: "مریم", type: "private", last_date: now },
            // چت بی‌نام: فقط شناسه دارد و نامش را باید از get_chat گرفت
            { chat_id: "999", type: "private", last_date: now },
          ],
        }),
      }),
      defineTool({
        name: "telegram_client_get_history",
        title: "تاریخچه",
        description: "history",
        input: { chat_id: z.string().min(1), limit: z.number().int().min(1).max(100).optional() },
        annotations: { readOnlyHint: true },
        handler: async (a) => ({
          chat_id: a.chat_id,
          messages: [
            { id: "1", text: "سلام جان", out: false, date: now },
            { id: "2", text: "فردا جلسه داریم", out: true, date: now },
          ],
        }),
      }),
      defineTool({
        name: "telegram_client_get_chat",
        title: "اطلاعات چت",
        description: "chat info",
        input: { chat_id: z.string().min(1) },
        annotations: { readOnlyHint: true },
        handler: async (a) => {
          if (a.chat_id !== "999") return { id: a.chat_id, name: "ناشناس" };
          return { id: "999", name: "سارا احمدی", username: "sara.ahmadi", kind: "User" };
        },
      }),
      defineTool({
        name: "telegram_client_send_message",
        title: "ارسال",
        description: "send",
        input: { chat_id: z.string().min(1), text: z.string().min(1).max(4096) },
        handler: async (a) => {
          sends++;
          lastText = a.text;
          lastChat = a.chat_id;
          return { ok: true, chat_id: a.chat_id, message_id: String(sends) };
        },
      }),
    ],
  };
  const dataDir = mkdtempSync(join(tmpdir(), "diba-mcp-agent-"));
  const engine = new DibaMcpEngine({ dataDir, providers: [provider], env: { MCP_MODE: "agent" } });
  engine.store.update("telegram_client", { enabled: true, values: { session: "s".repeat(24) } });
  if (seedInbox) {
    engine.inbox.add("telegram_client", [
      {
        key: "telegram_client:42:seed",
        provider: "telegram_client",
        chatId: "42",
        chatType: "private",
        messageId: "seed",
        text: "پیام قدیمی",
        kind: "text",
        date: "2020-01-01T00:00:00.000Z",
      },
    ]);
  }
  return {
    engine,
    sends: () => sends,
    lastText: () => lastText,
    lastChat: () => lastChat,
    close: () => {
      engine.inbox.stop();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

async function mockDibaRouter() {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      let payload: any = {};
      try {
        payload = JSON.parse(body);
      } catch {
        // ignore
      }
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const system = String(messages.find((m: any) => m.role === "system")?.content ?? "");
      const user = String(messages.find((m: any) => m.role === "user")?.content ?? "");
      let reply = "ok";
      if (/spelling|transliteration|JSON array/i.test(system)) {
        if (/john/i.test(user)) reply = JSON.stringify(["John", "جان"]);
        else reply = JSON.stringify([user]);
      } else if (/دستیار فارسی دیبا/.test(system)) {
        reply = "سلام جان، فردا جلسه داریم. وقتت بخیر.";
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model: "mock", choices: [{ message: { role: "assistant", content: reply } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as any;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

describe("Diba assistant", () => {
  test("یک جمله‌ی ساده با نام انگلیسی → ارسال فوری به مخاطب درست", async () => {
    const s = setup();
    const agent = new McpAgent(s.engine);
    try {
      const r = await agent.handle({ request: "به John در تلگرام پیام بده که فردا جلسه داریم." });
      assert.equal(r.status, "done", JSON.stringify(r));
      assert.equal(r.action, "send");
      assert.equal(s.sends(), 1);
      assert.match(s.lastText(), /جلسه/);
      assert.equal(s.lastChat(), "42");
      assert.equal(r.auto_sent, true);
      assert.equal(r.recipient?.name, "جان اسمیت");
      assert.ok(!hasChatKeys(r));

      const en = await agent.handle({ request: "send John a message that we have a meeting tomorrow" });
      assert.equal(en.status, "done", JSON.stringify(en));
      assert.equal(s.sends(), 2);
    } finally {
      s.close();
    }
  });

  test("نام مبهم → فهرست گزینه‌ها بدون شناسه، سپس انتخاب با شماره و ارسال", async () => {
    const s = setup();
    const agent = new McpAgent(s.engine);
    try {
      const multi = await agent.handle({ request: "به علی پیام بده که فردا می‌بینمت", conversation_id: "t2" });
      assert.equal(multi.status, "need_person", JSON.stringify(multi));
      assert.equal(multi.candidates?.length, 2);
      assert.ok(multi.candidates?.every((c) => c.selection_token));
      assert.ok(!hasChatKeys(multi));
      assert.equal(s.sends(), 0);

      const chosen = await agent.handle({ request: "۱", conversation_id: "t2" });
      assert.equal(chosen.status, "done", JSON.stringify(chosen));
      assert.equal(s.sends(), 1);
      assert.equal(s.lastChat(), "43");
      assert.equal(chosen.recipient?.name, "علی رضایی");
    } finally {
      s.close();
    }
  });

  test("بدون متن صریح: پیش‌نویس می‌سازد و فقط با «بله» می‌فرستد", async () => {
    const s = setup();
    const model = await mockDibaRouter();
    s.engine.store.updateDibarouter({ baseUrl: model.baseUrl, apiKey: "test", model: "mock" });
    const agent = new McpAgent(s.engine);
    try {
      const prep = await agent.handle({ request: "به جان اسمیت پیام بده", conversation_id: "t3" });
      assert.equal(prep.status, "need_confirmation", JSON.stringify(prep));
      assert.ok(prep.draft);
      assert.ok(prep.confirmation_token);
      assert.equal(s.sends(), 0);

      const sent = await agent.handle({ request: "بله", conversation_id: "t3" });
      assert.equal(sent.status, "done", JSON.stringify(sent));
      assert.equal(s.sends(), 1);
      assert.match(s.lastText(), /جلسه/);
    } finally {
      await model.close();
      s.close();
    }
  });

  test("تغییر متن پیش‌نویس با جمله‌ی جدید همان گفتگو", async () => {
    const s = setup();
    const model = await mockDibaRouter();
    s.engine.store.updateDibarouter({ baseUrl: model.baseUrl, apiKey: "test", model: "mock" });
    const agent = new McpAgent(s.engine);
    try {
      const prep = await agent.handle({ request: "به جان اسمیت پیام بده", conversation_id: "t4" });
      assert.equal(prep.status, "need_confirmation", JSON.stringify(prep));

      const revised = await agent.handle({ request: "فردا ساعت ۵ می‌بینمت", conversation_id: "t4" });
      assert.equal(revised.status, "need_confirmation", JSON.stringify(revised));
      assert.match(revised.draft ?? "", /ساعت ?5/);
      assert.equal(s.sends(), 0);

      const sent = await agent.handle({ request: "بله", conversation_id: "t4" });
      assert.equal(sent.status, "done", JSON.stringify(sent));
      assert.match(s.lastText(), /ساعت/);
    } finally {
      await model.close();
      s.close();
    }
  });

  test("فهرست چت‌ها، خواندن پیام‌ها، وضعیت و توانایی‌ها", async () => {
    const s = setup();
    const agent = new McpAgent(s.engine);
    try {
      const list = await agent.handle({ request: "چت‌های تلگرام" });
      assert.equal(list.status, "done", JSON.stringify(list));
      assert.ok(list.chats?.some((c) => c.name === "علی رضایی"));
      assert.ok(!hasChatKeys(list));

      const all = await agent.handle({ request: "لیست چت‌ها" });
      assert.equal(all.status, "done", JSON.stringify(all));
      assert.ok((all.chats?.length ?? 0) >= 3);

      const read = await agent.handle({ request: "پیام‌های جان اسمیت در تلگرام را بخوان" });
      assert.equal(read.status, "done", JSON.stringify(read));
      assert.ok((read.messages?.length ?? 0) >= 2);
      assert.match(JSON.stringify(read.messages), /فردا جلسه/);

      const status = await agent.handle({ request: "وضعیت سرویس‌ها" });
      assert.equal(status.status, "done");
      assert.ok(status.providers?.some((p) => p.id === "telegram_client" && p.can_send));

      const caps = await agent.handle({ request: "چه کارهایی می‌توانی بکنی؟" });
      assert.equal(caps.status, "done");
      assert.ok(caps.capabilities?.some((c) => c.id === "telegram_client"));
    } finally {
      s.close();
    }
  });

  test("اجرای مستقیم ابزار سرویس (read-only) بدون تأیید", async () => {
    const s = setup();
    const agent = new McpAgent(s.engine);
    try {
      const r = await agent.handle({ request: "", tool: "telegram_client_get_chats", args: { limit: 5 } });
      assert.equal(r.status, "done", JSON.stringify(r));
      assert.match(JSON.stringify(r.result), /علی رضایی/);
      assert.equal(s.sends(), 0);
    } finally {
      s.close();
    }
  });

  test("dry_run ارسال نمی‌کند", async () => {
    const s = setup();
    const agent = new McpAgent(s.engine);
    try {
      const r = await agent.handle({ request: "به جان اسمیت پیام بده که سلام", dry_run: true });
      assert.equal(r.status, "done", JSON.stringify(r));
      assert.match(r.message, /dry_run/);
      assert.equal(s.sends(), 0);
    } finally {
      s.close();
    }
  });

  test("عنوان زنده‌ی چت بر عنوان عددی صندوق اولویت دارد", async () => {
    const s = setup(true);
    const agent = new McpAgent(s.engine);
    try {
      const list = await agent.handle({ request: "چت‌های تلگرام" });
      assert.equal(list.status, "done", JSON.stringify(list));
      assert.ok(list.chats?.some((c) => c.name === "جان اسمیت"), JSON.stringify(list.chats));
      assert.ok(!list.chats?.some((c) => c.name === "مخاطب بدون نام"));
    } finally {
      s.close();
    }
  });

  test("درخواست جدید برای شخص دیگر، پیش‌نویس قبلی را باطل می‌کند (بدون ارسال اشتباه)", async () => {
    const s = setup();
    const model = await mockDibaRouter();
    s.engine.store.updateDibarouter({ baseUrl: model.baseUrl, apiKey: "test", model: "mock" });
    const agent = new McpAgent(s.engine);
    try {
      const prep = await agent.handle({ request: "به جان اسمیت پیام بده", conversation_id: "t5" });
      assert.equal(prep.status, "need_confirmation", JSON.stringify(prep));
      assert.equal(prep.recipient?.name, "جان اسمیت");

      const other = await agent.handle({ request: "به مریم پیام بده که فردا می‌بینمت", conversation_id: "t5" });
      assert.equal(other.status, "done", JSON.stringify(other));
      assert.equal(other.recipient?.name, "مریم");
      assert.equal(s.lastChat(), "47");
      assert.equal(s.sends(), 1);
    } finally {
      await model.close();
      s.close();
    }
  });

  test("فهرست گزینه‌های قدیمی با درخواست کامل تازه بازسازی می‌شود", async () => {
    const s = setup();
    const agent = new McpAgent(s.engine);
    try {
      const multi = await agent.handle({ request: "به علی پیام بده", conversation_id: "t6" });
      assert.equal(multi.status, "need_person", JSON.stringify(multi));
      assert.equal(s.sends(), 0);

      const fresh = await agent.handle({ request: "به مریم پیام بده که فردا می‌بینمت", conversation_id: "t6" });
      assert.equal(fresh.status, "done", JSON.stringify(fresh));
      assert.equal(fresh.recipient?.name, "مریم");
      assert.equal(s.lastChat(), "47");
      assert.equal(s.sends(), 1);
    } finally {
      s.close();
    }
  });

  test("درخواست کامل تازه پیش‌نویس/فهرست قبلی را می‌بلعد و متن جدید را می‌فرستد", async () => {
    const s = setup();
    const agent = new McpAgent(s.engine);
    try {
      const multi = await agent.handle({ request: "به علی پیام بده که فردا می‌بینمت", conversation_id: "t7" });
      assert.equal(multi.status, "need_person", JSON.stringify(multi));

      const fresh = await agent.handle({ request: "به مریم در تلگرام پیام بده که امروز دیر می‌آیم، ببخشید", conversation_id: "t7" });
      assert.equal(fresh.status, "done", JSON.stringify(fresh));
      assert.equal(fresh.recipient?.name, "مریم");
      assert.equal(s.lastChat(), "47");
      assert.match(s.lastText(), /دیر می/);
      assert.equal(s.sends(), 1);
    } finally {
      s.close();
    }
  });

  test("dry_run هیچ وضعیتی ذخیره نمی‌کند که بعداً ناخواسته ارسال شود", async () => {
    const s = setup();
    const agent = new McpAgent(s.engine);
    try {
      const preview = await agent.handle({ request: "به علی پیام بده", dry_run: true, conversation_id: "t8" });
      assert.equal(preview.status, "need_person", JSON.stringify(preview));
      assert.equal(s.sends(), 0);

      const after = await agent.handle({ request: "به مریم پیام بده که امروز دیر می‌آیم، ببخشید", conversation_id: "t8" });
      assert.equal(after.status, "done", JSON.stringify(after));
      assert.equal(s.lastChat(), "47");
      assert.match(s.lastText(), /دیر می/);
      assert.equal(s.sends(), 1);
    } finally {
      s.close();
    }
  });

  test("چت بی‌نام با نام واقعی اکانت نمایش داده می‌شود", async () => {
    const s = setup();
    const agent = new McpAgent(s.engine);
    try {
      const list = await agent.handle({ request: "چت‌های تلگرام" });
      assert.equal(list.status, "done", JSON.stringify(list));
      assert.ok(list.chats?.some((c) => c.name === "سارا احمدی"), JSON.stringify(list.chats));
      assert.ok(!list.chats?.some((c) => c.name === "مخاطب بدون نام"));

      // با همان نام واقعی هم قابل پیدا شدن است
      const found = await agent.handle({
        request: "به سارا در تلگرام پیام بده که فردا می‌بینمت",
        dry_run: true,
      });
      assert.equal(found.status, "done", JSON.stringify(found));
      assert.equal(found.recipient?.name, "سارا احمدی");
    } finally {
      s.close();
    }
  });

  test("فهرست داشبورد هم نام واقعی چت بی‌نام را می‌گیرد", async () => {
    const s = setup();
    try {
      s.engine.inbox.add("telegram_client", [
        {
          key: "telegram_client:999:seed",
          provider: "telegram_client",
          chatId: "999",
          chatType: "private",
          messageId: "seed-999",
          text: "سلام",
          kind: "text",
          date: "2020-01-02T00:00:00.000Z",
        },
      ]);
      const chats = await enrichChatTitles(s.engine, s.engine.inbox.chats());
      const target = chats.find((chat) => chat.chatId === "999");
      assert.ok(target, JSON.stringify(chats.map((chat) => chat.chatId)));
      assert.equal(target?.title, "سارا احمدی");
    } finally {
      s.close();
    }
  });

  test("agent mode only exposes diba_agent and answers a greeting", async () => {
    const s = setup();
    const server = s.engine.createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientTransport);
    try {
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((t) => t.name), ["diba_agent"]);
      const result = await client.callTool({ name: "diba_agent", arguments: { request: "سلام" } });
      const data = JSON.parse(String((result.content[0] as any).text));
      assert.equal(data.status, "done");
      assert.match(data.message, /بفرستم/);
      assert.equal(data.conversation_id, "mcp");
    } finally {
      await client.close();
      await server.close();
      s.close();
    }
  });
});
