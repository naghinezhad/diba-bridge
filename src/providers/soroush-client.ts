/**
 * سروش‌پلاس با حساب کاربری (self client)، جدا از Bot API در providers/soroush.ts.
 *
 * سروش‌پلاس روی MTProto (نسخه‌ی تلگرام) کار می‌کند. کتابخانه‌ی `sroosh`
 * همان پیاده‌سازی GramJS است که برای سرورهای سروش پیکربندی شده:
 *   im-server.splus.ir، لایه ۱۸۲، API ID مخصوص سروش
 *
 * ورود با شماره/کد و رمز دومرحله‌ای انجام می‌شود و نشست به شکل StringSession
 * در config ذخیره می‌شود. این پروتکل خصوصی است و سروش می‌تواند تغییرش دهد.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Api, SrooshClient } from "sroosh";
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

const nodeRequire = createRequire(import.meta.url);
const { NewMessage } = nodeRequire("sroosh/events") as any;
const { StringSession } = nodeRequire("sroosh/sessions") as any;
// این namespace در نسخه‌ی type کتابخانه کامل نیست ولی در runtime موجود است
const ApiAuth: any = (Api as any).auth;

export const SOROUSH_CLIENT_ID = "soroush_client";
/** API ID/hash عمومی کلاینت سروش‌پلاس (همان مقادیر مستندات SrooshJS) */
const DEFAULT_API_ID = 1030400;
const DEFAULT_API_HASH = "6edb16cf88714a4e9a805e928c39c937";
const MAX_QUEUE = 500;
const CONNECT_TIMEOUT_MS = 45_000;

// ---------------------------------------------------------------- helpers

export function normalizeSoroushPhone(raw: string): string {
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

/** API ID/hash ثابت کلاینت سروش؛ کاربر لازم نیست وارد کند */
function apiCredentials(): { apiId: number; apiHash: string } {
  return { apiId: DEFAULT_API_ID, apiHash: DEFAULT_API_HASH };
}

function friendlyError(err: any, prefix: string): ProviderError {
  if (err instanceof ProviderError) return err;
  const message = String(err?.errorMessage ?? err?.message ?? err);
  if (/PHONE_NUMBER_INVALID/i.test(message)) return new ProviderError("شماره تلفن برای سروش معتبر نیست.", err);
  if (/PHONE_NUMBER_UNOCCUPIED/i.test(message))
    return new ProviderError("این شماره در سروش ثبت نشده است؛ اول در اپ سروش ثبت‌نام کنید.", err);
  if (/PHONE_CODE_INVALID/i.test(message)) return new ProviderError("کد ورود سروش اشتباه است.", err);
  if (/PHONE_CODE_EXPIRED/i.test(message)) return new ProviderError("کد ورود سروش منقضی شده است.", err);
  if (/SESSION_PASSWORD_NEEDED|PASSWORD/i.test(message))
    return new ProviderError("این حساب رمز دومرحله‌ای دارد؛ رمز را وارد کنید.", err);
  if (/FLOOD|TOO_MANY/i.test(message)) return new ProviderError("درخواست‌های ورود زیاد بوده؛ کمی بعد دوباره تلاش کنید.", err);
  if (/AUTH_KEY|UNAUTHORIZED|SESSION/i.test(message))
    return new ProviderError("نشست سروش معتبر نیست؛ دوباره وارد شوید.", err);
  if (err?.name === "TimeoutError" || err?.code) {
    return new ProviderError(`${prefix}: ${describeNetError(err)}`, err);
  }
  return new ProviderError(`${prefix}: ${message}`, err);
}

function isoDate(value: unknown): string {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return new Date(n < 1e11 ? n * 1000 : n).toISOString();
  return new Date().toISOString();
}

function chatTypeOfEvent(event: any): IncomingMessage["chatType"] {
  if (event?.isPrivate) return "private";
  if (event?.isGroup) return "group";
  if (event?.isChannel) return "channel";
  return "unknown";
}

function kindOfMessage(message: any): IncomingMessage["kind"] {
  if (message?.photo) return "photo";
  if (message?.video) return "video";
  if (message?.voice || message?.audio) return "voice";
  if (message?.document) return "file";
  if (message?.geo || message?.venue) return "location";
  if (message?.message !== undefined || message?.text !== undefined) return "text";
  return "other";
}

function titleOfEntity(entity: any): string | undefined {
  if (!entity) return undefined;
  if (entity.title) return String(entity.title);
  const name = [entity.firstName, entity.lastName].filter(Boolean).join(" ");
  if (name) return name;
  if (entity.username) return `@${entity.username}`;
  return undefined;
}

function publicEntity(entity: any): any {
  if (!entity) return undefined;
  return {
    id: entity.id === undefined ? undefined : String(entity.id),
    name: titleOfEntity(entity),
    username: entity.username,
    phone: entity.phone,
    kind: entity.className ?? undefined,
    is_bot: entity.bot ?? undefined,
  };
}

function chatIdOf(ctx: ProviderContext, chatId?: string): string {
  const id = chatId?.trim() || ctx.config.defaultChatId?.trim();
  if (!id) throw new ProviderError("chat_id داده نشده و «چت پیش‌فرض» هم در تنظیمات خالی است");
  return id;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
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

// ---------------------------------------------------------------- auth state

interface PendingAuth {
  client: SrooshClient;
  phone: string;
  phoneCodeHash: string;
  createdAt: number;
}

const pendingAuth = new Map<string, PendingAuth>();

async function disposePending() {
  const old = [...pendingAuth.values()];
  pendingAuth.clear();
  await Promise.all(old.map((p) => p.client.disconnect().catch(() => {})));
}

function storePending(client: SrooshClient, phone: string, phoneCodeHash: string): string {
  const now = Date.now();
  for (const [key, value] of pendingAuth) {
    if (now - value.createdAt > 10 * 60_000) {
      pendingAuth.delete(key);
      void value.client.disconnect().catch(() => {});
    }
  }
  const tx = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  pendingAuth.set(tx, { client, phone, phoneCodeHash, createdAt: now });
  return tx;
}

/** نشانی سرویس را از نشست ذخیره‌شده/تنظیمات می‌سازد */
function createClient(ctx: ProviderContext, session: string): SrooshClient {
  const { apiId, apiHash } = apiCredentials();
  return new SrooshClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 3,
    timeout: 20,
  });
}

async function finishLogin(client: SrooshClient, phone: string, save: (values: Record<string, string>) => void): Promise<AuthStep> {
  const session = String((client.session as any).save() ?? "");
  if (!session) throw new ProviderError("نشست سروش ساخته نشد؛ دوباره تلاش کنید.");
  save({ session, phone });
  await client.disconnect().catch(() => {});
  return { step: "done", user: { id: 0, name: phone } };
}

const soroushClientAuth: ProviderAuthDef = {
  title: "ورود با حساب سروش‌پلاس",
  description:
    "شماره‌ی حساب سروش‌پلاس را وارد کنید؛ کد از اپ سروش یا پیامک می‌آید. اگر حساب رمز دومرحله‌ای دارد، رمز را هم می‌پرسد. نشست روی همین سرور ذخیره می‌شود.",
  phoneField: "phone",
  sessionField: "session",
  async start(ctx, rawPhone, save) {
    const phone = normalizeSoroushPhone(rawPhone);
    if (!/^\+\d{10,15}$/.test(phone)) throw new ProviderError("شماره سروش معتبر نیست. نمونه: +989121234567 یا ۰۹۱۲۱۲۳۴۵۶۷");
    await disposePending();
    const client = createClient(ctx, "");
    try {
      await withTimeout(client.connect(), 30_000);
      const code = await withTimeout(client.sendCode(apiCredentials(), phone, false), 30_000);
      const tx = storePending(client, phone, code.phoneCodeHash);
      save({ phone });
      return {
        step: "code",
        transactionHash: tx,
        hint: code.isCodeViaApp ? "کد در اپ سروش ارسال شد." : "کد از طریق پیامک ارسال شد.",
      };
    } catch (err) {
      await client.disconnect().catch(() => {});
      throw friendlyError(err, "ارسال کد ورود سروش");
    }
  },
  async verifyCode(ctx, transactionHash, code, save) {
    const state = pendingAuth.get(transactionHash);
    if (!state) throw new ProviderError("درخواست ورود سروش منقضی شده؛ دوباره شماره را وارد کنید.");
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
      if (!(result instanceof ApiAuth.Authorization)) {
        throw new ProviderError("ورود سروش کامل نشد؛ دوباره تلاش کنید.");
      }
      pendingAuth.delete(transactionHash);
      return await finishLogin(state.client, state.phone, save);
    } catch (err) {
      const message = String((err as any)?.errorMessage ?? (err as any)?.message ?? err);
      if (/SESSION_PASSWORD_NEEDED/i.test(message)) {
        return { step: "password", transactionHash, hint: "این حساب رمز دومرحله‌ای دارد." };
      }
      throw friendlyError(err, "تأیید کد ورود سروش");
    }
  },
  async verifyPassword(_ctx, transactionHash, password, save) {
    const state = pendingAuth.get(transactionHash);
    if (!state) throw new ProviderError("درخواست ورود سروش منقضی شده؛ دوباره شماره را وارد کنید.");
    try {
      const client = state.client;
      const user = await withTimeout(
        client.signInWithPassword(apiCredentials(), {
          password: async () => String(password ?? ""),
          onError: async () => false,
        }),
        30_000,
      );
      if (!user) throw new ProviderError("رمز دومرحله‌ای سروش پذیرفته نشد.");
      pendingAuth.delete(transactionHash);
      return await finishLogin(client, state.phone, save);
    } catch (err) {
      throw friendlyError(err, "تأیید رمز دومرحله‌ای سروش");
    }
  },
  async logout(_ctx, save) {
    await disposePending();
    await resetSoroushClient();
    save({ session: "" });
    return { step: "done", hint: "از حساب سروش خارج شدید." };
  },
};

// ---------------------------------------------------------------- connection manager

interface Waiter {
  wake: () => void;
  fail: (err: Error) => void;
}

interface ManagedClient {
  session: string;
  client: SrooshClient;
  selfId: string;
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

export async function resetSoroushClient(): Promise<void> {
  const m = current;
  current = undefined;
  if (!m) return;
  m.closed = true;
  wakeAll(m, new ProviderError("اتصال سروش قطع شد"));
  await m.client.disconnect().catch(() => {});
}

function pushMessage(m: ManagedClient, message: IncomingMessage) {
  m.queue.push(message);
  if (m.queue.length > MAX_QUEUE) m.queue.splice(0, m.queue.length - MAX_QUEUE);
  const first = m.waiters.values().next().value as Waiter | undefined;
  first?.wake();
}

function toIncoming(m: ManagedClient, event: any): IncomingMessage | undefined {
  const msg = event?.message;
  if (!msg) return undefined;
  const chatId = String(event.chatId ?? msg.chatId ?? "");
  const messageId = String(msg.id ?? "");
  if (!chatId || !messageId) return undefined;
  const known = m.titles.get(chatId);
  const direction: IncomingMessage["direction"] = msg.out ? "out" : "in";
  if (direction === "out" && m.outgoing.has(messageId)) return undefined;
  const senderId = msg.senderId === undefined ? "" : String(msg.senderId);
  return {
    key: `${SOROUSH_CLIENT_ID}:${chatId}:${messageId}`,
    provider: SOROUSH_CLIENT_ID,
    chatId,
    chatTitle: known?.title,
    chatType: known?.type ?? chatTypeOfEvent(event),
    messageId,
    from: senderId ? { id: senderId } : undefined,
    text: msg.message ?? msg.text,
    kind: kindOfMessage(msg),
    date: isoDate(msg.date),
    direction,
    source: direction === "out" ? "account" : undefined,
  };
}

async function loadTitleIndex(m: ManagedClient): Promise<void> {
  try {
    const dialogs = await m.client.getDialogs({ limit: 100 });
    for (const d of dialogs) {
      const id = d.id === undefined ? "" : String(d.id);
      if (!id) continue;
      m.titles.set(id, {
        title: d.title || d.name || undefined,
        type: d.isUser ? "private" : d.isGroup ? "group" : d.isChannel ? "channel" : "unknown",
      });
    }
  } catch {
    // عنوان‌ها اختیاری‌اند
  }
}

function createManaged(ctx: ProviderContext, session: string): ManagedClient {
  const client = createClient(ctx, session);
  const m: ManagedClient = {
    session,
    client,
    selfId: "",
    queue: [],
    waiters: new Set(),
    titles: new Map(),
    outgoing: new Set(),
    closed: false,
  };
  client.addEventHandler(async (event: any) => {
    try {
      const incoming = toIncoming(m, event);
      if (incoming) pushMessage(m, incoming);
    } catch {
      // پیام بدشکل نباید حلقه را متوقف کند
    }
  }, new NewMessage({}));
  return m;
}

async function connectManaged(m: ManagedClient): Promise<void> {
  try {
    await withTimeout(m.client.connect(), CONNECT_TIMEOUT_MS);
    const me: any = await withTimeout(m.client.getMe(), 15_000);
    m.selfId = String(me?.id ?? "");
    await loadTitleIndex(m);
  } catch (err) {
    m.closed = true;
    await m.client.disconnect().catch(() => {});
    throw friendlyError(err, "اتصال به حساب سروش برقرار نشد");
  }
}

async function getManaged(ctx: ProviderContext): Promise<ManagedClient> {
  const session = ctx.config.session?.trim();
  if (!session) throw new ProviderError("اول با حساب سروش وارد شوید (دکمه‌ی «ورود با حساب سروش‌پلاس»).");
  if (current && current.session === session) {
    if (!current.closed) {
      if (current.connecting) await current.connecting;
      return current;
    }
    await resetSoroushClient();
  }

  await resetSoroushClient();
  const managed = createManaged(ctx, session);
  current = managed;
  managed.connecting = connectManaged(managed);
  try {
    await withTimeout(managed.connecting, CONNECT_TIMEOUT_MS);
    return managed;
  } catch (err) {
    if (current === managed) current = undefined;
    managed.closed = true;
    await managed.client.disconnect().catch(() => {});
    throw err instanceof ProviderError ? err : friendlyError(err, "اتصال به حساب سروش برقرار نشد");
  }
}

async function waitForMessage(m: ManagedClient, timeoutMs: number): Promise<void> {
  if (m.queue.length) return;
  if (m.closed) throw new ProviderError("اتصال سروش قطع شده است؛ دوباره وصل می‌شویم");
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
  if (m.closed && !m.queue.length) throw new ProviderError("اتصال سروش قطع شده است؛ دوباره وصل می‌شویم");
}

async function resolveTitles(m: ManagedClient, messages: IncomingMessage[]): Promise<void> {
  const missing = [...new Set(messages.map((x) => x.chatId))].filter((id) => !m.titles.get(id)?.title).slice(0, 5);
  await Promise.all(
    missing.map(async (chatId) => {
      try {
        const entity: any = await withTimeout(m.client.getEntity(chatId), 3_000);
        const title = titleOfEntity(entity);
        const type = entity?.className === "User" ? "private" : entity?.className === "Channel" ? "channel" : entity?.className === "Chat" ? "group" : "unknown";
        if (title) m.titles.set(chatId, { title, type });
      } catch {
        // عنوان اختیاری است
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

function messageFromHistory(m: ManagedClient, chatId: string, msg: any): IncomingMessage {
  const messageId = String(msg?.id ?? "");
  const known = m.titles.get(chatId);
  const direction: IncomingMessage["direction"] = msg?.out ? "out" : "in";
  const senderId = msg?.senderId === undefined ? "" : String(msg.senderId);
  return {
    key: `${SOROUSH_CLIENT_ID}:${chatId}:${messageId}`,
    provider: SOROUSH_CLIENT_ID,
    chatId,
    chatTitle: known?.title,
    chatType: known?.type ?? "unknown",
    messageId,
    from: senderId ? { id: senderId } : undefined,
    text: msg?.message ?? msg?.text,
    kind: kindOfMessage(msg),
    date: isoDate(msg?.date),
    direction,
    source: direction === "out" ? "account" : undefined,
  };
}

async function resolveEntity(client: SrooshClient, chatId: string): Promise<any> {
  try {
    return await client.getEntity(chatId);
  } catch {
    throw new ProviderError(`چتی با شناسه‌ی «${chatId}» پیدا نشد.`);
  }
}

async function sendWithMedia(
  client: SrooshClient,
  entity: any,
  value: string,
  opts: { expect?: "image"; filename?: string; caption?: string; forceDocument?: boolean },
) {
  if (!isUploadable(value)) throw new ProviderError("برای حساب سروش فقط لینک عمومی یا فایل انتخاب‌شده پشتیبانی می‌شود.");
  const media = await loadMedia(value, { expect: opts.expect, filename: opts.filename });
  const dir = await mkdtemp(join(tmpdir(), "diba-soroush-"));
  const safeName = media.filename.replace(/[\\/:*?"<>|]+/g, "_") || "file";
  const file = join(dir, safeName);
  try {
    await writeFile(file, Buffer.from(await media.blob.arrayBuffer()));
    const msg: any = await client.sendFile(entity, {
      file,
      caption: opts.caption,
      forceDocument: opts.forceDocument,
      parseMode: undefined,
    });
    return {
      ok: true,
      chat_id: String(msg?.chatId ?? ""),
      message_id: msg?.id === undefined ? undefined : String(msg.id),
      date: isoDate(msg?.date),
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------- provider

const chatId = z
  .string()
  .optional()
  .describe("Soroush chat id (numeric) or @username. If omitted, the default chat from settings is used.");

function spaceId(value: string): string {
  const id = String(value ?? "").trim();
  if (!id) throw new ProviderError("chat_id لازم است.");
  return id;
}

async function inputEntity(client: SrooshClient, id: string): Promise<any> {
  try {
    return await client.getInputEntity(id);
  } catch {
    throw new ProviderError(`چت «${id}» در سروش پیدا نشد.`);
  }
}

async function inputUsers(client: SrooshClient, ids: string[]): Promise<any[]> {
  const users = ids.map((x) => String(x).trim()).filter(Boolean);
  if (!users.length) throw new ProviderError("حداقل یک member لازم است.");
  return Promise.all(users.map((id) => inputEntity(client, id)));
}

async function createSpace(
  client: SrooshClient,
  kind: "group" | "channel",
  title: string,
  about: string | undefined,
  members: string[],
): Promise<any> {
  const Channels: any = (Api as any).channels;
  const result: any = await client.invoke(
    new Channels.CreateChannel({
      title,
      about: about ?? "",
      megagroup: kind === "group",
      broadcast: kind === "channel",
    }),
  );
  const chat = result?.chats?.[0];
  const id = chat?.id === undefined ? "" : String(chat.id);
  if (members.length && id) {
    const users = await inputUsers(client, members);
    await client.invoke(new Channels.InviteToChannel({ channel: await inputEntity(client, id), users }));
  }
  return {
    ok: true,
    chat_id: id,
    title: chat?.title ?? title,
    type: kind,
  };
}

async function editSpace(client: SrooshClient, id: string, title?: string, about?: string): Promise<any> {
  const Channels: any = (Api as any).channels;
  const channel = await inputEntity(client, id);
  if (title) await client.invoke(new Channels.EditTitle({ channel, title }));
  if (about !== undefined) {
    const Messages: any = (Api as any).messages;
    await client.invoke(new Messages.EditChatAbout({ peer: channel, about }));
  }
  return { ok: true, chat_id: id };
}

async function leaveSpace(client: SrooshClient, id: string): Promise<any> {
  const Channels: any = (Api as any).channels;
  await client.invoke(new Channels.LeaveChannel({ channel: await inputEntity(client, id) }));
  return { ok: true, chat_id: id };
}

async function deleteSpace(client: SrooshClient, id: string): Promise<any> {
  const Channels: any = (Api as any).channels;
  await client.invoke(new Channels.DeleteChannel({ channel: await inputEntity(client, id) }));
  return { ok: true, chat_id: id };
}

async function addMembers(client: SrooshClient, id: string, memberIds: string[]): Promise<any> {
  const Channels: any = (Api as any).channels;
  const users = await inputUsers(client, memberIds);
  await client.invoke(new Channels.InviteToChannel({ channel: await inputEntity(client, id), users }));
  return { ok: true, chat_id: id, added: users.length };
}

async function membersOf(client: SrooshClient, id: string, limit: number): Promise<any> {
  const Channels: any = (Api as any).channels;
  const result: any = await client.invoke(
    new Channels.GetParticipants({
      channel: await inputEntity(client, id),
      filter: new (Api as any).ChannelParticipantsRecent(),
      offset: 0,
      limit,
      hash: 0,
    }),
  );
  return {
    chat_id: id,
    count: result?.count,
    members: (result?.participants ?? []).map((p: any) => ({
      id: p?.userId === undefined ? undefined : String(p.userId),
      role: p?.className ?? undefined,
      admin_rights: p?.adminRights ?? undefined,
    })),
  };
}

export const soroushClient: ProviderDef = {
  id: SOROUSH_CLIENT_ID,
  name: "Soroush Client",
  nameFa: "سروش‌پلاس (حساب کاربری)",
  category: "messenger",
  color: "#2563eb",
  glyph: "ش",
  description: "اتصال به حساب شخصی سروش‌پلاس با شماره تلفن — ارسال و دریافت پیام مثل خود کاربر (MTProto خصوصی)",
  docsUrl: "https://web.splus.ir/",
  fields: [
    { key: "phone", label: "شماره تلفن", type: "text", placeholder: "۰۹۱۲۱۲۳۴۵۶۷", help: "برای ورود. بعد از ورود ذخیره می‌شود." },
    {
      key: "session",
      label: "نشست حساب (خودکار)",
      type: "secret",
      required: true,
      help: "با دکمه‌ی «ورود با حساب سروش‌پلاس» خودکار پر می‌شود. StringSession است.",
    },
    { key: "defaultChatId", label: "چت پیش‌فرض", type: "text", placeholder: "اختیاری — مثلاً 123456789" },
  ],
  auth: soroushClientAuth,
  test: async (ctx) => {
    const m = await getManaged(ctx);
    return publicEntity(await m.client.getMe());
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
      name: "soroush_client_get_me",
      title: "اطلاعات حساب سروش",
      description: "Get the profile of the Soroush Plus user account this server is logged in as.",
      input: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (_a, ctx) => {
        const m = await getManaged(ctx);
        return publicEntity(await m.client.getMe());
      },
    }),
    defineTool({
      name: "soroush_client_get_chat",
      title: "اطلاعات چت",
      description: "Get a Soroush user/group/channel by numeric id or @username.",
      input: { chat_id: z.string().describe("Numeric chat id or @username") },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        return publicEntity(await resolveEntity(m.client, a.chat_id.trim()));
      },
    }),
    defineTool({
      name: "soroush_client_send_message",
      title: "ارسال پیام با حساب سروش",
      description: "Send a text message from the logged-in Soroush Plus account to a user, group or channel.",
      input: {
        chat_id: chatId,
        text: z.string().min(1).max(4096).describe("Message text"),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const entity = await resolveEntity(m.client, chatIdOf(ctx, a.chat_id));
        const msg: any = await m.client.sendMessage(entity, { message: a.text, parseMode: undefined });
        const mid = msg?.id === undefined ? undefined : String(msg.id);
        if (mid) {
          m.outgoing.add(mid);
          if (m.outgoing.size > 200) {
            const first = m.outgoing.values().next().value;
            if (first) m.outgoing.delete(first);
          }
          m.queue = m.queue.filter((x) => x.messageId !== mid);
        }
        return { ok: true, chat_id: String(msg?.chatId ?? ""), message_id: mid, date: isoDate(msg?.date) };
      },
    }),
    defineTool({
      name: "soroush_client_send_photo",
      title: "ارسال عکس با حساب سروش",
      description: "Send a photo from a public URL or an uploaded file via the logged-in Soroush Plus account.",
      input: {
        chat_id: chatId,
        photo: mediaField("image", "The image"),
        caption: z.string().max(1024).optional(),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const entity = await resolveEntity(m.client, chatIdOf(ctx, a.chat_id));
        return sendWithMedia(m.client, entity, a.photo, { expect: "image", caption: a.caption });
      },
    }),
    defineTool({
      name: "soroush_client_send_file",
      title: "ارسال فایل با حساب سروش",
      description: "Send a file from a public URL or an uploaded file via the logged-in Soroush Plus account.",
      input: {
        chat_id: chatId,
        file: mediaField("file", "The file"),
        caption: z.string().max(1024).optional(),
        filename: z.string().optional(),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const entity = await resolveEntity(m.client, chatIdOf(ctx, a.chat_id));
        return sendWithMedia(m.client, entity, a.file, { caption: a.caption, filename: a.filename, forceDocument: true });
      },
    }),
    defineTool({
      name: "soroush_client_list_groups",
      title: "فهرست گروه‌ها",
      description: "List Soroush groups of the logged-in account.",
      input: { limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const dialogs = await m.client.getDialogs({ limit: a.limit ?? 50 });
        return {
          groups: dialogs
            .filter((d: any) => d.isGroup)
            .map((d: any) => ({ chat_id: String(d.id), title: d.title || d.name, type: "group", unread_count: d.unreadCount })),
        };
      },
    }),
    defineTool({
      name: "soroush_client_create_group",
      title: "ساخت گروه",
      description: "Create a Soroush group (supergroup), optionally with initial members.",
      input: {
        title: z.string().min(1).max(128),
        about: z.string().max(1024).optional(),
        member_ids: z.array(z.string()).optional(),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        return await createSpace(m.client, "group", a.title, a.about, a.member_ids ?? []);
      },
    }),
    defineTool({
      name: "soroush_client_group_members",
      title: "اعضای گروه",
      description: "List members of a Soroush group.",
      input: { chat_id: z.string(), limit: z.number().int().min(1).max(200).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        return await membersOf(m.client, spaceId(a.chat_id), a.limit ?? 100);
      },
    }),
    defineTool({
      name: "soroush_client_add_group_members",
      title: "افزودن عضو به گروه",
      description: "Add members to a Soroush group.",
      input: { chat_id: z.string(), member_ids: z.array(z.string()).min(1) },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        return await addMembers(m.client, spaceId(a.chat_id), a.member_ids);
      },
    }),
    defineTool({
      name: "soroush_client_edit_group",
      title: "ویرایش گروه",
      description: "Edit a Soroush group title/about.",
      input: { chat_id: z.string(), title: z.string().max(128).optional(), about: z.string().max(1024).optional() },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        if (!a.title && a.about === undefined) throw new ProviderError("title یا about لازم است.");
        return await editSpace(m.client, spaceId(a.chat_id), a.title, a.about);
      },
    }),
    defineTool({
      name: "soroush_client_leave_group",
      title: "خروج از گروه",
      description: "Leave a Soroush group.",
      input: { chat_id: z.string() },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => leaveSpace((await getManaged(ctx)).client, spaceId(a.chat_id)),
    }),
    defineTool({
      name: "soroush_client_delete_group",
      title: "حذف گروه",
      description: "Delete a Soroush group (owner only).",
      input: { chat_id: z.string() },
      annotations: { openWorldHint: true, destructiveHint: true },
      handler: async (a, ctx) => deleteSpace((await getManaged(ctx)).client, spaceId(a.chat_id)),
    }),
    defineTool({
      name: "soroush_client_list_channels",
      title: "فهرست کانال‌ها",
      description: "List Soroush channels of the logged-in account.",
      input: { limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const dialogs = await m.client.getDialogs({ limit: a.limit ?? 50 });
        return {
          channels: dialogs
            .filter((d: any) => d.isChannel)
            .map((d: any) => ({ chat_id: String(d.id), title: d.title || d.name, type: "channel", unread_count: d.unreadCount })),
        };
      },
    }),
    defineTool({
      name: "soroush_client_create_channel",
      title: "ساخت کانال",
      description: "Create a Soroush channel, optionally with initial members.",
      input: {
        title: z.string().min(1).max(128),
        about: z.string().max(1024).optional(),
        member_ids: z.array(z.string()).optional(),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        return await createSpace(m.client, "channel", a.title, a.about, a.member_ids ?? []);
      },
    }),
    defineTool({
      name: "soroush_client_channel_members",
      title: "اعضای کانال",
      description: "List members of a Soroush channel.",
      input: { chat_id: z.string(), limit: z.number().int().min(1).max(200).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        return await membersOf(m.client, spaceId(a.chat_id), a.limit ?? 100);
      },
    }),
    defineTool({
      name: "soroush_client_add_channel_members",
      title: "افزودن عضو به کانال",
      description: "Add members to a Soroush channel.",
      input: { chat_id: z.string(), member_ids: z.array(z.string()).min(1) },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        return await addMembers(m.client, spaceId(a.chat_id), a.member_ids);
      },
    }),
    defineTool({
      name: "soroush_client_edit_channel",
      title: "ویرایش کانال",
      description: "Edit a Soroush channel title/about.",
      input: { chat_id: z.string(), title: z.string().max(128).optional(), about: z.string().max(1024).optional() },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        if (!a.title && a.about === undefined) throw new ProviderError("title یا about لازم است.");
        return await editSpace(m.client, spaceId(a.chat_id), a.title, a.about);
      },
    }),
    defineTool({
      name: "soroush_client_leave_channel",
      title: "خروج از کانال",
      description: "Leave a Soroush channel.",
      input: { chat_id: z.string() },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => leaveSpace((await getManaged(ctx)).client, spaceId(a.chat_id)),
    }),
    defineTool({
      name: "soroush_client_delete_channel",
      title: "حذف کانال",
      description: "Delete a Soroush channel (owner only).",
      input: { chat_id: z.string() },
      annotations: { openWorldHint: true, destructiveHint: true },
      handler: async (a, ctx) => deleteSpace((await getManaged(ctx)).client, spaceId(a.chat_id)),
    }),
    defineTool({
      name: "soroush_client_get_chats",
      title: "فهرست گفتگوها",
      description: "List recent Soroush Plus chats (private chats, groups, channels) with chat id and last message.",
      input: { limit: z.number().int().min(1).max(100).optional().describe("Max chats (1-100), default 30") },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const dialogs = await m.client.getDialogs({ limit: a.limit ?? 30 });
        const chats = dialogs.map((d) => {
          const id = d.id === undefined ? "" : String(d.id);
          const title = d.title || d.name || undefined;
          const type = d.isUser ? "private" : d.isGroup ? "group" : d.isChannel ? "channel" : "unknown";
          if (id && title) m.titles.set(id, { title, type });
          return {
            chat_id: id,
            title,
            type,
            unread_count: d.unreadCount,
            last_message: d.message?.message ?? d.message?.text,
            last_date: isoDate(d.message?.date ?? d.date),
            last_direction: d.message?.out ? "out" : "in",
          };
        });
        return { dialogs: chats };
      },
    }),
    defineTool({
      name: "soroush_client_get_history",
      title: "تاریخچه‌ی گفتگو",
      description: "Read recent messages of a Soroush Plus chat (newest first).",
      input: {
        chat_id: z.string().describe("Numeric chat id or @username"),
        limit: z.number().int().min(1).max(100).optional().describe("Max messages (1-100), default 20"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const m = await getManaged(ctx);
        const entity = await resolveEntity(m.client, a.chat_id.trim());
        const messages = await m.client.getMessages(entity, { limit: a.limit ?? 20 });
        const mapped = messages.map((msg) => messageFromHistory(m, a.chat_id.trim(), msg));
        await resolveTitles(m, mapped);
        return { source: "history", chat_id: a.chat_id.trim(), messages: mapped };
      },
    }),
    defineTool({
      name: "soroush_client_get_updates",
      title: "دریافت پیام‌های جدید",
      description:
        "Read recent messages of the logged-in Soroush Plus account. With chat_id: history of that chat. Without chat_id: recent chats.",
      input: {
        chat_id: z.string().optional().describe("Only messages from this chat"),
        limit: z.number().int().min(1).max(100).optional().describe("Max messages (1-100), default 20"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        if (ctx.inbox) return { source: "inbox", messages: ctx.inbox.list({ chatId: a.chat_id, limit: a.limit ?? 20 }) };
        const m = await getManaged(ctx);
        if (a.chat_id) {
          const target = a.chat_id.trim();
          const entity = await resolveEntity(m.client, target);
          const messages = await m.client.getMessages(entity, { limit: a.limit ?? 20 });
          const mapped = messages.map((msg) => messageFromHistory(m, target, msg));
          await resolveTitles(m, mapped);
          return { source: "history", chat_id: target, messages: mapped };
        }
        const dialogs = await m.client.getDialogs({ limit: a.limit ?? 20 });
        return {
          source: "chats",
          chats: dialogs.map((d) => ({
            chat_id: d.id === undefined ? "" : String(d.id),
            title: d.title || d.name,
            last_message: d.message?.message ?? d.message?.text,
            last_date: isoDate(d.message?.date ?? d.date),
          })),
        };
      },
    }),
  ],
};
