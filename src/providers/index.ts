import type { ProviderDef } from "../core/types.js";
import { baleClient } from "./bale-client.js";
import { blubank } from "./blubank.js";
import { eitaaClient } from "./eitaa-client.js";
import { abantether } from "./exchanges/abantether.js";
import { binance } from "./exchanges/binance.js";
import { bitpin } from "./exchanges/bitpin.js";
import { bybit } from "./exchanges/bybit.js";
import { kraken } from "./exchanges/kraken.js";
import { kucoin } from "./exchanges/kucoin.js";
import { nobitex } from "./exchanges/nobitex.js";
import { okx } from "./exchanges/okx.js";
import { tabdeal } from "./exchanges/tabdeal.js";
import { wallex } from "./exchanges/wallex.js";
import { instagram } from "./instagram.js";
import { linkedinProvider } from "./linkedin.js";
import { rubikaClient } from "./rubika-client.js";
import { soroushClient } from "./soroush-client.js";
import { telegramClient } from "./telegram-client.js";
import { whatsapp } from "./whatsapp.js";
import { wordpress } from "./wordpress.js";
import { x } from "./x.js";

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
  nobitex,
  wallex,
  bitpin,
  tabdeal,
  abantether,
  binance,
  bybit,
  okx,
  kucoin,
  kraken,
  wordpress,
];

// prettier-ignore
export { abantether, baleClient, binance, bitpin, blubank, bybit, eitaaClient, instagram, kraken, kucoin, linkedinProvider, nobitex, okx, rubikaClient, soroushClient, tabdeal, telegramClient, wallex, whatsapp, wordpress, x };
