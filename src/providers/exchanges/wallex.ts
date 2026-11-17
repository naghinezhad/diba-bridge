import type { ProviderContext } from "../../core/types.js";
import { ProviderError } from "../../core/types.js";
import { baseOf, credentials, decimalMinus, defineExchange, exchangeFetch, query, splitByQuote, trimDecimal, type CandleInterval, type ExchangeAdapter } from "./common.js";

const NAME = "والکس";
const BASE = "https://api.wallex.ir";
const QUOTES = ["TMN", "IRT", "USDT"];
const RESOLUTIONS: Partial<Record<CandleInterval, [string, number]>> = { "1m": ["1", 60], "1h": ["60", 3600], "1d": ["1D", 86_400] };

function toSymbol(input: string): string {
  const parts = splitByQuote(input, QUOTES);
  if (!parts) return input.trim().toUpperCase();
  return `${parts[0]}${parts[1] === "IRT" ? "TMN" : parts[1]}`;
}

function unwrap(data: any) {
  if (data?.success === false) {
    const details = data.result && typeof data.result === "object" ? Object.values(data.result).flat().join(" ") : "";
    throw new ProviderError(`${NAME}: ${[data.message, details].filter(Boolean).join(" ") || "خطای ناشناخته"}`, data);
  }
  return data?.result;
}

async function call(ctx: ProviderContext, path: string, init: { method?: "GET" | "POST" | "DELETE"; body?: string; auth?: boolean } = {}) {
  const headers: Record<string, string> = {};
  if (init.auth) headers["X-API-Key"] = credentials(ctx, NAME, false, "none").apiKey;
  if (init.body) headers["content-type"] = "application/json";
  try {
    return unwrap(await exchangeFetch(NAME, `${baseOf(ctx, BASE)}${path}`, { method: init.method, headers, body: init.body }));
  } catch (err: any) {
    const body = err?.details?.body;
    if (body && typeof body === "object" && body.success === false) unwrap(body);
    throw err;
  }
}

const adapter: ExchangeAdapter = {
  id: "wallex",
  name: "Wallex",
  nameFa: NAME,
  region: "iran",
  color: "#1d4ed8",
  glyph: "و",
  docsUrl: "https://developers.wallex.ir",
  defaultBase: BASE,
  symbolExample: "BTCTMN",
  secret: "none",
  keyHelp: "از پنل والکس ← تنظیمات ← مدیریت API یک کلید بسازید. برای خواندن موجودی دسترسی مشاهده کافی است؛ دسترسی برداشت را روشن نکنید.",
  note: "On Wallex, TMN markets are quoted in Toman (IRT); USDT markets are in USDT.",
  symbol: toSymbol,

  async ticker(ctx, symbol) {
    const market = (await call(ctx, "/v1/markets"))?.symbols?.[symbol];
    if (!market?.stats) throw new ProviderError(`${NAME}: بازار ${symbol} پیدا نشد.`);
    const s = market.stats;
    return {
      symbol,
      last: trimDecimal(s.lastPrice),
      bid: trimDecimal(s.bidPrice),
      ask: trimDecimal(s.askPrice),
      high24h: trimDecimal(s["24h_highPrice"]),
      low24h: trimDecimal(s["24h_lowPrice"]),
      volume24h: trimDecimal(s["24h_volume"]),
      changePercent24h: s["24h_ch"] === undefined ? undefined : String(s["24h_ch"]),
    };
  },

  async orderBook(ctx, symbol, depth) {
    const book = await call(ctx, `/v1/depth?${query({ symbol })}`);
    const side = (rows: any[] = []): [string, string][] => rows.slice(0, depth).map((r) => [String(r.price), String(r.quantity)]);
    return { symbol, bids: side(book?.bid), asks: side(book?.ask) };
  },

  async candles(ctx, symbol, interval, limit) {
    const resolution = RESOLUTIONS[interval];
    if (!resolution) throw new ProviderError(`${NAME}: کندل ${interval} پشتیبانی نمی‌شود. بازه‌های موجود: ${Object.keys(RESOLUTIONS).join("، ")}.`);
    const to = Math.floor(Date.now() / 1000);
    const data = await exchangeFetch(NAME, `${baseOf(ctx, BASE)}/v1/udf/history?${query({ symbol, resolution: resolution[0], from: to - resolution[1] * (limit + 1), to })}`);
    if (data?.s === "no_data") return [];
    if (data?.s !== "ok") throw new ProviderError(`${NAME}: ${data?.errmsg || "کندل‌ها خوانده نشد"}`, data);
    const times: number[] = data.t ?? [];
    return times
      .map((t, i) => ({ time: new Date(t * 1000).toISOString(), open: String(data.o[i]), high: String(data.h[i]), low: String(data.l[i]), close: String(data.c[i]), volume: String(data.v[i]) }))
      .slice(-limit);
  },

  async balances(ctx) {
    const balances: Record<string, any> = (await call(ctx, "/v1/account/balances", { auth: true }))?.balances ?? {};
    return Object.values(balances).map((b) => ({ asset: String(b.asset), free: decimalMinus(b.value, b.locked), locked: trimDecimal(b.locked ?? "0") }));
  },

  async openOrders(ctx, symbol) {
    const rows: any[] = (await call(ctx, `/v1/account/openOrders${symbol ? `?${query({ symbol })}` : ""}`, { auth: true }))?.orders ?? [];
    return rows.map((o) => ({
      id: String(o.clientOrderId),
      symbol: String(o.symbol),
      side: String(o.side).toLowerCase() === "sell" ? "sell" : "buy",
      type: String(o.type ?? "").toLowerCase(),
      price: trimDecimal(o.price),
      quantity: trimDecimal(o.origQty),
      filled: trimDecimal(o.executedQty ?? "0"),
      status: String(o.status ?? ""),
      createdAt: o.created_at,
    }));
  },

  async placeOrder(ctx, order) {
    const raw = await call(ctx, "/v1/account/orders", {
      method: "POST",
      auth: true,
      body: JSON.stringify({
        symbol: order.symbol,
        type: order.type === "market" ? "MARKET" : "LIMIT",
        side: order.side === "buy" ? "BUY" : "SELL",
        quantity: order.quantity,
        ...(order.price ? { price: order.price } : {}),
      }),
    });
    return { id: String(raw?.clientOrderId ?? ""), raw };
  },

  cancelOrder: (ctx, _symbol, orderId) => call(ctx, `/v1/account/orders?${query({ clientOrderId: orderId })}`, { method: "DELETE", auth: true }),
};

export const wallex = defineExchange(adapter);
