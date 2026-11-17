import type { ProviderContext } from "../../core/types.js";
import { ProviderError } from "../../core/types.js";
import { baseOf, credentials, decimalMinus, defineExchange, exchangeFetch, query, splitByQuote, trimDecimal, type ExchangeAdapter } from "./common.js";

const NAME = "بیت‌پین";
const BASE = "https://api.bitpin.ir";
const QUOTES = ["IRT", "TMN", "USDT"];
const TOKEN_TTL_MS = 12 * 60_000;

const tokens = new Map<string, { access: string; expires: number }>();

function toSymbol(input: string): string {
  const parts = splitByQuote(input, QUOTES);
  if (!parts) return input.trim().toUpperCase();
  return `${parts[0]}_${parts[1] === "TMN" ? "IRT" : parts[1]}`;
}

async function accessToken(ctx: ProviderContext, fresh = false): Promise<string> {
  const { apiKey, apiSecret } = credentials(ctx, NAME);
  const base = baseOf(ctx, BASE);
  const cacheKey = `${base}|${apiKey}`;
  const cached = tokens.get(cacheKey);
  if (!fresh && cached && cached.expires > Date.now()) return cached.access;
  const data = await exchangeFetch(NAME, `${base}/api/v1/usr/authenticate/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, secret_key: apiSecret }),
  });
  if (!data?.access) throw new ProviderError(`${NAME}: ورود با کلید API انجام نشد.`);
  tokens.set(cacheKey, { access: String(data.access), expires: Date.now() + TOKEN_TTL_MS });
  return String(data.access);
}

async function authed(ctx: ProviderContext, method: "GET" | "POST" | "DELETE", path: string, payload?: Record<string, unknown>) {
  const send = async (fresh: boolean) =>
    exchangeFetch(NAME, `${baseOf(ctx, BASE)}${path}`, {
      method,
      headers: { authorization: `Bearer ${await accessToken(ctx, fresh)}`, ...(payload ? { "content-type": "application/json" } : {}) },
      body: payload ? JSON.stringify(payload) : undefined,
    });
  try {
    return await send(false);
  } catch (err: any) {
    if (err?.details?.status !== 401) throw err;
    return send(true);
  }
}

const rowsOf = (data: any): any[] => (Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : []);

const adapter: ExchangeAdapter = {
  id: "bitpin",
  name: "Bitpin",
  nameFa: NAME,
  region: "iran",
  color: "#0f9d76",
  glyph: "بپ",
  docsUrl: "https://docs.bitpin.ir",
  defaultBase: BASE,
  symbolExample: "BTC_IRT",
  secretLabel: "Secret Key",
  keyHelp: "از پنل بیت‌پین ← تنظیمات ← کلید API بسازید و API Key و Secret Key را اینجا بگذارید. دسترسی برداشت را روشن نکنید.",
  note: "On Bitpin, IRT markets are quoted in Toman; USDT markets are in USDT.",
  symbol: toSymbol,

  async ticker(ctx, symbol) {
    const rows = rowsOf(await exchangeFetch(NAME, `${baseOf(ctx, BASE)}/api/v1/mkt/tickers/`));
    const t = rows.find((r) => r.symbol === symbol);
    if (!t) throw new ProviderError(`${NAME}: بازار ${symbol} پیدا نشد.`);
    return {
      symbol,
      last: String(t.price),
      high24h: t.high === undefined ? undefined : String(t.high),
      low24h: t.low === undefined ? undefined : String(t.low),
      changePercent24h: t.daily_change_price === undefined ? undefined : String(t.daily_change_price),
    };
  },

  async orderBook(ctx, symbol, depth) {
    const book = await exchangeFetch(NAME, `${baseOf(ctx, BASE)}/api/v1/mth/orderbook/${encodeURIComponent(symbol)}/`);
    const side = (rows: any[] = []): [string, string][] => rows.slice(0, depth).map((r) => [String(r[0]), String(r[1])]);
    return { symbol, bids: side(book?.bids), asks: side(book?.asks) };
  },

  async balances(ctx) {
    return rowsOf(await authed(ctx, "GET", "/api/v1/wlt/wallets/")).map((w) => ({ asset: String(w.asset), free: decimalMinus(w.balance, w.frozen), locked: trimDecimal(w.frozen ?? "0") }));
  },

  async openOrders(ctx, symbol) {
    return rowsOf(await authed(ctx, "GET", `/api/v1/odr/orders/?${query({ state: "active", symbol })}`)).map((o) => ({
      id: String(o.id),
      symbol: String(o.symbol),
      side: o.side === "sell" ? "sell" : "buy",
      type: String(o.type ?? ""),
      price: String(o.price ?? ""),
      quantity: String(o.base_amount ?? ""),
      filled: String(o.dealed_base_amount ?? "0"),
      status: String(o.state ?? ""),
      createdAt: o.created_at,
    }));
  },

  async placeOrder(ctx, order) {
    const raw = await authed(ctx, "POST", "/api/v1/odr/orders/", {
      symbol: order.symbol,
      type: order.type,
      side: order.side,
      base_amount: order.quantity,
      ...(order.price ? { price: order.price } : {}),
    });
    return { id: String(raw?.id ?? ""), raw };
  },

  cancelOrder: (ctx, _symbol, orderId) => authed(ctx, "DELETE", `/api/v1/odr/orders/${encodeURIComponent(orderId)}/`),
};

export const bitpin = defineExchange(adapter);
