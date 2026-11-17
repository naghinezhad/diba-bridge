import { cleanText, foldName } from "./name-match.js";
import { isCancelText, isConfirmText, selectionIndex } from "./text.js";

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
  providerHints: string[];
  person?: string;
  message?: string;
  media?: "photo" | "file" | "video" | "location";
  allowGroup: boolean;
  refersToLast?: boolean;
  selection?: number;
}

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

export function stripProviderWords(text: string, providers: ProviderWord[], bare = true): string {
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
    if (!bare) continue;
    const bareWord = new RegExp(`(?:^|\\s)${escapeRegExp(word)}(?=[\\s،,.!?؛:»"']|$)`, "giu");
    out = out.replace(bareWord, " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

export function detectProviderHints(text: string, providers: ProviderWord[]): string[] {
  const folded = ` ${foldName(text)} `;
  const tokens = folded.trim().split(" ");
  const hits = new Set<string>();
  for (const p of providers) {
    for (const word of p.words) {
      const w = foldName(word);
      if (w.length < 2) continue;
      const whole = folded.includes(` ${w} `);
      const suffixed = w.length >= 4 && tokens.some((token) => token.startsWith(w) && token.length - w.length <= 2);
      if (whole || suffixed) hits.add(p.id);
    }
  }
  return [...hits];
}

export function splitProviderHint(text: string, providers: ProviderWord[]): { name: string; provider?: string } {
  const stripped = stripProviderWords(text, providers);
  if (!stripped) return { name: cleanText(text) };
  const hints = detectProviderHints(text, providers);
  return { name: stripped, provider: hints.length === 1 ? hints[0] : undefined };
}

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

function cleanPersonPart(value: string): string {
  let out = cleanText(value)
    .replace(/(?:پیام|پیامک|مسیج|متن)\s*(?:بده|بفرست|بفرستید|بدید|بدهید)/giu, " ")
    .replace(/(?:^|\s)(?:send|message|text|dm|ping|tell|write)(?=\s|$)/giu, " ")
    .replace(/(?:^|\s)(?:بفرستید|بفرست|بفرستش|ارسال\s*کن|بگویید|بگید|بگو|بدهید|بده)(?=\s|$)/giu, " ")
    .replace(/(?:^|\s)(?:a|an|the|message|msg|text|to|for|به|برای)(?=\s|$)/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function originalSpelling(raw: string, message: string | undefined): string | undefined {
  if (!message) return message;
  const source = String(raw ?? "").replace(/\s*\n\s*/g, " ").trim();
  const trailing = /[\s.!؟?،,؛:»"'“”]+$/u;
  const target = message.replace(trailing, "");
  for (let i = 0; i < source.length; i++) {
    if (i > 0 && !/\s/.test(source[i - 1])) continue;
    const candidate = source.slice(i).replace(/^[\s:،,«"'“”]+/u, "");
    if (cleanText(candidate).replace(trailing, "") === target) return candidate.replace(trailing, "").slice(0, 1500);
  }
  return message;
}

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
  const selection = selectionIndex(withoutProviders || text);

  if (isCancelText(text)) return { ...base, action: "cancel" };
  if (isConfirmText(text)) return { ...base, action: "confirm" };
  if (selection !== undefined) {
    return { ...base, action: "find", providerHints, selection };
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
    const bare = tidyName(withoutProviders);
    if (bare && !isPlaceholder(bare) && bare.split(" ").length <= 4) {
      return { ...base, action: "find", providerHints, person: bare };
    }
    return { ...base, action: "unknown", providerHints };
  }

  const pronoun =
    withoutProviders.match(/^(?:بهش|براش|واسش|به‌ش|(?:به|برای|واسه)\s+(?:او|اون|ایشون|ایشان|همون|همان))(?:\s+(.*))?$/u) ??
    withoutProviders.match(/^(?:please\s+)?(?:tell|message|text|dm|ping|send)\s+(?:him|her|them)(?:\s+(.*))?$/iu);
  if (pronoun) {
    const rest = cleanText(pronoun[1] ?? "")
      .replace(/^(?:(?:یه|یک)\s+)?(?:(?:پیام|پیامک|مسیج|متن)\s*)?(?:بده|بفرست|بفرستید|بنویس|بگو|بگویید|بگید|خبر\s*بده|اطلاع\s*بده)(?=\s|$)/u, "")
      .replace(/^(?:a\s+)?(?:message|text)(?=\s|$)/iu, "")
      .trim()
      .replace(/^(?:که|that|saying)(?=\s|$)/iu, "")
      .replace(/^[\s:،,]+/u, "")
      .trim();
    return {
      ...base,
      action: "send",
      providerHints,
      refersToLast: true,
      message: originalSpelling(raw, rest ? rest.slice(0, 1500) : undefined),
      media: detectMedia(text),
    };
  }

  const split = (source: string): { person: string; message?: string } => {
    const { head, tail } = extractMessageTail(source);
    let who = "";
    let what = tail;
    const tellMatch = head.match(/^(?:به|برای|to|for)\s+(.+?)\s+(?:بگو|بگویید|بگید|say|tell)\s*(.*)$/iu);
    if (tellMatch) {
      who = tellMatch[1];
      const after = tellMatch[2]?.trim();
      if (after) what = after;
    } else {
      who = tidyName(cleanPersonPart(head));
    }
    who = tidyName(who);
    return { person: isPlaceholder(who) ? "" : who, message: what };
  };

  let { person, message } = split(withoutProviders);
  let hints = providerHints;
  if (!person && providerHints.length) {
    const retry = split(stripProviderWords(text, providers, false));
    if (retry.person) {
      person = retry.person;
      message = retry.message;
      const asName = foldName(person);
      hints = providerHints.filter((id) => !providers.find((p) => p.id === id)?.words.some((word) => foldName(word) === asName));
    }
  }
  message = originalSpelling(raw, message ? message.slice(0, 1500) : undefined);

  const media = detectMedia(text);
  return {
    ...base,
    action: "send",
    providerHints: hints,
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

