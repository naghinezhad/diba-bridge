import { dibaRouterChat, type DibaRouterConfig } from "../dibarouter.js";
import type { DibaMcpEngine } from "../engine.js";
import { publicTitle } from "../memory.js";
import { checkMessageQuality } from "./policy.js";

export interface SendIntent {
  recipient: string;
  instruction: string;
  raw: string;
}

export interface DraftRecipient {
  title: string;
  lastText?: string;
  provider: string;
  type: string;
  chatId: string;
}

export interface DraftResult {
  ok: boolean;
  text: string;
  reason?: string;
}

const HAS_PERSIAN = /[؀-ۿ]/;

function cleanMessage(value: string): string {
  return String(value ?? "")
    .replace(/^[\s"'«“”]+|[\s"'»“”]+$/g, "")
    .replace(/^(?:متن پیام|پیام|message)\s*[:：]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);
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

export async function buildDraft(
  engine: DibaMcpEngine,
  config: DibaRouterConfig,
  intent: SendIntent,
  recipient: DraftRecipient,
  signal?: AbortSignal,
): Promise<DraftResult> {
  const cancelled = () => signal?.aborted === true;
  const prior = engine.memory.recipient(recipient.provider, recipient.chatId);
  const firstContact = !prior || prior.sendCount === 0;
  const allowLinks = /https?:\/\//.test(intent.instruction);
  const expectsPersian = HAS_PERSIAN.test(intent.instruction || intent.raw);
  const languageOk = () => !expectsPersian || HAS_PERSIAN.test(text);
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
    }
  }
  if (!text) return { ok: false, text: "", reason: "متن پیام ساخته نشد؛ لطفاً خودِ متن یا منظورت را بگو." };
  if (!languageOk()) return { ok: false, text, reason: "متن ساخته‌شده فارسی نبود؛ لطفاً متن دقیق‌تری بده." };
  if (!quality.ok) return { ok: false, text, reason: `متن پیام مناسب نبود: ${quality.reasons.join(" ")}` };
  return { ok: true, text };
}
