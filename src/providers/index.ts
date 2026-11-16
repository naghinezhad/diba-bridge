import type { ProviderDef } from "../core/types.js";
import { baleClient } from "./bale-client.js";
import { blubank } from "./blubank.js";
import { eitaaClient } from "./eitaa-client.js";
import { binance } from "./exchanges/binance.js";
import { bybit } from "./exchanges/bybit.js";
import { kraken } from "./exchanges/kraken.js";
import { kucoin } from "./exchanges/kucoin.js";
import { okx } from "./exchanges/okx.js";
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
  blubank,
  eitaaClient,
  rubikaClient,
  soroushClient,
  telegramClient,
  instagram,
  linkedinProvider,
  whatsapp,
  x,
  // صرافی‌های خارجی (API رسمی؛ معامله به‌طور پیش‌فرض خاموش است)
  binance,
  bybit,
  okx,
  kucoin,
  kraken,
  wordpress,
];

export { baleClient, binance, blubank, bybit, eitaaClient, instagram, kraken, kucoin, linkedinProvider, okx, rubikaClient, soroushClient, telegramClient, whatsapp, wordpress, x };
