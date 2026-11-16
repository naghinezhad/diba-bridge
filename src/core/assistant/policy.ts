/**
 * سیاست‌های ارسال دستیار: کدام سرویس‌ها ارسال دارند، چه چتی گروه حساب می‌شود
 * و چه متنی کیفیت لازم برای ارسال را دارد. ارسال واقعی در engine انجام می‌شود.
 */

export interface MessageQuality {
  ok: boolean;
  score: number;
  reasons: string[];
  warnings: string[];
}

/** ابزار ارسال متن هر سرویس؛ سرویسی که اینجا نیست فقط‌خواندنی است. */
export const SEND_TOOLS: Record<string, string> = {
  bale_client: "bale_client_send_message",
  eitaa_client: "eitaa_client_send_message",
  rubika_client: "rubika_client_send_message",
  soroush_client: "soroush_client_send_message",
  telegram_client: "telegram_client_send_message",
  whatsapp: "whatsapp_send_message",
};

export function canSendWith(providerId: string): boolean {
  return Boolean(SEND_TOOLS[providerId]);
}

export function isGroupLike(type: string): boolean {
  return !["private", "user", "dm", "direct", "unknown", ""].includes(String(type ?? "").toLowerCase());
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
  // «\b» برای حروف فارسی کار نمی‌کند؛ مرز کلمه را با فاصله تشخیص می‌دهیم
  if (/(?:^|\s)(\S+)(?:\s+\1){3,}(?=\s|$)/iu.test(clean)) reasons.push("یک عبارت چند بار پشت‌سرهم تکرار شده است.");
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
