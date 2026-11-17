import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuthenticationError, BaleRpcError, Chat, Client, User, type Message } from "../../vendor/balejs/dist/index.js";
import { z } from "zod";
import { describeNetError } from "../core/net.js";
import {
  defineTool,
  ProviderError,
  type AuthStep,
  type IncomingMessage,
  type ProviderAuthDef,
  type ProviderContext,
  type ProviderDef,
} from "../core/types.js";

export const BALE_CLIENT_ID = "bale_client";
export const BALE_CLIENT_DEFAULT_BASE_URL = "https://next-ws.bale.ai";
export const BALE_CLIENT_DEFAULT_WS_URL = "wss://next-ws.bale.ai/ws/";

const MAX_QUEUE = 500;
const CONNECT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------- helpers

export function normalizeBalePhone(raw: string): string {
  const latin = String(raw ?? "")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  let s = latin.trim().replace(/[^\d+]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("00")) s = s.slice(2);
  if (s.startsWith("0")) s = `98${s.slice(1)}`;
  else if (/^9\d{9}$/.test(s)) s = `98${s}`;
  return s;
}

export function parseBaleSession(raw: string): { userId: number; jwt: string } {
  const value = String(raw ?? "").trim();
  const i = value.indexOf(":");
  const userId = Number(value.slice(0, i));
  const jwt = value.slice(i + 1).trim();
  if (i <= 0 || !Number.isSafeInteger(userId) || userId <= 0 || !jwt) {
    throw new ProviderError("نشست بله معتبر نیست. دوباره وارد شوید یا مقدار «کاربر:توکن» را درست بچسبانید.");
  }
  return { userId, jwt };
}

export function toBaleSession(userId: number, jwt: string): string {
  return `${userId}:${jwt}`;
}

function chatTypeOfPeer(type: number): IncomingMessage["chatType"] {
  switch (type) {
    case 1:
    case 4:
      return "private";
    case 2:
    case 5:
    case 6:
      return "group";
    case 3:
      return "channel";
    default:
      return "unknown";
  }
}

function chatTypeOf(value: string | undefined): IncomingMessage["chatType"] {
  if (value === "private" || value === "bot") return "private";
  if (value === "group" || value === "supergroup" || value === "thread") return "group";
  if (value === "channel") return "channel";
  return "unknown";
}

function isoDate(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString();
  let ms = n;
  if (n < 1e11) ms = n * 1000;
  else if (n > 1e15) ms = n / 1000;
  return new Date(ms).toISOString();
}

function messageContent(rawMessage: any): { kind: IncomingMessage["kind"]; text?: string } {
  const m = rawMessage?.message ?? {};
  if (m.text_message?.text !== undefined) return { kind: "text", text: String(m.text_message.text) };
  if (m.document_message) {
    const doc = m.document_message;
    const ext = doc.ext ?? {};
    const kind: IncomingMessage["kind"] = ext.document_ex_photo
      ? "photo"
      : ext.document_ex_video
        ? "video"
        : ext.document_ex_voice
          ? "voice"
          : "file";
    const caption = doc.caption?.text;
    return { kind, text: caption === undefined ? undefined : String(caption) };
  }
  if (m.gift) return { kind: "other", text: m.gift.message?.value };
  if (m.sticker_message) return { kind: "other" };
  return { kind: "other" };
}

function publicUser(user: User | undefined) {
  if (!user) return undefined;
  return { id: user.id, name: user.name, username: user.username, is_bot: user.isBot };
}

function publicChat(chat: User | Chat) {
  if (chat instanceof User) {
    return { kind: "user" as const, id: chat.id, name: chat.name, username: chat.username, is_bot: chat.isBot };
  }
  return {
    kind: "chat" as const,
    id: chat.id,
    peer_id: chat.peerId,
    peer_type: chat.peerType,
    title: chat.title,
    username: chat.username,
    type: chat.type,
  };
}

function isPeerId(value: string) {
  return /^\d+\|\d+$/.test(value);
}

function friendlyError(err: any, prefix: string): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err?.message === "timeout") {
    return new ProviderError(`${prefix}: زمان اتصال به سرور بله تمام شد. اتصال شبکه/فیلتر را بررسی کنید.`, err);
  }
  if (err instanceof BaleRpcError) {
    const message = String(err.message ?? "");
    if (/UNAUTHORIZED|AUTH_KEY|INVALID_ACCESS|JWT|TOKEN|SESSION/i.test(message)) {
      return new ProviderError("نشست حساب بله منقضی یا نامعتبر شده است؛ دوباره وارد شوید.", err);
    }
    return new ProviderError(`${prefix}: ${message || `خطای بله (${err.code})`}`, err);
  }
  if (err instanceof AuthenticationError) {
    return new ProviderError("ورود به حساب بله انجام نشد؛ دوباره تلاش کنید.", err);
  }
  if (err?.name === "TimeoutError" || err?.code) {
    return new ProviderError(`${prefix}: ${describeNetError(err)}`, err);
  }
  return new ProviderError(`${prefix}: ${err?.message ?? String(err)}`, err);
}

function authError(err: any, prefix: string): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err?.message === "timeout") {
    return new ProviderError(`${prefix}: زمان اتصال به سرور بله تمام شد. اتصال شبکه/فیلتر را بررسی کنید.`, err);
  }
  if (err instanceof BaleRpcError) {
    const message = String(err.message ?? "");
    if (/PHONE_NUMBER_BANNED/i.test(message)) return new ProviderError("این شماره در بله مسدود شده است.", err);
    if (/PHONE_NUMBER_UNOCCUPIED/i.test(message))
      return new ProviderError("این شماره در بله ثبت نشده است؛ اول با اپ رسمی بله ثبت‌نام کنید.", err);
    if (/PHONE_NUMBER_INVALID/i.test(message))
      return new ProviderError("شماره تلفن معتبر نیست. شماره را با ۰۹ یا +۹۸ وارد کنید.", err);
    if (/FLOOD|TOO_MANY/i.test(message))
      return new ProviderError("درخواست‌های ورود زیاد بوده؛ چند دقیقه بعد دوباره تلاش کنید.", err);
    if (/WRONG_PASSWORD|PASSWORD_INVALID/i.test(message)) return new ProviderError("رمز دومرحله‌ای اشتباه است.", err);
    if (/PASSWORD/i.test(message))
      return new ProviderError("این حساب رمز دومرحله‌ای دارد؛ قدم رمز را کامل کنید.", err);
    if (/CODE/i.test(message)) return new ProviderError("کد وارد شده اشتباه یا منقضی شده است.", err);
    return new ProviderError(`${prefix}: ${message || `خطای بله (${err.code})`}`, err);
  }
  if (err?.name === "TimeoutError" || err?.code) {
    return new ProviderError(`${prefix}: ${describeNetError(err)}`, err);
  }
  return new ProviderError(`${prefix}: ${err?.message ?? String(err)}`, err);
}

// ---------------------------------------------------------------- connection manager

interface Waiter {
  wake: () => void;
  fail: (err: Error) => void;
}

interface ManagedClient {
  session: string;
  client: Client;
  selfId: number;
  queue: IncomingMessage[];
  waiters: Set<Waiter>;
  titles: Map<string, { title?: string; type: IncomingMessage["chatType"] }>;
  users: Map<number, string>;
  outgoing: Set<string>;
  closed: boolean;
  connecting?: Promise<void>;
}

let current: ManagedClient | undefined;

function clientOptions(ctx: ProviderContext) {
  return {
    sessionDir: join(tmpdir(), "diba-mcp-bale-client"),
    grpc: { baseUrl: (ctx.config.baseUrl?.trim() || BALE_CLIENT_DEFAULT_BASE_URL).replace(/\/+$/, "") },
    websocket: {
      websocketUri: ctx.config.wsUrl?.trim() || BALE_CLIENT_DEFAULT_WS_URL,
      timeoutSeconds: 25,
    },
  };
}

function wakeAll(m: ManagedClient, err?: Error) {
  for (const w of [...m.waiters]) {
    if (err) w.fail(err);
    else w.wake();
  }
}

async function safeDisconnect(client: Client): Promise<void> {
  try {
    await withTimeout(client.disconnect(), 3_000);
  } catch {
  }
}

export async function resetBaleClient(): Promise<void> {
  const m = current;
  current = undefined;
  if (!m) return;
  m.closed = true;
  wakeAll(m, new ProviderError("اتصال حساب بله قطع شد"));
  await safeDisconnect(m.client);
}

function pushMessage(m: ManagedClient, message: IncomingMessage) {
  m.queue.push(message);
  if (m.queue.length > MAX_QUEUE) m.queue.splice(0, m.queue.length - MAX_QUEUE);
  const first = m.waiters.values().next().value as Waiter | undefined;
  first?.wake();
}

function toIncoming(m: ManagedClient, msg: Message): IncomingMessage | undefined {
  const rid = Number(msg.rid);
  if (!rid) return undefined;
  const raw: any = msg.raw ?? {};
  const peer = raw.peer ?? msg.chat;
  const peerId = Number(peer?.id ?? msg.chat.peerId);
  const peerType = Number(peer?.type ?? msg.chat.peerType);
  const chatId = `${peerId}|${peerType}`;
  const authorId = Number(msg.author?.id ?? raw.sender_uid ?? 0);
  const { kind, text } = messageContent(raw);
  const known = m.titles.get(chatId);
  const direction: IncomingMessage["direction"] = authorId && authorId === m.selfId ? "out" : "in";
  return {
    key: `${BALE_CLIENT_ID}:${chatId}:${rid}`,
    provider: BALE_CLIENT_ID,
    chatId,
    chatTitle: known?.title,
    chatType: known?.type ?? chatTypeOfPeer(peerType),
    messageId: String(rid),
    from: authorId ? { id: String(authorId), name: m.users.get(authorId) } : undefined,
    text,
    kind,
    date: isoDate(msg.date ?? raw.date),
    direction,
    source: direction === "out" ? "account" : undefined,
  };
}

async function loadDialogIndex(m: ManagedClient): Promise<void> {
  const data: any = await m.client.load_dialogs(100);
  const users = new Map<number, string>();
  const groups = new Map<number, string>();
  for (const u of data.users ?? []) {
    if (u?.id === undefined) continue;
    users.set(Number(u.id), String(u.name || u.nick?.value || ""));
  }
  for (const g of data.groups ?? []) {
    if (g?.id === undefined) continue;
    groups.set(Number(g.id), String(g.title || ""));
  }
  for (const d of data.dialogs ?? []) {
    const id = Number(d?.peer?.id);
    const type = Number(d?.peer?.type);
    if (!id) continue;
    const title = type === 1 || type === 4 ? users.get(id) : groups.get(id);
    if (title) m.titles.set(`${id}|${type}`, { title, type: chatTypeOfPeer(type) });
  }
  m.users = users;
}

function createManaged(session: string, ctx: ProviderContext): ManagedClient {
  const parsed = parseBaleSession(session);
  const client = new Client(session, clientOptions(ctx));
  const m: ManagedClient = {
    session,
    client,
    selfId: parsed.userId,
    queue: [],
    waiters: new Set(),
    titles: new Map(),
    users: new Map(),
    outgoing: new Set(),
    closed: false,
  };

  client.on_message((msg) => {
    try {
      const incoming = toIncoming(m, msg);
      if (incoming && !(incoming.direction === "out" && m.outgoing.has(incoming.messageId))) pushMessage(m, incoming);
    } catch {
    }
  });
  client.on_disconnect(() => {
    m.closed = true;
    wakeAll(m, new ProviderError("اتصال حساب بله قطع شد؛ دوباره وصل می‌شویم"));
  });
  client.on_error(() => {
  });
  return m;
}

async function connectManaged(m: ManagedClient): Promise<void> {
  try {
    await m.client.connect();
    if (m.closed) {
      await safeDisconnect(m.client);
      return;
    }
    m.selfId = Number(m.client.user?.id ?? m.selfId);
    const socket = (m.client as any).websocket;
    socket?.on?.("close", () => {
      m.closed = true;
      wakeAll(m, new ProviderError("اتصال حساب بله قطع شد؛ دوباره وصل می‌شویم"));
    });
    await loadDialogIndex(m).catch(() => {
    });
  } catch (err) {
    m.closed = true;
    await safeDisconnect(m.client);
    throw friendlyError(err, "اتصال به حساب بله برقرار نشد");
  }
}

async function getManaged(ctx: ProviderContext): Promise<ManagedClient> {
  const session = ctx.config.session?.trim();
  if (!session) throw new ProviderError("اول با حساب بله وارد شوید (دکمه‌ی «ورود با حساب بله»).");

  if (current && current.session === session) {
    if (!current.closed) {
      if (current.connecting) await current.connecting;
      return current;
    }
    await resetBaleClient();
  }

  await resetBaleClient();
  const managed = createManaged(session, ctx);
  current = managed;
  managed.connecting = connectManaged(managed);
  try {
    await withTimeout(managed.connecting, CONNECT_TIMEOUT_MS);
    return managed;
  } catch (err) {
    if (current === managed) current = undefined;
    managed.closed = true;
    await safeDisconnect(managed.client);
    throw err instanceof ProviderError ? err : friendlyError(err, "اتصال به حساب بله برقرار نشد");
  }
}

async function waitForMessage(m: ManagedClient, timeoutMs: number): Promise<void> {
  if (m.queue.length) return;
  if (m.closed) throw new ProviderError("اتصال حساب بله قطع شده است؛ دوباره وصل می‌شویم");
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
  if (m.closed && !m.queue.length) throw new ProviderError("اتصال حساب بله قطع شده است؛ دوباره وصل می‌شویم");
}

async function resolveTitles(m: ManagedClient, messages: IncomingMessage[]): Promise<void> {
  const missing = [...new Set(messages.map((x) => x.chatId))].filter((id) => !m.titles.get(id)?.title).slice(0, 4);
  await Promise.all(
    missing.map(async (chatId) => {
      try {
        const chat = await withTimeout(m.client.get_chat(chatId), 2_000);
        if (!chat) return;
        if (chat instanceof User) {
          m.titles.set(chatId, { title: chat.name || undefined, type: "private" });
        } else {
          m.titles.set(chatId, { title: chat.title || chat.full_name || undefined, type: chatTypeOf(chat.type) });
        }
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

function chatIdOf(ctx: ProviderContext, chatId?: string): string {
  const id = chatId?.trim() || ctx.config.defaultChatId?.trim();
  if (!id) throw new ProviderError("chat_id داده نشده و «چت پیش‌فرض» هم در تنظیمات خالی است");
  return id;
}

async function resolvePeerId(client: Client, rawId: string): Promise<string> {
  if (isPeerId(rawId)) return rawId;
  const chat = await client.get_chat(rawId);
  if (!chat) throw new ProviderError(`چتی با شناسه‌ی «${rawId}» پیدا نشد. شناسه‌ی بله شکل 12345|1 دارد.`);
  return chat instanceof User ? `${chat.id}|1` : chat.id;
}

// ---------------------------------------------------------------- auth

function authClient(ctx: ProviderContext): Client {
  return new Client("0", clientOptions(ctx));
}

function authUser(raw: any) {
  const id = Number(raw?.user?.id);
  const jwt = String(raw?.jwt?.value ?? "");
  if (!id || !jwt) throw new ProviderError("پاسخ ورود بله ناقص بود؛ دوباره تلاش کنید.");
  return { id, jwt, name: raw?.user?.name, username: raw?.user?.nick?.value };
}

async function finishCodeAuth(ctx: ProviderContext, raw: any, save: (values: Record<string, string>) => void): Promise<AuthStep> {
  const user = authUser(raw);
  const values: Record<string, string> = { [baleClientAuth.sessionField]: toBaleSession(user.id, user.jwt) };
  const phone = ctx.config[baleClientAuth.phoneField];
  if (phone) values[baleClientAuth.phoneField] = phone;
  save(values);
  await resetBaleClient();
  return { step: "done", user: { id: user.id, name: user.name, username: user.username } };
}

const baleClientAuth: ProviderAuthDef = {
  title: "ورود با حساب بله",
  description:
    "شماره‌ی حساب بله را وارد کنید؛ کد از پیامک یا خود بله می‌آید. اگر حساب رمز دومرحله‌ای دارد، قدم بعدی رمز را می‌پرسد. بعد از ورود، یک نشست روی همین سرور ذخیره می‌شود.",
  phoneField: "phone",
  sessionField: "session",
  async start(ctx, rawPhone, save) {
    const phone = normalizeBalePhone(rawPhone);
    if (!/^\d{10,15}$/.test(phone)) throw new ProviderError("شماره تلفن معتبر نیست. نمونه: ۰۹۱۲۱۲۳۴۵۶۷ یا +۹۸۹۱۲۱۲۳۴۵۶۷");
    const client = authClient(ctx);
    try {
      const res: any = await client.start_phone_auth(phone);
      if (!res?.transaction_hash) throw new ProviderError("بله درخواست کد را قبول نکرد؛ دوباره تلاش کنید.");
      if (res.is_registered === false) throw new ProviderError("این شماره در بله ثبت نشده است؛ اول با اپ رسمی بله ثبت‌نام کنید.");
      save({ [baleClientAuth.phoneField]: phone });
      return {
        step: "code",
        transactionHash: String(res.transaction_hash),
        hint: "کد ورود به بله (یا پیامک) فرستاده شد.",
      };
    } catch (err) {
      throw authError(err, "ارسال کد ورود");
    } finally {
      await client.disconnect().catch(() => {});
    }
  },
  async verifyCode(ctx, transactionHash, code, save) {
    if (!transactionHash) throw new ProviderError("درخواست کد دوباره اجرا شود.");
    const value = String(code ?? "").trim();
    if (!value) throw new ProviderError("کد ورود خالی است.");
    const client = authClient(ctx);
    try {
      const res: any = await client.validate_code(transactionHash, value);
      return await finishCodeAuth(ctx, res, save);
    } catch (err) {
      const message = err instanceof BaleRpcError ? String(err.message ?? "") : "";
      if (/PASSWORD/i.test(message) && !/WRONG_PASSWORD|PASSWORD_INVALID/i.test(message)) {
        return { step: "password", transactionHash, hint: "این حساب رمز دومرحله‌ای دارد." };
      }
      throw authError(err, "تأیید کد ورود");
    } finally {
      await client.disconnect().catch(() => {});
    }
  },
  async verifyPassword(ctx, transactionHash, password, save) {
    if (!transactionHash) throw new ProviderError("درخواست کد دوباره اجرا شود.");
    const value = String(password ?? "");
    if (!value) throw new ProviderError("رمز دومرحله‌ای خالی است.");
    const client = authClient(ctx);
    try {
      const res: any = await client.validate_password(transactionHash, value);
      return await finishCodeAuth(ctx, res, save);
    } catch (err) {
      throw authError(err, "تأیید رمز دومرحله‌ای");
    } finally {
      await client.disconnect().catch(() => {});
    }
  },
  async logout(_ctx, save) {
    save({ [baleClientAuth.sessionField]: "" });
    await resetBaleClient();
    return { step: "done", hint: "از حساب بله خارج شدید." };
  },
};

// ---------------------------------------------------------------- provider

const chatId = z
  .string()
  .optional()
  .describe("Bale peer id like \"12345|1\" (1=user, 2=group, 3=channel). If omitted, the default chat from settings is used.");

export const baleClient: ProviderDef = {
  id: BALE_CLIENT_ID,
  name: "Bale Client",
  nameFa: "بله (حساب کاربری)",
  category: "messenger",
  region: "iran",
  color: "#0f9d8a",
  glyph: "ح",
  description: "اتصال به حساب شخصی بله با شماره تلفن — ارسال و دریافت پیام مثل خود کاربر (API خصوصی)",
  docsUrl: "https://web.bale.ai/",
  fields: [
    {
      key: "phone",
      label: "شماره تلفن",
      type: "text",
      placeholder: "۰۹۱۲۱۲۳۴۵۶۷",
      help: "برای ورود. بعد از ورود ذخیره می‌شود و لازم نیست دوباره بنویسید.",
    },
    {
      key: "session",
      label: "نشست حساب (خودکار)",
      type: "secret",
      required: true,
      help: "با دکمه‌ی «ورود با حساب بله» خودکار پر می‌شود. اگر نشست آماده دارید، به شکل userId:jwt بچسبانید.",
    },
    {
      key: "baseUrl",
      label: "آدرس پایه API",
      type: "url",
      default: BALE_CLIENT_DEFAULT_BASE_URL,
      help: "فقط اگر بله آدرس سرور را عوض کرد تغییر دهید.",
    },
    {
      key: "wsUrl",
      label: "آدرس WebSocket",
      type: "url",
      default: BALE_CLIENT_DEFAULT_WS_URL,
      help: "فقط اگر بله آدرس WebSocket را عوض کرد تغییر دهید.",
    },
    {
      key: "defaultChatId",
      label: "چت پیش‌فرض",
      type: "text",
      placeholder: "اختیاری — مثلاً 12345|1",
    },
  ],
  auth: baleClientAuth,
  test: async (ctx) => {
    const m = await getManaged(ctx);
    return publicUser(m.client.user);
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
      name: "bale_client_get_me",
      title: "اطلاعات حساب بله",
      description: "Get the profile (id, name, username) of the Bale user account this server is logged in as.",
      input: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (_a, ctx) => {
        const m = await getManaged(ctx);
        return publicUser(m.client.user);
      },
    }),
    defineTool({
      name: "bale_client_get_chat",
      title: "اطلاعات چت",
      description:
        "Get a Bale user/group/channel by peer id (\"12345|1\") or by username/search text. Returns its title/name and type.",
      input: { chat_id: z.string().describe("Bale peer id (12345|1), @username or search text") },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const chat = await m.client.get_chat(a.chat_id.trim());
        if (!chat) throw new ProviderError(`چتی با شناسه‌ی «${a.chat_id}» پیدا نشد.`);
        return publicChat(chat);
      },
    }),
    defineTool({
      name: "bale_client_send_message",
      title: "ارسال پیام با حساب بله",
      description:
        "Send a text message from the logged-in Bale user account to a user, group or channel. " +
        "chat_id must be a Bale peer id like \"12345|1\"; a username like \"@someone\" also works.",
      input: {
        chat_id: chatId,
        text: z.string().min(1).max(4096).describe("Message text (max 4096 chars)"),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const peerId = await resolvePeerId(m.client, chatIdOf(ctx, a.chat_id));
        const sent = await m.client.send_message(peerId, a.text);
        const rid = String(sent.rid);
        m.outgoing.add(rid);
        if (m.outgoing.size > 200) {
          const first = m.outgoing.values().next().value;
          if (first) m.outgoing.delete(first);
        }
        m.queue = m.queue.filter((x) => x.messageId !== rid);
        return {
          ok: true,
          chat_id: peerId,
          message_id: rid,
          date: isoDate(sent.date),
        };
      },
    }),
    defineTool({
      name: "bale_client_get_dialogs",
      title: "فهرست گفتگوها",
      description:
        "List the logged-in user's recent Bale chats (private chats, groups, channels) with title, unread count, last message and chat_id. " +
        "Use this to find the chat_id to send to.",
      input: {
        limit: z.number().int().min(1).max(100).optional().describe("Max dialogs (1-100), default 30"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        return dialogsOf(m, a.limit ?? 30);
      },
    }),
    defineTool({
      name: "bale_client_get_history",
      title: "تاریخچه‌ی گفتگو",
      description: "Read recent messages of a Bale chat from the logged-in user's account (newest first).",
      input: {
        chat_id: z.string().describe("Bale peer id like \"12345|1\""),
        limit: z.number().int().min(1).max(100).optional().describe("Max messages (1-100), default 20"),
        from_date: z.number().optional().describe("Load messages older than this Unix date (ms); default -1 (newest)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const peerId = await resolvePeerId(m.client, a.chat_id.trim());
        const history = await m.client.load_history(peerId, a.from_date ?? -1, a.limit ?? 20);
        const messages = history.map((msg) => toIncoming(m, msg)).filter((x): x is IncomingMessage => Boolean(x));
        await resolveTitles(m, messages);
        return { source: "history", chat_id: peerId, messages };
      },
    }),
    defineTool({
      name: "bale_client_get_updates",
      title: "دریافت پیام‌های جدید",
      description:
        "Read recent messages of the logged-in Bale account. With chat_id: message history of that chat. " +
        "Without chat_id: last message of each recent dialog (useful to find chat ids). " +
        "When 'receive messages' is on in the dashboard, this reads the shared inbox instead.",
      input: {
        chat_id: z.string().optional().describe("Only messages from this chat (Bale peer id)"),
        limit: z.number().int().min(1).max(100).optional().describe("Max messages (1-100), default 20"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        if (ctx.inbox) return { source: "inbox", messages: ctx.inbox.list({ chatId: a.chat_id, limit: a.limit ?? 20 }) };
        const m = await getManaged(ctx);
        const limit = a.limit ?? 20;
        if (a.chat_id) {
          const peerId = await resolvePeerId(m.client, a.chat_id.trim());
          const history = await m.client.load_history(peerId, -1, limit);
          const messages = history.map((msg) => toIncoming(m, msg)).filter((x): x is IncomingMessage => Boolean(x));
          await resolveTitles(m, messages);
          return { source: "history", chat_id: peerId, messages };
        }
        const dialogs = await dialogsOf(m, limit);
        return { source: "dialogs", dialogs: dialogs.dialogs };
      },
    }),
    defineTool({
      name: "bale_client_list_groups",
      title: "فهرست گروه‌های بله",
      description: "List Bale groups from the logged-in account's recent dialogs.",
      input: { limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const dialogs = (await dialogsOf(m, a.limit ?? 50)).dialogs;
        return { groups: dialogs.filter((d: any) => d.type === "group") };
      },
    }),
    defineTool({
      name: "bale_client_list_channels",
      title: "فهرست کانال‌های بله",
      description: "List Bale channels from the logged-in account's recent dialogs.",
      input: { limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const dialogs = (await dialogsOf(m, a.limit ?? 50)).dialogs;
        return { channels: dialogs.filter((d: any) => d.type === "channel") };
      },
    }),
    defineTool({
      name: "bale_client_get_chat_members",
      title: "اعضای گروه یا کانال بله",
      description: "List members of a Bale group or channel where the account is a member/admin.",
      input: {
        chat_id: z.string().describe("Bale peer id like \"12345|2\""),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        try {
          const peerId = await resolvePeerId(m.client, a.chat_id.trim());
          return { chat_id: peerId, members: await m.client.load_members(peerId, a.limit ?? 100) };
        } catch (err) { throw friendlyError(err, "دریافت اعضای گروه"); }
      },
    }),
    defineTool({
      name: "bale_client_add_chat_members",
      title: "افزودن عضو به گروه بله",
      description: "Invite Bale users to a group by numeric user ids.",
      input: {
        chat_id: z.string().describe("Bale group peer id like \"12345|2\""),
        user_ids: z.array(z.number().int().positive()).min(1).max(50),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        try {
          const peerId = await resolvePeerId(m.client, a.chat_id.trim());
          return { ok: true, chat_id: peerId, result: await m.client.invite_users(peerId, a.user_ids) };
        } catch (err) { throw friendlyError(err, "افزودن عضو"); }
      },
    }),
    defineTool({
      name: "bale_client_edit_chat",
      title: "ویرایش گروه یا کانال بله",
      description: "Change the title and/or description of a Bale group where the account is an admin.",
      input: {
        chat_id: z.string().describe("Bale group peer id like \"12345|2\""),
        title: z.string().min(1).max(128).optional(),
        about: z.string().max(512).optional(),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        if (!a.title && !a.about) throw new ProviderError("عنوان یا توضیحات را وارد کنید.");
        const m = await getManaged(ctx);
        try {
          const peerId = await resolvePeerId(m.client, a.chat_id.trim());
          if (a.title) await m.client.edit_group_title(peerId, a.title);
          if (a.about) await m.client.edit_group_about(peerId, a.about);
          return { ok: true, chat_id: peerId };
        } catch (err) { throw friendlyError(err, "ویرایش گروه"); }
      },
    }),
    defineTool({
      name: "bale_client_leave_chat",
      title: "خروج از گروه یا کانال بله",
      description: "Leave a Bale group or channel.",
      input: { chat_id: z.string().describe("Bale peer id like \"12345|2\"") },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        try {
          const peerId = await resolvePeerId(m.client, a.chat_id.trim());
          return { ok: true, chat_id: peerId, result: await m.client.leave_chat(peerId) };
        } catch (err) { throw friendlyError(err, "خروج از گروه"); }
      },
    }),
    defineTool({
      name: "bale_client_get_chat_link",
      title: "لینک دعوت گروه بله",
      description: "Get or revoke the invite link of a Bale group.",
      input: {
        chat_id: z.string().describe("Bale group peer id like \"12345|2\""),
        revoke: z.boolean().optional().describe("Revoke the current link and create a new one"),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        try {
          const peerId = await resolvePeerId(m.client, a.chat_id.trim());
          return { chat_id: peerId, link: a.revoke ? await m.client.revoke_group_link(peerId) : await m.client.get_group_link(peerId) };
        } catch (err) { throw friendlyError(err, "لینک گروه"); }
      },
    }),
    defineTool({
      name: "bale_client_join_chat",
      title: "ورود به گروه یا کانال بله",
      description: "Join a Bale group/channel via an invite link or public username.",
      input: { link_or_username: z.string().min(1).describe("Invite link, token, or @username") },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        try {
          const raw = a.link_or_username.trim();
          const chat = raw.startsWith("@")
            ? await m.client.join_public_chat(raw.replace(/^@/, ""))
            : await m.client.join_chat(raw);
          return { ok: true, chat: publicChat(chat) };
        } catch (err) { throw friendlyError(err, "ورود به گروه"); }
      },
    }),
  ],
};

async function dialogsOf(m: ManagedClient, limit: number) {
  const data: any = await m.client.load_dialogs(limit);
  const users = new Map<number, any>();
  const groups = new Map<number, any>();
  for (const u of data.users ?? []) if (u?.id !== undefined) users.set(Number(u.id), u);
  for (const g of data.groups ?? []) if (g?.id !== undefined) groups.set(Number(g.id), g);

  const dialogs = (data.dialogs ?? []).map((d: any) => {
    const peerId = Number(d?.peer?.id);
    const peerType = Number(d?.peer?.type);
    const chatId = `${peerId}|${peerType}`;
    const source = peerType === 1 || peerType === 4 ? users.get(peerId) : groups.get(peerId);
    const title = source?.name ?? source?.title;
    const content = messageContent(d?.message);
    const outgoing = Number(d?.sender_uid) === m.selfId;
    if (title) m.titles.set(chatId, { title: String(title), type: chatTypeOfPeer(peerType) });
    return {
      chat_id: chatId,
      title: title === undefined ? undefined : String(title),
      type: chatTypeOfPeer(peerType),
      unread_count: Number(d?.unread_count ?? 0),
      last_message: content.text,
      last_kind: content.kind,
      last_date: isoDate(d?.date ?? d?.sort_date),
      last_direction: outgoing ? "out" : "in",
      message_id: d?.rid === undefined ? undefined : String(d.rid),
    };
  });
  return { dialogs };
}
