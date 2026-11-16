/** کوکوین — Spot REST API (https://www.kucoin.com/docs/rest/) */
import { randomUUID } from "node:crypto";
import type { ProviderContext } from "../../core/types.js";
import { ProviderError } from "../../core/types.js";
import { baseOf, credentials, defineExchange, exchangeFetch, hmacBase64, query, splitSymbol, type CandleInterval, type ExchangeAdapter } from "./common.js";

const NAME = "کوکوین";
const BASE = "https://api.kucoin.com";
const INTERVALS: Record<CandleInterval, string> = { "1m": "1min", "5m": "5min", "15m": "15min", "1h": "1hour", "4h": "4hour", "1d": "1day", "1w": "1week" };
const SECONDS: Record<CandleInterval, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800 };

/** امضای کوکوین: Base64(HMAC-SHA256) روی «timestamp + METHOD + مسیر با پرس‌وجو + بدنه» */
export function kucoinSign(secret: string, timestamp: string, method: string, endpoint: string, body = ""): string {
  return hmacBase64("sha256", secret, `${timestamp}${method.toUpperCase()}${endpoint}${body}`);
}

/** در نسخه‌ی ۲ کلیدها، خود Passphrase هم با رمز API امضا می‌شود */
export function kucoinPassphrase(secret: string, passphrase: string): string {
  return hmacBase64("sha256", secret, passphrase);
}

/** کوکوین خطا را با code غیر "200000" برمی‌گرداند */
function unwrap(data: any) {
  if (String(data?.code) !== "200000") throw new ProviderError(`${NAME}: ${data?.msg || "خطای ناشناخته"}`, data);
  return data.data;
}

async function pub(ctx: ProviderContext, path: string, params: Record<string, string | number | undefined>) {
  return unwrap(await exchangeFetch(NAME, `${baseOf(ctx, BASE)}${path}?${query(params)}`));
}

async function signed(ctx: ProviderContext, method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string | number | undefined> = {}) {
  const { apiKey, apiSecret, passphrase } = credentials(ctx, NAME, true);
  const qs = method === "POST" ? "" : query(params);
  const endpoint = `${path}${qs ? `?${qs}` : ""}`;
  const body = method === "POST" ? JSON.stringify(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ""))) : "";
  const timestamp = String(Date.now());
  const data = await exchangeFetch(NAME, `${baseOf(ctx, BASE)}${endpoint}`, {
    method,
    body: body || undefined,
    headers: {
      "KC-API-KEY": apiKey,
      "KC-API-SIGN": kucoinSign(apiSecret, timestamp, method, endpoint, body),
      "KC-API-TIMESTAMP": timestamp,
      "KC-API-PASSPHRASE": kucoinPassphrase(apiSecret, passphrase),
      "KC-API-KEY-VERSION": "2",
      ...(body ? { "content-type": "application/json" } : {}),
    },
  });
  return unwrap(data);
}

const adapter: ExchangeAdapter = {
  id: "kucoin",
  name: "KuCoin",
  nameFa: NAME,
  color: "#24ae8f",
  glyph: "K",
  docsUrl: "https://www.kucoin.com/docs/rest/",
  defaultBase: BASE,
  symbolExample: "BTC-USDT",
  needsPassphrase: true,
  keyHelp: "از KuCoin ← API Management بسازید. برای خواندن موجودی دسترسی General کافی است؛ دسترسی Withdrawal را روشن نکنید.",
  symbol: (input) => splitSymbol(input)?.join("-") ?? input.trim().toUpperCase(),

  async ticker(ctx, symbol) {
    const t = await pub(ctx, "/api/v1/market/stats", { symbol });
    if (!t?.last) throw new ProviderError(`${NAME}: نماد ${symbol} پیدا نشد.`);
    return {
      symbol: t.symbol,
      last: t.last,
      bid: t.buy,
      ask: t.sell,
      high24h: t.high,
      low24h: t.low,
      volume24h: t.vol,
      // کوکوین نسبت می‌دهد (0.0123)؛ به درصد تبدیل می‌شود
      changePercent24h: t.changeRate === undefined || t.changeRate === null ? undefined : String(Number((Number(t.changeRate) * 100).toFixed(4))),
    };
  },

  async orderBook(ctx, symbol, depth) {
    const b = await pub(ctx, depth <= 20 ? "/api/v1/market/orderbook/level2_20" : "/api/v1/market/orderbook/level2_100", { symbol });
    const levels = (rows: string[][] = []) => rows.slice(0, depth).map((r) => [r[0], r[1]] as [string, string]);
    return { symbol, bids: levels(b?.bids), asks: levels(b?.asks) };
  },

  async candles(ctx, symbol, interval, limit) {
    // این اندپوینت limit ندارد؛ بازه‌ی زمانی به اندازه‌ی همان تعداد کندل خواسته می‌شود
    const endAt = Math.floor(Date.now() / 1000);
    const rows: string[][] = (await pub(ctx, "/api/v1/market/candles", { symbol, type: INTERVALS[interval], startAt: endAt - SECONDS[interval] * (limit + 1), endAt })) ?? [];
    // ترتیب ستون‌های کوکوین: زمان، باز، بسته، بالا، پایین، حجم
    return rows.slice(0, limit).map((r) => ({ time: new Date(Number(r[0]) * 1000).toISOString(), open: r[1], close: r[2], high: r[3], low: r[4], volume: r[5] }));
  },

  async balances(ctx) {
    const rows: any[] = (await signed(ctx, "GET", "/api/v1/accounts", { type: "trade" })) ?? [];
    return rows.map((a) => ({ asset: a.currency, free: a.available, locked: a.holds }));
  },

  async openOrders(ctx, symbol) {
    const rows: any[] = (await signed(ctx, "GET", "/api/v1/orders", { status: "active", symbol }))?.items ?? [];
    return rows.map((o) => ({
      id: o.id,
      symbol: o.symbol,
      side: o.side === "sell" ? "sell" : "buy",
      type: o.type,
      price: o.price,
      quantity: o.size,
      filled: o.dealSize,
      status: o.isActive ? "active" : "done",
      createdAt: o.createdAt ? new Date(Number(o.createdAt)).toISOString() : undefined,
    }));
  },

  async placeOrder(ctx, order) {
    // clientOid یکتا جلوی ثبت دوباره‌ی همان سفارش در تلاش مجدد را می‌گیرد
    const raw = await signed(ctx, "POST", "/api/v1/orders", { clientOid: randomUUID(), side: order.side, symbol: order.symbol, type: order.type, size: order.quantity, price: order.price });
    return { id: String(raw?.orderId ?? ""), raw };
  },

  cancelOrder: (ctx, _symbol, orderId) => signed(ctx, "DELETE", `/api/v1/orders/${encodeURIComponent(orderId)}`),
};

export const kucoin = defineExchange(adapter);
