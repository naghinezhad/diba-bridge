/** بایننس — Spot REST API (https://developers.binance.com/docs/binance-spot-api-docs/rest-api) */
import type { ProviderContext } from "../../core/types.js";
import { baseOf, credentials, defineExchange, exchangeFetch, hmacHex, query, splitSymbol, type CandleInterval, type ExchangeAdapter } from "./common.js";

const NAME = "بایننس";
const BASE = "https://api.binance.com";

/** امضای بایننس: HMAC-SHA256 روی همان رشته‌ی پرس‌وجو، به شکل hex */
export function binanceSign(secret: string, queryString: string): string {
  return hmacHex("sha256", secret, queryString);
}

function pub(ctx: ProviderContext, path: string, params: Record<string, string | number | undefined>) {
  return exchangeFetch(NAME, `${baseOf(ctx, BASE)}${path}?${query(params)}`);
}

function signed(ctx: ProviderContext, method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string | number | undefined> = {}) {
  const { apiKey, apiSecret } = credentials(ctx, NAME);
  const qs = query({ ...params, recvWindow: 5000, timestamp: Date.now() });
  return exchangeFetch(NAME, `${baseOf(ctx, BASE)}${path}?${qs}&signature=${binanceSign(apiSecret, qs)}`, { method, headers: { "X-MBX-APIKEY": apiKey } });
}

const adapter: ExchangeAdapter = {
  id: "binance",
  name: "Binance",
  nameFa: NAME,
  color: "#f0b90b",
  glyph: "B",
  docsUrl: "https://developers.binance.com/docs/binance-spot-api-docs/rest-api",
  defaultBase: BASE,
  symbolExample: "BTCUSDT",
  keyHelp: "از Binance ← API Management بسازید. برای خواندن موجودی «Enable Reading» کافی است؛ دسترسی برداشت را روشن نکنید.",
  symbol: (input) => splitSymbol(input)?.join("") ?? input.trim().toUpperCase(),

  async ticker(ctx, symbol) {
    const t = await pub(ctx, "/api/v3/ticker/24hr", { symbol });
    return { symbol: t.symbol, last: t.lastPrice, bid: t.bidPrice, ask: t.askPrice, high24h: t.highPrice, low24h: t.lowPrice, volume24h: t.volume, changePercent24h: t.priceChangePercent };
  },

  async orderBook(ctx, symbol, depth) {
    const b = await pub(ctx, "/api/v3/depth", { symbol, limit: depth });
    return { symbol, bids: b.bids, asks: b.asks };
  },

  async candles(ctx, symbol, interval: CandleInterval, limit) {
    const rows: any[][] = await pub(ctx, "/api/v3/klines", { symbol, interval, limit });
    return rows.map((r) => ({ time: new Date(Number(r[0])).toISOString(), open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
  },

  async balances(ctx) {
    const acc = await signed(ctx, "GET", "/api/v3/account", { omitZeroBalances: "true" });
    return (acc.balances ?? []).map((b: any) => ({ asset: b.asset, free: b.free, locked: b.locked }));
  },

  async openOrders(ctx, symbol) {
    const rows: any[] = await signed(ctx, "GET", "/api/v3/openOrders", { symbol });
    return rows.map((o) => ({
      id: String(o.orderId),
      symbol: o.symbol,
      side: String(o.side).toLowerCase() === "sell" ? "sell" : "buy",
      type: String(o.type).toLowerCase(),
      price: o.price,
      quantity: o.origQty,
      filled: o.executedQty,
      status: o.status,
      createdAt: o.time ? new Date(Number(o.time)).toISOString() : undefined,
    }));
  },

  async placeOrder(ctx, order) {
    const raw = await signed(ctx, "POST", "/api/v3/order", {
      symbol: order.symbol,
      side: order.side.toUpperCase(),
      type: order.type.toUpperCase(),
      quantity: order.quantity,
      price: order.price,
      timeInForce: order.type === "limit" ? "GTC" : undefined,
    });
    return { id: String(raw.orderId), raw };
  },

  cancelOrder: (ctx, symbol, orderId) => signed(ctx, "DELETE", "/api/v3/order", { symbol, orderId }),
};

export const binance = defineExchange(adapter);
