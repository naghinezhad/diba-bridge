/**
 * اعتبارسنجی یک تریگر پیش از ذخیره.
 *
 * هر تریگر سه بخش دارد: «چه زمانی» (رویداد + شرط)، «چه کاری» (اقدام) و مشخصات (نام، دسته).
 * این فایل ورودی داشبورد را به شکل تمیز و کامل برمی‌گرداند یا با پیام فارسی و نام فیلد رد می‌کند.
 * فقط فیلدهایی که به همان نوع اقدام مربوط‌اند نگه داشته می‌شوند.
 */
import type { TriggerAction, TriggerActionType, TriggerCategory, TriggerDef, TriggerEvent, TriggerMatch } from "./triggers.js";

export const TRIGGER_EVENTS: TriggerEvent[] = ["incoming_message", "tool_called", "tool_error", "manual"];
export const TRIGGER_ACTIONS: TriggerActionType[] = ["reply_template", "ai_reply", "forward", "call_tool", "webhook"];
export const TRIGGER_CATEGORIES: TriggerCategory[] = ["social", "ai", "mcp", "forward", "webhook"];
const CHAT_TYPES = ["*", "private", "group", "channel"] as const;

/** دسته‌ی پیش‌فرض هر اقدام؛ وقتی کاربر دسته را مشخص نکرده باشد */
export const CATEGORY_OF_ACTION: Record<TriggerActionType, TriggerCategory> = {
  reply_template: "social",
  ai_reply: "ai",
  forward: "forward",
  call_tool: "mcp",
  webhook: "webhook",
};

/** اقدام‌هایی که به همان چتِ فرستنده پاسخ می‌دهند و بدون پیام ورودی مقصدی ندارند */
export const REPLY_ACTIONS: TriggerActionType[] = ["reply_template", "ai_reply"];

export const TRIGGER_LIMITS = { name: 80, description: 300, keywords: 500, text: 4000, toolArgs: 4000 } as const;

export class TriggerValidationError extends Error {
  constructor(message: string, public readonly field: string) {
    super(message);
    this.name = "TriggerValidationError";
  }
}

const fail = (field: string, message: string): never => {
  throw new TriggerValidationError(message, field);
};

function text(value: unknown, field: string, label: string, max: number, opts: { required?: boolean; multiline?: boolean } = {}): string {
  if (value !== undefined && value !== null && typeof value !== "string") fail(field, `${label} باید متن باشد`);
  const raw = typeof value === "string" ? value : "";
  const clean = (opts.multiline ? raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "") : raw.replace(/[\u0000-\u001f\u007f]/g, " ")).trim();
  if (opts.required && !clean) fail(field, `${label} را وارد کنید`);
  if (clean.length > max) fail(field, `${label} نباید بیشتر از ${max} کاراکتر باشد`);
  return clean;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string, label: string, fallback?: T): T {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) fail(field, `${label} نامعتبر است`);
  return value as T;
}

/** شناسه‌ی سرویس یا «*» */
function providerId(value: unknown, field: string, label: string, opts: { wildcard: boolean }): string {
  const v = text(value, field, label, 60) || (opts.wildcard ? "*" : "");
  if (!v) fail(field, `${label} را انتخاب کنید`);
  if (v === "*" && opts.wildcard) return v;
  if (!/^[a-z0-9_]+$/i.test(v)) fail(field, `${label} نامعتبر است`);
  return v;
}

/** آرگومان‌های ابزار باید پس از جای‌گذاری متغیرها یک شیء JSON باشند */
export function checkToolArgs(raw: string): void {
  if (!raw) return;
  let parsed: unknown;
  try {
    // متغیرها هنگام اجرا با متن جایگزین می‌شوند؛ برای بررسی ساختار، یک مقدار بی‌خطر به‌جایشان می‌نشیند
    parsed = JSON.parse(raw.replace(/\{\{\w+\}\}/g, "x"));
  } catch {
    fail("action.toolArgs", "آرگومان‌های ابزار JSON معتبر نیست");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("action.toolArgs", "آرگومان‌های ابزار باید یک شیء JSON باشد، مثل {\"text\":\"...\"}");
}

export function checkWebhookUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail("action.webhookUrl", "آدرس Webhook معتبر نیست");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") fail("action.webhookUrl", "آدرس Webhook باید با http یا https شروع شود");
  if (url.username || url.password) fail("action.webhookUrl", "آدرس Webhook نباید نام کاربری یا رمز داشته باشد");
  return url.toString();
}

function normalizeMatch(raw: unknown, event: TriggerEvent): TriggerMatch {
  const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (event === "incoming_message") {
    const match: TriggerMatch = {
      provider: providerId(m.provider, "match.provider", "پیام‌رسان", { wildcard: true }),
      chatType: oneOf(m.chatType, CHAT_TYPES, "match.chatType", "نوع گفتگو", "*"),
      contains: text(m.contains, "match.contains", "کلمات کلیدی", TRIGGER_LIMITS.keywords),
      toolName: "*",
    };
    const chatId = text(m.chatId, "match.chatId", "شناسه‌ی چت", 120);
    if (chatId) match.chatId = chatId;
    return match;
  }
  if (event === "manual") return { provider: "*", chatType: "*", contains: "", toolName: "*" };
  const toolName = text(m.toolName, "match.toolName", "الگوی نام ابزار", 200) || "*";
  if (!/^[a-z0-9_*,\s-]+$/i.test(toolName)) fail("match.toolName", "الگوی نام ابزار فقط می‌تواند حرف لاتین، عدد، _ ، * و ویرگول داشته باشد");
  return { provider: "*", chatType: "*", contains: "", toolName };
}

function normalizeAction(raw: unknown, event: TriggerEvent): TriggerAction {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const type = oneOf(a.type, TRIGGER_ACTIONS, "action.type", "نوع اقدام");
  if (REPLY_ACTIONS.includes(type) && event !== "incoming_message" && event !== "manual") {
    fail("action.type", "پاسخ به چت فقط برای رویداد «پیام ورودی» یا «اجرای دستی» ممکن است؛ برای رویدادهای ابزار، فوروارد، اجرای ابزار یا Webhook را انتخاب کنید");
  }
  switch (type) {
    case "reply_template":
      return { type, template: text(a.template, "action.template", "متن پاسخ", TRIGGER_LIMITS.text, { required: true, multiline: true }) };
    case "ai_reply":
      return { type, systemPrompt: text(a.systemPrompt, "action.systemPrompt", "دستورالعمل هوش مصنوعی", TRIGGER_LIMITS.text, { multiline: true }) };
    case "forward": {
      const action: TriggerAction = {
        type,
        targetProvider: providerId(a.targetProvider, "action.targetProvider", "سرویس مقصد", { wildcard: false }),
        template: text(a.template, "action.template", "متن پیام فوروارد", TRIGGER_LIMITS.text, { multiline: true }),
      };
      const chat = text(a.targetChatId, "action.targetChatId", "شناسه‌ی چت مقصد", 120);
      if (chat) action.targetChatId = chat;
      return action;
    }
    case "call_tool": {
      const toolName = text(a.toolName, "action.toolName", "نام ابزار", 120, { required: true });
      if (!/^[a-z0-9_]+$/i.test(toolName)) fail("action.toolName", "نام ابزار فقط می‌تواند حرف لاتین، عدد و _ داشته باشد");
      const toolArgs = text(a.toolArgs, "action.toolArgs", "آرگومان‌های ابزار", TRIGGER_LIMITS.toolArgs, { multiline: true });
      checkToolArgs(toolArgs);
      return { type, toolName, toolArgs };
    }
    case "webhook":
      return { type, webhookUrl: checkWebhookUrl(text(a.webhookUrl, "action.webhookUrl", "آدرس Webhook", 500, { required: true })) };
  }
}

export type TriggerInput = Pick<TriggerDef, "name" | "description" | "category" | "enabled" | "event" | "match" | "action">;

/** ورودی کامل یک تریگر را بررسی می‌کند و شکل قابل ذخیره‌ی آن را برمی‌گرداند */
export function normalizeTrigger(body: unknown): TriggerInput {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const name = text(b.name, "name", "نام اتوماسیون", TRIGGER_LIMITS.name, { required: true });
  if (name.length < 2) fail("name", "نام اتوماسیون خیلی کوتاه است");
  const event = oneOf(b.event, TRIGGER_EVENTS, "event", "رویداد");
  const action = normalizeAction(b.action, event);
  return {
    name,
    description: text(b.description, "description", "توضیح", TRIGGER_LIMITS.description),
    category: oneOf(b.category, TRIGGER_CATEGORIES, "category", "دسته‌بندی", CATEGORY_OF_ACTION[action.type]),
    enabled: b.enabled !== false,
    event,
    match: normalizeMatch(b.match, event),
    action,
  };
}
