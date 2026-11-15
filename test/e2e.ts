/**
 * تست سرتاسری: یک سرویس آزمایشی (ProviderDef) + یک API جعلی بالا می‌آورد،
 * سرور diba-mcp را اجرا می‌کند و با کلاینت واقعی MCP ابزارها را صدا می‌زند.
 *   npm test
 *
 * سرویس‌های واقعی (بله، تلگرام، ...) وابسته به شبکه و حساب واقعی هستند؛ اینجا
 * همان مسیرهای پلتفرم (engine، صندوق، تست کامل، داشبورد و MCP) با یک سرویس
 * ساختگی پوشش داده می‌شوند و خودِ سرویس‌ها تست واحد دارند.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createDibaMcp } from "../src/index.js";
import { defineTool, type IncomingMessage, type ProviderDef } from "../src/core/types.js";
import { runSelfTest } from "../src/core/selftest.js";

const listen = (app: express.Express) =>
  new Promise<{ url: string; close: () => void }>((ok) => {
    const s = app.listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, close: () => s.close() }));
  });

// ---------- API جعلی سرویس آزمایشی ----------
const seen: any[] = [];
const pending: any[] = [];
let nextId = 100;
let nextUpdate = 1;
const mock = express();
mock.use(express.json());

const tokenOf = (req: express.Request) => String(req.query.token ?? req.body?.token ?? "");
const authorized = (req: express.Request, res: express.Response) => {
  if (tokenOf(req) === "GOOD") return true;
  res.status(401).json({ ok: false, error: "Unauthorized" });
  return false;
};

mock.get("/me", (req, res) => {
  if (!authorized(req, res)) return;
  res.json({ ok: true, result: { id: 7, first_name: "حساب تست", username: "demo_user" } });
});

mock.get("/chat/:id", (req, res) => {
  if (!authorized(req, res)) return;
  res.json({ ok: true, result: { id: req.params.id, title: "مریم", type: "private" } });
});

mock.post("/send", (req, res) => {
  if (!authorized(req, res)) return;
  seen.push({ path: "/send", body: req.body });
  res.json({ ok: true, result: { message_id: ++nextId, chat_id: String(req.body.chat_id) } });
});

mock.get("/updates", (req, res) => {
  if (!authorized(req, res)) return;
  const offset = Number(req.query.offset ?? 0);
  const batch = pending.filter((u) => u.id >= offset);
  res.json({ ok: true, result: batch });
});

// دیبا روتر جعلی: پاسخ SSE کند، برای تست دکمه‌ی «توقف» دستیار
let drOpen = false;
let drClosed = false;
mock.post("/dr/chat/completions", (req, res) => {
  drOpen = true;
  res.writeHead(200, { "content-type": "text/event-stream" });
  const timer = setInterval(() => {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "…" } }] })}\n\n`);
  }, 25);
  req.on("close", () => {
    drClosed = true;
    clearInterval(timer);
  });
});

const upstream = await listen(mock);

// ---------- سرویس آزمایشی ----------
const demo: ProviderDef = {
  id: "demo",
  name: "Demo",
  nameFa: "سرویس آزمایشی",
  category: "messenger",
  color: "#2563eb",
  glyph: "آ",
  description: "سرویس ساختگی برای تست پلتفرم",
  fields: [
    { key: "token", label: "توکن", type: "secret", required: true },
    { key: "baseUrl", label: "آدرس پایه", type: "url", default: upstream.url },
    { key: "defaultChatId", label: "چت پیش‌فرض", type: "text" },
  ],
  async test(ctx) {
    const r = await fetch(`${ctx.config.baseUrl}/me?token=${encodeURIComponent(ctx.config.token)}`);
    if (!r.ok) throw new Error(`Unauthorized (${r.status})`);
    return ((await r.json()) as any).result;
  },
  tools: [
    defineTool({
      name: "demo_get_me",
      title: "اطلاعات حساب",
      description: "Get the demo account profile.",
      input: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (_a, ctx) => {
        const r = await fetch(`${ctx.config.baseUrl}/me?token=${encodeURIComponent(ctx.config.token)}`);
        if (!r.ok) throw new Error("Unauthorized");
        return ((await r.json()) as any).result;
      },
    }),
    defineTool({
      name: "demo_get_chat",
      title: "اطلاعات چت",
      description: "Get a chat by id.",
      input: { chat_id: z.string().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const r = await fetch(`${ctx.config.baseUrl}/chat/${encodeURIComponent(a.chat_id)}?token=${encodeURIComponent(ctx.config.token)}`);
        if (!r.ok) throw new Error("Unauthorized");
        return ((await r.json()) as any).result;
      },
    }),
    defineTool({
      name: "demo_send_message",
      title: "ارسال پیام",
      description: "Send a text message via the demo service.",
      input: { chat_id: z.string().optional(), text: z.string().min(1) },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const chatId = a.chat_id || ctx.config.defaultChatId;
        const r = await fetch(`${ctx.config.baseUrl}/send`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: ctx.config.token, chat_id: chatId, text: a.text }),
        });
        if (!r.ok) throw new Error("Unauthorized");
        return ((await r.json()) as any).result;
      },
    }),
  ],
  receive: {
    async poll(ctx, cursor) {
      const offset = Number(cursor ?? 0);
      const r = await fetch(`${ctx.config.baseUrl}/updates?offset=${offset}&token=${encodeURIComponent(ctx.config.token)}`);
      if (!r.ok) throw new Error("Unauthorized");
      const list = ((await r.json()) as any).result as any[];
      const messages: IncomingMessage[] = list.map((u) => ({
        key: `demo:${u.chat_id}:${u.id}`,
        provider: "demo",
        chatId: String(u.chat_id),
        chatTitle: u.title || "کاربر",
        chatType: "private",
        messageId: String(u.id),
        from: { id: String(u.chat_id), name: u.title || "کاربر" },
        text: u.text,
        kind: "text",
        date: new Date(u.time ?? Date.now()).toISOString(),
        direction: "in",
      }));
      const next = list.length ? Math.max(...list.map((u) => u.id)) + 1 : offset;
      return { messages, cursor: String(next) };
    },
  },
};

const pushUpdate = (chatId: number, text: string, title = "مریم") =>
  pending.push({ id: nextUpdate++, chat_id: chatId, text, title, time: Date.now() });

// ---------- diba-mcp ----------
process.env.ADMIN_PASSWORD = "e2e-pass";
const dataDir = mkdtempSync(join(tmpdir(), "diba-mcp-test-"));
const dibaMcp = createDibaMcp({ dataDir, env: { MCP_MODE: "tools" }, only: ["demo"], extraProviders: [demo] });
const { store } = dibaMcp.engine;
store.update("demo", { enabled: true, values: { token: "GOOD", baseUrl: upstream.url, defaultChatId: "555" } });

const app = express();
app.use("/diba-mcp", dibaMcp.router()); // مثل الحاق به پروژه‌ی میزبان، با پیشوند
const srv = await listen(app);
const mcpUrl = new URL(`${srv.url}/diba-mcp/mcp`);

let passed = 0;
const step = async (name: string, fn: () => Promise<void>) => {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

try {
  await step("بدون توکن ← 401", async () => {
    const r = await fetch(mcpUrl, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(r.status, 401);
  });

  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers: { Authorization: `Bearer ${store.mcpToken}` } } }),
  );

  await step("فهرست ابزارها فقط سرویس آماده را نشان می‌دهد", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of ["list_services", "list_chats", "demo_send_message", "demo_get_me", "demo_get_chat"])
      assert.ok(names.includes(n), `missing ${n}`);
    assert.equal(tools.find((t) => t.name === "demo_get_me")?.annotations?.readOnlyHint, true);
  });

  await step("ارسال پیام با چت پیش‌فرض", async () => {
    const r: any = await client.callTool({ name: "demo_send_message", arguments: { text: "سلام از تست" } });
    assert.ok(!r.isError, r.content?.[0]?.text);
    const last = seen.at(-1);
    assert.equal(last.path, "/send");
    assert.equal(last.body.chat_id, "555");
    assert.equal(last.body.text, "سلام از تست");
  });

  await step("خطای احراز هویت خوانا و بدون نشت توکن", async () => {
    store.update("demo", { values: { token: "BAD-TOKEN" } });
    const r: any = await client.callTool({ name: "demo_get_me", arguments: {} });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /Unauthorized/);
    assert.ok(!r.content[0].text.includes("BAD-TOKEN"));
    store.update("demo", { values: { token: "GOOD" } });
  });

  await step("دریافت پیام خاموش است ← get_updates مستقیم از API", async () => {
    pushUpdate(777, "سلام از سرویس");
    // ابزار get_updates برای این سرویس تعریف نشده؛ صندوق مستقیم تست می‌شود
    const { added } = await dibaMcp.engine.inbox.fetchOnce("demo");
    assert.equal(added, 1);
    const list = dibaMcp.engine.inbox.messages("demo");
    assert.equal(list[0].chatId, "777");
    assert.equal(list[0].chatTitle, "مریم");
    assert.equal(list[0].direction, "in");
  });

  await step("حلقه‌ی دریافت، صندوق، list_chats و offset", async () => {
    dibaMcp.engine.inbox.idleMs = 20;
    dibaMcp.engine.updateProvider("demo", { receive: true });
    const until = async (cond: () => boolean) => {
      for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 15));
      assert.ok(cond(), "timeout");
    };
    const incoming = () => dibaMcp.engine.inbox.messages("demo", { limit: 500 }).filter((m) => m.direction !== "out");
    const before = incoming().length;
    pushUpdate(888, "پیام دوم", "رضا");
    await until(() => incoming().length === before + 1);
    const chats = JSON.parse((await client.callTool({ name: "list_chats", arguments: { provider: "demo" } })).content[0].text as string);
    const ids = chats.chats.map((c: any) => c.chatId);
    assert.ok(ids.includes("888") && ids.includes("777"), JSON.stringify(ids));
  });

  await step("پیام‌های ارسالی در گفتگو ثبت می‌شوند (منبع، جهت)", async () => {
    const out = dibaMcp.engine.inbox.messages("demo", { chatId: "555" }).filter((m) => m.direction === "out");
    assert.ok(out.some((m) => m.text === "سلام از تست"), JSON.stringify(out));
    assert.ok(out.every((m) => m.source === "mcp"));
    const r = await dibaMcp.engine.callTool("demo_send_message", { chat_id: "777", text: "جواب از داشبورد" }, "dashboard");
    assert.ok(r.ok);
    const conv = dibaMcp.engine.inbox.messages("demo", { chatId: "777" });
    assert.equal(conv[0].direction, "out");
    assert.equal(conv[0].source, "dashboard");
    assert.equal(conv[0].chatTitle, "مریم"); // عنوان از پیام‌های قبلی همان چت
    const chat = dibaMcp.engine.inbox.chats("demo").find((c) => c.chatId === "777")!;
    assert.equal(chat.lastDirection, "out");
  });

  await step("تست کامل: مراحل پیکربندی، شبکه، احراز، چت، ارسال و دریافت", async () => {
    const r = await runSelfTest(dibaMcp.engine, "demo", { send: true });
    const by = Object.fromEntries(r.steps.map((s) => [s.id, s.status]));
    assert.deepEqual(by, { config: "ok", network: "ok", auth: "ok", chat: "ok", send_text: "ok", send_photo: "skip", receive: "ok" }, r.text);
    assert.equal(r.ok, true);
    assert.ok(!r.text.includes("GOOD"));
  });

  await step("ورودی نامعتبر", async () => {
    const r: any = await client.callTool({ name: "demo_send_message", arguments: { text: "" } });
    assert.equal(r.isError, true);
  });

  await step("خاموش کردن حساب ← ابزار حذف می‌شود", async () => {
    store.update("demo", { enabled: false });
    const { tools } = await client.listTools();
    assert.ok(!tools.some((t) => t.name.startsWith("demo_")));
    store.update("demo", { enabled: true });
  });

  await step("لاگ‌ها ثبت شده و توکن در آن‌ها نیست", async () => {
    const logs = dibaMcp.engine.logger.list();
    assert.ok(logs.length >= 5);
    assert.ok(logs.every((l) => !JSON.stringify(l).includes("GOOD-TOKEN")));
  });

  await step("توقف دستیار: بستن اتصال، درخواست مدل را قطع می‌کند", async () => {
    store.updateDibarouter({ baseUrl: `${upstream.url}/dr`, apiKey: "e2e-key", model: "e2e-model" });
    const login = await fetch(`${srv.url}/diba-mcp/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "e2e-pass" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie()[0].split(";")[0];

    const ac = new AbortController();
    const pendingRes = fetch(`${srv.url}/diba-mcp/api/agent/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ messages: [{ role: "user", content: "سلام" }], stream: true, conversationId: "e2e" }),
      signal: ac.signal,
    });
    const res = await pendingRes;
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
    const reader = res.body!.getReader();
    await reader.read(); // اولین رویداد استریم
    ac.abort(); // همان چیزی که دکمه‌ی «توقف» انجام می‌دهد
    await reader.cancel().catch(() => {});

    const end = Date.now() + 2000;
    while (!drClosed && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    assert.equal(drOpen, true, "درخواست باید به مدل رسیده باشد");
    assert.equal(drClosed, true, "با توقف کاربر، اتصال به مدل باید بسته شود");
  });

  await step("داشبورد: بدون ورود ← 401، صفحه در دسترس", async () => {
    const r = await fetch(`${srv.url}/diba-mcp/api/providers`);
    assert.equal(r.status, 401);
    const page = await fetch(`${srv.url}/diba-mcp/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<html/);
  });

  await client.close();
  dibaMcp.engine.inbox.stop();
  console.log(`\n  همه‌ی ${passed} تست با موفقیت گذشت ✅`);
} finally {
  srv.close();
  upstream.close();
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(0);
