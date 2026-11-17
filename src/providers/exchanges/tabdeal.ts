/**
 * تبدیل — API رسمی، هم‌شکل با API بایننس (https://docs.tabdeal.org).
 * خواندن‌ها از مسیر `/r/api/v1` و ثبت و لغو سفارش از `/api/v1` می‌روند. درخواست‌های حساب با
 * HMAC-SHA256 روی رشته‌ی پارامترها امضا می‌شوند. قیمت بازارهای تومانی به تومان است.
 * تبدیل آمار ۲۴ساعته و کندل عمومی ندارد؛ قیمت از آخرین معامله و دفتر سفارش ساخته می‌شود.
 */
import type { ProviderContext } from "../../core/types.js";
import { ProviderError } from "../../core/types.js";
import { baseOf, credentials, defineExchange, exchangeFetch, hmacHex, query, splitByQuote, trimDecimal, type ExchangeAdapter } from "./common.js";

const NAME = "تبدیل";
const BASE = "https://api1.tabdeal.org";
const QUOTES = ["IRT", "TMN", "USDT"];

/** امضای تبدیل: HMAC-SHA256 روی همان رشته‌ی پارامترهایی که فرستاده می‌شود، به شکل hex */
export function tabdealSign(secret: string, queryString: string): string {
  return hmacHex("sha256", secret, queryString);
}

/** نماد تبدیل: «BTCIRT» یا «BTCUSDT» */
function toSymbol(input: string): string {
  const parts = splitByQuote(input, QUOTES);
  if (!parts) return input.trim().toUpperCase();
  return `${parts[0]}${parts[1] === "TMN" ? "IRT" : parts[1]}`;
}

const readPath = (path: string) => `/r/api/v1${path}`;
const writePath = (path: string) => `/api/v1${path}`;

async function pub(ctx: ProviderContext, path: string, params: Record<string, string | number | undefined>) {
  return exchangeFetch(NAME, `${baseOf(ctx, BASE)}${readPath(path)}?${query(params)}`);
}

async function signed(ctx: ProviderContext, method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string | number | undefined> = {}) {
  const { apiKey, apiSecret } = credentials(ctx, NAME);
  const qs = query({ ...params, timestamp: Date.now() });
  const url = `${baseOf(ctx, BASE)}${method === "GET" ? readPath(path) : writePath(path)}?${qs}&signature=${tabdealSign(apiSecret, qs)}`;
  return exchangeFetch(NAME, url, { method, headers: { "X-MBX-APIKEY": apiKey } });
}

const adapter: ExchangeAdapter = {
  id: "tabdeal",
  name: "Tabdeal",
  nameFa: NAME,
  region: "iran",
  color: "#0b6bcb",
  glyph: "ت",
  docsUrl: "https://docs.tabdeal.org",
  defaultBase: BASE,
  symbolExample: "BTCIRT",
  keyHelp: "از پنل تبدیل ← تنظیمات ← API یک کلید بسازید. برای خواندن موجودی دسترسی خواندن کافی است؛ دسترسی برداشت را روشن نکنید.",
  note: "On Tabdeal, IRT markets are quoted in Toman; USDT markets are in USDT. Tabdeal has no 24h statistics, so the ticker only carries last, bid and ask.",
  symbol: toSymbol,

  async ticker(ctx, symbol) {
    const [trades, book] = await Promise.all([pub(ctx, "/trades", { symbol, limit: 5 }), pub(ctx, "/depth", { symbol, limit: 5 })]);
    const latest = (Array.isArray(trades) ? trades : []).sort((a: any, b: any) => Number(b.time) - Number(a.time))[0];
    if (!latest) throw new ProviderError(`${NAME}: برای ${symbol} معامله‌ای پیدا نشد.`);
    return { symbol, last: trimDecimal(latest.price), bid: book?.bids?.[0] ? trimDecimal(book.bids[0][0]) : undefined, ask: book?.asks?.[0] ? trimDecimal(book.asks[0][0]) : undefined };
  },

  async orderBook(ctx, symbol, depth) {
    const book = await pub(ctx, "/depth", { symbol, limit: depth });
    const side = (rows: any[] = []): [string, string][] => rows.slice(0, depth).map((r) => [trimDecimal(r[0]), trimDecimal(r[1])]);
    return { symbol, bids: side(book?.bids), asks: side(book?.asks) };
  },

  async balances(ctx) {
    const rows = await signed(ctx, "GET", "/get-funding-asset");
    return (Array.isArray(rows) ? rows : []).map((w: any) => ({ asset: String(w.asset), free: trimDecimal(w.free ?? "0"), locked: trimDecimal(w.freeze ?? "0") }));
  },

  async openOrders(ctx, symbol) {
    const rows = await signed(ctx, "GET", "/openOrders", { symbol });
    return (Array.isArray(rows) ? rows : []).map((o: any) => ({
      id: String(o.orderId),
      symbol: String(o.symbol),
      side: String(o.side).toLowerCase() === "sell" ? "sell" : "buy",
      type: String(o.type ?? "").toLowerCase(),
      price: trimDecimal(o.price),
      quantity: trimDecimal(o.origQty),
      filled: trimDecimal(o.executedQty ?? "0"),
      status: String(o.status ?? ""),
      createdAt: o.transactTime || o.updateTime ? new Date(Number(o.transactTime || o.updateTime)).toISOString() : undefined,
    }));
  },

  async placeOrder(ctx, order) {
    const raw = await signed(ctx, "POST", "/order", {
      symbol: order.symbol,
      side: order.side === "buy" ? "BUY" : "SELL",
      type: order.type === "market" ? "MARKET" : "LIMIT",
      quantity: order.quantity,
      price: order.price,
    });
    return { id: String(raw?.orderId ?? ""), raw };
  },

  cancelOrder: (ctx, symbol, orderId) => signed(ctx, "DELETE", "/order", { symbol, orderId }),
};

export const tabdeal = defineExchange(adapter);
