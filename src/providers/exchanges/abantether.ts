import type { ProviderContext } from "../../core/types.js";
import { ProviderError } from "../../core/types.js";
import { baseOf, credentials, defineExchange, exchangeFetch, query, splitByQuote, trimDecimal, type ExchangeAdapter } from "./common.js";

const NAME = "آبان‌تتر";
const BASE = "https://api.abantether.ir";
const QUOTES = ["IRT", "TMN", "USDT"];
const OPEN_STATUSES = new Set(["new", "processing", "fee_calculated", "accounting_blocked", "open"]);

function toSymbol(input: string): string {
  const parts = splitByQuote(input, QUOTES);
  if (!parts) return input.trim().toUpperCase();
  return `${parts[0]}${parts[1] === "TMN" ? "IRT" : parts[1]}`;
}

function pair(symbol: string): { base: string; quote: string } {
  const parts = splitByQuote(symbol, QUOTES);
  if (!parts) throw new ProviderError(`${NAME}: نماد ${symbol} شناخته نشد. نمونه: BTCIRT یا BTCUSDT.`);
  return { base: parts[0], quote: parts[1] === "TMN" ? "IRT" : parts[1] };
}

async function call(ctx: ProviderContext, path: string, init: { method?: "GET" | "POST"; body?: Record<string, unknown>; auth?: boolean } = {}) {
  const headers: Record<string, string> = {};
  if (init.auth) headers.authorization = credentials(ctx, NAME, false, "none").apiKey;
  if (init.body) headers["content-type"] = "application/json";
  const data = await exchangeFetch(NAME, `${baseOf(ctx, BASE)}${path}`, { method: init.method, headers, body: init.body ? JSON.stringify(init.body) : undefined });
  return data?.data;
}

const adapter: ExchangeAdapter = {
  id: "abantether",
  name: "AbanTether",
  nameFa: NAME,
  region: "iran",
  color: "#f59e0b",
  glyph: "آ",
  docsUrl: "https://docs.abantether.ir",
  defaultBase: BASE,
  symbolExample: "BTCIRT",
  secret: "none",
  keyHelp: "از پنل آبان‌تتر ← حساب کاربری، Api-Key را بردارید. این کلید منقضی نمی‌شود و دسترسی کامل به حساب می‌دهد؛ فقط روی سرور خودتان نگهش دارید.",
  note:
    "AbanTether is an OTC desk, not an order book: `ask` is the price you buy at and `bid` is the price you sell at; `last` equals the buy price. Prices are listed for IRT markets, in Toman.",
  quantityHint:
    "For SELL orders: amount of the coin to sell. For BUY orders: amount of the quote currency to spend (Toman for IRT markets, USDT for USDT markets). Decimal string.",
  symbol: toSymbol,

  async ticker(ctx, symbol) {
    const { base } = pair(symbol);
    const market = (await call(ctx, `/api/v1/manager/otc/ticker?${query({ coin: base })}`))?.markets?.[symbol];
    if (!market) throw new ProviderError(`${NAME}: بازار ${symbol} پیدا نشد.`);
    if (market.active === false) throw new ProviderError(`${NAME}: بازار ${symbol} در حال حاضر غیرفعال است.`);
    return { symbol, last: trimDecimal(market.buy_price), bid: trimDecimal(market.sell_price), ask: trimDecimal(market.buy_price) };
  },

  async balances(ctx) {
    const rows: any[] = (await call(ctx, "/api/v1/accounting/balances?type=spot", { auth: true })) ?? [];
    const clean = (v: unknown) => (Number(v) === 0 ? "0" : trimDecimal(v));
    return rows.map((b) => ({ asset: String(b.symbol ?? b.asset?.symbol), free: clean(b.available ?? b.balance), locked: clean(b.blocked) }));
  },

  async openOrders(ctx, symbol) {
    const filter = symbol ? pair(symbol) : undefined;
    const rows: any[] = (await call(ctx, `/api/v1/order_handler/orders/otc?${query({ base_symbol: filter?.base, quote_symbol: filter?.quote, per_page: 50 })}`, { auth: true })) ?? [];
    return rows
      .filter((o) => OPEN_STATUSES.has(String(o.status)))
      .map((o) => ({
        id: String(o.id),
        symbol: `${o.base_symbol}${o.quote_symbol}`,
        side: o.side === "sell" ? "sell" : "buy",
        type: String(o.type ?? ""),
        price: String(o.price ?? ""),
        quantity: String(o.side === "sell" ? o.volume?.base : o.volume?.quote),
        filled: String(o.side === "sell" ? o.filled_volume?.base : o.filled_volume?.quote),
        status: String(o.status ?? ""),
        createdAt: o.created_at,
      }));
  },

  async placeOrder(ctx, order) {
    const { base, quote } = pair(order.symbol);
    const raw = await call(ctx, `/api/v1/order_handler/orders/otc/${order.type}`, {
      method: "POST",
      auth: true,
      body: { side: order.side, base_symbol: base, quote_symbol: quote, volume: order.quantity, ...(order.price ? { price: order.price } : {}) },
    });
    return { id: String(raw?.id ?? ""), raw };
  },

  cancelOrder: (ctx, _symbol, orderId) => call(ctx, `/api/v1/order_handler/orders/otc/${encodeURIComponent(orderId)}/cancel`, { method: "POST", auth: true }),
};

export const abantether = defineExchange(adapter);
