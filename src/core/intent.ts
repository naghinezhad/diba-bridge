/**
 * تشخیص نیت از یک جمله‌ی ساده‌ی فارسی/انگلیسی.
 *
 * هدف: «به عماد داخل تلگرام پیام بده که فردا جلسه داریم» باید بدون هیچ
 * سؤال اضافه‌ای به {action: send, provider: telegram, person: عماد,
 * message: فردا جلسه داریم} تبدیل شود.
 *
 * این ماژول به موتور وابسته نیست؛ فهرست واژه‌های هر سرویس از بیرون داده می‌شود.
 */
import { cleanText, foldName } from "./name-match.js";

export type AssistantAction =
  | "status"
  | "list_chats"
  | "read"
  | "find"
  | "send"
  | "confirm"
  | "cancel"
  | "capabilities"
  | "unknown";

export interface ProviderWord {
  id: string;
  words: string[];
}

export interface ParsedRequest {
  action: AssistantAction;
  raw: string;
  /** شناسه‌ی سرویس‌هایی که در متن صریح آمده‌اند */
  providerHints: string[];
  /** نام/نام کاربری/شماره‌ی مخاطب */
  person?: string;
  /** متن یا خواسته‌ی پیام (بعد از «که/that/saying/…») */
  message?: string;
  media?: "photo" | "file" | "video" | "location";
  allowGroup: boolean;
  /** شماره‌ی گزینه در پاسخ به فهرست قبلی */
  selection?: number;
  /** نام گزینه‌ای که کاربر با اسم انتخاب کرده */
  selectionName?: string;
}

const FA = /[\u0600-\u06FF]/;
const ORDINALS: Array<[RegExp, number]> = [
  [/^(?:اول|اولی|یک|یکم|first)$/i, 0],
  [/^(?:دوم|دومی|دو|دومین|second)$/i, 1],
  [/^(?:سوم|سومی|سه|سومین|third)$/i, 2],
  [/^(?:چهارم|چهارمی|چهار|fourth)$/i, 3],
  [/^(?:پنجم|پنجمی|پنج|fifth)$/i, 4],
  [/^(?:ششم|ششمی|شش|sixth)$/i, 5],
];

const FILLERS = [
  "لطفا",
  "لطفاً",
  "سریع",
  "الان",
  "همین حالا",
  "یه",
  "یک",
  "پیام",
  "مسیج",
  "پیامک",
  "متن",
  "رو",
  "را",
  "هم",
  "please",
  "quickly",
  "now",
  "a",
  "the",
  "message",
  "msg",
  "text",
  "dm",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** عبارت‌های سرویس را از متن حذف می‌کند («داخل تلگرام»، «on WhatsApp»، …) */
export function stripProviderWords(text: string, providers: ProviderWord[]): string {
  let out = cleanText(text);
  const words = providers
    .flatMap((p) => p.words.map((word) => ({ word: cleanText(word), id: p.id })))
    .filter((w) => w.word.length >= 2)
    .sort((a, b) => b.word.length - a.word.length);
  for (const { word } of words) {
    const pattern = new RegExp(
      `(?:^|\\s)(?:در|توی|تو|داخل|از\\s*طریق|با|روی|واسه|برای|on|in|via|through|inside|at)\\s+(?:the\\s+)?${escapeRegExp(word)}(?=[\\s،,.!?؛:»"']|$)`,
      "giu",
    );
    out = out.replace(pattern, " ");
    // «چت‌های تلگرام»، «پیام‌های تلگرام»
    const bare = new RegExp(`(?:^|\\s)${escapeRegExp(word)}(?=[\\s،,.!?؛:»"']|$)`, "giu");
    out = out.replace(bare, " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

export function detectProviderHints(text: string, providers: ProviderWord[]): string[] {
  const folded = ` ${foldName(text)} `;
  const hits = new Set<string>();
  for (const p of providers) {
    for (const word of p.words) {
      const w = foldName(word);
      if (w.length < 2) continue;
      if (folded.includes(` ${w} `) || folded.includes(` ${w}`)) hits.add(p.id);
    }
  }
  return [...hits];
}

function isCancelText(text: string): boolean {
  const t = cleanText(text).replace(/[،,.!?؛:]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return t.length <= 24 && /^(?:نه|خیر|لغو|انصراف|بیخیال|بی خیال|کنسل|cancel|no|stop|never mind)$/.test(t);
}

function isConfirmText(text: string): boolean {
  const t = cleanText(text).replace(/[،,.!?؛:]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return (
    t.length <= 40 &&
    /^(?:بله|آره|اره|تایید|تأیید|تایید می.?کنم|تأیید می.?کنم|بفرست|ارسال کن|بفرستش|همینه|همین|اوکی|باشه|ok|okay|yes|yep|send|send it|confirm|confirmed|do it|go ahead)(?:\s+(?:بفرست|ارسال کن|باشه|کن|it))?$/.test(
      t,
    )
  );
}

function selectionOf(text: string): { index?: number } {
  const t = cleanText(text).replace(/[،,.!?؛:]/g, " ").replace(/\s+/g, " ").trim();
  const cleaned = t
    .replace(/^(?:همون|همان|گزینه|مورد|شماره|option|number)\s*/i, "")
    .replace(/\s*(?:رو|را|هم|رو بفرست)$/i, "")
    .trim();
  const numeric = cleaned.match(/^([1-9])$/);
  if (numeric) return { index: Number(numeric[1]) - 1 };
  for (const [re, index] of ORDINALS) if (re.test(cleaned)) return { index };
  return {};
}

/** حذف کلمات پرکننده از ابتدا/انتها */
function tidyName(value: string): string {
  let out = cleanText(value)
    .replace(/^[\s,،.!؟:؛«»"'“”]+|[\s,،.!؟:؛«»"'“”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const filler = new RegExp(`^(?:${FILLERS.map(escapeRegExp).join("|")})\\s+`, "iu");
  for (let i = 0; i < 4 && filler.test(out); i++) out = out.replace(filler, "");
  out = out.replace(/\s+(?:رو|را)$/u, "").trim();
  return out.slice(0, 64);
}

/**
 * جدا کردن متن پیام از نام.
 * «\b» در جاوااسکریپت برای فارسی کار نمی‌کند، پس با توکن و فاصله کار می‌کنیم.
 */
function extractMessageTail(text: string): { head: string; tail?: string } {
  const tokens = cleanText(text).split(" ").filter(Boolean);
  const markers = new Set(["که", "that", "saying", "telling"]);
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i].replace(/^[\s,،.:؛]+|[\s,،.:؛]+$/g, "").toLowerCase();
    if (!markers.has(token)) continue;
    const head = tokens.slice(0, i).join(" ").replace(/[\s,،.:؛]+$/, "");
    const tail = tokens
      .slice(i + 1)
      .join(" ")
      .replace(/^[\s,،.:؛]+|[\s,،.!؟:؛«»"'“”]+$/g, "")
      .trim();
    return { head, tail: tail || undefined };
  }
  const colon = cleanText(text).match(/^([^:]{2,}?)\s*:\s*(.+)$/);
  if (colon) return { head: colon[1], tail: colon[2].trim() };
  return { head: cleanText(text) };
}

/** پاک‌سازی بخش نام: فعل‌ها، حرف اضافه‌ها و حروف تعریف */
function cleanPersonPart(value: string): string {
  let out = cleanText(value)
    .replace(/(?:پیام|پیامک|مسیج|متن)\s*(?:بده|بفرست|بفرستید|بدید|بدهید)/giu, " ")
    .replace(/(?:^|\s)(?:send|message|text|dm|ping|tell|write)(?=\s|$)/giu, " ")
    .replace(/(?:^|\s)(?:بفرستید|بفرست|بفرستش|ارسال\s*کن|بگویید|بگید|بگو|بدهید|بده)(?=\s|$)/giu, " ")
    .replace(/(?:^|\s)(?:a|an|the|message|msg|text|to|for|به|برای)(?=\s|$)/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
  // چند بار تمیزکاری، چون حذف یک کلمه ممکن است کلمه‌ی پرکننده‌ی بعدی را اول خط بیاورد
  out = out.replace(/^(?:a|an|the|to|for|به|برای)\s+/iu, "").trim();
  return out;
}

const SEND_PATTERN =
  /(?:پیام|پیامک|مسیج|متن)\s*(?:بده|بفرست|بفرستید|بدید|بدهید)|(?:بفرست|بفرستید|ارسال\s*کن|بگو|بگویید|بگید|خبر\s*بده|اطلاع\s*بده)|\b(?:send|message|text|dm|tell|ping|write\s+to)\b/iu;

const READ_PATTERN =
  /(?:پیام\s*ها(?:ی|یم|یت)?|پیامها(?:ی)?|پیام\s*های|تاریخچه|آخرین\s*پیام|بخوان|بخون|نشان\s*بده|show|read|last\s+messages?|history|messages)/iu;
const LIST_PATTERN = /(?:لیست|فهرست|همه|چت\s*ها|چتها|چتهای|گفتگوها|گفتگوها|مخاطبین|contacts?|chats?|conversations|inbox)/iu;
const STATUS_PATTERN = /(?:وضعیت|status|سرویس|services?|آماده|ready|کدام\s*سرویس|چه\s*سرویسی|اتصال)/iu;
const CAPABILITY_PATTERN = /(?:چه\s*کار|چه\s*کاری|قابلیت|توانایی|امکانات|capabilit|what\s+can\s+you|help|راهنما|چیکار)/iu;

function detectMedia(text: string): ParsedRequest["media"] {
  if (/(?:عکس|تصویر|photo|image|picture)/iu.test(text)) return "photo";
  if (/(?:ویدیو|فیلم|video)/iu.test(text)) return "video";
  if (/(?:فایل|سند|document|file)/iu.test(text)) return "file";
  if (/(?:لوکیشن|موقعیت|مکان|location)/iu.test(text)) return "location";
  return undefined;
}

/**
 * ورودی خام + فهرست سرویس‌ها → نیت.
 * خروجی محافظه‌کارانه است: اگر مطمئن نبود، action=unknown تا دستیار سؤال کند.
 */
export function parseRequest(raw: string, providers: ProviderWord[] = []): ParsedRequest {
  const text = cleanText(raw);
  const base: ParsedRequest = {
    action: "unknown",
    raw: text,
    providerHints: [],
    allowGroup: /(?:گروه|کانال|group|channel)/iu.test(text),
  };
  if (!text) return base;

  const withoutProviders = stripProviderWords(text, providers);
  const providerHints = detectProviderHints(text, providers);
  const selection = selectionOf(withoutProviders || text);

  if (isCancelText(text)) return { ...base, action: "cancel" };
  if (isConfirmText(text)) return { ...base, action: "confirm" };
  if (selection.index !== undefined) {
    return { ...base, action: "find", providerHints, selection: selection.index };
  }

  if (CAPABILITY_PATTERN.test(text) && !SEND_PATTERN.test(text) && !READ_PATTERN.test(text)) {
    return { ...base, action: "capabilities", providerHints };
  }
  if (STATUS_PATTERN.test(text) && !SEND_PATTERN.test(text) && !READ_PATTERN.test(text)) {
    return { ...base, action: "status", providerHints };
  }
  if (READ_PATTERN.test(text) && !/^(?:به|برای)/u.test(withoutProviders) && !SEND_PATTERN.test(withoutProviders)) {
    const stripped = withoutProviders
      .replace(new RegExp(READ_PATTERN.source, "giu"), " ")
      .replace(new RegExp(READ_PATTERN.source, "giu"), " ")
      .replace(/^(?:از|از\s+طرف|for|from)\s+/iu, " ")
      .replace(/\s+/g, " ")
      .trim();
    const person = tidyName(cleanPersonPart(stripped));
    return { ...base, action: "read", providerHints, person: person && !isPlaceholder(person) ? person : undefined };
  }
  if (LIST_PATTERN.test(text) && !SEND_PATTERN.test(withoutProviders)) {
    return { ...base, action: "list_chats", providerHints };
  }

  if (!SEND_PATTERN.test(text)) {
    // «عماد» تنها یا «عماد در تلگرام» → جستجوی مخاطب
    const bare = tidyName(withoutProviders);
    if (bare && !isPlaceholder(bare) && bare.split(" ").length <= 4) {
      return { ...base, action: "find", providerHints, person: bare };
    }
    return { ...base, action: "unknown", providerHints };
  }

  const { head, tail } = extractMessageTail(withoutProviders);
  let person = "";
  let message = tail;

  // «به X بگو …» — متن بعد از فعل می‌آید
  const tellMatch = head.match(/^(?:به|برای|to|for)\s+(.+?)\s+(?:بگو|بگویید|بگید|say|tell)\s*(.*)$/iu);
  if (tellMatch) {
    person = tellMatch[1];
    const after = tellMatch[2]?.trim();
    if (after) message = after;
  } else {
    person = tidyName(cleanPersonPart(head));
  }

  person = tidyName(person);
  if (isPlaceholder(person)) person = "";
  message = message ? message.slice(0, 1500) : undefined;

  const media = detectMedia(text);
  return {
    ...base,
    action: "send",
    providerHints,
    person: person || undefined,
    message,
    media,
  };
}

function isPlaceholder(value: string): boolean {
  const v = foldName(value).replace(/^(?:به|برای)\s+/, "").trim();
  if (!v) return true;
  return /^(?:من|خودم|ما|شما|او|ایشون|همه|یکی|یک\s*نفر|someone|somebody|me|myself|him|her|them)$/u.test(v);
}

/** آیا متن فقط سلام/تشکر است؟ */
export function isSmallTalk(text: string): boolean {
  const t = cleanText(text).replace(/[!؟.،\s]/g, "");
  return /^(?:سلام|درود|سلامعلیکم|وقتبخیر|صبحبخیر|شببخیر|ممنون|مرسی|تشکر|hi|hello|hey|thanks|thankyou|sup)$/iu.test(t);
}

export function hasPersian(text: string): boolean {
  return FA.test(text);
}
