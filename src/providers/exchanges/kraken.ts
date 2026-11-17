import { createHash, createHmac } from "node:crypto";
import type { ProviderContext } from "../../core/types.js";
import { ProviderError } from "../../core/types.js";
import { baseOf, credentials, defineExchange, exchangeFetch, query, splitSymbol, type CandleInterval, type ExchangeAdapter } from "./common.js";

const NAME = "کراکن";
const BASE = "https://api.kraken.com";
const MINUTES: Record<CandleInterval, number> = { "1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240, "1d": 1440, "1w": 10080 };
const ALIASES: Record<string, string> = { BTC: "XBT", DOGE: "XDG" };

export function krakenSign(secretBase64: string, path: string, nonce: string, postData: string): string {
  const digest = createHash("sha256").update(nonce + postData).digest();
  return createHmac("sha512", Buffer.from(secretBase64, "base64")).update(Buffer.concat([Buffer.from(path), digest])).digest("base64");
}

function unwrap(data: any) {
  if (Array.isArray(data?.error) && data.error.length) throw new ProviderError(`${NAME}: ${data.error.join("، ")}`, data);
  return data?.result ?? {};
}

async function pub(ctx: ProviderContext, path: string, params: Record<string, string | number | undefined>) {
  return unwrap(await exchangeFetch(NAME, `${baseOf(ctx, BASE)}${path}?${query(params)}`));
}

let lastNonce = 0;
function nextNonce(): string {
  lastNonce = Math.max(Date.now() * 1000, lastNonce + 1);
  return String(lastNonce);
}

async function signed(ctx: ProviderContext, path: string, params: Record<string, string | number | undefined> = {}) {
  const { apiKey, apiSecret } = credentials(ctx, NAME);
  const nonce = nextNonce();
  const body = query({ nonce, ...params });
  const data = await exchangeFetch(NAME, `${baseOf(ctx, BASE)}${path}`, {
    method: "POST",
    body,
    headers: { "API-Key": apiKey, "API-Sign": krakenSign(apiSecret, path, nonce, body), "content-type": "application/x-www-form-urlencoded" },
  });
  return unwrap(data);
}

const firstPair = (result: Record<string, any>) => Object.entries(result).find(([key]) => key !== "last")?.[1];

const adapter: ExchangeAdapter = {
  id: "kraken",
  name: "Kraken",
  nameFa: NAME,
  color: "#5841d8",
  glyph: "Kr",
  docsUrl: "https://docs.kraken.com/api/",
  defaultBase: BASE,
  symbolExample: "XBTUSDT",
  keyHelp: "از Kraken ← Settings ← API بسازید. برای خواندن موجودی «Query Funds» و «Query Open Orders» کافی است؛ دسترسی Withdraw را روشن نکنید.",
  symbol: (input) => {
    const parts = splitSymbol(input);
    return parts ? parts.map((p) => ALIASES[p] ?? p).join("") : input.trim().toUpperCase();
  },

  async ticker(ctx, symbol) {
    const t = firstPair(await pub(ctx, "/0/public/Ticker", { pair: symbol }));
    if (!t) throw new ProviderError(`${NAME}: نماد ${symbol} پیدا نشد.`);
    return {
      symbol,
      last: t.c?.[0],
      bid: t.b?.[0],
      ask: t.a?.[0],
      high24h: t.h?.[1],
      low24h: t.l?.[1],
      volume24h: t.v?.[1],
    };
  },

  async orderBook(ctx, symbol, depth) {
    const b = firstPair(await pub(ctx, "/0/public/Depth", { pair: symbol, count: depth })) ?? {};
    const levels = (rows: (string | number)[][] = []) => rows.map((r) => [String(r[0]), String(r[1])] as [string, string]);
    return { symbol, bids: levels(b.bids), asks: levels(b.asks) };
  },

  async candles(ctx, symbol, interval, limit) {
    const rows: (string | number)[][] = firstPair(await pub(ctx, "/0/public/OHLC", { pair: symbol, interval: MINUTES[interval] })) ?? [];
    return rows.slice(-limit).map((r) => ({ time: new Date(Number(r[0]) * 1000).toISOString(), open: String(r[1]), high: String(r[2]), low: String(r[3]), close: String(r[4]), volume: String(r[6]) }));
  },

  async balances(ctx) {
    const result: Record<string, { balance: string; hold_trade?: string }> = await signed(ctx, "/0/private/BalanceEx");
    return Object.entries(result).map(([asset, b]) => {
      const locked = Number(b.hold_trade ?? 0);
      return { asset, free: String(Number(b.balance) - locked), locked: String(locked) };
    });
  },

  async openOrders(ctx, symbol) {
    const open: Record<string, any> = (await signed(ctx, "/0/private/OpenOrders")).open ?? {};
    return Object.entries(open)
      .map(([id, o]) => ({
        id,
        symbol: String(o.descr?.pair ?? ""),
        side: (o.descr?.type === "sell" ? "sell" : "buy") as "buy" | "sell",
        type: String(o.descr?.ordertype ?? ""),
        price: String(o.descr?.price ?? ""),
        quantity: String(o.vol ?? ""),
        filled: String(o.vol_exec ?? ""),
        status: String(o.status ?? ""),
        createdAt: o.opentm ? new Date(Number(o.opentm) * 1000).toISOString() : undefined,
      }))
      .filter((o) => !symbol || o.symbol.replace(/[^A-Z0-9]/gi, "").toUpperCase() === symbol);
  },

  async placeOrder(ctx, order) {
    const raw = await signed(ctx, "/0/private/AddOrder", { pair: order.symbol, type: order.side, ordertype: order.type, volume: order.quantity, price: order.price });
    return { id: String(raw?.txid?.[0] ?? ""), raw };
  },

  cancelOrder: (ctx, _symbol, orderId) => signed(ctx, "/0/private/CancelOrder", { txid: orderId }),
};

export const kraken = defineExchange(adapter);
