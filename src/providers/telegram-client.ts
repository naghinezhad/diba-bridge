import { createRequire } from "node:module";
import { Api, TelegramClient } from "telegram";
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

const nodeRequire = createRequire(import.meta.url);
const { StringSession } = nodeRequire("telegram/sessions") as any;
const { NewMessage } = nodeRequire("telegram/events") as any;
const ApiAuth: any = (Api as any).auth;
const ApiChannels: any = (Api as any).channels;
const ApiMessages: any = (Api as any).messages;

export const TELEGRAM_CLIENT_ID = "telegram_client";
const DEFAULT_API_ID = 2040;
const DEFAULT_API_HASH = "b18441a1ff607e10a989891a5462e627";
const MAX_QUEUE = 500;
const CONNECT_TIMEOUT_MS = 45_000;

// ---------------------------------------------------------------- helpers

export function normalizeTelegramPhone(raw: string): string {
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

function apiCredentials(ctx: ProviderContext) {
  const apiId = Number(ctx.config.apiId) || DEFAULT_API_ID;
  const apiHash = String(ctx.config.apiHash || DEFAULT_API_HASH).trim();
  return { apiId, apiHash };
}

function friendlyError(err: any, prefix: string): ProviderError {
  if (err instanceof ProviderError) return err;
  const message = String(err?.errorMessage ?? err?.message ?? err);
  if (/PHONE_NUMBER_INVALID/i.test(message)) return new ProviderError("شماره تلفن تلگرام معتبر نیست.", err);
  if (/API_ID|API_HASH/i.test(message))
    return new ProviderError("API ID/Hash تلگرام معتبر نیست. مقادیر my.telegram.org را در تنظیمات تلگرام (حساب کاربری) وارد کنید.", err);
  if (/PHONE_NUMBER_UNOCCUPIED/i.test(message))
    return new ProviderError("این شماره در تلگرام ثبت‌نام نشده است؛ اول در اپ تلگرام ثبت‌نام کنید.", err);
  if (/PHONE_CODE_INVALID/i.test(message)) return new ProviderError("کد ورود تلگرام اشتباه است.", err);
  if (/PHONE_CODE_EXPIRED/i.test(message)) return new ProviderError("کد ورود تلگرام منقضی شده است.", err);
  if (/SESSION_PASSWORD_NEEDED|PASSWORD/i.test(message))
    return new ProviderError("این حساب رمز دومرحله‌ای دارد؛ رمز را وارد کنید.", err);
  if (/FLOOD|TOO_MANY/i.test(message)) return new ProviderError("درخواست‌ها زیاد بود؛ کمی بعد دوباره تلاش کنید.", err);
  if (/AUTH_KEY|UNAUTHORIZED|SESSION/i.test(message))
    return new ProviderError("نشست تلگرام معتبر نیست؛ دوباره وارد شوید.", err);
  if (err?.name === "TimeoutError" || err?.code) return new ProviderError(`${prefix}: ${describeNetError(err)}`, err);
  return new ProviderError(`${prefix}: ${message}`, err);
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

const isoDate = (value: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString();
  return new Date(n < 1e11 ? n * 1000 : n).toISOString();
};

function titleOf(entity: any): string | undefined {
  if (!entity) return undefined;
  if (entity.title) return String(entity.title);
  const name = [entity.firstName, entity.lastName].filter(Boolean).join(" ");
  return name || (entity.username ? `@${entity.username}` : undefined);
}

function publicEntity(entity: any) {
  if (!entity) return undefined;
  return {
    id: entity.id === undefined ? undefined : String(entity.id),
    name: titleOf(entity),
    username: entity.username,
    phone: entity.phone,
    kind: entity.className,
    is_bot: entity.bot,
  };
}

function chatIdOf(ctx: ProviderContext, chatId?: string): string {
  const id = chatId?.trim() || ctx.config.defaultChatId?.trim();
  if (!id) throw new ProviderError("chat_id لازم است یا «چت پیش‌فرض» را تنظیم کنید.");
  return id;
}

// ---------------------------------------------------------------- auth pending

interface PendingAuth {
  client: TelegramClient;
  phone: string;
  phoneCodeHash: string;
  createdAt: number;
}

const pendingAuth = new Map<string, PendingAuth>();

function createClient(ctx: ProviderContext, session: string): TelegramClient {
  const { apiId, apiHash } = apiCredentials(ctx);
  return new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 3,
    timeout: 20,
    autoReconnect: true,
  });
}

function storePending(client: TelegramClient, phone: string, phoneCodeHash: string): string {
  const now = Date.now();
  for (const [key, value] of pendingAuth) {
    if (now - value.createdAt > 10 * 60_000) {
      pendingAuth.delete(key);
      void value.client.disconnect().catch(() => {});
    }
  }
  const key = `${phone}:${now}:${Math.random().toString(36).slice(2, 7)}`;
  pendingAuth.set(key, { client, phone, phoneCodeHash, createdAt: now });
  return key;
}

async function disposePending(): Promise<void> {
  for (const value of pendingAuth.values()) void value.client.disconnect().catch(() => {});
  pendingAuth.clear();
}

async function finishLogin(client: TelegramClient, phone: string, save: (values: Record<string, string>) => void): Promise<AuthStep> {
  const session = String((client.session as any).save() ?? "");
  if (!session) throw new ProviderError("نشست تلگرام ساخته نشد؛ دوباره تلاش کنید.");
  save({ session, phone });
  await client.disconnect().catch(() => {});
  return { step: "done", user: { id: 0, name: phone } };
}

const telegramClientAuth: ProviderAuthDef = {
  title: "ورود با حساب تلگرام",
  description:
    "شماره‌ی حساب تلگرام را وارد کنید؛ کد از خود تلگرام می‌آید. اگر حساب رمز دومرحله‌ای دارد، رمز را هم می‌پرسد. نشست روی همین سرور ذخیره می‌شود.",
  phoneField: "phone",
  sessionField: "session",
  async start(ctx, rawPhone, save) {
    const phone = normalizeTelegramPhone(rawPhone);
    if (!/^\+\d{10,15}$/.test(phone)) throw new ProviderError("شماره تلگرام معتبر نیست. نمونه: +989121234567");
    await disposePending();
    const client = createClient(ctx, "");
    try {
      await withTimeout(client.connect(), 30_000);
      // Force SMS first. Some accounts otherwise receive the code only as an
      // in-app service message, which looks like "no code" to the user.
      let code: { phoneCodeHash: string; isCodeViaApp: boolean };
      try {
        code = await withTimeout(client.sendCode(apiCredentials(ctx), phone, true), 30_000);
      } catch (firstErr: any) {
        const firstMessage = String(firstErr?.errorMessage ?? firstErr?.message ?? firstErr);
        if (/PHONE_NUMBER|API_ID|API_HASH|FLOOD|TOO_MANY/i.test(firstMessage)) throw firstErr;
        // If the SMS provider refuses, retry with the normal app-code flow.
        code = await withTimeout(client.sendCode(apiCredentials(ctx), phone, false), 30_000);
      }
      const tx = storePending(client, phone, code.phoneCodeHash);
      save({ phone });
      return {
        step: "code",
        transactionHash: tx,
        hint: code.isCodeViaApp
          ? "کد در اپ تلگرام (پیام سرویس) ارسال شد. اگر ندیدید، «ارسال دوباره کد» را بزنید."
          : "کد از طریق پیامک ارسال شد. اگر ندیدید، «ارسال دوباره کد» را بزنید.",
      };
    } catch (err) {
      await client.disconnect().catch(() => {});
      throw friendlyError(err, "ارسال کد ورود تلگرام");
    }
  },
  async verifyCode(_ctx, transactionHash, code, save) {
    const state = pendingAuth.get(transactionHash);
    if (!state) throw new ProviderError("درخواست ورود تلگرام منقضی شده؛ دوباره شماره را وارد کنید.");
    try {
      const result = await withTimeout(
        state.client.invoke(
          new ApiAuth.SignIn({
            phoneNumber: state.phone,
            phoneCodeHash: state.phoneCodeHash,
            phoneCode: String(code ?? "").trim(),
          }),
        ),
        30_000,
      );
      if (!(result instanceof ApiAuth.Authorization)) throw new ProviderError("ورود تلگرام کامل نشد.");
      pendingAuth.delete(transactionHash);
      return await finishLogin(state.client, state.phone, save);
    } catch (err) {
      const message = String((err as any)?.errorMessage ?? (err as any)?.message ?? err);
      if (/SESSION_PASSWORD_NEEDED/i.test(message)) {
        return { step: "password", transactionHash, hint: "این حساب رمز دومرحله‌ای دارد." };
      }
      throw friendlyError(err, "تأیید کد ورود تلگرام");
    }
  },
  async verifyPassword(ctx, transactionHash, password, save) {
    const state = pendingAuth.get(transactionHash);
    if (!state) throw new ProviderError("درخواست ورود تلگرام منقضی شده؛ دوباره شماره را وارد کنید.");
    try {
      const user = await withTimeout(
        state.client.signInWithPassword(apiCredentials(ctx), {
          password: async () => String(password ?? ""),
          onError: async () => false,
        }),
        30_000,
      );
      if (!user) throw new ProviderError("رمز دومرحله‌ای تلگرام پذیرفته نشد.");
      pendingAuth.delete(transactionHash);
      return await finishLogin(state.client, state.phone, save);
    } catch (err) {
      throw friendlyError(err, "تأیید رمز دومرحله‌ای تلگرام");
    }
  },
  async logout(_ctx, save) {
    await disposePending();
    await resetTelegramClient();
    save({ session: "" });
    return { step: "done", hint: "از حساب تلگرام خارج شدید." };
  },
};

// ---------------------------------------------------------------- connection manager

interface Waiter {
  wake: () => void;
  fail: (err: Error) => void;
}

interface ManagedClient {
  session: string;
  client: TelegramClient;
  selfId: string;
  queue: IncomingMessage[];
  waiters: Set<Waiter>;
  closed: boolean;
  connecting?: Promise<void>;
}

let current: ManagedClient | undefined;

function wakeAll(m: ManagedClient, err?: Error) {
  for (const waiter of [...m.waiters]) {
    if (err) waiter.fail(err);
    else waiter.wake();
  }
}

export async function resetTelegramClient(): Promise<void> {
  const m = current;
  current = undefined;
  if (!m) return;
  m.closed = true;
  wakeAll(m, new ProviderError("اتصال حساب تلگرام قطع شد"));
  await m.client.disconnect().catch(() => {});
}

function pushMessage(m: ManagedClient, message: IncomingMessage) {
  m.queue.push(message);
  if (m.queue.length > MAX_QUEUE) m.queue.splice(0, m.queue.length - MAX_QUEUE);
  const first = m.waiters.values().next().value as Waiter | undefined;
  first?.wake();
}

function messageFromEvent(m: ManagedClient, message: any): IncomingMessage | null {
  if (!message) return null;
  const chatId = message.chatId ?? message.peerId?.channelId ?? message.peerId?.chatId ?? message.peerId?.userId ?? message.senderId;
  if (chatId === undefined || chatId === null) return null;
  const kind: IncomingMessage["kind"] = message.photo
    ? "photo"
    : message.video
      ? "video"
      : message.voice || message.audio
        ? "voice"
        : message.document
          ? "file"
          : message.geo
            ? "location"
            : message.message !== undefined || message.text !== undefined
              ? "text"
              : "other";
  const sender: any = message.sender;
  return {
    key: `${TELEGRAM_CLIENT_ID}:${chatId}:${message.id}`,
    provider: TELEGRAM_CLIENT_ID,
    chatId: String(chatId),
    chatTitle: message.chat?.title || message.chat?.firstName || message.chat?.username,
    chatType: message.isGroup ? "group" : message.isChannel ? "channel" : "private",
    messageId: String(message.id ?? ""),
    from: sender
      ? { id: sender.id === undefined ? undefined : String(sender.id), name: titleOf(sender), username: sender.username }
      : message.senderId !== undefined ? { id: String(message.senderId) } : undefined,
    text: message.message ?? message.text,
    kind,
    date: isoDate(message.date),
  };
}

async function getManaged(ctx: ProviderContext): Promise<ManagedClient> {
  const session = ctx.config.session?.trim();
  if (!session) throw new ProviderError("اول با حساب تلگرام وارد شوید (دکمه‌ی «ورود با حساب تلگرام»).");
  if (current && current.session === session) {
    if (!current.closed) {
      if (current.connecting) await current.connecting;
      return current;
    }
  }
  if (current) await resetTelegramClient();

  const client = createClient(ctx, session);
  const managed: ManagedClient = {
    session,
    client,
    selfId: "",
    queue: [],
    waiters: new Set(),
    closed: false,
  };
  current = managed;
  managed.connecting = (async () => {
    try {
      await withTimeout(client.connect(), CONNECT_TIMEOUT_MS);
      const me: any = await withTimeout(client.getMe(), 30_000);
      managed.selfId = me?.id === undefined ? "" : String(me.id);
      client.addEventHandler(async (event: any) => {
        try {
          const mapped = messageFromEvent(managed, event?.message);
          if (mapped && mapped.from?.id !== managed.selfId) pushMessage(managed, mapped);
        } catch {
          // ignore malformed updates
        }
      }, new NewMessage({}));
    } finally {
      managed.connecting = undefined;
    }
  })();
  try {
    await managed.connecting;
    return managed;
  } catch (err) {
    current = undefined;
    managed.closed = true;
    await client.disconnect().catch(() => {});
    throw friendlyError(err, "اتصال به حساب تلگرام");
  }
}

function waitForMessage(m: ManagedClient, timeoutMs: number): Promise<void> {
  if (m.queue.length) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const waiter: Waiter = {
      wake: () => { clearTimeout(timer); m.waiters.delete(waiter); resolve(); },
      fail: (err) => { clearTimeout(timer); m.waiters.delete(waiter); reject(err); },
    };
    const timer = setTimeout(() => {
      m.waiters.delete(waiter);
      resolve();
    }, timeoutMs);
    m.waiters.add(waiter);
  });
}

// ---------------------------------------------------------------- chat helpers

async function resolveEntity(client: TelegramClient, id: string): Promise<any> {
  try {
    return await client.getEntity(id);
  } catch {
    throw new ProviderError(`چت «${id}» در تلگرام پیدا نشد.`);
  }
}

async function inputEntity(client: TelegramClient, id: string): Promise<any> {
  try {
    return await client.getInputEntity(id);
  } catch {
    throw new ProviderError(`چت «${id}» در تلگرام پیدا نشد.`);
  }
}

async function inputUsers(client: TelegramClient, ids: string[]): Promise<any[]> {
  const users = ids.map((x) => String(x).trim()).filter(Boolean);
  if (!users.length) throw new ProviderError("حداقل یک عضو لازم است.");
  return Promise.all(users.map((id) => inputEntity(client, id)));
}

async function dialogsOf(client: TelegramClient, limit: number) {
  const dialogs: any[] = await client.getDialogs({ limit });
  return dialogs.map((d: any) => ({
    chat_id: d.id === undefined ? "" : String(d.id),
    title: d.title || d.name,
    type: d.isUser ? "private" : d.isGroup ? "group" : d.isChannel ? "channel" : "unknown",
    unread_count: d.unreadCount ?? 0,
    last_message: d.message?.message,
    last_date: isoDate(d.message?.date),
  }));
}

async function createSpace(client: TelegramClient, kind: "group" | "channel", title: string, about: string | undefined, members: string[]) {
  const result: any = await client.invoke(
    new ApiChannels.CreateChannel({
      title,
      about: about ?? "",
      megagroup: kind === "group",
      broadcast: kind === "channel",
    }),
  );
  const chat = result?.chats?.[0];
  const id = chat?.id === undefined ? "" : String(chat.id);
  if (members.length && chat) {
    const users = await inputUsers(client, members);
    await client.invoke(new ApiChannels.InviteToChannel({ channel: chat, users }));
  }
  return { ok: true, chat_id: id, title: chat?.title ?? title, type: kind };
}

async function editSpace(client: TelegramClient, id: string, title?: string, about?: string) {
  const channel = await inputEntity(client, id);
  if (title) await client.invoke(new ApiChannels.EditTitle({ channel, title }));
  if (about !== undefined) await client.invoke(new ApiMessages.EditChatAbout({ peer: channel, about }));
  return { ok: true, chat_id: id };
}

async function leaveSpace(client: TelegramClient, id: string) {
  await client.invoke(new ApiChannels.LeaveChannel({ channel: await inputEntity(client, id) }));
  return { ok: true, chat_id: id };
}

async function deleteSpace(client: TelegramClient, id: string) {
  await client.invoke(new ApiChannels.DeleteChannel({ channel: await inputEntity(client, id) }));
  return { ok: true, chat_id: id };
}

async function addMembers(client: TelegramClient, id: string, memberIds: string[]) {
  const users = await inputUsers(client, memberIds);
  await client.invoke(new ApiChannels.InviteToChannel({ channel: await inputEntity(client, id), users }));
  return { ok: true, chat_id: id, added: users.length };
}

async function membersOf(client: TelegramClient, id: string, limit: number) {
  const result: any = await client.invoke(
    new ApiChannels.GetParticipants({
      channel: await inputEntity(client, id),
      filter: new (Api as any).ChannelParticipantsRecent(),
      offset: 0,
      limit,
      hash: BigInt(0),
    }),
  );
  return {
    chat_id: id,
    members: (result?.participants ?? []).map((p: any) => ({
      id: p.userId === undefined ? undefined : String(p.userId),
      role: p.className,
      admin_rights: p.adminRights,
      banned_rights: p.bannedRights,
    })),
  };
}

async function chatLink(client: TelegramClient, id: string) {
  const result: any = await client.invoke(new ApiMessages.ExportChatInvite({ peer: await inputEntity(client, id) }));
  return { chat_id: id, link: result?.link };
}

// ---------------------------------------------------------------- provider

export const telegramClient: ProviderDef = {
  id: TELEGRAM_CLIENT_ID,
  name: "Telegram Client",
  nameFa: "تلگرام (حساب کاربری)",
  category: "messenger",
  region: "international",
  color: "#229ED9",
  glyph: "ت",
  description: "ورود با شماره تلگرام و مدیریت حساب، گروه‌ها و کانال‌ها از طریق MTProto",
  docsUrl: "https://core.telegram.org/api",
  fields: [
    { key: "phone", label: "شماره تلفن", type: "text", placeholder: "۰۹۱۲۱۲۳۴۵۶۷", help: "برای ورود؛ بعد از ورود ذخیره می‌شود." },
    { key: "session", label: "نشست حساب (خودکار)", type: "secret", required: true, help: "پس از ورود موفق ذخیره می‌شود." },
    { key: "apiId", label: "API ID تلگرام", type: "text", default: String(DEFAULT_API_ID), help: "از my.telegram.org؛ مقدار پیش‌فرض برای شروع است." },
    { key: "apiHash", label: "API Hash تلگرام", type: "secret", default: DEFAULT_API_HASH, help: "از my.telegram.org؛ در صورت نیاز تغییر دهید." },
    { key: "defaultChatId", label: "چت پیش‌فرض", type: "text", placeholder: "اختیاری — @username یا شناسه عددی" },
  ],
  auth: telegramClientAuth,
  test: async (ctx) => {
    const m = await getManaged(ctx);
    return publicEntity(await m.client.getMe());
  },
  receive: {
    idleMs: 1_000,
    async poll(ctx, _cursor, longPollSec) {
      const m = await getManaged(ctx);
      await waitForMessage(m, longPollSec > 0 ? longPollSec * 1_000 : 1_200);
      return { messages: m.queue.splice(0, m.queue.length), cursor: String(Date.now()) };
    },
  },
  tools: [
    defineTool({
      name: "telegram_client_get_me",
      title: "اطلاعات حساب تلگرام",
      description: "Get the logged-in Telegram user profile.",
      input: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (_a, ctx) => publicEntity(await (await getManaged(ctx)).client.getMe()),
    }),
    defineTool({
      name: "telegram_client_get_chats",
      title: "فهرست گفتگوهای تلگرام",
      description: "List recent Telegram dialogs (private chats, groups and channels).",
      input: { limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => ({ chats: await dialogsOf((await getManaged(ctx)).client, a.limit ?? 50) }),
    }),
    defineTool({
      name: "telegram_client_get_chat",
      title: "اطلاعات چت تلگرام",
      description: "Get a Telegram user/group/channel by numeric id, @username or invite link.",
      input: { chat_id: z.string().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => publicEntity(await resolveEntity((await getManaged(ctx)).client, a.chat_id.trim())),
    }),
    defineTool({
      name: "telegram_client_send_message",
      title: "ارسال پیام با حساب تلگرام",
      description: "Send a text message from the logged-in Telegram user account.",
      input: {
        chat_id: z.string().optional(),
        text: z.string().min(1).max(4096),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const entity = await resolveEntity(m.client, chatIdOf(ctx, a.chat_id));
        const sent: any = await m.client.sendMessage(entity, { message: a.text, parseMode: undefined });
        return { ok: true, chat_id: entity.id === undefined ? undefined : String(entity.id), message_id: sent?.id === undefined ? undefined : String(sent.id) };
      },
    }),
    defineTool({
      name: "telegram_client_get_history",
      title: "تاریخچه گفتگوی تلگرام",
      description: "Read recent messages of a Telegram chat.",
      input: { chat_id: z.string().min(1), limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const entity = await resolveEntity(m.client, a.chat_id.trim());
        const list: any[] = await m.client.getMessages(entity, { limit: a.limit ?? 20 });
        return {
          chat_id: String(entity.id ?? a.chat_id),
          messages: list.map((msg: any) => ({
            id: msg.id === undefined ? undefined : String(msg.id),
            text: msg.message ?? msg.text,
            date: isoDate(msg.date),
            from_id: msg.senderId === undefined ? undefined : String(msg.senderId),
            out: Boolean(msg.out),
          })),
        };
      },
    }),
    defineTool({
      name: "telegram_client_list_groups",
      title: "فهرست گروه‌های تلگرام",
      description: "List Telegram groups of the logged-in account.",
      input: { limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const chats = await dialogsOf((await getManaged(ctx)).client, a.limit ?? 50);
        return { groups: chats.filter((c) => c.type === "group") };
      },
    }),
    defineTool({
      name: "telegram_client_list_channels",
      title: "فهرست کانال‌های تلگرام",
      description: "List Telegram channels of the logged-in account.",
      input: { limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const chats = await dialogsOf((await getManaged(ctx)).client, a.limit ?? 50);
        return { channels: chats.filter((c) => c.type === "channel") };
      },
    }),
    defineTool({
      name: "telegram_client_create_group",
      title: "ساخت گروه تلگرام",
      description: "Create a Telegram group, optionally with initial member ids/usernames.",
      input: {
        title: z.string().min(1).max(128),
        about: z.string().max(255).optional(),
        member_ids: z.array(z.string()).max(100).optional(),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => createSpace((await getManaged(ctx)).client, "group", a.title, a.about, a.member_ids ?? []),
    }),
    defineTool({
      name: "telegram_client_create_channel",
      title: "ساخت کانال تلگرام",
      description: "Create a Telegram broadcast channel, optionally with initial members.",
      input: {
        title: z.string().min(1).max(128),
        about: z.string().max(255).optional(),
        member_ids: z.array(z.string()).max(100).optional(),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => createSpace((await getManaged(ctx)).client, "channel", a.title, a.about, a.member_ids ?? []),
    }),
    defineTool({
      name: "telegram_client_chat_members",
      title: "اعضای گروه یا کانال تلگرام",
      description: "List members of a Telegram group or channel.",
      input: { chat_id: z.string().min(1), limit: z.number().int().min(1).max(200).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => membersOf((await getManaged(ctx)).client, a.chat_id.trim(), a.limit ?? 100),
    }),
    defineTool({
      name: "telegram_client_add_chat_members",
      title: "افزودن عضو به گروه/کانال تلگرام",
      description: "Invite users to a Telegram group or channel by ids/usernames.",
      input: { chat_id: z.string().min(1), member_ids: z.array(z.string()).min(1).max(50) },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => addMembers((await getManaged(ctx)).client, a.chat_id.trim(), a.member_ids),
    }),
    defineTool({
      name: "telegram_client_edit_chat",
      title: "ویرایش گروه/کانال تلگرام",
      description: "Change the title and/or description of a Telegram group or channel.",
      input: { chat_id: z.string().min(1), title: z.string().min(1).max(128).optional(), about: z.string().max(255).optional() },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        if (!a.title && a.about === undefined) throw new ProviderError("title یا about لازم است.");
        return editSpace((await getManaged(ctx)).client, a.chat_id.trim(), a.title, a.about);
      },
    }),
    defineTool({
      name: "telegram_client_leave_chat",
      title: "خروج از گروه/کانال تلگرام",
      description: "Leave a Telegram group or channel.",
      input: { chat_id: z.string().min(1) },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => leaveSpace((await getManaged(ctx)).client, a.chat_id.trim()),
    }),
    defineTool({
      name: "telegram_client_delete_chat",
      title: "حذف گروه/کانال تلگرام",
      description: "Delete a Telegram group/channel where the account is the owner.",
      input: { chat_id: z.string().min(1) },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => deleteSpace((await getManaged(ctx)).client, a.chat_id.trim()),
    }),
    defineTool({
      name: "telegram_client_get_chat_link",
      title: "لینک دعوت گروه/کانال تلگرام",
      description: "Get the invite link of a Telegram group or channel.",
      input: { chat_id: z.string().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => chatLink((await getManaged(ctx)).client, a.chat_id.trim()),
    }),
  ],
};
