/**
 * ابزارهای متنی مشترک دستیار: برچسب‌ها، اعداد فارسی و تشخیص پاسخ‌های کوتاه
 * («بله»، «لغو»، «دومی»). هر دو مسیر دستیار (ابزار MCP و گفتگوی داشبورد)
 * از همین‌جا استفاده می‌کنند تا رفتارشان یکی بماند.
 *
 * نکته: «\b» در جاوااسکریپت فقط برای حروف لاتین کار می‌کند؛ برای فارسی مرز کلمه
 * را با فاصله/ابتدا/انتها تشخیص می‌دهیم.
 */
import { cleanText } from "./name-match.js";

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function faNum(value: number): string {
  return String(value).replace(/\d/g, (digit) => FA_DIGITS[Number(digit)]);
}

export function clip(value: unknown, max = 90): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function timeValue(value?: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function typeLabel(type: string): string {
  const t = String(type ?? "").toLowerCase();
  if (t === "group" || t === "chat") return "گروه";
  if (t === "channel") return "کانال";
  if (["private", "user", "dm", "direct"].includes(t)) return "خصوصی";
  return "چت";
}

/** متن کوتاه بدون علائم نگارشی، برای مقایسه با پاسخ‌های ثابت */
function shortReply(text: string): string {
  return cleanText(text).replace(/[،,.!?؟؛:]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

export function isCancelText(text: string): boolean {
  const t = shortReply(text);
  return t.length <= 24 && /^(?:نه|خیر|لغو|انصراف|بیخیال|بی خیال|کنسل|cancel|no|stop|never mind)$/.test(t);
}

export function isConfirmText(text: string): boolean {
  const t = shortReply(text);
  return (
    t.length <= 40 &&
    /^(?:بله|آره|اره|تایید|تأیید|تایید می.?کنم|تأیید می.?کنم|بفرست|ارسال کن|بفرستش|همینه|همین|اوکی|باشه|ok|okay|yes|yep|send|send it|confirm|confirmed|do it|go ahead)(?:\s+(?:بفرست|ارسال کن|باشه|کن|it))?$/.test(
      t,
    )
  );
}

const ORDINALS: Array<[RegExp, number]> = [
  [/^(?:اول|اولی|یک|یکم|first)$/i, 0],
  [/^(?:دوم|دومی|دو|دومین|second)$/i, 1],
  [/^(?:سوم|سومی|سه|سومین|third)$/i, 2],
  [/^(?:چهارم|چهارمی|چهار|fourth)$/i, 3],
  [/^(?:پنجم|پنجمی|پنج|fifth)$/i, 4],
  [/^(?:ششم|ششمی|شش|sixth)$/i, 5],
];

/** «۲»، «دومی»، «گزینه ۲»، «همون اولی رو» → اندیس صفرمبنا؛ در غیر این صورت undefined */
export function selectionIndex(text: string): number | undefined {
  const cleaned = shortReply(text)
    .replace(/^(?:همون|همان|گزینه|مورد|شماره|option|number)\s*/i, "")
    .replace(/\s*(?:رو بفرست|رو|را|هم)$/i, "")
    .trim();
  const numeric = cleaned.match(/^([1-9])$/);
  if (numeric) return Number(numeric[1]) - 1;
  for (const [re, index] of ORDINALS) if (re.test(cleaned)) return index;
  return undefined;
}

/** آیا متن فقط سلام/تشکر است؟ */
export function isSmallTalk(text: string): boolean {
  const t = cleanText(text).replace(/[!؟?.،\s]/g, "");
  return /^(?:سلام|درود|سلامعلیکم|وقتبخیر|صبحبخیر|شببخیر|ممنون|مرسی|تشکر|hi|hello|hey|thanks|thankyou|sup)$/iu.test(t);
}
