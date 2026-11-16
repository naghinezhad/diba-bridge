/** OKX — REST API v5، بازار spot (https://www.okx.com/docs-v5/en/) */
import type { ProviderContext } from "../../core/types.js";
import { ProviderError } from "../../core/types.js";
import { baseOf, credentials, defineExchange, exchangeFetch, hmacBase64, query, splitSymbol, type CandleInterval, type ExchangeAdapter } from "./common.js";

const NAME = "او‌کی‌ایکس";
const BASE = "https://www.okx.com";
const INTERVALS: Record<CandleInterval, string> = { "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D", "1w": "1W" };

/** امضای OKX: Base64(HMAC-SHA256) روی «timestamp + METHOD + مسیر با پرس‌وجو + بدنه» */
export function okxSign(secret: string, timestamp: string, method: string, requestPath: string, body = ""): string {
  return hmacBase64("sha256", secret, `${timestamp}${method.toUpperCase()}${requestPath}${body}`);
}

/** OKX خطا را با HTTP 200 و code غیر "0" برمی‌گرداند؛ جزئیات سفارش ناموفق در sMsg است */
function unwrap(data: any): any[] {
  if (String(data?.code) !== "0") {
    const detail = Array.isArray(data?.data) ? data.data.map((d: any) => d?.sMsg).filter(Boolean).join("، ") : "";
    throw new ProviderError(`${NAME}: ${detail || data?.msg || "خطای ناشناخته"}`, data);
  }
  return data.data ?? [];
}

async function pub(ctx: ProviderContext, path: string, params: Record<string, string | number | undefined>) {
  return unwrap(await exchangeFetch(NAME, `${baseOf(ctx, BASE)}${path}?${query(params)}`));
}

async function signed(ctx: ProviderContext, method: "GET" | "POST", path: string, params: Record<string, string | number | undefined> = {}) {
  const { apiKey, apiSecret, passphrase } = credentials(ctx, NAME, true);
  const qs = method === "GET" ? query(params) : "";
  const requestPath = `${path}${qs ? `?${qs}` : ""}`;
  const body = method === "POST" ? JSON.stringify(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ""))) : "";
  const timestamp = new Date().toISOString();
  const data = await exchangeFetch(NAME, `${baseOf(ctx, BASE)}${requestPath}`, {
    method,
    body: body || undefined,
    headers: {
      "OK-ACCESS-KEY": apiKey,
      "OK-ACCESS-SIGN": okxSign(apiSecret, timestamp, method, requestPath, body),
      "OK-ACCESS-TIMESTAMP": timestamp,
      "OK-ACCESS-PASSPHRASE": passphrase,
      ...(body ? { "content-type": "application/json" } : {}),
    },
  });
  return unwrap(data);
}

const adapter: ExchangeAdapter = {
  id: "okx",
  name: "OKX",
  nameFa: NAME,
  color: "#111111",
  glyph: "OK",
  docsUrl: "https://www.okx.com/docs-v5/en/",
  defaultBase: BASE,
  symbolExample: "BTC-USDT",
  needsPassphrase: true,
  keyHelp: "از OKX ← API ← Create API key بسازید. برای خواندن موجودی دسترسی Read کافی است؛ دسترسی Withdraw را روشن نکنید.",
  symbol: (input) => splitSymbol(input)?.join("-") ?? input.trim().toUpperCase(),

  async ticker(ctx, symbol) {
    const t = (await pub(ctx, "/api/v5/market/ticker", { instId: symbol }))[0];
    if (!t) throw new ProviderError(`${NAME}: نماد ${symbol} پیدا نشد.`);
    const open = Number(t.open24h);
    return {
      symbol: t.instId,
      last: t.last,
      bid: t.bidPx,
      ask: t.askPx,
      high24h: t.high24h,
      low24h: t.low24h,
      volume24h: t.vol24h,
      changePercent24h: open > 0 ? String(Number((((Number(t.last) - open) / open) * 100).toFixed(4))) : undefined,
    };
  },

  async orderBook(ctx, symbol, depth) {
    const b = (await pub(ctx, "/api/v5/market/books", { instId: symbol, sz: depth }))[0] ?? {};
    const levels = (rows: string[][] = []) => rows.map((r) => [r[0], r[1]] as [string, string]);
    return { symbol, bids: levels(b.bids), asks: levels(b.asks) };
  },

  async candles(ctx, symbol, interval, limit) {
    const rows = (await pub(ctx, "/api/v5/market/candles", { instId: symbol, bar: INTERVALS[interval], limit })) as string[][];
    return rows.map((r) => ({ time: new Date(Number(r[0])).toISOString(), open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
  },

  async balances(ctx) {
    const account = (await signed(ctx, "GET", "/api/v5/account/balance"))[0];
    return (account?.details ?? []).map((d: any) => ({ asset: d.ccy, free: d.availBal ?? d.cashBal ?? "0", locked: d.frozenBal ?? "0" }));
  },

  async openOrders(ctx, symbol) {
    const rows = await signed(ctx, "GET", "/api/v5/trade/orders-pending", { instType: "SPOT", instId: symbol });
    return rows.map((o: any) => ({
      id: o.ordId,
      symbol: o.instId,
      side: o.side === "sell" ? "sell" : "buy",
      type: o.ordType,
      price: o.px,
      quantity: o.sz,
      filled: o.accFillSz,
      status: o.state,
      createdAt: o.cTime ? new Date(Number(o.cTime)).toISOString() : undefined,
    }));
  },

  async placeOrder(ctx, order) {
    const raw = (
      await signed(ctx, "POST", "/api/v5/trade/order", {
        instId: order.symbol,
        tdMode: "cash",
        side: order.side,
        ordType: order.type,
        sz: order.quantity,
        px: order.price,
        // بدون این، مقدار خرید market به واحد ارز نقل‌قول تفسیر می‌شود
        tgtCcy: order.type === "market" ? "base_ccy" : undefined,
      })
    )[0];
    return { id: String(raw?.ordId ?? ""), raw };
  },

  cancelOrder: async (ctx, symbol, orderId) => (await signed(ctx, "POST", "/api/v5/trade/cancel-order", { instId: symbol, ordId: orderId }))[0],
};

export const okx = defineExchange(adapter);
