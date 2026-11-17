import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
// The version bundled with Baileys can be much older than WhatsApp Web.
// Using an old version results in a QR that the phone rejects/expires.
const FALLBACK_WA_VERSION = [2, 3000, 1054477537] as [number, number, number];

function waVersion(): [number, number, number] {
  const raw = process.env.WHATSAPP_WEB_VERSION?.trim();
  if (raw) {
    const parts = raw.split(".").map(Number);
    if (parts.length === 3 && parts.every((x) => Number.isFinite(x))) return parts as [number, number, number];
  }
  return FALLBACK_WA_VERSION;
}

function authDir(ctx: ProviderContext): string {
  const base = ctx.dataDir || process.env.DATA_DIR || resolve(process.cwd(), "data");
  return join(base, "whatsapp-auth");
}

function systemProxy(): string {
  if (process.platform !== "win32") return "";
  try {
    const out = execFileSync("reg.exe", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 2_000,
    });
    if (!/ProxyEnable\s+REG_DWORD\s+0x1/i.test(out)) return "";
    const raw = out.match(/ProxyServer\s+REG_SZ\s+(.+)/i)?.[1]?.trim();
    if (!raw) return "";
    // Windows can store per-protocol proxies: "http=host:port;https=host:port".
    const entries = raw.split(";").map((x) => x.trim()).filter(Boolean);
    const selected = entries.find((x) => /^https=/i.test(x)) || entries.find((x) => /^http=/i.test(x)) || entries[0];
    const address = selected.replace(/^[a-z]+=/i, "");
    return /^[a-z]+:\/\//i.test(address) ? address : `http://${address}`;
  } catch {
    return "";
  }
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
  // On Windows, use the system proxy (VPN clients usually expose one here).
  const winProxy = systemProxy();
  if (winProxy) {
    try { return new HttpsProxyAgent(winProxy); } catch { /* ignore */ }
  }
  return undefined;
}

function debug(event: string, data: Record<string, unknown> = {}) {
  if (process.env.WHATSAPP_DEBUG !== "1") return;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "qr" || key === "creds") continue;
    safe[key] = value;
  }
  console.error(`[whatsapp] ${new Date().toISOString()} ${event} ${JSON.stringify(safe)}`);
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
  if (/wrong version number|EPROTO|SSL routines|TLS/i.test(message))
    return new ProviderError(`${prefix}: اتصال TLS واتس‌اپ توسط شبکه/پروکسی قطع می‌شود. در «تنظیمات → شبکه و پروکسی» یک پروکسی HTTP یا SOCKS5 سالم تنظیم کنید.`, err);
  if (/Connection Closed|connection closed|timeout|timed out|ECONN|ETIMEDOUT|ECONNRESET|QR timeout/i.test(message))
    return new ProviderError(`${prefix}: اتصال به WhatsApp برقرار نشد. اینترنت/VPN یا HTTPS_PROXY/SOCKS_PROXY را بررسی کنید.`, err);
  if (/not registered|logged out|401/i.test(message))
    return new ProviderError(`${prefix}: نشست واتس‌اپ معتبر نیست؛ دوباره QR را بسازید.`, err);
  return new ProviderError(`${prefix}: ${message}`, err);
}

// ---------------------------------------------------------------- socket manager

interface ChatRecord {
  id: string;
  title: string;
  kind: "private" | "group" | "channel" | "broadcast";
  unread: number;
  timestamp: number;
  lastText?: string;
}

interface Managed {
  sock: any;
  queue: IncomingMessage[];
  waiters: Set<() => void>;
  closed: boolean;
  chats: Map<string, ChatRecord>;
  contacts: Map<string, string>;
  history: Map<string, any[]>;
  historyReady: boolean;
  historyWaiters: Set<() => void>;
}

let managed: Managed | undefined;
let pending: { sock: any; opened: boolean; error?: Error; qr?: string } | undefined;

function chatKind(id: string): ChatRecord["kind"] {
  if (id.endsWith("@g.us")) return "group";
  if (id.endsWith("@newsletter")) return "channel";
  if (id.endsWith("@broadcast")) return "broadcast";
  return "private";
}

function unwrapMessage(m: any): any {
  let c = m?.message ?? {};
  for (let i = 0; i < 3; i += 1) {
    const next = c?.viewOnceMessage?.message
      ?? c?.viewOnceMessageV2?.message
      ?? c?.viewOnceMessageV2Extension?.message
      ?? c?.ephemeralMessage?.message
      ?? c?.documentWithCaptionMessage?.message
      ?? c?.editedMessage?.message;
    if (!next) break;
    c = next;
  }
  return c;
}

function textOfMessage(m: any): string | undefined {
  const c = unwrapMessage(m);
  const candidates = [
    c?.conversation,
    c?.extendedTextMessage?.text,
    c?.imageMessage?.caption,
    c?.videoMessage?.caption,
    c?.documentMessage?.caption,
    c?.buttonsMessage?.contentText,
    c?.buttonsMessage?.headerText,
    c?.buttonsMessage?.footerText,
    c?.templateMessage?.hydratedTemplate?.hydratedContentText,
    c?.templateMessage?.hydratedTemplate?.hydratedTitleText,
    c?.templateMessage?.hydratedFourRowTemplate?.hydratedContentText,
    c?.templateMessage?.fourRowTemplate?.content?.text,
    c?.interactiveMessage?.body?.text,
    c?.interactiveMessage?.header?.title,
    c?.interactiveMessage?.footer?.text,
    c?.listMessage?.title,
    c?.listMessage?.description,
    c?.buttonsResponseMessage?.selectedDisplayText,
    c?.listResponseMessage?.title,
    c?.listResponseMessage?.singleSelectReply?.selectedRowId,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function mergeChat(target: Managed, raw: any) {
  const id = String(raw?.id?._serialized ?? raw?.id ?? "");
  if (!id) return;
  const existing = target.chats.get(id);
  const title = raw?.name || raw?.subject || raw?.verifiedName || target.contacts.get(id) || existing?.title || id.split("@")[0];
  target.chats.set(id, {
    id,
    title,
    kind: chatKind(id),
    unread: Number(raw?.unreadCount ?? existing?.unread ?? 0),
    timestamp: Number(raw?.conversationTimestamp ?? existing?.timestamp ?? 0),
    lastText: raw?.lastMessage?.message ? textOfMessage(raw.lastMessage) : existing?.lastText,
  });
}

function setContact(target: Managed, id: string, name: string) {
  if (!id || !name) return;
  target.contacts.set(id, name);
  const chat = target.chats.get(id);
  if (chat && (!chat.title || chat.title === id.split("@")[0])) chat.title = name;
}

function recordMessage(target: Managed, raw: any) {
  const jid = String(raw?.key?.remoteJid ?? "");
  if (!jid) return;
  const list = target.history.get(jid) ?? [];
  const id = String(raw?.key?.id ?? "");
  if (!id || list.some((x) => x?.key?.id === id)) return;
  list.push(raw);
  if (list.length > 300) list.splice(0, list.length - 300);
  target.history.set(jid, list);
  const existing = target.chats.get(jid);
  target.chats.set(jid, {
    id: jid,
    title: existing?.title || raw?.pushName || target.contacts.get(jid) || jid.split("@")[0],
    kind: chatKind(jid),
    unread: existing?.unread ?? 0,
    timestamp: Number(raw?.messageTimestamp ?? existing?.timestamp ?? 0),
    lastText: textOfMessage(raw) ?? existing?.lastText,
  });
}

function messageFromUpsert(m: any): IncomingMessage | null {
  if (!m?.key?.remoteJid) return null;
  const text = textOfMessage(m);
  if (!text && process.env.WHATSAPP_DEBUG_RAW === "1") {
    try {
      writeFileSync(resolve("data", "whatsapp-raw-last.json"), JSON.stringify({
        message: m?.message,
        messageStubType: m?.messageStubType,
        messageStubParameters: m?.messageStubParameters,
        messageTimestamp: m?.messageTimestamp,
      }, null, 2));
    } catch { /* debug only */ }
  }
  const c = m.message ?? {};
  const kind: IncomingMessage["kind"] = c.imageMessage ? "photo" : c.videoMessage ? "video" : c.audioMessage ? "voice" : c.documentMessage ? "file" : text !== undefined ? "text" : "other";
  return {
    key: `whatsapp:${m.key.remoteJid}:${m.key.id}`,
    provider: "whatsapp",
    chatId: String(m.key.remoteJid),
    chatTitle: m.pushName,
    chatType: chatKind(String(m.key.remoteJid)) === "group" ? "group" : "private",
    messageId: String(m.key.id ?? ""),
    from: m.key.participant ? { id: String(m.key.participant), name: m.pushName } : undefined,
    text,
    kind,
    date: new Date(Number(m.messageTimestamp ?? Date.now() / 1000) * 1000).toISOString(),
  };
}

function attachMessages(target: Managed) {
  target.sock.ev.on("messages.upsert", ({ messages }: any) => {
    for (const raw of messages ?? []) {
      recordMessage(target, raw);
      if (raw?.key?.fromMe) continue;
      const msg = messageFromUpsert(raw);
      if (!msg) continue;
      if (msg.from?.id) msg.from.name = target.contacts.get(msg.from.id) || msg.from.name;
      msg.chatTitle = target.contacts.get(msg.chatId) || msg.chatTitle;
      target.queue.push(msg);
      if (target.queue.length > MAX_QUEUE) target.queue.splice(0, target.queue.length - MAX_QUEUE);
      const waiter = target.waiters.values().next().value as (() => void) | undefined;
      waiter?.();
    }
  });
  target.sock.ev.on("messaging-history.set", ({ chats, contacts, messages }: any) => {
    for (const contact of contacts ?? []) {
      const id = String(contact?.id?._serialized ?? contact?.id ?? "");
      const name = contact?.name || contact?.notify || contact?.verifiedName;
      setContact(target, id, name);
    }
    for (const chat of chats ?? []) mergeChat(target, chat);
    for (const message of messages ?? []) recordMessage(target, message);
    target.historyReady = true;
    for (const waiter of target.historyWaiters) waiter();
    target.historyWaiters.clear();
  });
  target.sock.ev.on("chats.upsert", (chats: any[]) => {
    for (const chat of chats ?? []) mergeChat(target, chat);
  });
  target.sock.ev.on("chats.update", (chats: any[]) => {
    for (const chat of chats ?? []) mergeChat(target, chat);
  });
  target.sock.ev.on("contacts.upsert", (contacts: any[]) => {
    for (const contact of contacts ?? []) {
      const id = String(contact?.id?._serialized ?? contact?.id ?? "");
      const name = contact?.name || contact?.notify || contact?.verifiedName;
      setContact(target, id, name);
    }
  });
  target.sock.ev.on("contacts.update", (contacts: any[]) => {
    for (const contact of contacts ?? []) {
      const id = String(contact?.id?._serialized ?? contact?.id ?? "");
      const name = contact?.name || contact?.notify || contact?.verifiedName;
      setContact(target, id, name);
    }
  });
  target.sock.ev.on("connection.update", ({ connection }: any) => {
    if (connection === "close") target.closed = true;
  });
}

async function refreshChatIndex(target: Managed) {
  try {
    const groups = await target.sock.groupFetchAllParticipating();
    for (const group of Object.values(groups ?? {}) as any[]) mergeChat(target, group);
  } catch {
    // Some accounts cannot enumerate groups; the event index still works.
  }
}

async function waitForHistory(target: Managed, timeoutMs = 3_000) {
  if (target.historyReady) return;
  await new Promise<void>((resolvePromise) => {
    const done = () => {
      clearTimeout(timer);
      target.historyWaiters.delete(done);
      resolvePromise();
    };
    const timer = setTimeout(done, timeoutMs);
    target.historyWaiters.add(done);
  });
}

function publicChat(chat: ChatRecord) {
  return {
    chat_id: chat.id,
    title: chat.title,
    type: chat.kind,
    unread_count: chat.unread,
    last_message_at: chat.timestamp ? new Date(chat.timestamp * 1000).toISOString() : undefined,
    last_message: chat.lastText?.slice(0, 200),
  };
}

function sortedChats(target: Managed) {
  return [...target.chats.values()].sort((a, b) => b.timestamp - a.timestamp);
}

function includeContacts(target: Managed) {
  for (const [id, name] of target.contacts) {
    if (!target.chats.has(id)) mergeChat(target, { id, name });
  }
}

function participantsOf(ctx: ProviderContext, value: string[]) {
  return value.map((x) => (x.includes("@") ? x : jidOf(ctx, x)));
}

function findContacts(target: Managed, query: string) {
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  return [...target.contacts.entries()]
    .map(([id, name]) => ({ id, name }))
    .filter((c) => c.name.toLowerCase().includes(q) || (digits.length >= 6 && c.id.replace(/\D/g, "").includes(digits)));
}

function targetOf(target: Managed, ctx: ProviderContext, chatId?: string, contact?: string) {
  if (chatId?.trim()) return jidOf(ctx, chatId);
  if (!contact?.trim()) throw new ProviderError("chat_id یا نام مخاطب لازم است.");
  const matches = findContacts(target, contact);
  if (!matches.length) throw new ProviderError(`مخاطبی با نام «${contact}» پیدا نشد.`);
  if (matches.length > 1) {
    throw new ProviderError(`چند مخاطب با نام «${contact}» پیدا شد: ${matches.map((m) => `${m.name} (${m.id})`).join(" ، ")}`);
  }
  return matches[0].id;
}

function rawMessageView(m: any) {
  const c = m?.message ?? {};
  const text = textOfMessage(m);
  return {
    message_id: String(m?.key?.id ?? ""),
    chat_id: String(m?.key?.remoteJid ?? ""),
    from: String(m?.key?.participant ?? m?.key?.remoteJid ?? ""),
    from_me: Boolean(m?.key?.fromMe),
    text,
    type: c.imageMessage ? "image" : c.videoMessage ? "video" : c.audioMessage ? "audio" : c.documentMessage ? "document" : c.stickerMessage ? "sticker" : text !== undefined ? "text" : "other",
    timestamp: new Date(Number(m?.messageTimestamp ?? 0) * 1000).toISOString(),
  };
}


async function createSocket(ctx: ProviderContext): Promise<any> {
  const dir = authDir(ctx);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const latest = await Promise.race([
    fetchLatestWaWebVersion({}).catch(() => undefined),
    new Promise<undefined>((r) => setTimeout(() => r(undefined), 5_000)),
  ]);
  const fallback = waVersion();
  const fetched = latest?.version;
  // Never downgrade to a stale revision returned by a cached/proxied sw.js.
  const version = fetched && fetched[2] >= fallback[2] ? fetched : fallback;
  const agent = proxyAgent();
  const sock = makeWASocket({
    auth: state,
    version,
    ...(agent ? { agent, fetchAgent: agent } : {}),
    browser: Browsers.ubuntu("Chrome"),
    printQRInTerminal: false,
    syncFullHistory: true,
    markOnlineOnConnect: false,
    connectTimeoutMs: CONNECT_TIMEOUT_MS,
  });
  debug("socket-created", { proxy: Boolean(agent), version: version.join("."), fetched: fetched?.join(".") });
  sock.ev.on("creds.update", (update: any) => {
    debug("creds-update", { registered: Boolean(update?.registered), me: update?.me?.id ? "present" : "none" });
    saveCreds();
  });
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
  const target: Managed = { sock, queue: [], waiters: new Set(), closed: false, chats: new Map(), contacts: new Map(), history: new Map(), historyReady: false, historyWaiters: new Set() };
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
      let reconnecting = false;
      async function reconnect() {
        if (!pending || reconnecting) return;
        reconnecting = true;
        try {
          const old = pending.sock;
          await old.end(undefined).catch(() => {});
          const next = await createSocket(ctx);
          if (!pending) { await next.end(undefined).catch(() => {}); return; }
          pending.sock = next;
          pending.opened = false;
          pending.error = undefined;
          bind(next);
          debug("reconnected");
        } catch (err: any) {
          if (pending) pending.error = err;
        } finally {
          reconnecting = false;
        }
      }
      function bind(target: any) {
        target.ev.on("connection.update", ({ qr, connection, lastDisconnect }: any) => {
          if (!pending) return;
          const status = lastDisconnect?.error?.output?.statusCode;
          debug("connection", {
            connection: connection ?? "update",
            hasQr: Boolean(qr),
            status,
            error: lastDisconnect?.error?.message,
          });
          if (qr) pending.qr = String(qr);
          if (connection === "open") pending.opened = true;
          if (connection === "close") {
            // 515 is expected immediately after a successful QR pairing:
            // WhatsApp asks the client to reconnect with the new credentials.
            if (status === 515) {
              setTimeout(() => void reconnect(), 500);
            } else {
              pending.error = new Error(status === 401 ? "loggedOut" : "connection closed");
            }
          }
        });
      }
      bind(sock);
      const qrString = await waitForQr(sock, QR_TIMEOUT_MS);
      const qr = await QRCode.toDataURL(qrString, { width: 280, margin: 1, errorCorrectionLevel: "M" });
      pending.qr = qrString;
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
  async getQr() {
    if (!pending) return { error: "QR منقضی شده؛ دوباره QR را بسازید." };
    if (pending.opened) return { ready: true };
    if (pending.error) return { error: "QR منقضی شد؛ QR جدید بسازید." };
    if (!pending.qr) return {};
    return { qr: await QRCode.toDataURL(pending.qr, { width: 280, margin: 1, errorCorrectionLevel: "M" }) };
  },
  async verifyCode(_ctx, _transactionHash, _code, save) {
    debug("verify-start", { pending: Boolean(pending), opened: Boolean(pending?.opened), error: pending?.error?.message });
    if (!pending) throw new ProviderError("QR منقضی شده؛ دوباره QR را بسازید.");
    if (pending.error) throw new ProviderError("اتصال واتس‌اپ قطع شد؛ دوباره QR را بسازید.");
    if (!pending.opened) {
      const deadline = Date.now() + 40_000;
      while (Date.now() < deadline) {
        if (!pending) break;
        if (pending.error) throw new ProviderError("اتصال واتس‌اپ قطع شد؛ دوباره QR را بسازید.");
        if (pending.opened) break;
        try {
          await waitForOpen(pending.sock, 6_000);
          break;
        } catch {
          // After QR pairing WhatsApp normally closes with 515 and asks for
          // a reconnect. Wait for the new socket instead of failing immediately.
        }
      }
      if (!pending?.opened) {
        debug("verify-not-open");
        throw new ProviderError("هنوز QR اسکن نشده است. دوباره «بررسی اتصال» را بزنید.");
      }
    }
    const sock = pending.sock;
    const target: Managed = { sock, queue: [], waiters: new Set(), closed: false, chats: new Map(), contacts: new Map(), history: new Map(), historyReady: false, historyWaiters: new Set() };
    attachMessages(target);
    // Give the initial history sync a chance to arrive before completing login.
    await waitForHistory(target, 6_000);
    managed = target;
    pending = undefined;
    debug("verify-done", { user: String(sock.user?.id ?? "").replace(/@.*/, "") });
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
  region: "international",
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
      name: "whatsapp_get_contacts",
      title: "مخاطبین واتس‌اپ",
      description: "List saved WhatsApp contact names and their chat IDs.",
      input: { query: z.string().optional(), limit: z.number().int().min(1).max(500).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        await waitForHistory(m);
        const contacts = (a.query ? findContacts(m, a.query) : [...m.contacts.entries()].map(([id, name]) => ({ id, name })))
          .slice(0, a.limit ?? 200);
        return {
          total: m.contacts.size,
          contacts,
          note: contacts.length ? undefined : "دفترچه مخاطبین این نشست خالی است؛ واتس‌اپ هنوز تاریخچه/مخاطبین را ارسال نکرده است. یک بار با QR از نو وارد شوید.",
        };
      },
    }),
    defineTool({
      name: "whatsapp_find_contact",
      title: "جستجوی مخاطب با نام",
      description: "Find a saved WhatsApp contact by name or phone number and return its chat ID.",
      input: { query: z.string().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        await waitForHistory(m);
        const matches = findContacts(m, a.query);
        return { matches, note: matches.length ? undefined : "مخاطبی با این نام در دفترچه واتس‌اپ پیدا نشد." };
      },
    }),
    defineTool({
      name: "whatsapp_resolve_contact",
      title: "پیدا کردن شناسه چت با شماره",
      description: "Resolve a phone number to a WhatsApp chat ID (JID).",
      input: { phone: z.string().min(6) },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const digits = a.phone.replace(/\D/g, "");
        const results = await m.sock.onWhatsApp(digits);
        const found = results?.[0];
        if (!found?.exists) throw new ProviderError("این شماره در واتس‌اپ ثبت نشده است.");
        mergeChat(m, { id: found.jid, name: a.phone });
        return { chat_id: found.jid, phone: a.phone, exists: true };
      },
    }),
    defineTool({
      name: "whatsapp_get_chats",
      title: "فهرست چت‌ها و کانال‌های واتس‌اپ",
      description: "List WhatsApp private chats, groups and channels.",
      input: {
        limit: z.number().int().min(1).max(100).optional(),
        type: z.enum(["all", "private", "group", "channel"]).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        await waitForHistory(m);
        await refreshChatIndex(m);
        includeContacts(m);
        const filter = a.type && a.type !== "all" ? a.type : undefined;
        const chats = sortedChats(m)
          .filter((c) => !filter || c.kind === filter)
          .slice(0, a.limit ?? 50)
          .map(publicChat);
        return {
          user: { id: m.sock.user?.id, name: m.sock.user?.name },
          total: m.chats.size,
          chats,
          note: chats.length ? undefined : "واتس‌اپ هنوز تاریخچه‌ی این نشست را ارسال نکرده است. گروه‌ها و کانال‌های شناخته‌شده نمایش داده می‌شوند؛ برای دریافت گفتگوهای خصوصی یک بار از حساب خارج و دوباره با QR وارد شوید.",
        };
      },
    }),
    defineTool({
      name: "whatsapp_get_chat",
      title: "جزئیات چت / گروه / کانال",
      description: "Get details and participants of a WhatsApp chat, group or channel.",
      input: { chat_id: z.string().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const id = jidOf(ctx, a.chat_id);
        const chat = m.chats.get(id);
        if (chat?.kind === "group") {
          const meta = await m.sock.groupMetadata(id);
          return {
            ...publicChat(chat),
            description: meta.desc,
            owner: meta.owner,
            participants: (meta.participants ?? []).map((p: any) => ({ id: p.id, admin: p.admin ?? null })),
          };
        }
        if (chat?.kind === "channel") {
          const meta = await m.sock.newsletterMetadata("jid", id).catch(() => null);
          return { ...publicChat(chat), ...(meta ?? {}) };
        }
        return publicChat(chat ?? { id, title: id.split("@")[0], kind: chatKind(id), unread: 0, timestamp: 0 });
      },
    }),
    defineTool({
      name: "whatsapp_get_messages",
      title: "پیام‌های یک چت یا کانال",
      description: "Get recent cached messages of a WhatsApp chat, or fetch recent channel messages.",
      input: { chat_id: z.string().min(1), limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const id = jidOf(ctx, a.chat_id);
        const limit = a.limit ?? 30;
        if (id.endsWith("@newsletter")) {
          try {
            const result = await m.sock.newsletterFetchMessages(id, limit, 0, 0);
            const raw = Array.isArray(result) ? result : result?.messages ?? [];
            const messages = raw.slice(-limit).map(rawMessageView);
            return { chat_id: id, messages };
          } catch (err: any) {
            throw friendlyError(err, "دریافت پیام‌های کانال");
          }
        }
        const cached = (m.history.get(id) ?? []).slice(-limit).map(rawMessageView);
        return { chat_id: id, messages: cached };
      },
    }),
    defineTool({
      name: "whatsapp_mark_read",
      title: "علامت‌گذاری چت به‌عنوان خوانده‌شده",
      description: "Mark recent messages of a WhatsApp chat as read.",
      input: { chat_id: z.string().min(1) },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const id = jidOf(ctx, a.chat_id);
        const keys = (m.history.get(id) ?? [])
          .filter((x: any) => !x?.key?.fromMe)
          .map((x: any) => ({ remoteJid: id, id: x.key.id, fromMe: false, participant: x.key.participant }));
        if (!keys.length) throw new ProviderError("پیام خوانده‌نشده‌ای برای این چت پیدا نشد.");
        await m.sock.readMessages(keys);
        return { ok: true, chat_id: id, marked: keys.length };
      },
    }),
    defineTool({
      name: "whatsapp_send_message",
      title: "ارسال پیام واتس‌اپ",
      description: "Send a WhatsApp text message, optionally quoting a previous message. Use chat_id or a saved contact name.",
      input: { chat_id: z.string().optional(), contact: z.string().optional(), text: z.string().min(1).max(4096), reply_to: z.string().optional() },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const id = targetOf(m, ctx, a.chat_id, a.contact);
        const quoted = a.reply_to ? (m.history.get(id) ?? []).find((x: any) => x?.key?.id === a.reply_to) : undefined;
        const sent = await m.sock.sendMessage(id, { text: a.text }, quoted ? { quoted } : undefined);
        return { ok: true, chat_id: id, message_id: sent?.key?.id };
      },
    }),
    defineTool({
      name: "whatsapp_send_image",
      title: "ارسال عکس واتس‌اپ",
      description: "Send an image from a public URL to a chat ID or saved contact.",
      input: { chat_id: z.string().optional(), contact: z.string().optional(), url: z.string().url(), caption: z.string().max(1024).optional() },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const id = targetOf(m, ctx, a.chat_id, a.contact);
        const sent = await m.sock.sendMessage(id, { image: { url: a.url }, caption: a.caption });
        return { ok: true, chat_id: id, message_id: sent?.key?.id };
      },
    }),
    defineTool({
      name: "whatsapp_send_document",
      title: "ارسال فایل واتس‌اپ",
      description: "Send a document from a public URL to a chat ID or saved contact.",
      input: { chat_id: z.string().optional(), contact: z.string().optional(), url: z.string().url(), filename: z.string().optional(), caption: z.string().max(1024).optional() },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const id = targetOf(m, ctx, a.chat_id, a.contact);
        const sent = await m.sock.sendMessage(id, { document: { url: a.url }, fileName: a.filename, caption: a.caption });
        return { ok: true, chat_id: id, message_id: sent?.key?.id };
      },
    }),
    defineTool({
      name: "whatsapp_create_group",
      title: "ساخت گروه واتس‌اپ",
      description: "Create a WhatsApp group with participants.",
      input: { name: z.string().min(1).max(100), participants: z.array(z.string().min(3)).min(1) },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const meta = await m.sock.groupCreate(a.name, participantsOf(ctx, a.participants));
        return { ok: true, chat_id: meta.id, title: meta.subject, participants: meta.participants?.length };
      },
    }),
    defineTool({
      name: "whatsapp_group_add_participants",
      title: "افزودن عضو به گروه",
      description: "Add participants to a WhatsApp group.",
      input: { chat_id: z.string().min(1), participants: z.array(z.string().min(3)).min(1) },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const result = await m.sock.groupParticipantsUpdate(jidOf(ctx, a.chat_id), participantsOf(ctx, a.participants), "add");
        return { ok: true, result };
      },
    }),
    defineTool({
      name: "whatsapp_group_remove_participants",
      title: "حذف عضو از گروه",
      description: "Remove participants from a WhatsApp group.",
      input: { chat_id: z.string().min(1), participants: z.array(z.string().min(3)).min(1) },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const result = await m.sock.groupParticipantsUpdate(jidOf(ctx, a.chat_id), participantsOf(ctx, a.participants), "remove");
        return { ok: true, result };
      },
    }),
    defineTool({
      name: "whatsapp_group_set_role",
      title: "مدیر یا عضو کردن کاربر",
      description: "Promote or demote a group participant.",
      input: { chat_id: z.string().min(1), participant: z.string().min(3), action: z.enum(["promote", "demote"]) },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const result = await m.sock.groupParticipantsUpdate(jidOf(ctx, a.chat_id), participantsOf(ctx, [a.participant]), a.action);
        return { ok: true, result };
      },
    }),
    defineTool({
      name: "whatsapp_group_update",
      title: "ویرایش تنظیمات گروه",
      description: "Update a WhatsApp group subject, description or settings.",
      input: {
        chat_id: z.string().min(1),
        subject: z.string().min(1).max(100).optional(),
        description: z.string().max(1024).optional(),
        setting: z.enum(["announcement", "not_announcement", "locked", "unlocked"]).optional(),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const id = jidOf(ctx, a.chat_id);
        if (a.subject) await m.sock.groupUpdateSubject(id, a.subject);
        if (a.description !== undefined) await m.sock.groupUpdateDescription(id, a.description);
        if (a.setting) await m.sock.groupSettingUpdate(id, a.setting);
        return { ok: true, chat_id: id };
      },
    }),
    defineTool({
      name: "whatsapp_group_invite",
      title: "لینک دعوت گروه",
      description: "Get or revoke a WhatsApp group invite link.",
      input: { chat_id: z.string().min(1), revoke: z.boolean().optional() },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const id = jidOf(ctx, a.chat_id);
        const code = a.revoke ? await m.sock.groupRevokeInvite(id) : await m.sock.groupInviteCode(id);
        return { ok: true, chat_id: id, invite_link: code ? `https://chat.whatsapp.com/${code}` : undefined, code };
      },
    }),
    defineTool({
      name: "whatsapp_group_leave",
      title: "خروج از گروه",
      description: "Leave a WhatsApp group. Set confirm=true to execute.",
      input: { chat_id: z.string().min(1), confirm: z.literal(true) },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const id = jidOf(ctx, a.chat_id);
        await m.sock.groupLeave(id);
        m.chats.delete(id);
        return { ok: true, chat_id: id, left: true };
      },
    }),
    defineTool({
      name: "whatsapp_channel_info",
      title: "اطلاعات کانال واتس‌اپ",
      description: "Get WhatsApp channel metadata by channel JID or invite code.",
      input: { channel: z.string().min(1), by: z.enum(["jid", "invite"]).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const type = a.by ?? (a.channel.endsWith("@newsletter") ? "jid" : "invite");
        const meta = await m.sock.newsletterMetadata(type, a.channel);
        if (!meta) throw new ProviderError("کانال پیدا نشد.");
        return meta;
      },
    }),
    defineTool({
      name: "whatsapp_channel_create",
      title: "ساخت کانال واتس‌اپ",
      description: "Create a WhatsApp channel.",
      input: { name: z.string().min(1).max(100), description: z.string().max(1024).optional() },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const meta = await m.sock.newsletterCreate(a.name, a.description);
        return { ok: true, channel: meta };
      },
    }),
    defineTool({
      name: "whatsapp_channel_messages",
      title: "پیام‌های کانال واتس‌اپ",
      description: "Fetch recent messages from a WhatsApp channel.",
      input: { channel: z.string().min(1), limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const jid = a.channel.includes("@") ? a.channel : jidOf(ctx, a.channel);
        const result = await m.sock.newsletterFetchMessages(jid, a.limit ?? 30, 0, 0);
        const raw = Array.isArray(result) ? result : result?.messages ?? [];
        return { channel: jid, messages: raw.slice(-(a.limit ?? 30)).map(rawMessageView) };
      },
    }),
    defineTool({
      name: "whatsapp_channel_send",
      title: "ارسال پیام در کانال",
      description: "Send a text message to a WhatsApp channel where the account is admin.",
      input: { channel: z.string().min(1), text: z.string().min(1).max(4096) },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const jid = a.channel.includes("@") ? a.channel : jidOf(ctx, a.channel);
        const sent = await m.sock.sendMessage(jid, { text: a.text });
        return { ok: true, channel: jid, message_id: sent?.key?.id };
      },
    }),
    defineTool({
      name: "whatsapp_channel_follow",
      title: "دنبال کردن / بی‌صدا کردن کانال",
      description: "Follow, unfollow, mute or unmute a WhatsApp channel.",
      input: { channel: z.string().min(1), action: z.enum(["follow", "unfollow", "mute", "unmute"]) },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const jid = a.channel.includes("@") ? a.channel : jidOf(ctx, a.channel);
        if (a.action === "follow") await m.sock.newsletterFollow(jid);
        else if (a.action === "unfollow") await m.sock.newsletterUnfollow(jid);
        else if (a.action === "mute") await m.sock.newsletterMute(jid);
        else await m.sock.newsletterUnmute(jid);
        return { ok: true, channel: jid, action: a.action };
      },
    }),
    defineTool({
      name: "whatsapp_channel_update",
      title: "ویرایش کانال",
      description: "Update a WhatsApp channel name or description.",
      input: { channel: z.string().min(1), name: z.string().min(1).max(100).optional(), description: z.string().max(1024).optional() },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const jid = a.channel.includes("@") ? a.channel : jidOf(ctx, a.channel);
        if (a.name) await m.sock.newsletterUpdateName(jid, a.name);
        if (a.description !== undefined) await m.sock.newsletterUpdateDescription(jid, a.description);
        return { ok: true, channel: jid };
      },
    }),
    defineTool({
      name: "whatsapp_channel_delete",
      title: "حذف کانال",
      description: "Delete a WhatsApp channel owned by this account. Set confirm=true to execute.",
      input: { channel: z.string().min(1), confirm: z.literal(true) },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const jid = a.channel.includes("@") ? a.channel : jidOf(ctx, a.channel);
        await m.sock.newsletterDelete(jid);
        m.chats.delete(jid);
        return { ok: true, channel: jid, deleted: true };
      },
    }),
  ],
};
