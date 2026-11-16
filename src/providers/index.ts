import type { ProviderDef } from "../core/types.js";
import { baleClient } from "./bale-client.js";
import { eitaaClient } from "./eitaa-client.js";
import { instagram } from "./instagram.js";
import { linkedinProvider } from "./linkedin.js";
import { rubikaClient } from "./rubika-client.js";
import { soroushClient } from "./soroush-client.js";
import { telegramClient } from "./telegram-client.js";
import { whatsapp } from "./whatsapp.js";
import { wordpress } from "./wordpress.js";
import { x } from "./x.js";

/**
 * فهرست همه‌ی سرویس‌ها.
 * همه‌ی پیام‌رسان‌ها با «حساب کاربری» وصل می‌شوند؛ اتصال با ربات/Bot API حذف شده است.
 * برای اضافه کردن سرویس جدید (زرین‌پال، کاوه‌نگار، نشان، ...):
 *   ۱. یک فایل در همین پوشه بسازید که ProviderDef برگرداند
 *   ۲. اینجا به آرایه اضافه‌اش کنید
 */
export const builtinProviders: ProviderDef[] = [
  baleClient,
  eitaaClient,
  rubikaClient,
  soroushClient,
  telegramClient,
  instagram,
  linkedinProvider,
  whatsapp,
  x,
  wordpress,
];

export { baleClient, eitaaClient, instagram, linkedinProvider, rubikaClient, soroushClient, telegramClient, whatsapp, wordpress, x };
