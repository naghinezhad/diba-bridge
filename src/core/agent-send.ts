/**
 * مسیر «به [نام] پیام بده» برای دستیار.
 *
 * نام/بخشی از نام را از متن بیرون می‌کشد، نزدیک‌ترین مخاطبین را پیدا می‌کند،
 * متن پیشنهادی را با مدل می‌سازد و **بدون ارسال** منتظر انتخاب/تأیید کاربر می‌ماند.
 */
import { checkMessageQuality, isGroupLike } from "./contacts.js";
import { dibaRouterChat, type DibaRouterConfig } from "./dibarouter.js";
import type { DibaMcpEngine } from "./engine.js";
import { normalizePersonName, providerLabel, publicTitle } from "./memory.js";

export interface SendIntent {
  recipient: string;
  instruction: string;
  raw: string;
}

export interface AgentSendTraceItem {
  name: string;
  args: unknown;
  ok: boolean;
  ms?: number;
  error?: string;
  preloaded?: boolean;
}

export interface AgentSendResult {
  ok: boolean;
  reply: string;
  toolTrace: AgentSendTraceItem[];
  text?: string;
  pending?: boolean;
  actions?: Array<{ label: string; value: string }>;
}

function cleanName(value: string): string {
  return String(value ?? "")
    .replace(/^[\s«"'“”]+|[\s»"'“”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanMessage(value: string): string {
  return String(value ?? "")
    .replace(/^[\s"'«“”]+|[\s"'»“”]+$/g, "")
    .replace(/^(?:متن پیام|پیام|message)\s*[:：]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);
}

/** الگوهای واضح «به X پیام بده/بفرست/بگو» را تشخیص می‌دهد. */
export function parseSendIntent(text: string): SendIntent | undefined {
  const raw = String(text ?? "").trim();
  if (!raw) return undefined;
  // جمله‌ی پرسشی را دستور ارسال تلقی نکن
  if (/[؟?]\s*$/.test(raw) || /^(?:آیا|ایا)\b/i.test(raw)) return undefined;
  const patterns = [
    /(?:^|\s)(?:به|برای)\s+(?<name>[^،.!؟]{2,60}?)\s*[،,]?\s+پیام\s*(?:بده|بفرست|بفرستد|بدهد)(?=\s|$|[،.!؟])\s*(?:که|:)?\s*(?<instruction>[\s\S]*)$/i,
    /(?:^|\s)(?:پیام|پیامک)\s*(?:را)?\s*(?:به|برای)\s+(?<name>[^،.!؟]{2,60}?)\s*[،,]?\s+(?:بده|بفرست)(?=\s|$|[،.!؟])\s*(?:که|:)?\s*(?<instruction>[\s\S]*)$/i,
    /(?:^|\s)(?:به|برای)\s+(?<name>[^،.!؟]{2,60}?)\s*[،,]?\s+بگو(?=\s|$|[،.!؟])\s*(?:که|:)?\s*(?<instruction>[\s\S]*)$/i,
    /(?:^|\s)(?:پیام|پیامک)\s*(?:بده|بفرست)\s*(?:به|برای)\s+(?<rest>.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    let nameRaw = match?.groups?.name ?? "";
    let instructionRaw = match?.groups?.instruction ?? "";
    if (!nameRaw && match?.groups?.rest) {
      const parts = String(match.groups.rest).split(/\s+که\s+|:\s*/);
      nameRaw = parts[0] ?? "";
      instructionRaw = parts.slice(1).join(" که ");
    }
    const name = cleanName(nameRaw);
    if (!name || /^(من|خودم|ما|همه|شما)$/i.test(name)) continue;
    const instruction = String(instructionRaw)
      .replace(/^[\s،,:؛]+/, "")
      .trim();
    return { recipient: name, instruction, raw };
  }
  return undefined;
}

async function composeMessage(
  engine: DibaMcpEngine,
  config: DibaRouterConfig,
  intent: SendIntent,
  recipient: { title: string; lastText?: string },
  previous?: { text: string; reasons: string[] },
  signal?: AbortSignal,
): Promise<string> {
  const name = publicTitle(recipient.title);
  const memory = engine.memory.promptContext(`${name} ${intent.instruction}`);
  const system =
    "تو دستیار فارسی دیبا هستی. فقط متن نهایی پیام را بنویس؛ بدون توضیح، عنوان یا گیومه.\n" +
    "پیام باید طبیعی، کوتاه (حداکثر ۳ جمله) و متناسب با رابطه و آخرین گفتگو باشد.\n" +
    "اگر کاربر متن مشخصی خواسته، همان معنا را حفظ کن و جزئیات (زمان، مکان، عدد، لینک) را تغییر نده.\n" +
    "از «سلام» تنها، متن تبلیغاتی، لینک ناخواسته و ایموجی زیاد پرهیز کن.";
  const user = [
    `مخاطب: ${name}`,
    recipient.lastText ? `آخرین پیام/موضوع: ${recipient.lastText}` : "",
    intent.instruction
      ? `خواسته‌ی کاربر: ${intent.instruction}`
      : "خواسته‌ی کاربر: یک پیام کوتاه، محترمانه و طبیعی برای شروع یا ادامه‌ی گفتگو بنویس.",
    memory ? `حافظه:\n${memory}` : "",
    previous ? `متن قبلی رد شد: ${previous.reasons.join(" ")}. آن را اصلاح کن.` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const out = await dibaRouterChat(
    config,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { maxTokens: 400, temperature: 0.55, signal },
  );
  return cleanMessage(out.reply);
}

function displayName(candidate: { title: string; type: string }): string {
  return publicTitle(candidate.title, candidate.type);
}

function typeLabel(type: string): string {
  const t = String(type ?? "").toLowerCase();
  if (t === "group" || t === "chat") return "گروه";
  if (t === "channel") return "کانال";
  if (["private", "user", "dm", "direct"].includes(t)) return "چت خصوصی";
  return "چت";
}

function providerName(engine: DibaMcpEngine, provider: string): string {
  return engine.provider(provider)?.nameFa ?? providerLabel(provider);
}

function faNumber(n: number): string {
  return String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

function candidateLines(engine: DibaMcpEngine, candidates: Array<{ title: string; provider: string; type: string }>): string[] {
  return candidates.slice(0, 6).map((c, index) => {
    const kind = isGroupLike(c.type) ? ` — ${typeLabel(c.type)}` : "";
    return `${faNumber(index + 1)}) ${displayName(c)} — ${providerName(engine, c.provider)}${kind}`;
  });
}

function confirmActions(): Array<{ label: string; value: string }> {
  return [
    { label: "تأیید و ارسال", value: "بله" },
    { label: "لغو", value: "لغو" },
  ];
}

function candidateActions(
  engine: DibaMcpEngine,
  candidates: Array<{ title: string; provider: string; type: string }>,
): Array<{ label: string; value: string }> {
  return candidates.slice(0, 6).map((c, index) => ({
    label: `${faNumber(index + 1)}) ${displayName(c)} — ${providerName(engine, c.provider)}`,
    value: faNumber(index + 1),
  }));
}

function normalizeDigits(value: string): string {
  return String(value ?? "").replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

function isApproval(text: string): boolean {
  const t = normalizeDigits(text).replace(/[،,.!?؛:]/g, " ").replace(/\s+/g, " ").trim();
  return (
    t.length <= 32 &&
    /^(?:بله|آره|اره|تأیید|تایید|تایید می‌کنم|تأیید می‌کنم|بفرست|ارسال کن|همینه|همین|اوکی|okay|ok|yes|confirm|send)(?:\s+(?:بفرست|ارسال کن|باشه|کن))?$/i.test(t)
  );
}

function isCancel(text: string): boolean {
  const t = normalizeDigits(text).replace(/[،,.!?؛:]/g, " ").replace(/\s+/g, " ").trim();
  return t.length <= 24 && /^(?:نه|خیر|لغو|انصراف|بی خیال|بیخیال|کنسل|cancel|no)$/i.test(t);
}

function pickCandidate<T extends { title: string; type: string }>(text: string, candidates: T[]): T | undefined {
  const normalized = normalizeDigits(text).replace(/[،,.!?؛:]/g, " ").replace(/\s+/g, " ").trim();
  const cleaned = normalized
    .replace(/^(?:همون|همان|گزینه|مورد)\s*/i, "")
    .replace(/\s*(?:رو|را|هم)$/i, "")
    .trim();
  const numeric = cleaned.match(/^([1-9])(?:\s*(?:رو|را|هم)?)?$/);
  if (numeric) return candidates[Number(numeric[1]) - 1];
  const ordinals: Array<[RegExp, number]> = [
    [/^(?:اول|اولی|یک|یکم)$/i, 0],
    [/^(?:دوم|دومی|دو|دومین)$/i, 1],
    [/^(?:سوم|سومی|سه|سومین)$/i, 2],
    [/^(?:چهارم|چهارمی|چهار)$/i, 3],
    [/^(?:پنجم|پنجمی|پنج)$/i, 4],
    [/^(?:ششم|ششمی|شش)$/i, 5],
  ];
  for (const [re, index] of ordinals) if (re.test(cleaned)) return candidates[index];
  const leading = normalized.match(/^([1-9])(?:\s|$)/);
  if (leading) return candidates[Number(leading[1]) - 1];
  const n = normalizePersonName(normalized);
  if (n.length >= 3) {
    const matches = candidates.filter((c) => {
      const title = normalizePersonName(displayName(c));
      return title.length >= 3 && (n.includes(title) || title.includes(n));
    });
    if (matches.length === 1) return matches[0];
  }
  if (isApproval(normalized) && candidates.length === 1) return candidates[0];
  return undefined;
}

export async function buildDraft(
  engine: DibaMcpEngine,
  config: DibaRouterConfig,
  intent: SendIntent,
  recipient: { title: string; lastText?: string; provider: string; type: string; chatId: string },
  signal?: AbortSignal,
): Promise<{ ok: boolean; text: string; reason?: string }> {
  const cancelled = () => signal?.aborted === true;
  const prior = engine.memory.recipient(recipient.provider, recipient.chatId);
  const firstContact = !prior || prior.sendCount === 0;
  const allowLinks = /https?:\/\//.test(intent.instruction);
  const expectsPersian = /[\u0600-\u06FF]/.test(intent.instruction || intent.raw);
  const languageOk = () => !expectsPersian || /[\u0600-\u06FF]/.test(text);
  let text = "";
  if (cancelled()) return { ok: false, text: "", reason: "درخواست لغو شد." };
  try {
    text = await composeMessage(engine, config, intent, recipient, undefined, signal);
  } catch {
    text = intent.instruction;
  }
  if (cancelled()) return { ok: false, text: "", reason: "درخواست لغو شد." };
  if (!text && intent.instruction) text = cleanMessage(intent.instruction);

  let quality = checkMessageQuality(text, { allowLinks, firstContact });
  if (!quality.ok || !languageOk()) {
    const reasons = [...quality.reasons, ...(languageOk() ? [] : ["متن باید فارسی باشد."])];
    try {
      const retry = await composeMessage(engine, config, intent, recipient, { text, reasons }, signal);
      if (retry) {
        text = retry;
        quality = checkMessageQuality(text, { allowLinks, firstContact });
      }
    } catch {
      // از متن قبلی استفاده می‌کنیم
    }
  }
  if (!text) return { ok: false, text: "", reason: "متن پیام ساخته نشد؛ لطفاً خودِ متن یا منظورت را بگو." };
  if (!languageOk()) return { ok: false, text, reason: "متن ساخته‌شده فارسی نبود؛ لطفاً متن دقیق‌تری بده." };
  if (!quality.ok) return { ok: false, text, reason: `متن پیام مناسب نبود: ${quality.reasons.join(" ")}` };
  return { ok: true, text };
}

/** مرحله‌ی اول: پیدا کردن نزدیک‌ترین مخاطبین و ساخت پیش‌نویس (بدون ارسال). */
export async function prepareSend(
  engine: DibaMcpEngine,
  config: DibaRouterConfig,
  intent: SendIntent,
  opts: { conversationId?: string; allowGroup?: boolean; signal?: AbortSignal } = {},
): Promise<AgentSendResult> {
  const conversationId = opts.conversationId ?? "dashboard";
  const toolTrace: AgentSendTraceItem[] = [];
  if (opts.signal?.aborted) return { ok: false, reply: "درخواست لغو شد.", toolTrace };

  const resolution = await engine.resolveRecipient(intent.recipient);
  toolTrace.push({ name: "resolve_recipient", args: { name: intent.recipient }, ok: resolution.candidates.length > 0, ms: 0 });
  if (opts.signal?.aborted) return { ok: false, reply: "درخواست لغو شد.", toolTrace };

  let candidates = resolution.candidates;
  if (!opts.allowGroup) candidates = candidates.filter((c) => !isGroupLike(c.type));
  if (!candidates.length) {
    return {
      ok: false,
      reply: resolution.candidates.length
        ? "فقط گروه/کانال پیدا شد. اگر می‌خواهی به گروه پیام برود، صریح بگو «به گروه … پیام بده»."
        : "هیچ چت یا مخاطبی پیدا نکردم. یک نام، بخشی از نام، نام کاربری یا موضوع آخرین پیام را بگو تا نزدیک‌ترین‌ها را پیدا کنم.",
      toolTrace,
    };
  }

  if (candidates.length === 1) {
    const selected = candidates[0];
    const draft = await buildDraft(engine, config, intent, selected, opts.signal);
    if (!draft.ok) return { ok: false, reply: draft.reason ?? "متن پیام ساخته نشد.", toolTrace, text: draft.text };
    engine.memory.setPending({
      conversationId,
      query: intent.recipient,
      instruction: intent.instruction,
      candidates,
      selected,
      text: draft.text,
      stage: "confirm",
      allowGroup: opts.allowGroup,
    });
    return {
      ok: true,
      reply:
        `مخاطب: ${displayName(selected)} — ${providerName(engine, selected.provider)}\n\n` +
        `متن پیشنهادی:\n«${draft.text}»\n\n` +
        "ارسال شود؟ برای تأیید «بله» و برای لغو «لغو» بفرست.",
      toolTrace,
      text: draft.text,
      pending: true,
      actions: confirmActions(),
    };
  }

  engine.memory.setPending({
    conversationId,
    query: intent.recipient,
    instruction: intent.instruction,
    candidates,
    stage: "choose",
    allowGroup: opts.allowGroup,
  });
  const lead = resolution.fallback ? "نام دقیقی پیدا نکردم؛ نزدیک‌ترین چت‌های اخیر:" : "چند مخاطب نزدیک پیدا کردم:";
  return {
    ok: true,
    reply: `${lead}\n${candidateLines(engine, candidates).join("\n")}\n\nشماره‌ی مخاطب را بفرست تا متن پیشنهادی را بسازم.`,
    toolTrace,
    pending: true,
    actions: candidateActions(engine, candidates),
  };
}

/** مرحله‌ی دوم: انتخاب/تأیید/لغو بر اساس پیام بعدی کاربر. */
export async function handleSendReply(
  engine: DibaMcpEngine,
  config: DibaRouterConfig,
  conversationId: string,
  text: string,
  opts: { signal?: AbortSignal } = {},
): Promise<AgentSendResult | undefined> {
  const pending = engine.memory.getPending(conversationId);
  if (!pending) return undefined;
  const clean = String(text ?? "").trim();
  if (!clean) return undefined;
  const toolTrace: AgentSendTraceItem[] = [];

  if (isCancel(clean)) {
    engine.memory.clearPending(conversationId);
    return { ok: true, reply: "ارسال لغو شد.", toolTrace, pending: false };
  }
  // درخواست ارسال جدید، پیش‌نویس قبلی را کنار می‌گذارد
  if (parseSendIntent(clean)) {
    engine.memory.clearPending(conversationId);
    return undefined;
  }
  if (opts.signal?.aborted) return { ok: false, reply: "درخواست لغو شد.", toolTrace };

  if (pending.stage === "choose") {
    const selected = pickCandidate(clean, pending.candidates);
    if (!selected) {
      return {
        ok: false,
        reply: `لطفاً شماره یا نام یکی از گزینه‌ها را بفرست:\n${candidateLines(engine, pending.candidates).join("\n")}`,
        toolTrace,
        pending: true,
        actions: candidateActions(engine, pending.candidates),
      };
    }
    const intent: SendIntent = { recipient: pending.query, instruction: pending.instruction, raw: clean };
    const draft = await buildDraft(engine, config, intent, selected, opts.signal);
    if (!draft.ok) {
      return { ok: false, reply: draft.reason ?? "متن پیام ساخته نشد.", toolTrace, pending: true, text: draft.text };
    }
    engine.memory.updatePending(conversationId, { selected, text: draft.text, stage: "confirm" });
    return {
      ok: true,
      reply:
        `مخاطب: ${displayName(selected)} — ${providerName(engine, selected.provider)}\n\n` +
        `متن پیشنهادی:\n«${draft.text}»\n\n` +
        "ارسال شود؟ برای تأیید «بله» و برای لغو «لغو» بفرست.",
      toolTrace,
      text: draft.text,
      pending: true,
      actions: confirmActions(),
    };
  }

  if (!isApproval(clean)) {
    return {
      ok: false,
      reply: "برای ارسال «بله» و برای لغو «لغو» را بفرست. اگر متن را می‌خواهی عوض کنی، درخواست جدید بده.",
      toolTrace,
      pending: true,
      actions: confirmActions(),
    };
  }

  // برداشت اتمی: اگر دو کلیک/دو درخواست هم‌زمان برسد، فقط یکی ارسال می‌شود
  const claimed = engine.memory.takePending(conversationId);
  if (!claimed) {
    return { ok: false, reply: "این پیش‌نویس قبلاً ارسال یا لغو شده است؛ دوباره درخواست بده.", toolTrace };
  }
  if (!claimed.selected || !claimed.text) {
    return { ok: false, reply: "پیش‌نویس منقضی شد؛ دوباره بگو به چه کسی پیام بدهم.", toolTrace };
  }

  const selected = claimed.selected;
  if (opts.signal?.aborted) return { ok: false, reply: "درخواست لغو شد.", toolTrace };
  const send = await engine.sendToRecipient({
    recipient: selected.title,
    chatId: selected.chatId,
    title: selected.title,
    type: selected.type,
    provider: selected.provider,
    text: claimed.text,
    allowGroup: claimed.allowGroup,
    allowLinks: /https?:\/\//.test(claimed.text),
  });
  toolTrace.push({
    name: "send_message_to",
    args: { recipient: displayName(selected), text: claimed.text },
    ok: send.ok,
    ms: send.ms,
    error: send.error,
  });
  if (!send.ok) {
    return { ok: false, reply: `ارسال به «${displayName(selected)}» انجام نشد: ${send.error}`, toolTrace, text: claimed.text };
  }
  return {
    ok: true,
    reply: `پیام به «${displayName(selected)}» در ${providerName(engine, selected.provider)} ارسال شد.\n\n«${claimed.text}»`,
    toolTrace,
    text: claimed.text,
    pending: false,
  };
}
