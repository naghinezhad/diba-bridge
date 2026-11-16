/**
 * مسیر «به [نام] پیام بده» در گفتگوی داشبورد.
 *
 * برخلاف ابزار MCP (agent.ts) که می‌تواند پیام صریح را مستقیم بفرستد، داشبورد
 * همیشه دو مرحله‌ای است: اول نزدیک‌ترین مخاطب و متن پیشنهادی را نشان می‌دهد و
 * **فقط پس از تأیید کاربر** ارسال می‌کند. پیدا کردن مخاطب، ساخت پیش‌نویس و
 * تشخیص «بله/لغو/شماره» با همان ماژول‌های مشترک دستیار انجام می‌شود.
 */
import type { DibaRouterConfig } from "../dibarouter.js";
import type { DibaMcpEngine } from "../engine.js";
import { normalizePersonName, publicTitle, type PendingCandidate } from "../memory.js";
import { buildDraft, type SendIntent } from "./draft.js";
import { splitProviderHint } from "./intent.js";
import { isGroupLike } from "./policy.js";
import { providerName, providerWords } from "./provider-words.js";
import { resolveRecipient } from "./resolver.js";
import { faNum, isCancelText, isConfirmText, selectionIndex, typeLabel } from "./text.js";

export type { SendIntent } from "./draft.js";

export interface ChatFlowTraceItem {
  name: string;
  args: unknown;
  ok: boolean;
  ms?: number;
  error?: string;
  preloaded?: boolean;
}

export interface ChatFlowResult {
  ok: boolean;
  reply: string;
  toolTrace: ChatFlowTraceItem[];
  text?: string;
  pending?: boolean;
  actions?: Array<{ label: string; value: string }>;
}

const MAX_OPTIONS = 6;

function cleanName(value: string): string {
  return String(value ?? "")
    .replace(/^[\s«"'“”]+|[\s»"'“”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** الگوهای واضح «به X پیام بده/بفرست/بگو» را تشخیص می‌دهد. */
export function parseSendIntent(text: string): SendIntent | undefined {
  const raw = String(text ?? "").trim();
  if (!raw) return undefined;
  // جمله‌ی پرسشی را دستور ارسال تلقی نکن («\b» برای فارسی کار نمی‌کند، پس مرز با فاصله)
  if (/[؟?]\s*$/.test(raw) || /^(?:آیا|ایا)(?:\s|$)/.test(raw)) return undefined;
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

type Option = PendingCandidate;

function displayName(candidate: { title: string; type: string }): string {
  return publicTitle(candidate.title, candidate.type);
}

function optionLabel(engine: DibaMcpEngine, candidate: Option, index: number): string {
  const kind = isGroupLike(candidate.type) ? ` — ${typeLabel(candidate.type)}` : "";
  return `${faNum(index + 1)}) ${displayName(candidate)} — ${providerName(engine, candidate.provider)}${kind}`;
}

function optionLines(engine: DibaMcpEngine, candidates: Option[]): string[] {
  return candidates.slice(0, MAX_OPTIONS).map((candidate, index) => optionLabel(engine, candidate, index));
}

function optionActions(engine: DibaMcpEngine, candidates: Option[]): Array<{ label: string; value: string }> {
  return candidates.slice(0, MAX_OPTIONS).map((candidate, index) => ({
    label: optionLabel(engine, candidate, index),
    value: faNum(index + 1),
  }));
}

function confirmActions(): Array<{ label: string; value: string }> {
  return [
    { label: "تأیید و ارسال", value: "بله" },
    { label: "لغو", value: "لغو" },
  ];
}

function confirmReply(engine: DibaMcpEngine, selected: Option, text: string): string {
  return (
    `مخاطب: ${displayName(selected)} — ${providerName(engine, selected.provider)}\n\n` +
    `متن پیشنهادی:\n«${text}»\n\n` +
    "ارسال شود؟ برای تأیید «بله» و برای لغو «لغو» بفرست."
  );
}

/** انتخاب کاربر از فهرست: شماره، ترتیب («دومی»)، شماره‌ی ابتدای جمله یا بخشی از نام */
function pickCandidate<T extends Option>(text: string, candidates: T[]): T | undefined {
  const index = selectionIndex(text);
  if (index !== undefined) return candidates[index];
  const normalized = normalizePersonName(text).replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
  const leading = normalized.match(/^([1-9])(?:\s|$)/);
  if (leading) return candidates[Number(leading[1]) - 1];
  if (normalized.length >= 3) {
    const matches = candidates.filter((candidate) => {
      const title = normalizePersonName(displayName(candidate));
      return title.length >= 3 && (normalized.includes(title) || title.includes(normalized));
    });
    if (matches.length === 1) return matches[0];
  }
  if (isConfirmText(text) && candidates.length === 1) return candidates[0];
  return undefined;
}

/** مرحله‌ی اول: پیدا کردن نزدیک‌ترین مخاطبین و ساخت پیش‌نویس (بدون ارسال). */
export async function prepareSend(
  engine: DibaMcpEngine,
  config: DibaRouterConfig,
  intent: SendIntent,
  opts: { conversationId?: string; allowGroup?: boolean; signal?: AbortSignal } = {},
): Promise<ChatFlowResult> {
  const conversationId = opts.conversationId ?? "dashboard";
  const toolTrace: ChatFlowTraceItem[] = [];
  const aborted = () => opts.signal?.aborted === true;
  if (aborted()) return { ok: false, reply: "درخواست لغو شد.", toolTrace };

  // «علی در تلگرام» → نام: علی، سرویس: تلگرام
  const target = splitProviderHint(intent.recipient, providerWords(engine));
  const started = performance.now();
  // گروه‌ها هم جستجو می‌شوند تا بتوانیم دقیق بگوییم «فقط گروه پیدا شد»
  const resolution = await resolveRecipient(engine, target.name, {
    provider: target.provider,
    allowGroup: true,
    sendableOnly: true,
  });
  toolTrace.push({
    name: "resolve_recipient",
    args: { name: target.name, provider: target.provider },
    ok: resolution.candidates.length > 0,
    ms: Math.round(performance.now() - started),
  });
  if (aborted()) return { ok: false, reply: "درخواست لغو شد.", toolTrace };

  const candidates = opts.allowGroup ? resolution.candidates : resolution.candidates.filter((c) => !isGroupLike(c.type));
  if (!candidates.length) {
    return {
      ok: false,
      reply: resolution.candidates.length
        ? "فقط گروه/کانال پیدا شد. اگر می‌خواهی به گروه پیام برود، صریح بگو «به گروه … پیام بده»."
        : "هیچ چت یا مخاطبی پیدا نکردم. یک نام، بخشی از نام، نام کاربری یا موضوع آخرین پیام را بگو تا نزدیک‌ترین‌ها را پیدا کنم.",
      toolTrace,
    };
  }

  const best = candidates[0];
  const unique =
    !resolution.fallback &&
    (candidates.length === 1 || (resolution.confident && resolution.best === best));
  if (unique) {
    const draft = await buildDraft(engine, config, intent, best, opts.signal);
    if (!draft.ok) return { ok: false, reply: draft.reason ?? "متن پیام ساخته نشد.", toolTrace, text: draft.text };
    engine.memory.setPending({
      conversationId,
      query: intent.recipient,
      instruction: intent.instruction,
      candidates: [best],
      selected: best,
      text: draft.text,
      stage: "confirm",
      allowGroup: opts.allowGroup,
    });
    return {
      ok: true,
      reply: confirmReply(engine, best, draft.text),
      toolTrace,
      text: draft.text,
      pending: true,
      actions: confirmActions(),
    };
  }

  const options = candidates.slice(0, MAX_OPTIONS);
  engine.memory.setPending({
    conversationId,
    query: intent.recipient,
    instruction: intent.instruction,
    candidates: options,
    stage: "choose",
    allowGroup: opts.allowGroup,
  });
  const lead = resolution.fallback ? "نام دقیقی پیدا نکردم؛ نزدیک‌ترین چت‌های اخیر:" : "چند مخاطب نزدیک پیدا کردم:";
  return {
    ok: true,
    reply: `${lead}\n${optionLines(engine, options).join("\n")}\n\nشماره‌ی مخاطب را بفرست تا متن پیشنهادی را بسازم.`,
    toolTrace,
    pending: true,
    actions: optionActions(engine, options),
  };
}

/** مرحله‌ی دوم: انتخاب/تأیید/لغو بر اساس پیام بعدی کاربر. */
export async function handleSendReply(
  engine: DibaMcpEngine,
  config: DibaRouterConfig,
  conversationId: string,
  text: string,
  opts: { signal?: AbortSignal } = {},
): Promise<ChatFlowResult | undefined> {
  const pending = engine.memory.getPending(conversationId);
  if (!pending) return undefined;
  const clean = String(text ?? "").trim();
  if (!clean) return undefined;
  const toolTrace: ChatFlowTraceItem[] = [];
  const aborted = () => opts.signal?.aborted === true;

  if (isCancelText(clean)) {
    engine.memory.clearPending(conversationId);
    return { ok: true, reply: "ارسال لغو شد.", toolTrace, pending: false };
  }
  // درخواست ارسال جدید، پیش‌نویس قبلی را کنار می‌گذارد
  if (parseSendIntent(clean)) {
    engine.memory.clearPending(conversationId);
    return undefined;
  }
  if (aborted()) return { ok: false, reply: "درخواست لغو شد.", toolTrace };

  if (pending.stage === "choose") {
    const selected = pickCandidate(clean, pending.candidates);
    if (!selected) {
      return {
        ok: false,
        reply: `لطفاً شماره یا نام یکی از گزینه‌ها را بفرست:\n${optionLines(engine, pending.candidates).join("\n")}`,
        toolTrace,
        pending: true,
        actions: optionActions(engine, pending.candidates),
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
      reply: confirmReply(engine, selected, draft.text),
      toolTrace,
      text: draft.text,
      pending: true,
      actions: confirmActions(),
    };
  }

  if (!isConfirmText(clean)) {
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
  if (aborted()) return { ok: false, reply: "درخواست لغو شد.", toolTrace };
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
