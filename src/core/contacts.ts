/**
 * پیدا کردن مخاطب/چت با نام و ارزیابی کیفیت پیام قبل از ارسال.
 *
 * هدف: دستیار بتواند «به فلانی پیام بده» را خودش انجام دهد، اما بدون حدس‌زدن
 * و بدون ریسک ارسال به مخاطب/گروه اشتباه. ارسال واقعی در engine انجام می‌شود.
 */
import type { DibaMcpEngine } from "./engine.js";
import { matchName } from "./name-match.js";
import { normalizePersonName } from "./memory.js";

export interface RecipientCandidate {
  provider: string;
  chatId: string;
  title: string;
  type: string;
  username?: string;
  lastText?: string;
  lastAt?: string;
  source: "inbox" | "chats" | "contacts" | "dialogs" | "memory";
  score?: number;
}

export interface RecipientResolution {
  query: string;
  candidates: RecipientCandidate[];
  best?: RecipientCandidate;
  confidence: number;
  ambiguous: boolean;
  /** اگر تطبیق نامی نبود، نزدیک‌ترین چت‌های اخیر برگردانده شده‌اند */
  fallback?: boolean;
  reason?: string;
}

export interface MessageQuality {
  ok: boolean;
  score: number;
  reasons: string[];
  warnings: string[];
}

const PROVIDER_WORDS: Record<string, string[]> = {
  bale_client: ["bale", "بله"],
  eitaa_client: ["eitaa", "ایتا", "ایتایار"],
  rubika_client: ["rubika", "روبیکا"],
  soroush_client: ["soroush", "سروش", "سروش‌پلاس", "سروش پلاس"],
  telegram_client: ["telegram", "تلگرام"],
  whatsapp: ["whatsapp", "واتساپ", "واتس‌اپ", "واتس"],
};

const CHAT_TOOLS: Record<string, Array<{ tool: string; args: Record<string, unknown>; source: RecipientCandidate["source"] }>> = {
  bale_client: [{ tool: "bale_client_get_dialogs", args: { limit: 100 }, source: "dialogs" }],
  eitaa_client: [{ tool: "eitaa_client_get_chats", args: { limit: 100 }, source: "chats" }],
  rubika_client: [{ tool: "rubika_client_get_chats", args: { limit: 100 }, source: "chats" }],
  soroush_client: [{ tool: "soroush_client_get_chats", args: { limit: 100 }, source: "chats" }],
  telegram_client: [{ tool: "telegram_client_get_chats", args: { limit: 100 }, source: "chats" }],
  whatsapp: [
    { tool: "whatsapp_get_chats", args: { limit: 100 }, source: "chats" },
    { tool: "whatsapp_get_contacts", args: { limit: 300 }, source: "contacts" },
  ],
};

export const SEND_TOOLS: Record<string, string> = {
  bale_client: "bale_client_send_message",
  eitaa_client: "eitaa_client_send_message",
  rubika_client: "rubika_client_send_message",
  soroush_client: "soroush_client_send_message",
  telegram_client: "telegram_client_send_message",
  whatsapp: "whatsapp_send_message",
};

const DIR_CACHE_MS = 60_000;
const cache = new WeakMap<object, Map<string, { at: number; items: RecipientCandidate[] }>>();

function asArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  for (const key of ["dialogs", "chats", "contacts", "matches", "users", "result", "data"]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function timeValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCandidate(provider: string, raw: any, source: RecipientCandidate["source"]): RecipientCandidate | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const chatId = String(raw.chat_id ?? raw.chatId ?? raw.id ?? raw.jid ?? raw.peer_id ?? "").trim();
  if (!chatId) return undefined;
  const usernameRaw = raw.username ? String(raw.username).replace(/^@+/, "") : "";
  const title = String(
    raw.title ?? raw.name ?? raw.full_name ?? raw.notify ?? raw.push_name ?? (usernameRaw ? `@${usernameRaw}` : chatId),
  ).trim();
  const typeRaw = raw.type ?? raw.chat_type ?? raw.chatType ?? "unknown";
  const type =
    typeof typeRaw === "number"
      ? typeRaw === 1 || typeRaw === 4
        ? "private"
        : typeRaw === 2
          ? "group"
          : typeRaw === 3
            ? "channel"
            : "unknown"
      : String(typeRaw || "unknown").toLowerCase();
  return {
    provider,
    chatId,
    title: title || chatId,
    type,
    username: usernameRaw ? `@${usernameRaw}` : undefined,
    lastText: raw.last_message ?? raw.lastMessage ?? raw.last_text ?? raw.text,
    lastAt: raw.last_date ?? raw.lastAt ?? raw.last_message_at ?? raw.lastMessageAt ?? raw.timestamp ?? raw.date,
    source,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function mentionedProviders(query: string): string[] {
  const q = normalizePersonName(query);
  return Object.entries(PROVIDER_WORDS)
    .filter(([, words]) => words.some((w) => q.includes(normalizePersonName(w))))
    .map(([id]) => id);
}

function digits(value: string): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function isGroupLike(type: string): boolean {
  return !["private", "user", "dm", "direct", "unknown", ""].includes(String(type ?? "").toLowerCase());
}

function scoreCandidate(candidate: RecipientCandidate, query: string): number {
  const q = normalizePersonName(query);
  if (!q) return 0;
  // تطبیق آوایی فارسی/انگلیسی (عماد ↔ Emad) به‌جای مقایسه‌ی متنی
  const matched = matchName(query, [candidate.title, candidate.username]);
  let score = matched.score;

  const qDigits = digits(query);
  if (qDigits.length >= 6) {
    if (digits(candidate.chatId).includes(qDigits) || digits(candidate.title).includes(qDigits)) score = Math.max(score, 95);
  }
  if (candidate.source === "inbox") score += 4;
  if (candidate.source === "contacts") score += 3;
  if (candidate.source === "memory") score += 6;
  if (candidate.lastAt) {
    const age = Date.now() - timeValue(candidate.lastAt);
    if (Number.isFinite(age)) {
      if (age < 24 * 60 * 60_000) score += 8;
      else if (age < 7 * 24 * 60 * 60_000) score += 4;
    }
  }
  return Math.min(120, score);
}

function dedupe(items: RecipientCandidate[]): RecipientCandidate[] {
  const map = new Map<string, RecipientCandidate>();
  for (const item of items) {
    const key = `${item.provider}:${item.chatId}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, item);
      continue;
    }
    // اطلاعات کامل‌تر را نگه دار
    map.set(key, {
      ...prev,
      title: prev.title || item.title,
      username: prev.username || item.username,
      lastText: prev.lastText || item.lastText,
      lastAt: prev.lastAt || item.lastAt,
      type: prev.type !== "unknown" ? prev.type : item.type,
      source: prev.source === "inbox" ? prev.source : item.source,
    });
  }
  return [...map.values()];
}

async function collectCandidates(
  engine: DibaMcpEngine,
  opts: { provider?: string; force?: boolean } = {},
): Promise<RecipientCandidate[]> {
  const cacheKey = opts.provider ?? "all";
  const perEngine = cache.get(engine as object);
  const cached = perEngine?.get(cacheKey);
  if (!opts.force && cached && Date.now() - cached.at < DIR_CACHE_MS) return cached.items;

  const items: RecipientCandidate[] = [];
  for (const chat of engine.inbox.chats(opts.provider)) {
    items.push({
      provider: chat.provider,
      chatId: chat.chatId,
      title: chat.title || chat.chatId,
      type: chat.type,
      lastText: chat.lastText,
      lastAt: chat.lastDate,
      source: "inbox",
    });
  }

  const providers = engine.describeProviders().filter((p) => p.ready && (!opts.provider || p.id === opts.provider));
  const tasks: Array<Promise<void>> = [];
  for (const provider of providers) {
    const specs = CHAT_TOOLS[provider.id];
    if (!specs) continue;
    const toolNames = new Set(provider.tools.map((t) => t.name));
    for (const spec of specs) {
      if (!toolNames.has(spec.tool)) continue;
      tasks.push(
        withTimeout(engine.callTool(spec.tool, spec.args, "dashboard"), 8_000)
          .then((result) => {
            if (!result.ok) return;
            for (const raw of asArray(result.result)) {
              const candidate = normalizeCandidate(provider.id, raw, spec.source);
              if (candidate) items.push(candidate);
            }
          })
          .catch(() => undefined),
      );
    }
  }
  await Promise.all(tasks);

  const deduped = dedupe(items);
  const map = cache.get(engine as object) ?? new Map();
  cache.set(engine as object, map);
  map.set(cacheKey, { at: Date.now(), items: deduped });
  return deduped;
}

export function clearRecipientCache(engine?: DibaMcpEngine) {
  if (engine) cache.delete(engine as object);
  else {
    // WeakMap قابل پیمایش نیست؛ نمونه‌های جدید خودشان کش تازه می‌سازند
  }
}

const PLACEHOLDERS = /^(فلانی|یک نفر|یکی|همون|همان|طرف|مخاطب|someone|somebody)$/i;

export async function resolveRecipient(
  engine: DibaMcpEngine,
  query: string,
  opts: { provider?: string; force?: boolean } = {},
): Promise<RecipientResolution> {
  const clean = String(query ?? "").trim();
  if (!clean) return { query: clean, candidates: [], confidence: 0, ambiguous: false, reason: "نام مخاطب خالی است." };
  const placeholder = PLACEHOLDERS.test(normalizePersonName(clean));

  const mentioned = mentionedProviders(clean);
  const providerFilter = opts.provider || (mentioned.length === 1 ? mentioned[0] : undefined);
  const memoryCandidates: RecipientCandidate[] = engine.memory
    .findRecipients(clean, 8)
    .filter((r) => !providerFilter || r.provider === providerFilter)
    .map((r) => ({
      provider: r.provider,
      chatId: r.chatId,
      title: r.title,
      type: r.type ?? "unknown",
      username: r.aliases.find((a) => a.startsWith("@")),
      lastAt: r.lastUsed,
      source: "memory" as const,
    }));
  const collected = await collectCandidates(engine, { provider: providerFilter, force: opts.force });
  const readyProviders = new Set(engine.describeProviders().filter((p) => p.ready).map((p) => p.id));
  const sendable = new Set(Object.keys(SEND_TOOLS));
  const all = dedupe([...memoryCandidates, ...collected]).filter((c) => readyProviders.has(c.provider) && sendable.has(c.provider));

  // اگر سرویس مشخصی در متن آمده، فقط همان سرویس‌ها را در نظر بگیر
  let pool = all;
  if (!opts.provider && mentioned.length) {
    const filtered = all.filter((c) => mentioned.includes(c.provider));
    if (filtered.length) pool = filtered;
  }

  const scored = pool
    .map((c) => ({ ...c, score: scoreCandidate(c, clean) }))
    .filter((c) => (c.score ?? 0) >= 40)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || timeValue(b.lastAt) - timeValue(a.lastAt));

  let top = dedupe(scored).slice(0, 8);
  let fallback = false;
  if (!top.length) {
    // نام دقیق/مطابق پیدا نشد: نزدیک‌ترین چت‌های اخیر را برگردان تا کاربر انتخاب کند
    fallback = true;
    const includeGroups = /(گروه|کانال|group|channel)/i.test(clean);
    top = dedupe(
      pool
        .filter((c) => includeGroups || !isGroupLike(c.type))
        .sort((a, b) => timeValue(b.lastAt) - timeValue(a.lastAt))
        .slice(0, 6)
        .map((c) => ({ ...c, score: 20 })),
    );
  }

  const best = top[0];
  const ambiguous = Boolean(top.length > 1);
  const confidence = fallback ? 0 : ambiguous ? Math.min(best?.score ?? 0, 70) : (best?.score ?? 0);
  const reason = fallback
    ? placeholder
      ? "نام دقیق مشخص نیست؛ نزدیک‌ترین چت‌های اخیر را نشان می‌دهم."
      : "مخاطبی با این نام پیدا نشد؛ نزدیک‌ترین چت‌های اخیر را نشان می‌دهم."
    : !best
      ? "مخاطبی با این نام/شناسه پیدا نشد."
      : ambiguous
        ? "چند مخاطب نزدیک پیدا شد؛ باید یکی انتخاب شود."
        : confidence < 60
          ? "تطبیق نام با اطمینان کافی انجام نشد."
          : undefined;

  return { query: clean, candidates: top, best, confidence, ambiguous, fallback, reason };
}

/**
 * ارزیابی کیفیت پیام برای کاهش ریسک بن و حفظ کیفیت.
 * این تابع عمداً سخت‌گیر است؛ مدل در صورت رد شدن، متن را بازنویسی می‌کند.
 */
export function checkMessageQuality(
  text: string,
  opts: { allowLinks?: boolean; firstContact?: boolean } = {},
): MessageQuality {
  const clean = String(text ?? "").trim();
  const reasons: string[] = [];
  const warnings: string[] = [];
  let score = 100;

  if (clean.length < 2) reasons.push("متن پیام خالی یا خیلی کوتاه است.");
  if (clean.length > 1500) reasons.push("متن پیام بیش از حد بلند است (حداکثر ۱۵۰۰ کاراکتر).");
  if (!/[\p{L}\p{N}]/u.test(clean)) reasons.push("پیام باید حداقل یک حرف یا عدد داشته باشد.");
  if (/(.)\1{7,}/u.test(clean)) reasons.push("کاراکترهای تکراری زیاد در متن هست.");
  if (/(\b\S+\b)(?:\s+\1){3,}/iu.test(clean)) reasons.push("یک عبارت چند بار پشت‌سرهم تکرار شده است.");
  const upper = clean.replace(/[^A-Za-z]/g, "");
  if (upper.length >= 20 && upper === upper.toUpperCase()) {
    reasons.push("متن تماماً با حروف بزرگ انگلیسی نوشته شده است.");
  }

  const links = (clean.match(/https?:\/\//gi) ?? []).length;
  if (links > 2) reasons.push("بیش از دو لینک در پیام هست.");
  if (links > 0 && !opts.allowLinks) reasons.push("لینک ناخواسته در پیام هست؛ اگر لازم است allow_links را true کن.");
  const spam = /(کلیک کنید|همین حالا ثبت.?نام|جایزه|قرعه.?کشی|تخفیف ویژه|click here|free prize|limited offer)/iu.test(clean);
  if (spam && links > 0) reasons.push("الگوی پیام تبلیغاتی/اسپم تشخیص داده شد.");

  if (/^(سلام|درود|سلام خوبی|سلام وقت بخیر|hi|hello|hey)[!؟.،\s]*$/iu.test(clean)) {
    reasons.push("پیام فقط سلام است؛ یک پیام طبیعی و مشخص بنویس (منظور، دلیل یا ادامه‌ی گفتگو).");
  }
  if (opts.firstContact && clean.length < 10) reasons.push("اولین پیام به این مخاطب خیلی کوتاه است؛ کمی زمینه بده.");

  if (reasons.length) score = Math.max(0, 60 - reasons.length * 15);
  else if (warnings.length) score = 85;
  return { ok: reasons.length === 0, score, reasons, warnings };
}
