import { createTelegramLikeProvider } from "./telegram-like.js";

/**
 * تلگرام از طریق Bot API رسمی.
 * برای حساب کاربری تلگرام، ربات‌ها به پیام‌های خصوصی کاربر دسترسی ندارند؛
 * این اتصال برای کانال/گروه/چت با ربات و دریافت update طراحی شده است.
 */
export const telegram = createTelegramLikeProvider({
  id: "telegram",
  name: "Telegram Bot",
  nameFa: "تلگرام (ربات رسمی)",
  color: "#229ED9",
  glyph: "ت",
  defaultBaseUrl: "https://api.telegram.org",
  docsUrl: "https://core.telegram.org/bots/api",
  botfather: "@BotFather",
  description: "ربات رسمی تلگرام با Bot API — ارسال پیام، فایل و دریافت update",
  management: true,
});
