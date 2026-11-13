/**
 * واتس‌اپ با حساب کاربری (WhatsApp Web / Multi-Device).
 *
 * QR مستقیم از پروتکل WhatsApp Web تولید می‌شود؛ بدون مرورگر، OpenWA،
 * API Token یا کد لینک. برای اسکن از WhatsApp → Linked devices استفاده کنید.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { makeWASocket, Browsers, fetchLatestWaWebVersion, useMultiFileAuthState } from "@whiskeysockets/baileys";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { z } from "zod";
import { defineTool, ProviderError, type IncomingMessage, type ProviderAuthDef, type ProviderContext, type ProviderDef } from "../core/types.js";

const nodeRequire = createRequire(import.meta.url);
const QRCode = nodeRequire("qrcode") as any;
const MAX_QUEUE = 500;
const CONNECT_TIMEOUT_MS = 45_000;
const QR_TIMEOUT_MS = 30_000;

function authDir(ctx: ProviderContext): string {
  const base = ctx.dataDir || process.env.DATA_DIR || resolve(process.cwd(), "data");
  return join(base, "whatsapp-auth");
}

function proxyAgent(): any {
  const env = process.env;
  const socks = env.SOCKS_PROXY || env.socks_proxy;
  if (socks) {
    try { return new SocksProxyAgent(socks); } catch { /* ignore */ }
  }
  const http = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || env.ALL_PROXY;
  if (http) {
    try { return new HttpsProxyAgent(http); } catch { /* ignore */ }
  }
  return undefined;
}

function jidOf(ctx: ProviderContext, chatId?: string): string {
  const raw = String(chatId || "").trim() || String(ctx.config.defaultChatId || "").trim();
  if (!raw) throw new ProviderError("chat_id لازم است یا «چت پیش‌فرض» را تنظیم کنید.");
  if (raw.includes("@")) return raw;
  return `${raw.replace(/\D/g, "")}@s.whatsapp.net`;
}

function friendlyError(err: any, prefix: string): ProviderError {
  if (err instanceof ProviderError) return err;
  const message = String(err?.message ?? err);
  if (/Connection Closed|connection closed|timeout|timed out|ECONN|ETIMEDOUT|ECONNRESET|QR timeout/i.test(message))
    return new ProviderError(`${prefix}: اتصال به WhatsApp برقرار نشد. اینترنت/VPN یا HTTPS_PROXY/SOCKS_PROXY را بررسی کنید.`, err);
  if (/not registered|logged out|401/i.test(message))
    return new ProviderError(`${prefix}: نشست واتس‌اپ معتبر نیست؛ دوباره QR را بسازید.`, err);
  return new ProviderError(`${prefix}: ${message}`, err);
}

// ---------------------------------------------------------------- socket manager

interface Managed {
  sock: any;
  queue: IncomingMessage[];
  waiters: Set<() => void>;
  closed: boolean;
}

let managed: Managed | undefined;
let pending: { sock: any; opened: boolean; error?: Error; qr?: string } | undefined;

function messageFromUpsert(m: any): IncomingMessage | null {
  if (!m?.key?.remoteJid) return null;
  const c = m.message ?? {};
  const text = c.conversation ?? c.extendedTextMessage?.text ?? c.imageMessage?.caption ?? c.videoMessage?.caption ?? c.documentMessage?.caption;
  const kind: IncomingMessage["kind"] = c.imageMessage ? "photo" : c.videoMessage ? "video" : c.audioMessage ? "voice" : c.documentMessage ? "file" : text !== undefined ? "text" : "other";
  return {
    key: `whatsapp:${m.key.remoteJid}:${m.key.id}`,
    provider: "whatsapp",
    chatId: String(m.key.remoteJid),
    chatTitle: m.pushName,
    chatType: String(m.key.remoteJid).endsWith("@g.us") ? "group" : "private",
    messageId: String(m.key.id ?? ""),
    from: m.key.participant ? { id: String(m.key.participant), name: m.pushName } : undefined,
    text,
    kind,
    date: new Date(Number(m.messageTimestamp ?? Date.now() / 1000) * 1000).toISOString(),
  };
}

function attachMessages(target: Managed) {
  target.sock.ev.on("messages.upsert", ({ messages, type }: any) => {
    if (type !== "notify") return;
    for (const raw of messages ?? []) {
      if (raw?.key?.fromMe) continue;
      const msg = messageFromUpsert(raw);
      if (!msg) continue;
      target.queue.push(msg);
      if (target.queue.length > MAX_QUEUE) target.queue.splice(0, target.queue.length - MAX_QUEUE);
      const waiter = target.waiters.values().next().value as (() => void) | undefined;
      waiter?.();
    }
  });
  target.sock.ev.on("connection.update", ({ connection }: any) => {
    if (connection === "close") target.closed = true;
  });
}

async function createSocket(ctx: ProviderContext): Promise<any> {
  const dir = authDir(ctx);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const latest = await Promise.race([
    fetchLatestWaWebVersion({}).catch(() => undefined),
    new Promise<undefined>((r) => setTimeout(() => r(undefined), 5_000)),
  ]);
  const agent = proxyAgent();
  const sock = makeWASocket({
    auth: state,
    ...(latest?.version ? { version: latest.version } : {}),
    ...(agent ? { agent, fetchAgent: agent } : {}),
    browser: Browsers.ubuntu("Chrome"),
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    connectTimeoutMs: CONNECT_TIMEOUT_MS,
  });
  sock.ev.on("creds.update", saveCreds);
  return sock;
}

function waitForQr(sock: any, timeoutMs: number): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let done = false;
    const finish = (err: Error | null, qr?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.ev.off("connection.update", onUpdate);
      if (err) reject(err);
      else resolvePromise(String(qr));
    };
    const timer = setTimeout(() => finish(new Error("QR timeout")), timeoutMs);
    const onUpdate = ({ qr, connection, lastDisconnect }: any) => {
      if (qr) finish(null, qr);
      else if (connection === "open") finish(new Error("already connected"));
      else if (connection === "close") {
        const status = lastDisconnect?.error?.output?.statusCode;
        finish(new Error(`Connection Closed${status ? ` (${status})` : ""}`));
      }
    };
    sock.ev.on("connection.update", onUpdate);
  });
}

function waitForOpen(sock: any, timeoutMs: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (sock.user?.id) return resolvePromise();
    let done = false;
    const finish = (err: Error | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.ev.off("connection.update", onUpdate);
      if (err) reject(err);
      else resolvePromise();
    };
    const timer = setTimeout(() => finish(new Error("timeout")), timeoutMs);
    const onUpdate = ({ connection }: any) => {
      if (connection === "open") finish(null);
      else if (connection === "close") finish(new Error("connection closed"));
    };
    sock.ev.on("connection.update", onUpdate);
  });
}

async function resetManaged() {
  const target = managed;
  managed = undefined;
  if (target) {
    target.closed = true;
    await target.sock.end(undefined).catch(() => {});
  }
  if (pending) {
    pending.sock.end(undefined).catch(() => {});
    pending = undefined;
  }
}

async function getManaged(ctx: ProviderContext): Promise<Managed> {
  if (managed && !managed.closed) return managed;
  if (!existsSync(join(authDir(ctx), "creds.json"))) throw new ProviderError("اول با QR وارد واتس‌اپ شوید.");
  const sock = await createSocket(ctx);
  const target: Managed = { sock, queue: [], waiters: new Set(), closed: false };
  attachMessages(target);
  try {
    await waitForOpen(sock, CONNECT_TIMEOUT_MS);
    managed = target;
    return target;
  } catch (err) {
    await sock.end(undefined).catch(() => {});
    throw friendlyError(err, "اتصال به واتس‌اپ");
  }
}

// ---------------------------------------------------------------- auth

const whatsappAuth: ProviderAuthDef = {
  title: "ورود با QR واتس‌اپ",
  description:
    "QR را با WhatsApp → Linked devices → Link a device اسکن کنید. بدون شماره، کد لینک، API Token یا OpenWA. نشست روی همین سرور ذخیره می‌شود.",
  phoneField: "phone",
  sessionField: "session",
  codeInput: false,
  qr: true,
  async start(ctx, _rawPhone, _save) {
    await resetManaged();
    try {
      const dir = authDir(ctx);
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      const sock = await createSocket(ctx);
      pending = { sock, opened: false };
      sock.ev.on("connection.update", ({ connection, lastDisconnect }: any) => {
        if (connection === "open") pending!.opened = true;
        if (connection === "close") {
          const status = lastDisconnect?.error?.output?.statusCode;
          pending!.error = new Error(status === 401 ? "loggedOut" : "connection closed");
        }
      });
      const qrString = await waitForQr(sock, QR_TIMEOUT_MS);
      const qr = await QRCode.toDataURL(qrString, { width: 280, margin: 1, errorCorrectionLevel: "M" });
      return {
        step: "code",
        transactionHash: "whatsapp-baileys-qr",
        qr,
        hint: "QR را با WhatsApp → Linked devices → Link a device اسکن کنید، سپس «بررسی اتصال» را بزنید.",
      };
    } catch (err) {
      await resetManaged();
      throw friendlyError(err, "دریافت QR واتس‌اپ");
    }
  },
  async verifyCode(_ctx, _transactionHash, _code, save) {
    if (!pending) throw new ProviderError("QR منقضی شده؛ دوباره QR را بسازید.");
    if (pending.error) throw new ProviderError("اتصال واتس‌اپ قطع شد؛ دوباره QR را بسازید.");
    if (!pending.opened) {
      try {
        await waitForOpen(pending.sock, 25_000);
      } catch {
        throw new ProviderError("هنوز QR اسکن نشده است. دوباره «بررسی اتصال» را بزنید.");
      }
    }
    const sock = pending.sock;
    const target: Managed = { sock, queue: [], waiters: new Set(), closed: false };
    attachMessages(target);
    managed = target;
    pending = undefined;
    save({ session: "connected", phone: String(sock.user?.id ?? "").split("@")[0].split(":")[0] || "" });
    return { step: "done", hint: "واتس‌اپ با موفقیت متصل شد.", user: { id: 0, name: sock.user?.name } };
  },
  async verifyPassword() {
    throw new ProviderError("ورود واتس‌اپ QR است؛ رمز عبور ندارد.");
  },
  async logout(ctx, save) {
    await resetManaged();
    const dir = authDir(ctx);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    save({ session: "", phone: "" });
    return { step: "done", hint: "از حساب واتس‌اپ خارج شدید." };
  },
};

export const whatsapp: ProviderDef = {
  id: "whatsapp",
  name: "WhatsApp",
  nameFa: "واتس‌اپ",
  category: "messenger",
  color: "#25D366",
  glyph: "و",
  description: "ورود با QR واتس‌اپ — ارسال پیام، عکس و فایل بدون API Token",
  docsUrl: "https://github.com/WhiskeySockets/Baileys",
  fields: [
    { key: "phone", label: "شماره واتس‌اپ (اختیاری)", type: "text", placeholder: "۰۹۱۲۱۲۳۴۵۶۷", help: "برای QR لازم نیست." },
    { key: "session", label: "نشست واتس‌اپ (خودکار)", type: "secret", required: true, help: "پس از اتصال موفق ذخیره می‌شود." },
    { key: "defaultChatId", label: "چت پیش‌فرض", type: "text", placeholder: "اختیاری — 98912…@s.whatsapp.net" },
  ],
  auth: whatsappAuth,
  test: async (ctx) => {
    const m = await getManaged(ctx);
    return { connected: true, user: { id: m.sock.user?.id, name: m.sock.user?.name } };
  },
  receive: {
    idleMs: 1_000,
    async poll(ctx, _cursor, longPollSec) {
      const m = await getManaged(ctx);
      if (!m.queue.length) {
        await new Promise<void>((resolvePromise) => {
          const waiter = () => {
            clearTimeout(timer);
            m.waiters.delete(waiter);
            resolvePromise();
          };
          const timer = setTimeout(() => {
            m.waiters.delete(waiter);
            resolvePromise();
          }, longPollSec > 0 ? longPollSec * 1_000 : 1_200);
          m.waiters.add(waiter);
        });
      }
      return { messages: m.queue.splice(0, m.queue.length), cursor: String(Date.now()) };
    },
  },
  tools: [
    defineTool({
      name: "whatsapp_get_session",
      title: "وضعیت اتصال واتس‌اپ",
      description: "Get the connected WhatsApp session.",
      input: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (_a, ctx) => {
        const m = await getManaged(ctx);
        return { connected: true, user: { id: m.sock.user?.id, name: m.sock.user?.name } };
      },
    }),
    defineTool({
      name: "whatsapp_get_chats",
      title: "فهرست گروه‌های واتس‌اپ",
      description: "List WhatsApp groups and the connected account.",
      input: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (_a, ctx) => {
        const m = await getManaged(ctx);
        let groups: any[] = [];
        try {
          const data = await m.sock.groupFetchAllParticipating();
          groups = Object.values(data ?? {}).map((g: any) => ({ chat_id: g.id, title: g.subject, type: "group" }));
        } catch { /* ignores enumeration restrictions */ }
        return { user: { id: m.sock.user?.id, name: m.sock.user?.name }, chats: groups };
      },
    }),
    defineTool({
      name: "whatsapp_send_message",
      title: "ارسال پیام واتس‌اپ",
      description: "Send a WhatsApp text message.",
      input: { chat_id: z.string().min(1), text: z.string().min(1).max(4096) },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const sent = await m.sock.sendMessage(jidOf(ctx, a.chat_id), { text: a.text });
        return { ok: true, chat_id: jidOf(ctx, a.chat_id), message_id: sent?.key?.id };
      },
    }),
    defineTool({
      name: "whatsapp_send_image",
      title: "ارسال عکس واتس‌اپ",
      description: "Send an image from a public URL.",
      input: { chat_id: z.string().min(1), url: z.string().url(), caption: z.string().max(1024).optional() },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const sent = await m.sock.sendMessage(jidOf(ctx, a.chat_id), { image: { url: a.url }, caption: a.caption });
        return { ok: true, chat_id: jidOf(ctx, a.chat_id), message_id: sent?.key?.id };
      },
    }),
    defineTool({
      name: "whatsapp_send_document",
      title: "ارسال فایل واتس‌اپ",
      description: "Send a document from a public URL.",
      input: { chat_id: z.string().min(1), url: z.string().url(), filename: z.string().optional(), caption: z.string().max(1024).optional() },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const sent = await m.sock.sendMessage(jidOf(ctx, a.chat_id), { document: { url: a.url }, fileName: a.filename, caption: a.caption });
        return { ok: true, chat_id: jidOf(ctx, a.chat_id), message_id: sent?.key?.id };
      },
    }),
  ],
};
