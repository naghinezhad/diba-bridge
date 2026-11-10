import type { ProviderDef } from "../core/types.js";
import { bale } from "./bale.js";
import { baleClient } from "./bale-client.js";
import { eitaa } from "./eitaa.js";
import { eitaaClient } from "./eitaa-client.js";
import { rubika } from "./rubika.js";
import { rubikaClient } from "./rubika-client.js";
import { soroush } from "./soroush.js";
import { soroushClient } from "./soroush-client.js";

/**
 * فهرست همه‌ی سرویس‌ها.
 * برای اضافه کردن سرویس جدید (زرین‌پال، کاوه‌نگار، نشان، ...):
 *   ۱. یک فایل در همین پوشه بسازید که ProviderDef برگرداند
 *   ۲. اینجا به آرایه اضافه‌اش کنید
 */
export const builtinProviders: ProviderDef[] = [bale, baleClient, eitaa, eitaaClient, rubika, rubikaClient, soroush, soroushClient];

export { bale, baleClient, eitaa, eitaaClient, rubika, rubikaClient, soroush, soroushClient };



