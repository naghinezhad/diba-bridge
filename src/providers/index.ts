import type { ProviderDef } from "../core/types.js";
import { bale } from "./bale.js";
import { baleClient } from "./bale-client.js";
import { eitaa } from "./eitaa.js";
import { eitaaClient } from "./eitaa-client.js";
import { instagram } from "./instagram.js";
import { linkedinProvider } from "./linkedin.js";
import { rubika } from "./rubika.js";
import { rubikaClient } from "./rubika-client.js";
import { soroush } from "./soroush.js";
import { soroushClient } from "./soroush-client.js";
import { telegram } from "./telegram.js";
import { telegramClient } from "./telegram-client.js";
import { whatsapp } from "./whatsapp.js";
import { x } from "./x.js";

/**
 * فهرست همه‌ی سرویس‌ها.
 * برای اضافه کردن سرویس جدید (زرین‌پال، کاوه‌نگار، نشان، ...):
 *   ۱. یک فایل در همین پوشه بسازید که ProviderDef برگرداند
 *   ۲. اینجا به آرایه اضافه‌اش کنید
 */
export const builtinProviders: ProviderDef[] = [bale, baleClient, eitaa, eitaaClient, rubika, rubikaClient, soroush, soroushClient, telegram, telegramClient, instagram, linkedinProvider, whatsapp, x];

export { bale, baleClient, eitaa, eitaaClient, instagram, linkedinProvider, rubika, rubikaClient, soroush, soroushClient, telegram, telegramClient, whatsapp, x };



