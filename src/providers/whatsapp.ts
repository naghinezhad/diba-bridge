import { z } from "zod";
import { netFetch } from "../core/net.js";
import { defineTool, ProviderError, type ProviderContext, type ProviderDef } from "../core/types.js";

const DEFAULT_BASE = "http://127.0.0.1:2785/api";

function baseOf(ctx: ProviderContext): string {
  let base = (ctx.config.baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
  if (!/\/api$/i.test(base)) base += "/api";
  return base;
}

async function openwa(
  ctx: ProviderContext,
  path: string,
  opts: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<any> {
  const key = ctx.config.apiKey;
  const session = ctx.config.sessionId;
  if (!key) throw new ProviderError("API Key اوپن‌وا ثبت نشده است.");
  if (!session) throw new ProviderError("Session ID اوپن‌وا ثبت نشده است.");
  const qs = opts.query ? `?${new URLSearchParams(opts.query).toString()}` : "";
  let res: any;
  try {
    res = await netFetch(`${baseOf(ctx)}/sessions/${encodeURIComponent(session)}${path}${qs}`, {
      method: opts.method ?? "GET",
      headers: {
        "X-API-Key": key,
        "content-type": "application/json",
        "user-agent": "dibaMCP/0.4",
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err: any) {
    throw new ProviderError(`پل OpenWA در دسترس نیست (${baseOf(ctx)}). ${err?.message ?? err}`, err);
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new ProviderError(`OpenWA: ${data?.message ?? data?.error ?? `HTTP ${res.status}`}`, data);
  return data;
}

export const whatsapp: ProviderDef = {
  id: "whatsapp",
  name: "WhatsApp (OpenWA)",
  nameFa: "واتس‌اپ (OpenWA)",
  category: "messenger",
  color: "#25D366",
  glyph: "و",
  description: "اتصال به واتس‌اپ از طریق OpenWA — ارسال متن/عکس/فایل، فهرست چت‌ها و پیام‌ها",
  docsUrl: "https://docs.open-wa.org/",
  fields: [
    { key: "baseUrl", label: "آدرس OpenWA", type: "url", default: DEFAULT_BASE, required: true, help: "پیش‌فرض: http://127.0.0.1:2785/api" },
    { key: "apiKey", label: "API Key", type: "secret", required: true },
    { key: "sessionId", label: "Session ID", type: "text", required: true, placeholder: "session-1" },
    { key: "defaultChatId", label: "چت پیش‌فرض", type: "text", placeholder: "اختیاری — 628…@c.us" },
  ],
  test: async (ctx) => {
    const sessions = await openwa(ctx, "", {});
    return { connected: Array.isArray(sessions) ? sessions.length : sessions };
  },
  tools: [
    defineTool({
      name: "whatsapp_get_session",
      title: "وضعیت نشست واتس‌اپ",
      description: "Get the OpenWA session status.",
      input: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (_a, ctx) => openwa(ctx, "", {}),
    }),
    defineTool({
      name: "whatsapp_get_chats",
      title: "فهرست چت‌های واتس‌اپ",
      description: "List WhatsApp chats from OpenWA.",
      input: { limit: z.number().int().min(1).max(200).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const r = await openwa(ctx, "/chats", { query: { limit: String(a.limit ?? 50) } });
        return { chats: Array.isArray(r) ? r : r?.chats ?? r?.data ?? [] };
      },
    }),
    defineTool({
      name: "whatsapp_get_messages",
      title: "پیام‌های واتس‌اپ",
      description: "List recent messages of a WhatsApp chat.",
      input: { chat_id: z.string().min(1), limit: z.number().int().min(1).max(200).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const r = await openwa(ctx, "/messages", { query: { chatId: a.chat_id, limit: String(a.limit ?? 50) } });
        return { messages: Array.isArray(r) ? r : r?.messages ?? r?.data ?? [] };
      },
    }),
    defineTool({
      name: "whatsapp_send_message",
      title: "ارسال پیام واتس‌اپ",
      description: "Send a WhatsApp text message via OpenWA.",
      input: { chat_id: z.string().min(1), text: z.string().min(1).max(4096) },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const r = await openwa(ctx, "/messages/send-text", { method: "POST", body: { chatId: a.chat_id, text: a.text } });
        return { ok: true, result: r };
      },
    }),
    defineTool({
      name: "whatsapp_send_image",
      title: "ارسال عکس واتس‌اپ",
      description: "Send an image from a public URL via OpenWA.",
      input: { chat_id: z.string().min(1), url: z.string().url(), caption: z.string().max(1024).optional() },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const r = await openwa(ctx, "/messages/send-image", {
          method: "POST",
          body: { chatId: a.chat_id, url: a.url, ...(a.caption ? { caption: a.caption } : {}) },
        });
        return { ok: true, result: r };
      },
    }),
    defineTool({
      name: "whatsapp_send_document",
      title: "ارسال فایل واتس‌اپ",
      description: "Send a document from a public URL via OpenWA.",
      input: { chat_id: z.string().min(1), url: z.string().url(), filename: z.string().optional(), caption: z.string().max(1024).optional() },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const r = await openwa(ctx, "/messages/send-document", {
          method: "POST",
          body: { chatId: a.chat_id, url: a.url, filename: a.filename, caption: a.caption },
        });
        return { ok: true, result: r };
      },
    }),
  ],
};
