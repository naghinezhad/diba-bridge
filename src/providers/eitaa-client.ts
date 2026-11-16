/**
 * ایتا با حساب کاربری از طریق «پل» EitaaBun.
 *
 * EitaaBun یک سرویس محلی است که پروتکل MTProto ایتا را روی HTTP باز می‌کند
 * (پورت پیش‌فرض ۱۲۳۴). این فایل فقط با آن پل حرف می‌زند و خودش MTProto
 * پیاده‌سازی نمی‌کند؛ چون لایه‌ی ایتا با سروش/تلگرام فرق دارد.
 *
 * راه‌اندازی پل: docs/EITAA_CLIENT_BRIDGE.md
 */
import { z } from "zod";
import { netFetch } from "../core/net.js";
import {
  defineTool,
  ProviderError,
  type AuthStep,
  type IncomingMessage,
  type ProviderAuthDef,
  type ProviderContext,
  type ProviderDef,
} from "../core/types.js";

export const EITAA_CLIENT_ID = "eitaa_client";
const MAX_QUEUE = 300;

// ---------------------------------------------------------------- helpers

export function normalizeEitaaPhone(raw: string): string {
  const latin = String(raw ?? "")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  let s = latin.replace(/[^\d+]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  else if (s.startsWith("0")) s = `+98${s.slice(1)}`;
  else if (s.startsWith("98") && s.length === 12) s = `+${s}`;
  else if (s.startsWith("9") && s.length === 10) s = `+98${s}`;
  else if (!s.startsWith("+")) s = `+${s}`;
  return s;
}

interface BridgeSession {
  phone: string;
  imei?: string;
  token?: string;
  user_id?: string;
  username?: string;
  access_hash?: string;
}

interface BridgeEntity {
  id: string;
  accessHash: string;
  type: "user" | "chat" | "channel";
  title?: string;
}

function parseSession(ctx: ProviderContext): BridgeSession | undefined {
  const raw = ctx.config.session?.trim();
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.phone) return undefined;
    return parsed as BridgeSession;
  } catch {
    return undefined;
  }
}

function bridgeBase(ctx: ProviderContext): string {
  const base = (ctx.config.bridgeUrl ?? "http://127.0.0.1:1234").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) throw new ProviderError("آدرس پل ایتا باید با http:// یا https:// شروع شود");
  return base;
}

async function bridgeCall(
  ctx: ProviderContext,
  path: string,
  body: Record<string, unknown>,
  timeoutMs = 45_000,
): Promise<any> {
  const url = `${bridgeBase(ctx)}/eitaa/${path.replace(/^\/+/, "")}`;
  let res: Awaited<ReturnType<typeof netFetch>>;
  try {
    res = await netFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: any) {
    throw new ProviderError(
      `پل ایتا در دسترس نیست (${bridgeBase(ctx)}). اول EitaaBun را اجرا کنید. ${err?.code ? `[${err.code}]` : ""}`,
      err,
    );
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = String(data?.msg ?? data?.error ?? data?.message ?? `HTTP ${res.status}`);
    if (/PasswordRequired/i.test(message)) throw new ProviderError("این حساب ایتا رمز دومرحله‌ای دارد.", message);
    if (/PasswordInvalid/i.test(message)) throw new ProviderError("رمز دومرحله‌ای ایتا اشتباه است.", message);
    if (/Session does not exist|You are not logged in/i.test(message))
      throw new ProviderError("نشست ایتا در پل پیدا نشد؛ دوباره وارد شوید.", message);
    throw new ProviderError(`خطای پل ایتا: ${message}`, message);
  }
  return data;
}

function peerId(peer: any): string | undefined {
  if (peer === undefined || peer === null) return undefined;
  if (typeof peer === "number" || typeof peer === "string") return String(peer);
  if (typeof peer === "object") {
    if (peer.user_id !== undefined) return String(peer.user_id);
    if (peer.chat_id !== undefined) return String(peer.chat_id);
    if (peer.channel_id !== undefined) return String(peer.channel_id);
    if (peer.id !== undefined) return String(peer.id);
  }
  return undefined;
}

function peerType(peer: any, fallback: "user" | "chat" | "channel" = "channel"): "user" | "chat" | "channel" {
  const kind = String(peer?._ ?? "");
  if (kind === "peerUser" || kind === "user") return "user";
  if (kind === "peerChat" || kind === "chat") return "chat";
  if (kind === "peerChannel" || kind === "channel") return "channel";
  return fallback;
}

function isoDate(value: unknown): string {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return new Date(n < 1e11 ? n * 1000 : n).toISOString();
  return new Date().toISOString();
}

function kindOfMedia(media: any): IncomingMessage["kind"] {
  const kind = String(media?._ ?? "");
  if (kind.includes("Photo")) return "photo";
  if (kind.includes("Video")) return "video";
  if (kind.includes("Voice") || kind.includes("Audio")) return "voice";
  if (kind.includes("Document")) return "file";
  if (kind.includes("Geo") || kind.includes("Location")) return "location";
  return media ? "other" : "text";
}

function errorOfBridge(err: any): ProviderError {
  if (err instanceof ProviderError) return err;
  return new ProviderError(String(err?.message ?? err), err);
}

// ---------------------------------------------------------------- auth

interface PendingAuth {
  phone: string;
  imei?: string;
  phoneHash?: string;
  code?: string;
  createdAt: number;
}

const pendingAuth = new Map<string, PendingAuth>();

function storePending(state: Omit<PendingAuth, "createdAt">): string {
  const tx = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  pendingAuth.set(tx, { ...state, createdAt: Date.now() });
  for (const [key, value] of pendingAuth) {
    if (Date.now() - value.createdAt > 10 * 60_000) pendingAuth.delete(key);
  }
  return tx;
}

function saveSession(save: (values: Record<string, string>) => void, session: BridgeSession) {
  save({ phone: session.phone, session: JSON.stringify(session) });
}

const eitaaClientAuth: ProviderAuthDef = {
  title: "ورود با حساب ایتا (از طریق پل EitaaBun)",
  description:
    "شماره‌ی حساب ایتا را وارد کنید. کد از اپ ایتا یا پیامک می‌آید. اگر رمز دومرحله‌ای دارید، رمز را هم می‌پرسد. پل EitaaBun باید روی همین سرور یا یک سرور در دسترس اجرا شده باشد.",
  phoneField: "phone",
  sessionField: "session",
  async start(ctx, rawPhone, save) {
    const phone = normalizeEitaaPhone(rawPhone);
    if (!/^\+\d{10,15}$/.test(phone))
      throw new ProviderError("شماره ایتا معتبر نیست. نمونه: +989121234567 یا ۰۹۱۲۱۲۳۴۵۶۷");
    const data = await bridgeCall(ctx, "auth/sendCode", { phone }, 45_000);
    if (!data?.phone_hash) throw new ProviderError("پل ایتا کد را قبول نکرد؛ پاسخ ناقص بود.");
    save({ phone });
    const tx = storePending({ phone, imei: data.imei, phoneHash: data.phone_hash });
    return {
      step: "code",
      transactionHash: tx,
      hint: /Call/i.test(String(data.next)) ? "کد از طریق تماس صوتی ارسال می‌شود." : "کد ورود ارسال شد.",
    };
  },
  async verifyCode(ctx, transactionHash, code, save) {
    const state = pendingAuth.get(transactionHash);
    if (!state) throw new ProviderError("درخواست ورود ایتا منقضی شده؛ دوباره شماره را وارد کنید.");
    const value = String(code ?? "").trim();
    try {
      const data = await bridgeCall(ctx, "auth/login", { phone: state.phone, code: value }, 45_000);
      if (!data?.token) throw new ProviderError("ورود ایتا کامل نشد؛ پل توکن نداد.");
      pendingAuth.delete(transactionHash);
      saveSession(save, {
        phone: state.phone,
        imei: data.imei ?? state.imei,
        token: data.token,
        user_id: data.user_id === undefined ? undefined : String(data.user_id),
        username: data.username,
        access_hash: data.access_hash === undefined ? undefined : String(data.access_hash),
      });
      return { step: "done", user: { id: Number(data.user_id ?? 0), name: data.username || state.phone } };
    } catch (err) {
      const message = String((err as any)?.message ?? err);
      if (/رمز دومرحله‌ای|PasswordRequired/i.test(message)) {
        pendingAuth.set(transactionHash, { ...state, code: value });
        return { step: "password", transactionHash, hint: "این حساب رمز دومرحله‌ای دارد." };
      }
      throw errorOfBridge(err);
    }
  },
  async verifyPassword(ctx, transactionHash, password, save) {
    const state = pendingAuth.get(transactionHash);
    if (!state) throw new ProviderError("درخواست ورود ایتا منقضی شده؛ دوباره شماره را وارد کنید.");
    if (!state.code) throw new ProviderError("کد ورود ایتا گم شده؛ دوباره شماره را وارد کنید.");
    try {
      const data = await bridgeCall(
        ctx,
        "auth/loginByPass",
        { phone: state.phone, code: state.code, password: String(password ?? "") },
        45_000,
      );
      if (!data?.token) throw new ProviderError("ورود ایتا با رمز کامل نشد.");
      pendingAuth.delete(transactionHash);
      saveSession(save, {
        phone: state.phone,
        imei: data.imei ?? state.imei,
        token: data.token,
        user_id: data.user_id === undefined ? undefined : String(data.user_id),
        username: data.username,
        access_hash: data.access_hash === undefined ? undefined : String(data.access_hash),
      });
      return { step: "done", user: { id: Number(data.user_id ?? 0), name: data.username || state.phone } };
    } catch (err) {
      throw errorOfBridge(err);
    }
  },
  async logout(ctx, save) {
    const session = parseSession(ctx);
    if (session?.phone) {
      await bridgeCall(ctx, "auth/logout", { phone: session.phone }, 20_000).catch(() => {});
    }
    await resetEitaaBridge();
    save({ session: "" });
    return { step: "done", hint: "از حساب ایتا خارج شدید." };
  },
};

// ---------------------------------------------------------------- manager

interface Waiter {
  wake: () => void;
  fail: (err: Error) => void;
}

interface BridgeState {
  session: BridgeSession;
  queue: IncomingMessage[];
  waiters: Set<Waiter>;
  entities: Map<string, BridgeEntity>;
  webhookSecret: string;
  updatesStarted: boolean;
  closed: boolean;
}

let active: BridgeState | undefined;

function wakeAll(state: BridgeState, err?: Error) {
  for (const waiter of [...state.waiters]) {
    if (err) waiter.fail(err);
    else waiter.wake();
  }
}

export async function resetEitaaBridge(): Promise<void> {
  const state = active;
  active = undefined;
  if (!state) return;
  state.closed = true;
  wakeAll(state, new ProviderError("اتصال ایتا قطع شد"));
}

function entityKey(type: string, id: string): string {
  return `${type}:${id}`;
}

function cacheEntity(state: BridgeState, entity: BridgeEntity) {
  state.entities.set(entityKey(entity.type, entity.id), entity);
  state.entities.set(entity.id, entity);
}

function entityFor(state: BridgeState, chatId: string): BridgeEntity | undefined {
  return state.entities.get(chatId);
}

function pushMessage(state: BridgeState, message: IncomingMessage) {
  state.queue.push(message);
  if (state.queue.length > MAX_QUEUE) state.queue.splice(0, state.queue.length - MAX_QUEUE);
  const first = state.waiters.values().next().value as Waiter | undefined;
  first?.wake();
}

async function waitForMessage(state: BridgeState, timeoutMs: number): Promise<void> {
  if (state.queue.length) return;
  if (state.closed) throw new ProviderError("اتصال ایتا قطع شده است.");
  await new Promise<void>((resolve, reject) => {
    let timer: NodeJS.Timeout;
    const waiter: Waiter = {
      wake: () => {
        clearTimeout(timer);
        state.waiters.delete(waiter);
        resolve();
      },
      fail: (err) => {
        clearTimeout(timer);
        state.waiters.delete(waiter);
        reject(err);
      },
    };
    state.waiters.add(waiter);
    timer = setTimeout(() => waiter.wake(), Math.max(200, timeoutMs));
  });
}

async function startUpdates(ctx: ProviderContext, state: BridgeState): Promise<void> {
  if (state.updatesStarted) return;
  const webhookBase = (ctx.config.webhookUrl ?? "http://127.0.0.1:3790/api/eitaa-bridge/webhook").trim();
  const token = ctx.config.webhookSecret?.trim() || "diba-eitaa";
  const webhook = `${webhookBase}${webhookBase.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
  try {
    await bridgeCall(ctx, "profile/startUpdates", { phone: state.session.phone, webhook }, 15_000);
    state.updatesStarted = true;
    state.webhookSecret = token;
  } catch {
    // دریافت webhook اختیاری است؛ ابزارهای دیگر کار می‌کنند
  }
}

async function getState(ctx: ProviderContext): Promise<BridgeState> {
  const session = parseSession(ctx);
  if (!session?.phone) throw new ProviderError("اول با حساب ایتا وارد شوید (دکمه‌ی ورود با حساب ایتا).");
  if (active && active.session.phone === session.phone && !active.closed) {
    if (!active.updatesStarted) await startUpdates(ctx, active);
    return active;
  }
  await resetEitaaBridge();
  const state: BridgeState = {
    session,
    queue: [],
    waiters: new Set(),
    entities: new Map(),
    webhookSecret: ctx.config.webhookSecret?.trim() || "diba-eitaa",
    updatesStarted: false,
    closed: false,
  };
  // اگر پل تازه اجرا شده، نشست ذخیره‌شده‌اش را از فایل بارگذاری کن
  try {
    await bridgeCall(ctx, "auth/loadSession", { phone: session.phone }, 10_000);
  } catch {
    // ممکن است نشست از قبل در حافظه‌ی پل باشد
  }
  try {
    await bridgeCall(ctx, "messages/dialogs", { phone: session.phone, date: 0 }, 45_000);
  } catch (err) {
    throw errorOfBridge(err);
  }
  active = state;
  await startUpdates(ctx, state);
  return state;
}

async function loadDialogs(ctx: ProviderContext, state: BridgeState, limit = 50): Promise<any[]> {
  const data = await bridgeCall(ctx, "messages/dialogs", { phone: state.session.phone, date: 0 }, 45_000);
  const dialogs: any[] = Array.isArray(data?.dialogs) ? data.dialogs : [];
  const messages: any[] = Array.isArray(data?.messages) ? data.messages : [];
  const chats: any[] = Array.isArray(data?.chats) ? data.chats : [];
  const users: any[] = Array.isArray(data?.users) ? data.users : [];

  const messageById = new Map<string, any>();
  for (const message of messages) if (message?.id !== undefined) messageById.set(String(message.id), message);

  const entities = new Map<string, any>();
  for (const chat of chats) {
    const id = peerId(chat);
    if (id) entities.set(id, chat);
  }
  for (const user of users) {
    const id = peerId(user);
    if (id) entities.set(`user:${id}`, user);
  }

  const result: any[] = [];
  for (const dialog of dialogs) {
    const peer = dialog?.peer;
    const id = peerId(peer);
    if (!id) continue;
    const type = peerType(peer);
    const raw = entities.get(type === "user" ? `user:${id}` : id) ?? entities.get(id);
    const name = [raw?.first_name, raw?.last_name].filter(Boolean).join(" ");
    const title = raw?.title || name || (raw?.username ? `@${raw.username}` : undefined);
    const entity: BridgeEntity = {
      id,
      accessHash: String(raw?.access_hash ?? "0"),
      type,
      title: title || undefined,
    };
    cacheEntity(state, entity);
    const last = messageById.get(String(dialog?.top_message));
    result.push({
      chat_id: id,
      access_hash: entity.accessHash,
      type,
      title: entity.title,
      unread_count: dialog?.unread_count ?? 0,
      last_message: last?.message,
      last_date: isoDate(last?.date),
      last_direction: peerId(last?.from) === state.session.user_id ? "out" : "in",
    });
    if (result.length >= limit) break;
  }
  return result;
}

async function resolveEntity(ctx: ProviderContext, state: BridgeState, chatId: string): Promise<BridgeEntity> {
  const cached = entityFor(state, chatId);
  if (cached) return cached;
  await loadDialogs(ctx, state, 100);
  const loaded = entityFor(state, chatId);
  if (loaded) return loaded;
  throw new ProviderError(`چتی با شناسه‌ی «${chatId}» در ایتا پیدا نشد. اول get_chats را صدا بزنید.`);
}

function mapHistoryMessage(state: BridgeState, entity: BridgeEntity, message: any): IncomingMessage {
  const id = String(message?.id ?? "");
  const fromId = peerId(message?.from);
  return {
    key: `${EITAA_CLIENT_ID}:${entity.id}:${id}`,
    provider: EITAA_CLIENT_ID,
    chatId: entity.id,
    chatTitle: entity.title,
    chatType: entity.type === "user" ? "private" : entity.type === "chat" ? "group" : "channel",
    messageId: id,
    from: fromId ? { id: fromId } : undefined,
    text: message?.text,
    kind: kindOfMedia(message?.media),
    date: isoDate(message?.date),
    direction: fromId && fromId === state.session.user_id ? "out" : "in",
    source: fromId && fromId === state.session.user_id ? "account" : undefined,
  };
}

/** EitaaBun updates → inbox */
export function handleEitaaBridgeWebhook(payload: any, token: string | undefined): boolean {
  const state = active;
  if (!state || state.closed) return false;
  if (state.webhookSecret && token !== state.webhookSecret) return false;
  if (payload?.phone && normalizeEitaaPhone(String(payload.phone)) !== normalizeEitaaPhone(state.session.phone)) return false;
  const updates = Array.isArray(payload?.updates) ? payload.updates : [];
  for (const update of updates) {
    const type = String(update?.type ?? "");
    if (type !== "MSG_USER" && type !== "MSG_GROUP") continue;
    // در MSG_USERِ خروجی، Update فقط from_id (خودمان) را می‌دهد و peer نیست؛
    // برای جلوگیری از نسبت‌دادن پیام به چت اشتباه، خروجی‌های تک‌به‌تک را رد می‌کنیم.
    if (type === "MSG_USER" && update.fromMe) continue;
    const isGroup = type === "MSG_GROUP";
    const chatId = String(isGroup ? update.group_id : update.from);
    if (!chatId || chatId === "undefined") continue;
    const fromId = peerId(update.from_id ?? update.from);
    const messageId = String(update.id ?? `${update.date ?? Date.now()}-${Math.abs(String(update.message ?? "").length)}-${fromId ?? "x"}`);
    const entity = entityFor(state, chatId);
    pushMessage(state, {
      key: `${EITAA_CLIENT_ID}:${chatId}:${messageId}`,
      provider: EITAA_CLIENT_ID,
      chatId,
      chatTitle: entity?.title,
      chatType: isGroup ? "group" : "private",
      messageId,
      from: fromId ? { id: fromId } : undefined,
      text: update.message,
      kind: kindOfMedia(update.media),
      date: isoDate(update.date),
      direction: update.fromMe ? "out" : "in",
      source: update.fromMe ? "account" : undefined,
    });
  }
  return true;
}

// ---------------------------------------------------------------- tools

const chatIdSchema = z
  .string()
  .optional()
  .describe("Eitaa chat id (numeric). If omitted, the default chat from settings is used.");

function targetId(ctx: ProviderContext, value?: string): string {
  const id = value?.trim() || ctx.config.defaultChatId?.trim();
  if (!id) throw new ProviderError("chat_id داده نشده و «چت پیش‌فرض» هم خالی است.");
  return id;
}

export const eitaaClient: ProviderDef = {
  id: EITAA_CLIENT_ID,
  name: "Eitaa Client",
  nameFa: "ایتا (حساب کاربری)",
  category: "messenger",
  region: "iran",
  color: "#f59e0b",
  glyph: "ا",
  description:
    "اتصال به حساب شخصی ایتا از طریق پل محلی EitaaBun — ارسال/دریافت پیام مثل خود کاربر. پل باید جدا اجرا شود.",
  docsUrl: "https://web.eitaa.com/",
  fields: [
    { key: "bridgeUrl", label: "آدرس پل EitaaBun", type: "text", default: "http://127.0.0.1:1234", required: true, help: "پورت EitaaBun ۱۲۳۴ است؛ آدرس داشبورد (۳۷۹۰) را اینجا نگذارید." },
    { key: "phone", label: "شماره تلفن", type: "text", placeholder: "۰۹۱۲۱۲۳۴۵۶۷" },
    {
      key: "session",
      label: "نشست ایتا (خودکار)",
      type: "secret",
      required: true,
      help: "با دکمه‌ی «ورود با حساب ایتا» خودکار پر می‌شود (JSON شامل phone/token/imei).",
    },
    {
      key: "webhookUrl",
      label: "آدرس وب‌هوک دریافت",
      type: "text",
      default: "http://127.0.0.1:3790/api/eitaa-bridge/webhook",
      help: "EitaaBun پیام‌های جدید را به این آدرس می‌فرستد.",
    },
    {
      key: "webhookSecret",
      label: "توکن وب‌هوک",
      type: "text",
      default: "diba-eitaa",
      help: "یک عبارت دلخواه؛ در URL وب‌هوک قرار می‌گیرد.",
    },
    { key: "defaultChatId", label: "چت پیش‌فرض", type: "text", placeholder: "اختیاری — مثلاً 123456789" },
  ],
  auth: eitaaClientAuth,
  test: async (ctx) => {
    const state = await getState(ctx);
    const dialogs = await loadDialogs(ctx, state, 1);
    return { user_id: state.session.user_id, username: state.session.username, phone: state.session.phone, dialogs: dialogs.length };
  },
  receive: {
    idleMs: 1_000,
    async poll(ctx, _cursor, longPollSec) {
      const state = await getState(ctx);
      await waitForMessage(state, longPollSec > 0 ? longPollSec * 1_000 : 1_200);
      return { messages: state.queue.splice(0, state.queue.length), cursor: String(Date.now()) };
    },
  },
  tools: [
    defineTool({
      name: "eitaa_client_get_me",
      title: "اطلاعات حساب ایتا",
      description: "Get the Eitaa account stored in the bridge session.",
      input: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (_a, ctx) => {
        const state = await getState(ctx);
        return {
          id: state.session.user_id,
          username: state.session.username,
          phone: state.session.phone,
          access_hash: state.session.access_hash,
        };
      },
    }),
    defineTool({
      name: "eitaa_client_get_chats",
      title: "فهرست گفتگوهای ایتا",
      description: "List recent Eitaa dialogs with chat id, access hash, type and last message.",
      input: { limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const state = await getState(ctx);
        return { dialogs: await loadDialogs(ctx, state, a.limit ?? 30) };
      },
    }),
    defineTool({
      name: "eitaa_client_get_chat",
      title: "اطلاعات چت ایتا",
      description: "Get an Eitaa chat by numeric id. Use get_chats first to fill the cache.",
      input: { chat_id: z.string(), type: z.enum(["user", "chat", "channel"]).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const state = await getState(ctx);
        const entity = await resolveEntity(ctx, state, a.chat_id.trim());
        return {
          id: entity.id,
          title: entity.title,
          type: entity.type,
          access_hash: entity.accessHash,
        };
      },
    }),
    defineTool({
      name: "eitaa_client_get_history",
      title: "تاریخچه‌ی گفتگوی ایتا",
      description: "Read recent messages of an Eitaa chat (newest first).",
      input: {
        chat_id: z.string(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const state = await getState(ctx);
        const entity = await resolveEntity(ctx, state, a.chat_id.trim());
        const limit = a.limit ?? 20;
        const data = await bridgeCall(
          ctx,
          "messages/read",
          {
            phone: state.session.phone,
            id: entity.id,
            access_hash: entity.accessHash,
            type: entity.type,
            offset: 0,
            size: limit,
          },
          45_000,
        );
        const messages: any[] = Array.isArray(data?.messages) ? data.messages : [];
        return {
          source: "history",
          chat_id: entity.id,
          messages: messages.map((message) => mapHistoryMessage(state, entity, message)),
        };
      },
    }),
    defineTool({
      name: "eitaa_client_send_message",
      title: "ارسال پیام با حساب ایتا",
      description: "Send a text message from the logged-in Eitaa account via the bridge.",
      input: {
        chat_id: chatIdSchema,
        text: z.string().min(1).max(4096),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const state = await getState(ctx);
        const entity = await resolveEntity(ctx, state, targetId(ctx, a.chat_id));
        const data = await bridgeCall(
          ctx,
          "messages/send",
          {
            phone: state.session.phone,
            message: a.text,
            id: entity.id,
            access_hash: entity.accessHash,
            type: entity.type,
          },
          45_000,
        );
        return { ok: true, result: data?.result ?? "ok", chat_id: entity.id, type: entity.type };
      },
    }),
    defineTool({
      name: "eitaa_client_get_updates",
      title: "دریافت پیام‌های جدید ایتا",
      description:
        "Read recent messages of the Eitaa account. With chat_id: history; without chat_id: recent chats.",
      input: {
        chat_id: z.string().optional().describe("Only messages from this chat"),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        if (ctx.inbox) return { source: "inbox", messages: ctx.inbox.list({ chatId: a.chat_id, limit: a.limit ?? 20 }) };
        const state = await getState(ctx);
        if (a.chat_id) {
          const entity = await resolveEntity(ctx, state, a.chat_id.trim());
          const data = await bridgeCall(
            ctx,
            "messages/read",
            {
              phone: state.session.phone,
              id: entity.id,
              access_hash: entity.accessHash,
              type: entity.type,
              offset: 0,
              size: a.limit ?? 20,
            },
            45_000,
          );
          const messages: any[] = Array.isArray(data?.messages) ? data.messages : [];
          return { source: "history", chat_id: entity.id, messages: messages.map((m) => mapHistoryMessage(state, entity, m)) };
        }
        return { source: "chats", dialogs: await loadDialogs(ctx, state, a.limit ?? 20) };
      },
    }),
    defineTool({
      name: "eitaa_client_list_groups",
      title: "فهرست گروه‌های ایتا",
      description: "List Eitaa groups from recent dialogs.",
      input: { limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const state = await getState(ctx);
        const dialogs = (await loadDialogs(ctx, state, a.limit ?? 50)).filter((d) => d.type === "chat");
        return { groups: dialogs };
      },
    }),
    defineTool({
      name: "eitaa_client_list_channels",
      title: "فهرست کانال‌های ایتا",
      description: "List Eitaa channels from recent dialogs.",
      input: { limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const state = await getState(ctx);
        const dialogs = (await loadDialogs(ctx, state, a.limit ?? 50)).filter((d) => d.type === "channel");
        return { channels: dialogs };
      },
    }),
    defineTool({
      name: "eitaa_client_create_group",
      title: "ساخت گروه ایتا",
      description: "Create a new Eitaa group with an initial list of member user ids.",
      input: {
        title: z.string().min(1).max(128),
        member_ids: z.array(z.union([z.string(), z.number()])).min(1).max(100).describe("Numeric Eitaa user ids"),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const state = await getState(ctx);
        const data = await bridgeCall(ctx, "groups/create", {
          phone: state.session.phone,
          title: a.title,
          ids: a.member_ids.map((id) => String(id)),
        }, 60_000);
        return { ok: true, group: data };
      },
    }),
    defineTool({
      name: "eitaa_client_get_chat_members",
      title: "اعضای گروه یا کانال ایتا",
      description: "List members of an Eitaa group/channel. Run get_chats first so the bridge learns its access hash.",
      input: {
        chat_id: z.string(),
        start: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const state = await getState(ctx);
        const entity = await resolveEntity(ctx, state, a.chat_id.trim());
        const data = await bridgeCall(ctx, "groups/getMembers", {
          phone: state.session.phone,
          id: entity.id,
          start: a.start ?? 0,
          size: a.limit ?? 100,
        }, 45_000);
        return { chat_id: entity.id, members: data?.participants ?? data };
      },
    }),
    defineTool({
      name: "eitaa_client_add_chat_member",
      title: "افزودن عضو به گروه ایتا",
      description: "Add one user to an Eitaa group/channel. The user's access_hash is returned by get_chat_members.",
      input: {
        chat_id: z.string(),
        user_id: z.string(),
        access_hash: z.string(),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const state = await getState(ctx);
        const entity = await resolveEntity(ctx, state, a.chat_id.trim());
        const data = await bridgeCall(ctx, "groups/addMember", {
          phone: state.session.phone,
          id: entity.id,
          uid: a.user_id,
          access_hash: a.access_hash,
        }, 45_000);
        return { ok: true, chat_id: entity.id, result: data };
      },
    }),
    defineTool({
      name: "eitaa_client_remove_chat_member",
      title: "حذف عضو از گروه ایتا",
      description: "Remove one user from an Eitaa group/channel.",
      input: {
        chat_id: z.string(),
        user_id: z.string(),
        access_hash: z.string(),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const state = await getState(ctx);
        const entity = await resolveEntity(ctx, state, a.chat_id.trim());
        const data = await bridgeCall(ctx, "groups/deleteMember", {
          phone: state.session.phone,
          id: entity.id,
          uid: a.user_id,
          access_hash: a.access_hash,
        }, 45_000);
        return { ok: true, chat_id: entity.id, result: data };
      },
    }),
    defineTool({
      name: "eitaa_client_edit_chat",
      title: "ویرایش گروه یا کانال ایتا",
      description: "Change the title and/or description of an Eitaa group/channel.",
      input: {
        chat_id: z.string(),
        title: z.string().min(1).max(128).optional(),
        description: z.string().max(512).optional(),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        if (!a.title && !a.description) throw new ProviderError("عنوان یا توضیحات را وارد کنید.");
        const state = await getState(ctx);
        const entity = await resolveEntity(ctx, state, a.chat_id.trim());
        const data = await bridgeCall(ctx, "groups/change", {
          phone: state.session.phone,
          id: entity.id,
          title: a.title,
          description: a.description,
        }, 45_000);
        return { ok: true, chat_id: entity.id, result: data };
      },
    }),
    defineTool({
      name: "eitaa_client_leave_chat",
      title: "خروج از گروه یا کانال ایتا",
      description: "Leave an Eitaa group/channel.",
      input: { chat_id: z.string() },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const state = await getState(ctx);
        const entity = await resolveEntity(ctx, state, a.chat_id.trim());
        const data = await bridgeCall(ctx, "groups/leave", { phone: state.session.phone, id: entity.id }, 45_000);
        return { ok: true, chat_id: entity.id, result: data };
      },
    }),
    defineTool({
      name: "eitaa_client_delete_chat",
      title: "حذف گروه یا کانال ایتا",
      description: "Delete an Eitaa group/channel where the account is the owner.",
      input: { chat_id: z.string() },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const state = await getState(ctx);
        const entity = await resolveEntity(ctx, state, a.chat_id.trim());
        const data = await bridgeCall(ctx, "groups/delete", { phone: state.session.phone, id: entity.id }, 60_000);
        return { ok: true, chat_id: entity.id, result: data };
      },
    }),
    defineTool({
      name: "eitaa_client_get_chat_link",
      title: "لینک دعوت گروه ایتا",
      description: "Get the invite link of an Eitaa group/channel.",
      input: { chat_id: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const state = await getState(ctx);
        const entity = await resolveEntity(ctx, state, a.chat_id.trim());
        const data = await bridgeCall(ctx, "groups/getLink", { phone: state.session.phone, id: entity.id }, 45_000);
        return { chat_id: entity.id, link: data?.link };
      },
    }),
  ],
};
