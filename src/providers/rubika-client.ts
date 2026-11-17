import { createCipheriv, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client as RubikaClient, Clients } from "rubjs";
import { z } from "zod";
import { describeNetError } from "../core/net.js";
import { isUploadable, loadMedia, mediaField } from "../core/media.js";
import {
  defineTool,
  ProviderError,
  type AuthStep,
  type IncomingMessage,
  type ProviderAuthDef,
  type ProviderContext,
  type ProviderDef,
} from "../core/types.js";

export const RUBIKA_CLIENT_ID = "rubika_client";

const nodeRequire = createRequire(import.meta.url);
const rubjsRoot = dirname(dirname(nodeRequire.resolve("rubjs")));
const RubikaNetwork = nodeRequire(join(rubjsRoot, "lib", "clients", "network_login.js")).default;
const RubikaCrypto = nodeRequire(join(rubjsRoot, "lib", "core", "client", "crypto.js")).default;

const RUBIKA_WEB_APP_VERSION = "4.4.34";
const originalNetworkSend = RubikaNetwork.prototype.send;
RubikaNetwork.prototype.send = function patchedSend(this: any, ...args: any[]) {
  if (this.defaultPlatform) this.defaultPlatform.app_version = RUBIKA_WEB_APP_VERSION;
  return originalNetworkSend.apply(this, args);
};

const SESSION_SECRET = "12345678901234567890123456789012";
const MAX_QUEUE = 500;
const CONNECT_TIMEOUT_MS = 45_000;

interface RubikaSessionData {
  phone: string;
  auth: string;
  guid: string;
  agent: string;
  private_key: string;
}

interface PendingAuth {
  phone: string;
  result: any;
  createdAt: number;
}

const pendingAuth = new Map<string, PendingAuth>();

// ---------------------------------------------------------------- helpers

export function normalizeRubikaPhone(raw: string): string {
  const latin = String(raw ?? "")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  let s = latin.replace(/[^\d]/g, "");
  if (s.startsWith("0098")) s = s.slice(2);
  if (s.startsWith("0")) s = `98${s.slice(1)}`;
  else if (s.startsWith("9") && s.length === 10) s = `98${s}`;
  return s;
}

export function parseRubikaSession(raw: string): RubikaSessionData {
  let value: any;
  try {
    value = JSON.parse(String(raw ?? "").trim());
  } catch {
    throw new ProviderError("نشست روبیکا معتبر نیست. با دکمه‌ی «ورود با حساب روبیکا» دوباره وارد شوید.");
  }
  if (!value || typeof value !== "object" || !value.auth || !value.guid || !value.private_key) {
    throw new ProviderError("نشست روبیکا ناقص است. دوباره وارد شوید.");
  }
  return {
    phone: String(value.phone ?? ""),
    auth: String(value.auth),
    guid: String(value.guid),
    agent: String(value.agent ?? ""),
    private_key: String(value.private_key),
  };
}

function encryptSession(session: RubikaSessionData): { iv: string; enData: string } {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", Buffer.from(SESSION_SECRET), iv);
  const enData = cipher.update(JSON.stringify(session), "utf8", "hex") + cipher.final("hex");
  return { iv: iv.toString("hex"), enData };
}

function decodeAuth(auth: string): string {
  let out = "";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const upper = lower.toUpperCase();
  const digits = "0123456789";
  for (const s of auth) {
    if (lower.includes(s)) out += String.fromCharCode(((32 - (s.charCodeAt(0) - 97)) % 26) + 97);
    else if (upper.includes(s)) out += String.fromCharCode(((29 - (s.charCodeAt(0) - 65)) % 26) + 65);
    else if (digits.includes(s)) out += String.fromCharCode(((13 - (s.charCodeAt(0) - 48)) % 10) + 48);
    else out += s;
  }
  return out;
}

function passphrase(auth: string): string {
  if (auth.length !== 32) throw new ProviderError("نشست روبیکا معتبر نیست (طول auth).");
  const chunks = auth.match(/.{8}/g);
  if (!chunks || chunks.length !== 4) throw new ProviderError("نشست روبیکا معتبر نیست (auth).");
  const combined = chunks[2] + chunks[0] + chunks[3] + chunks[1];
  return [...combined].map((c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 9) % 26) + 97)).join("");
}

function isoDate(value: unknown): string {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) {
    const ms = n < 1e11 ? n * 1000 : n;
    return new Date(ms).toISOString();
  }
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function chatTypeOfGuid(guid: string): IncomingMessage["chatType"] {
  if (/^u0/i.test(guid) || /^b0/i.test(guid)) return "private";
  if (/^g0/i.test(guid)) return "group";
  if (/^c0/i.test(guid)) return "channel";
  return "unknown";
}

function kindOfMessage(message: any): IncomingMessage["kind"] {
  const file = message?.file_inline;
  if (file) {
    const t = String(file.type ?? "").toLowerCase();
    if (t === "image") return "photo";
    if (t === "video" || t === "videomessage" || t === "gif") return "video";
    if (t === "voice" || t === "music") return "voice";
    return "file";
  }
  if (message?.location) return "location";
  if (message?.text !== undefined) return "text";
  return "other";
}

function friendlyError(err: any, prefix: string): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err?.message === "timeout") {
    return new ProviderError(`${prefix}: زمان اتصال به روبیکا تمام شد. اتصال شبکه/فیلتر را بررسی کنید.`, err);
  }
  if (/auth|session|user_guid|invalid|bad decrypt|decrypt|oaep|decoder routines/i.test(String(err?.message ?? ""))) {
    return new ProviderError("نشست روبیکا معتبر نیست؛ دوباره وارد شوید.", err);
  }
  if (err?.name === "TimeoutError" || err?.code) {
    return new ProviderError(`${prefix}: ${describeNetError(err)}`, err);
  }
  return new ProviderError(`${prefix}: ${err?.message ?? String(err)}`, err);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// ---------------------------------------------------------------- client

class SafeRubikaClient extends RubikaClient {
  declare startPromise: Promise<void>;
  declare startError?: Error;

  override async start(): Promise<void> {
    const work = (async () => {
      const db = this.sessionDb.getSession() as RubikaSessionData | null;
      if (!db) throw new Error("No Rubika session");
      this.auth = db.auth;
      this.userGuid = db.guid;
      this.privateKey = db.private_key;
      if (typeof db.agent === "string" && db.agent) this.network.userAgent = db.agent;
      if (!this.auth) throw new Error("No Rubika session");
      this.network.defaultPlatform.app_version = RUBIKA_WEB_APP_VERSION;
      this.key = Buffer.from(passphrase(this.auth), "utf8");
      this.decode_auth = decodeAuth(this.auth);
      const result = await this.getUserInfo();
      const guid = result?.user?.user_guid;
      if (!guid) throw new Error("Rubika session is invalid");
      this.userGuid = guid;
      this.initialize = true;
    })();
    this.startPromise = work.catch((err) => {
      this.startError = err instanceof Error ? err : new Error(String(err));
      this.initialize = false;
    });
    await this.startPromise;
  }
}

interface Waiter {
  wake: () => void;
  fail: (err: Error) => void;
}

interface ManagedClient {
  session: string;
  client: SafeRubikaClient;
  selfGuid: string;
  queue: IncomingMessage[];
  waiters: Set<Waiter>;
  titles: Map<string, { title?: string; type: IncomingMessage["chatType"] }>;
  outgoing: Set<string>;
  closed: boolean;
  connecting?: Promise<void>;
}

let current: ManagedClient | undefined;

function wakeAll(m: ManagedClient, err?: Error) {
  for (const w of [...m.waiters]) {
    if (err) w.fail(err);
    else w.wake();
  }
}

async function closeClient(client: SafeRubikaClient): Promise<void> {
  try {
    const network = client.network;
    if (network.heartbeatInterval) clearInterval(network.heartbeatInterval);
    if (network.inactivityTimeout) clearTimeout(network.inactivityTimeout);
    network.ws?.close();
    network.ws = undefined;
  } catch {
  }
}

export async function resetRubikaClient(): Promise<void> {
  const m = current;
  current = undefined;
  if (!m) return;
  m.closed = true;
  wakeAll(m, new ProviderError("اتصال روبیکا قطع شد"));
  await closeClient(m.client);
}

function pushMessage(m: ManagedClient, message: IncomingMessage) {
  m.queue.push(message);
  if (m.queue.length > MAX_QUEUE) m.queue.splice(0, m.queue.length - MAX_QUEUE);
  const first = m.waiters.values().next().value as Waiter | undefined;
  first?.wake();
}

function toIncoming(m: ManagedClient, ctx: any): IncomingMessage | undefined {
  const raw = ctx?.message ?? {};
  const chatId = String(ctx?.object_guid ?? raw.object_guid ?? "");
  const messageId = String(ctx?.message_id ?? raw.message_id ?? "");
  if (!chatId || !messageId) return undefined;
  const authorGuid = String(raw.author_object_guid ?? "");
  const direction: IncomingMessage["direction"] = authorGuid && authorGuid === m.selfGuid ? "out" : "in";
  if (direction === "out" && m.outgoing.has(messageId)) return undefined;
  const known = m.titles.get(chatId);
  return {
    key: `${RUBIKA_CLIENT_ID}:${chatId}:${messageId}`,
    provider: RUBIKA_CLIENT_ID,
    chatId,
    chatTitle: known?.title,
    chatType: known?.type ?? chatTypeOfGuid(chatId),
    messageId,
    from: authorGuid ? { id: authorGuid, name: raw.author_title } : undefined,
    text: raw.text,
    kind: kindOfMessage(raw),
    date: isoDate(raw.time ?? ctx.timestamp),
    direction,
    source: direction === "out" ? "account" : undefined,
  };
}

function messageFromHistory(m: ManagedClient, chatId: string, raw: any): IncomingMessage {
  const msg = raw?.message ?? raw ?? {};
  const messageId = String(raw?.message_id ?? msg?.message_id ?? "");
  const authorGuid = String(msg?.author_object_guid ?? raw?.author_object_guid ?? "");
  const direction: IncomingMessage["direction"] = authorGuid && authorGuid === m.selfGuid ? "out" : "in";
  const known = m.titles.get(chatId);
  return {
    key: `${RUBIKA_CLIENT_ID}:${chatId}:${messageId}`,
    provider: RUBIKA_CLIENT_ID,
    chatId,
    chatTitle: known?.title,
    chatType: known?.type ?? chatTypeOfGuid(chatId),
    messageId,
    from: authorGuid ? { id: authorGuid, name: msg?.author_title } : undefined,
    text: msg?.text,
    kind: kindOfMessage(msg),
    date: isoDate(msg?.time ?? raw?.time),
    direction,
    source: direction === "out" ? "account" : undefined,
  };
}

function titleOfChat(chat: any): string | undefined {
  const title =
    chat?.title ||
    [chat?.first_name, chat?.last_name].filter(Boolean).join(" ") ||
    chat?.username ||
    chat?.object_guid;
  return title ? String(title) : undefined;
}

async function fetchChats(client: SafeRubikaClient): Promise<any> {
  try {
    const first: any = await client.getChats("");
    if (first && Array.isArray(first.chats)) return first;
  } catch {
  }
  return await client.getChats("0");
}

async function loadChatIndex(m: ManagedClient): Promise<void> {
  try {
    const data: any = await fetchChats(m.client);
    const chats: any[] = Array.isArray(data?.chats) ? data.chats : [];
    for (const chat of chats) {
      const guid = String(chat?.object_guid ?? chat?.guid ?? "");
      if (!guid) continue;
      m.titles.set(guid, { title: titleOfChat(chat), type: chatTypeOfGuid(guid) });
    }
  } catch {
  }
}

function createManaged(session: RubikaSessionData, raw: string): ManagedClient {
  const client = new SafeRubikaClient(encryptSession(session), "Web", 15_000);
  const m: ManagedClient = {
    session: raw,
    client,
    selfGuid: session.guid,
    queue: [],
    waiters: new Set(),
    titles: new Map(),
    outgoing: new Set(),
    closed: false,
  };
  client.on("message", async (ctx: any) => {
    try {
      const incoming = toIncoming(m, ctx);
      if (incoming) pushMessage(m, incoming);
    } catch {
    }
  });
  return m;
}

async function connectManaged(m: ManagedClient): Promise<void> {
  try {
    await m.client.startPromise;
    if (m.client.startError) throw friendlyError(m.client.startError, "اتصال به حساب روبیکا برقرار نشد");
    if (m.closed) {
      await closeClient(m.client);
      return;
    }
    m.selfGuid = m.client.userGuid ?? m.selfGuid;
    await loadChatIndex(m);
    await m.client.run();
  } catch (err) {
    m.closed = true;
    await closeClient(m.client);
    throw friendlyError(err, "اتصال به حساب روبیکا برقرار نشد");
  }
}

async function getManaged(ctx: ProviderContext): Promise<ManagedClient> {
  const raw = ctx.config.session?.trim();
  if (!raw) throw new ProviderError("اول با حساب روبیکا وارد شوید (دکمه‌ی «ورود با حساب روبیکا»).");
  if (current && current.session === raw) {
    if (!current.closed) {
      if (current.connecting) await current.connecting;
      return current;
    }
    await resetRubikaClient();
  }

  await resetRubikaClient();
  const session = parseRubikaSession(raw);
  const managed = createManaged(session, raw);
  current = managed;
  managed.connecting = connectManaged(managed);
  try {
    await withTimeout(managed.connecting, CONNECT_TIMEOUT_MS);
    return managed;
  } catch (err) {
    if (current === managed) current = undefined;
    managed.closed = true;
    await closeClient(managed.client);
    throw err instanceof ProviderError ? err : friendlyError(err, "اتصال به حساب روبیکا برقرار نشد");
  }
}

async function waitForMessage(m: ManagedClient, timeoutMs: number): Promise<void> {
  if (m.queue.length) return;
  if (m.closed) throw new ProviderError("اتصال روبیکا قطع شده است؛ دوباره وصل می‌شویم");
  await new Promise<void>((resolve, reject) => {
    let timer: NodeJS.Timeout;
    const waiter: Waiter = {
      wake: () => {
        clearTimeout(timer);
        m.waiters.delete(waiter);
        resolve();
      },
      fail: (err) => {
        clearTimeout(timer);
        m.waiters.delete(waiter);
        reject(err);
      },
    };
    m.waiters.add(waiter);
    timer = setTimeout(() => waiter.wake(), Math.max(200, timeoutMs));
  });
  if (m.closed && !m.queue.length) throw new ProviderError("اتصال روبیکا قطع شده است؛ دوباره وصل می‌شویم");
}

async function resolveTitles(m: ManagedClient, messages: IncomingMessage[]): Promise<void> {
  const missing = [...new Set(messages.map((x) => x.chatId))].filter((id) => !m.titles.get(id)?.title).slice(0, 5);
  await Promise.all(
    missing.map(async (chatId) => {
      try {
        let title: string | undefined;
        if (/^u0/i.test(chatId)) {
          const r: any = await withTimeout(m.client.getUserInfo(chatId), 3_000);
          const u = r?.user;
          title = [u?.first_name, u?.last_name].filter(Boolean).join(" ") || u?.username;
        } else if (/^g0/i.test(chatId)) {
          const r: any = await withTimeout(m.client.getGroupInfo(chatId), 3_000);
          title = r?.group?.group_title ?? r?.group?.title;
        } else if (/^c0/i.test(chatId)) {
          const r: any = await withTimeout(m.client.getChannelInfo(chatId), 3_000);
          title = r?.channel?.channel_title ?? r?.channel?.title;
        }
        if (title) m.titles.set(chatId, { title: String(title), type: chatTypeOfGuid(chatId) });
      } catch {
      }
    }),
  );
  for (const message of messages) {
    const known = m.titles.get(message.chatId);
    if (!known) continue;
    if (known.title) message.chatTitle = known.title;
    message.chatType = known.type;
  }
}

function chatIdOf(ctx: ProviderContext, chatId?: string): string {
  const id = chatId?.trim() || ctx.config.defaultChatId?.trim();
  if (!id) throw new ProviderError("chat_id داده نشده و «چت پیش‌فرض» هم در تنظیمات خالی است");
  return id;
}

async function resolveTarget(client: SafeRubikaClient, rawId: string): Promise<string> {
  if (!rawId.startsWith("@")) return rawId;
  const info: any = await client.getObjectInfoByUsername(rawId.slice(1));
  const guid = info?.object_guid ?? info?.user?.user_guid ?? info?.channel?.channel_guid ?? info?.group?.group_guid;
  if (!guid) throw new ProviderError(`کاربر/کانالی با نام «${rawId}» پیدا نشد.`);
  return String(guid);
}

async function sendWithMedia(
  client: SafeRubikaClient,
  chatId: string,
  value: string,
  type: "Image" | "File",
  caption: string | undefined,
  opts: { expect?: "image"; filename?: string },
) {
  if (!isUploadable(value)) {
    throw new ProviderError("برای حساب کاربری روبیکا فقط لینک عمومی یا فایل انتخاب‌شده پشتیبانی می‌شود (file_id نه).");
  }
  const media = await loadMedia(value, opts);
  const dir = await mkdtemp(join(tmpdir(), "diba-rubika-"));
  const safeName = media.filename.replace(/[\\/:*?"<>|]+/g, "_") || "file";
  const file = join(dir, safeName);
  try {
    await writeFile(file, Buffer.from(await media.blob.arrayBuffer()));
    const res: any = await client.sendMessage(chatId, caption, null, file, type);
    const update = res?.message_update ?? res ?? {};
    if (!update.message_id) throw new ProviderError("روبیکا ارسال فایل را تأیید نکرد.");
    return {
      ok: true,
      chat_id: chatId,
      message_id: String(update.message_id),
      kind: type === "Image" ? "photo" : "file",
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------- auth

function rubikaStatusMessage(status: unknown, detail: unknown): string {
  const code = String(detail || status || "UNKNOWN");
  if (/INVALID_INPUT/i.test(code))
    return "روبیکا ورودی را نپذیرفت (INVALID_INPUT). شماره را با ۰۹ یا +۹۸ و بدون فاصله وارد کنید و دوباره تلاش کنید.";
  if (/NOT_SUPPORTED_API_VERSION/i.test(code))
    return "نسخه‌ی پروتکل این کلاینت برای روبیکا قدیمی شده است؛ کتابخانه‌ی rubjs باید به‌روزرسانی شود.";
  if (/TOO_REQUESTS|FLOOD/i.test(code))
    return "درخواست‌های ورود زیاد بوده؛ چند دقیقه بعد دوباره تلاش کنید.";
  if (/UNDELIVERABLE/i.test(code)) return "روبیکا نتوانست کد را به این شماره بفرستد؛ شماره را بررسی کنید.";
  if (/PASSWORD_HASH_INVALID|InvalidPassKey/i.test(code)) return "رمز دومرحله‌ای اشتباه است.";
  if (/NOT_REGISTERED/i.test(code)) return "این شماره در روبیکا ثبت نشده است؛ اول در اپ روبیکا ثبت‌نام کنید.";
  if (/INVALID_AUTH/i.test(code)) return "نشست روبیکا معتبر نیست؛ دوباره وارد شوید.";
  return `روبیکا درخواست را رد کرد: ${String(status ?? "UNKNOWN")}${detail ? ` (${String(detail)})` : ""}`;
}

async function rawSendCode(phone: string, passKey?: string): Promise<any> {
  const network = new RubikaNetwork();
  const auth = RubikaCrypto.secret(32);
  const key = Buffer.from(RubikaCrypto.passphrase(auth), "utf8");
  const input: Record<string, unknown> = { phone_number: phone, send_type: "SMS" };
  if (passKey !== undefined && passKey !== "") input.pass_key = passKey;

  const response = await network.send(
    { method: "sendCode", tmp_session: true, input },
    { auth, key },
  );
  if (!response?.data_enc) throw new ProviderError("روبیکا پاسخ خالی داد؛ دوباره تلاش کنید.");

  let parsed: any;
  try {
    parsed = JSON.parse(RubikaCrypto.decrypt(response.data_enc, key));
  } catch {
    throw new ProviderError("پاسخ روبیکا قابل خواندن نبود؛ دوباره تلاش کنید.");
  }
  if (parsed.status !== "OK" || parsed.status_det !== "OK") {
    throw new ProviderError(rubikaStatusMessage(parsed.status, parsed.status_det));
  }
  return { ...(parsed.data ?? {}), auth, key, phone_number: phone };
}

function pendingState(tx: string): PendingAuth {
  const state = pendingAuth.get(tx);
  if (!state || Date.now() - state.createdAt > 10 * 60_000) {
    pendingAuth.delete(tx);
    throw new ProviderError("درخواست ورود روبیکا منقضی شده؛ دوباره شماره را وارد کنید.");
  }
  return state;
}

function storePending(phone: string, result: any): string {
  const now = Date.now();
  for (const [key, value] of pendingAuth) if (now - value.createdAt > 10 * 60_000) pendingAuth.delete(key);
  const tx = randomBytes(12).toString("hex");
  pendingAuth.set(tx, { phone, result, createdAt: now });
  return tx;
}

function authResult(result: any): AuthStep {
  if (result?.status === "SendPassKey") {
    return { step: "password", hint: result.hint_pass_key ? String(result.hint_pass_key) : "رمز دومرحله‌ای حساب را وارد کنید." };
  }
  if (result?.status === "OK" || result?.phone_code_hash) {
    return {
      step: "code",
      hint: result.code_digits_count ? `کد ${result.code_digits_count} رقمی روبیکا را وارد کنید.` : "کد ورود روبیکا را وارد کنید.",
    };
  }
  const status = String(result?.status ?? "پاسخ نامشخص");
  if (/InvalidPassKey|WRONG_PASSWORD|PASSWORD_INVALID/i.test(status)) throw new ProviderError("رمز دومرحله‌ای اشتباه است.");
  if (/PHONE_NUMBER_INVALID|INVALID_PHONE/i.test(status)) throw new ProviderError("شماره تلفن برای روبیکا معتبر نیست.");
  if (/PHONE_NUMBER_BANNED|BANNED/i.test(status)) throw new ProviderError("این شماره در روبیکا مسدود شده است.");
  if (/FLOOD|TOO_MANY|TRY_AGAIN/i.test(status)) throw new ProviderError("درخواست‌های ورود زیاد بوده؛ چند دقیقه بعد دوباره تلاش کنید.");
  throw new ProviderError(`روبیکا درخواست ورود را قبول نکرد: ${status}`);
}

async function finishSignIn(result: any, save: (values: Record<string, string>) => void): Promise<AuthStep> {
  if (!result?.isOk || !result.sessionData) {
    if (result?.status === "CodeIsInvalid") throw new ProviderError("کد ورود روبیکا اشتباه است.");
    throw new ProviderError(`ورود روبیکا انجام نشد: ${result?.status ?? "پاسخ نامشخص"}`);
  }
  const session = result.sessionData as RubikaSessionData;
  save({ session: JSON.stringify(session), phone: session.phone ? normalizeRubikaPhone(session.phone) : "" });
  await resetRubikaClient();
  return { step: "done", user: { id: 0, name: session.phone || "Rubika" } };
}

const rubikaClientAuth: ProviderAuthDef = {
  title: "ورود با حساب روبیکا",
  description:
    "شماره‌ی حساب روبیکا را وارد کنید؛ کد از روبیکا می‌آید. اگر حساب رمز دومرحله‌ای دارد، اول رمز را می‌پرسد. نشست روی همین سرور ذخیره می‌شود.",
  phoneField: "phone",
  sessionField: "session",
  async start(_ctx, rawPhone, save) {
    const phone = normalizeRubikaPhone(rawPhone);
    if (!/^\d{10,15}$/.test(phone)) throw new ProviderError("شماره روبیکا معتبر نیست. نمونه: ۰۹۱۲۱۲۳۴۵۶۷ یا +۹۸۹۱۲۱۲۳۴۵۶۷");
    try {
      const result = await withTimeout(rawSendCode(phone), 30_000);
      const step = authResult(result);
      const tx = storePending(phone, result);
      save({ phone });
      return { ...step, transactionHash: tx };
    } catch (err) {
      throw err instanceof ProviderError ? err : friendlyError(err, "ارسال کد ورود روبیکا");
    }
  },
  async verifyCode(_ctx, transactionHash, code, save) {
    const state = pendingState(transactionHash);
    if (!state.result) throw new ProviderError("درخواست کد دوباره اجرا شود.");
    try {
      const result = await withTimeout(Clients.LoginClient.signIn(String(code ?? "").trim(), state.result), 30_000);
      const step = await finishSignIn(result, save);
      pendingAuth.delete(transactionHash);
      return step;
    } catch (err) {
      throw err instanceof ProviderError ? err : friendlyError(err, "تأیید کد ورود روبیکا");
    }
  },
  async verifyPassword(_ctx, transactionHash, password, save) {
    const state = pendingState(transactionHash);
    try {
      const result = await withTimeout(rawSendCode(state.phone, String(password ?? "")), 30_000);
      if (result?.status === "SendPassKey") throw new ProviderError("رمز دومرحله‌ای اشتباه است.");
      const step = authResult(result);
      state.result = result;
      save({ phone: state.phone });
      return { ...step, transactionHash };
    } catch (err) {
      throw err instanceof ProviderError ? err : friendlyError(err, "تأیید رمز دومرحله‌ای روبیکا");
    }
  },
  async logout(_ctx, save) {
    pendingAuth.clear();
    save({ session: "" });
    await resetRubikaClient();
    return { step: "done", hint: "از حساب روبیکا خارج شدید." };
  },
};

// ---------------------------------------------------------------- provider

const chatId = z
  .string()
  .optional()
  .describe("Rubika object_guid (u0… user, g0… group, c0… channel). If omitted, the default chat from settings is used.");

function groupGuid(value: string): string {
  const id = String(value ?? "").trim();
  if (!/^g0/i.test(id)) throw new ProviderError("group_guid باید با g0 شروع شود.");
  return id;
}

function channelGuid(value: string): string {
  const id = String(value ?? "").trim();
  if (!/^c0/i.test(id)) throw new ProviderError("channel_guid باید با c0 شروع شود.");
  return id;
}

function memberGuids(values: string[]): string[] {
  const list = values.map((v) => String(v).trim()).filter(Boolean);
  if (!list.length) throw new ProviderError("حداقل یک member_guid لازم است.");
  return list;
}

function createdEntity(result: any, key: "group" | "channel"): any {
  return result?.[key] ?? result?.data?.[key] ?? result;
}

async function listByType(client: any, type: "group" | "channel", limit: number): Promise<any[]> {
  const data: any = await fetchChats(client);
  const chats = Array.isArray(data?.chats) ? data.chats : [];
  return chats
    .filter((c: any) => chatTypeOfGuid(String(c.object_guid ?? c.guid ?? "")) === type)
    .slice(0, limit)
    .map((c: any) => ({
      chat_id: String(c.object_guid ?? c.guid ?? ""),
      title: titleOfChat(c),
      type,
      member_count: c.member_count,
      last_message: c.last_message?.text,
      last_date: isoDate(c.last_message?.time ?? c.time),
    }));
}

export const rubikaClient: ProviderDef = {
  id: RUBIKA_CLIENT_ID,
  name: "Rubika Client",
  nameFa: "روبیکا (حساب کاربری)",
  category: "messenger",
  region: "iran",
  color: "#7c3aed",
  glyph: "ک",
  description: "اتصال به حساب شخصی روبیکا با شماره تلفن — ارسال و دریافت پیام مثل خود کاربر (API خصوصی)",
  docsUrl: "https://web.rubika.ir/",
  fields: [
    {
      key: "phone",
      label: "شماره تلفن",
      type: "text",
      placeholder: "۰۹۱۲۱۲۳۴۵۶۷",
      help: "برای ورود. بعد از ورود ذخیره می‌شود.",
    },
    {
      key: "session",
      label: "نشست حساب (خودکار)",
      type: "secret",
      required: true,
      help: "با دکمه‌ی «ورود با حساب روبیکا» خودکار پر می‌شود. برای انتقال دستی، JSON نشست را بچسبانید.",
    },
    {
      key: "defaultChatId",
      label: "چت پیش‌فرض",
      type: "text",
      placeholder: "اختیاری — مثلاً u0Q... یا g0Q...",
    },
  ],
  auth: rubikaClientAuth,
  test: async (ctx) => {
    const m = await getManaged(ctx);
    return m.client.getMe();
  },
  receive: {
    idleMs: 1_000,
    async poll(ctx, _cursor, longPollSec) {
      const m = await getManaged(ctx);
      await waitForMessage(m, longPollSec > 0 ? longPollSec * 1_000 : 1_200);
      const messages = m.queue.splice(0, m.queue.length);
      await resolveTitles(m, messages);
      return { messages, cursor: String(Date.now()) };
    },
  },
  tools: [
    defineTool({
      name: "rubika_client_get_me",
      title: "اطلاعات حساب روبیکا",
      description: "Get the profile of the Rubika user account this server is logged in as.",
      input: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (_a, ctx) => {
        const m = await getManaged(ctx);
        return m.client.getMe();
      },
    }),
    defineTool({
      name: "rubika_client_get_chat",
      title: "اطلاعات چت",
      description: "Get a Rubika user/group/channel by object_guid (u0…/g0…/c0…) or @username.",
      input: { chat_id: z.string().describe("Rubika object_guid or @username") },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const id = a.chat_id.trim();
        if (/^u0/i.test(id)) return m.client.getUserInfo(id);
        if (/^g0/i.test(id)) return m.client.getGroupInfo(id);
        if (/^c0/i.test(id)) return m.client.getChannelInfo(id);
        return m.client.getObjectInfoByUsername(id.replace(/^@/, ""));
      },
    }),
    defineTool({
      name: "rubika_client_send_message",
      title: "ارسال پیام با حساب روبیکا",
      description: "Send a text message from the logged-in Rubika account to a user, group or channel.",
      input: {
        chat_id: chatId,
        text: z.string().min(1).max(4096).describe("Message text"),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const target = await resolveTarget(m.client, chatIdOf(ctx, a.chat_id));
        const res: any = await m.client.sendMessage(target, a.text);
        const update = res?.message_update ?? res ?? {};
        const mid = update.message_id === undefined ? undefined : String(update.message_id);
        if (!mid) throw new ProviderError("روبیکا ارسال پیام را تأیید نکرد.");
        m.outgoing.add(mid);
        if (m.outgoing.size > 200) {
          const first = m.outgoing.values().next().value;
          if (first) m.outgoing.delete(first);
        }
        m.queue = m.queue.filter((x) => x.messageId !== mid);
        return { ok: true, chat_id: target, message_id: mid, date: isoDate(update.time ?? Date.now()) };
      },
    }),
    defineTool({
      name: "rubika_client_send_photo",
      title: "ارسال عکس با حساب روبیکا",
      description: "Send a photo from a public URL or an uploaded file via the logged-in Rubika account.",
      input: {
        chat_id: chatId,
        photo: mediaField("image", "The image"),
        caption: z.string().max(1024).optional().describe("Optional caption"),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const target = await resolveTarget(m.client, chatIdOf(ctx, a.chat_id));
        return sendWithMedia(m.client, target, a.photo, "Image", a.caption, { expect: "image" });
      },
    }),
    defineTool({
      name: "rubika_client_send_file",
      title: "ارسال فایل با حساب روبیکا",
      description: "Send a file from a public URL or an uploaded file via the logged-in Rubika account.",
      input: {
        chat_id: chatId,
        file: mediaField("file", "The file"),
        caption: z.string().max(1024).optional().describe("Optional caption"),
        filename: z.string().optional().describe("Override the file name"),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const target = await resolveTarget(m.client, chatIdOf(ctx, a.chat_id));
        return sendWithMedia(m.client, target, a.file, "File", a.caption, { filename: a.filename });
      },
    }),
    defineTool({
      name: "rubika_client_list_groups",
      title: "فهرست گروه‌ها",
      description: "List Rubika groups of the logged-in account.",
      input: { limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        return { groups: await listByType(m.client, "group", a.limit ?? 50) };
      },
    }),
    defineTool({
      name: "rubika_client_create_group",
      title: "ساخت گروه",
      description: "Create a Rubika group, optionally with initial members.",
      input: {
        title: z.string().min(1).max(128),
        member_guids: z.array(z.string()).optional(),
        description: z.string().max(1024).optional(),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const members = a.member_guids?.length ? memberGuids(a.member_guids) : [];
        const result: any = await m.client.addGroup(a.title, members, a.description);
        const group = createdEntity(result, "group");
        return { ok: true, group_guid: group?.group_guid ?? group?.object_guid, group };
      },
    }),
    defineTool({
      name: "rubika_client_group_members",
      title: "اعضای گروه",
      description: "List members of a Rubika group (group_guid starts with g0).",
      input: { group_guid: z.string(), search_text: z.string().optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        return await m.client.getGroupAllMembers(groupGuid(a.group_guid), a.search_text);
      },
    }),
    defineTool({
      name: "rubika_client_add_group_members",
      title: "افزودن عضو به گروه",
      description: "Add one or more members to a Rubika group.",
      input: { group_guid: z.string(), member_guids: z.array(z.string()).min(1) },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const result: any = await m.client.addGroupMembers(groupGuid(a.group_guid), memberGuids(a.member_guids));
        return { ok: true, result };
      },
    }),
    defineTool({
      name: "rubika_client_remove_group_member",
      title: "حذف عضو از گروه",
      description: "Remove/ban a member from a Rubika group.",
      input: { group_guid: z.string(), member_guid: z.string() },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const result: any = await m.client.banGroupMember(groupGuid(a.group_guid), String(a.member_guid).trim(), "Set");
        return { ok: true, result };
      },
    }),
    defineTool({
      name: "rubika_client_edit_group",
      title: "ویرایش گروه",
      description: "Edit a Rubika group title/description.",
      input: { group_guid: z.string(), title: z.string().max(128).optional(), description: z.string().max(1024).optional() },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        if (!a.title && a.description === undefined) throw new ProviderError("title یا description لازم است.");
        const result: any = await m.client.editGroupInfo(groupGuid(a.group_guid), a.title, a.description);
        return { ok: true, result };
      },
    }),
    defineTool({
      name: "rubika_client_leave_group",
      title: "خروج از گروه",
      description: "Leave a Rubika group.",
      input: { group_guid: z.string() },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const result: any = await m.client.leaveGroup(groupGuid(a.group_guid));
        return { ok: true, result };
      },
    }),
    defineTool({
      name: "rubika_client_delete_group",
      title: "حذف گروه",
      description: "Delete a Rubika group (owner only).",
      input: { group_guid: z.string() },
      annotations: { openWorldHint: true, destructiveHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const result: any = await m.client.removeGroup(groupGuid(a.group_guid));
        return { ok: true, result };
      },
    }),
    defineTool({
      name: "rubika_client_list_channels",
      title: "فهرست کانال‌ها",
      description: "List Rubika channels of the logged-in account.",
      input: { limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        return { channels: await listByType(m.client, "channel", a.limit ?? 50) };
      },
    }),
    defineTool({
      name: "rubika_client_create_channel",
      title: "ساخت کانال",
      description: "Create a Rubika channel, optionally with initial members.",
      input: {
        title: z.string().min(1).max(128),
        description: z.string().max(1024).optional(),
        member_guids: z.array(z.string()).optional(),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const members = a.member_guids?.length ? memberGuids(a.member_guids) : [];
        const result: any = await m.client.addChannel(a.title, a.description, members);
        const channel = createdEntity(result, "channel");
        return { ok: true, channel_guid: channel?.channel_guid ?? channel?.object_guid, channel };
      },
    }),
    defineTool({
      name: "rubika_client_channel_members",
      title: "اعضای کانال",
      description: "List members of a Rubika channel (channel_guid starts with c0).",
      input: { channel_guid: z.string(), search_text: z.string().optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        return await m.client.getChannelAllMembers(channelGuid(a.channel_guid), a.search_text);
      },
    }),
    defineTool({
      name: "rubika_client_add_channel_members",
      title: "افزودن عضو به کانال",
      description: "Add one or more members to a Rubika channel.",
      input: { channel_guid: z.string(), member_guids: z.array(z.string()).min(1) },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const result: any = await m.client.addChannelMembers(channelGuid(a.channel_guid), memberGuids(a.member_guids));
        return { ok: true, result };
      },
    }),
    defineTool({
      name: "rubika_client_remove_channel_member",
      title: "حذف عضو از کانال",
      description: "Remove/ban a member from a Rubika channel.",
      input: { channel_guid: z.string(), member_guid: z.string() },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const result: any = await m.client.banChannelMember(channelGuid(a.channel_guid), String(a.member_guid).trim(), "Set");
        return { ok: true, result };
      },
    }),
    defineTool({
      name: "rubika_client_edit_channel",
      title: "ویرایش کانال",
      description: "Edit a Rubika channel title/description.",
      input: { channel_guid: z.string(), title: z.string().max(128).optional(), description: z.string().max(1024).optional() },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        if (!a.title && a.description === undefined) throw new ProviderError("title یا description لازم است.");
        const result: any = await m.client.editChannelInfo(channelGuid(a.channel_guid), a.title, a.description);
        return { ok: true, result };
      },
    }),
    defineTool({
      name: "rubika_client_delete_channel",
      title: "حذف کانال",
      description: "Delete a Rubika channel (owner only).",
      input: { channel_guid: z.string() },
      annotations: { openWorldHint: true, destructiveHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const result: any = await m.client.removeChannel(channelGuid(a.channel_guid));
        return { ok: true, result };
      },
    }),
    defineTool({
      name: "rubika_client_get_chats",
      title: "فهرست گفتگوها",
      description: "List recent Rubika chats (private chats, groups, channels) with object_guid and last message.",
      input: {
        limit: z.number().int().min(1).max(100).optional().describe("Max chats (1-100), default 30"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const data: any = await fetchChats(m.client);
        const chats = (Array.isArray(data?.chats) ? data.chats : []).slice(0, a.limit ?? 30);
        const dialogs = chats.map((c: any) => {
          const guid = String(c.object_guid ?? c.guid ?? "");
          if (guid && titleOfChat(c)) m.titles.set(guid, { title: titleOfChat(c), type: chatTypeOfGuid(guid) });
          const last = c.last_message ?? {};
          return {
            chat_id: guid,
            title: titleOfChat(c),
            type: chatTypeOfGuid(guid),
            last_message: last.text,
            last_kind: kindOfMessage(last),
            last_direction: last.is_mine ? "out" : "in",
            last_date: isoDate(last.time ?? c.time),
          };
        });
        return { dialogs };
      },
    }),
    defineTool({
      name: "rubika_client_get_history",
      title: "تاریخچه‌ی گفتگو",
      description: "Read recent messages of a Rubika chat (newest first).",
      input: {
        chat_id: z.string().describe("Rubika object_guid"),
        limit: z.number().int().min(1).max(100).optional().describe("Max messages (1-100), default 20"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const target = await resolveTarget(m.client, a.chat_id.trim());
        const data: any = await m.client.getMessages(target, "0", String(a.limit ?? 20), "FromMax");
        const messages = (Array.isArray(data?.messages) ? data.messages : [])
          .map((msg: any) => messageFromHistory(m, target, msg))
          .filter((x: IncomingMessage) => Boolean(x.messageId));
        await resolveTitles(m, messages);
        return { source: "history", chat_id: target, messages };
      },
    }),
    defineTool({
      name: "rubika_client_get_updates",
      title: "دریافت پیام‌های جدید",
      description:
        "Read recent messages of the logged-in Rubika account. With chat_id: history of that chat. " +
        "Without chat_id: last message of recent chats. When receive is on, reads the shared inbox instead.",
      input: {
        chat_id: z.string().optional().describe("Only messages from this chat (object_guid)"),
        limit: z.number().int().min(1).max(100).optional().describe("Max messages (1-100), default 20"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        if (ctx.inbox) return { source: "inbox", messages: ctx.inbox.list({ chatId: a.chat_id, limit: a.limit ?? 20 }) };
        const m = await getManaged(ctx);
        const limit = a.limit ?? 20;
        if (a.chat_id) {
          const target = await resolveTarget(m.client, a.chat_id.trim());
          const data: any = await m.client.getMessages(target, "0", String(limit), "FromMax");
          const messages = (Array.isArray(data?.messages) ? data.messages : []).map((msg: any) => messageFromHistory(m, target, msg));
          await resolveTitles(m, messages);
          return { source: "history", chat_id: target, messages };
        }
        const data: any = await fetchChats(m.client);
        const chats = (Array.isArray(data?.chats) ? data.chats : []).slice(0, limit);
        return {
          source: "chats",
          chats: chats.map((c: any) => ({
            chat_id: String(c.object_guid ?? c.guid ?? ""),
            title: titleOfChat(c),
            last_message: c.last_message?.text,
            last_date: isoDate(c.last_message?.time ?? c.time),
          })),
        };
      },
    }),
  ],
};
