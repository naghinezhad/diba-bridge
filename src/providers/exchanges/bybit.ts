import type { ProviderContext } from "../../core/types.js";
import { ProviderError } from "../../core/types.js";
import { baseOf, credentials, defineExchange, exchangeFetch, hmacHex, query, splitSymbol, type CandleInterval, type ExchangeAdapter } from "./common.js";

const NAME = "بای‌بیت";
const BASE = "https://api.bybit.com";
const RECV_WINDOW = "5000";
const INTERVALS: Record<CandleInterval, string> = { "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D", "1w": "W" };

export function bybitSign(secret: string, timestamp: string, apiKey: string, recvWindow: string, payload: string): string {
  return hmacHex("sha256", secret, `${timestamp}${apiKey}${recvWindow}${payload}`);
}

function unwrap(data: any) {
  if (data?.retCode !== 0) throw new ProviderError(`${NAME}: ${data?.retMsg || "خطای ناشناخته"}`, data);
  return data.result;
}

async function pub(ctx: ProviderContext, path: string, params: Record<string, string | number | undefined>) {
  return unwrap(await exchangeFetch(NAME, `${baseOf(ctx, BASE)}${path}?${query(params)}`));
}

async function signed(ctx: ProviderContext, method: "GET" | "POST", path: string, params: Record<string, string | number | undefined>) {
  const { apiKey, apiSecret } = credentials(ctx, NAME);
  const timestamp = String(Date.now());
  const qs = method === "GET" ? query(params) : "";
  const body = method === "POST" ? JSON.stringify(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ""))) : "";
  const data = await exchangeFetch(NAME, `${baseOf(ctx, BASE)}${path}${qs ? `?${qs}` : ""}`, {
    method,
    body: body || undefined,
    headers: {
      "X-BAPI-API-KEY": apiKey,
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-RECV-WINDOW": RECV_WINDOW,
      "X-BAPI-SIGN": bybitSign(apiSecret, timestamp, apiKey, RECV_WINDOW, method === "GET" ? qs : body),
      ...(body ? { "content-type": "application/json" } : {}),
    },
  });
  return unwrap(data);
}

const adapter: ExchangeAdapter = {
  id: "bybit",
  name: "Bybit",
  nameFa: NAME,
  color: "#f7a600",
  glyph: "By",
  docsUrl: "https://bybit-exchange.github.io/docs/v5/intro",
  defaultBase: BASE,
  symbolExample: "BTCUSDT",
  keyHelp: "از Bybit ← API ← Create New Key بسازید. برای خواندن موجودی دسترسی Read-Only کافی است؛ دسترسی برداشت را روشن نکنید.",
  symbol: (input) => splitSymbol(input)?.join("") ?? input.trim().toUpperCase(),

  async ticker(ctx, symbol) {
    const t = (await pub(ctx, "/v5/market/tickers", { category: "spot", symbol })).list?.[0];
    if (!t) throw new ProviderError(`${NAME}: نماد ${symbol} پیدا نشد.`);
    return {
      symbol: t.symbol,
      last: t.lastPrice,
      bid: t.bid1Price,
      ask: t.ask1Price,
      high24h: t.highPrice24h,
      low24h: t.lowPrice24h,
      volume24h: t.volume24h,
      changePercent24h: t.price24hPcnt === undefined ? undefined : String(Number((Number(t.price24hPcnt) * 100).toFixed(4))),
    };
  },

  async orderBook(ctx, symbol, depth) {
    const b = await pub(ctx, "/v5/market/orderbook", { category: "spot", symbol, limit: depth });
    return { symbol, bids: b.b ?? [], asks: b.a ?? [] };
  },

  async candles(ctx, symbol, interval, limit) {
    const rows: string[][] = (await pub(ctx, "/v5/market/kline", { category: "spot", symbol, interval: INTERVALS[interval], limit })).list ?? [];
    return rows.map((r) => ({ time: new Date(Number(r[0])).toISOString(), open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
  },

  async balances(ctx) {
    const account = (await signed(ctx, "GET", "/v5/account/wallet-balance", { accountType: "UNIFIED" })).list?.[0];
    return (account?.coin ?? []).map((c: any) => ({ asset: c.coin, free: String(Number(c.walletBalance) - Number(c.locked || 0)), locked: String(c.locked || "0") }));
  },

  async openOrders(ctx, symbol) {
    const rows: any[] = (await signed(ctx, "GET", "/v5/order/realtime", { category: "spot", symbol })).list ?? [];
    return rows.map((o) => ({
      id: o.orderId,
      symbol: o.symbol,
      side: String(o.side).toLowerCase() === "sell" ? "sell" : "buy",
      type: String(o.orderType).toLowerCase(),
      price: o.price,
      quantity: o.qty,
      filled: o.cumExecQty,
      status: o.orderStatus,
      createdAt: o.createdTime ? new Date(Number(o.createdTime)).toISOString() : undefined,
    }));
  },

  async placeOrder(ctx, order) {
    const raw = await signed(ctx, "POST", "/v5/order/create", {
      category: "spot",
      symbol: order.symbol,
      side: order.side === "buy" ? "Buy" : "Sell",
      orderType: order.type === "market" ? "Market" : "Limit",
      qty: order.quantity,
      price: order.price,
      marketUnit: order.type === "market" ? "baseCoin" : undefined,
    });
    return { id: String(raw.orderId), raw };
  },

  cancelOrder: (ctx, symbol, orderId) => signed(ctx, "POST", "/v5/order/cancel", { category: "spot", symbol, orderId }),
};

export const bybit = defineExchange(adapter);
