/**
 * پایه‌ی مشترک صرافی‌های ارز دیجیتال.
 *
 * هر صرافی فقط یک «adapter» می‌نویسد (نشانی‌ها و امضای خودش) و این فایل از روی آن
 * یک ProviderDef با ابزارهای هم‌شکل می‌سازد:
 *
 *   <id>_get_ticker        قیمت و آمار ۲۴ساعته            (عمومی)
 *   <id>_get_orderbook     دفتر سفارش                      (عمومی)
 *   <id>_get_candles       کندل‌ها                         (عمومی)
 *   <id>_get_balances      موجودی حساب                     (کلید API)
 *   <id>_get_open_orders   سفارش‌های باز                   (کلید API)
 *   <id>_place_order       ثبت سفارش خرید/فروش             (کلید API + مجوز معامله)
 *   <id>_cancel_order      لغو سفارش                       (کلید API + مجوز معامله)
 *
 * معامله به‌طور پیش‌فرض خاموش است: تا وقتی «اجازه‌ی معامله» در تنظیمات همان صرافی روشن نشود،
 * ثبت و لغو سفارش رد می‌شود. ثبت سفارش بدون confirm فقط پیش‌نمایش برمی‌گرداند.
 */
import { createHmac } from "node:crypto";
import { z } from "zod";
import { netFetch } from "../../core/net.js";
import { defineTool, ProviderError, type ProviderContext, type ProviderDef, type ProviderField } from "../../core/types.js";

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit";
export type CandleInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w";
export const CANDLE_INTERVALS: CandleInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"];

export interface OrderInput {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  /** مقدار به واحد ارز پایه (مثلاً BTC در BTC/USDT)، به شکل رشته تا دقت اعشار از دست نرود */
  quantity: string;
  /** برای سفارش limit الزامی است */
  price?: string;
}

export interface Ticker {
  symbol: string;
  last: string;
  bid?: string;
  ask?: string;
  high24h?: string;
  low24h?: string;
  volume24h?: string;
  changePercent24h?: string;
}

export interface OrderBook {
  symbol: string;
  /** [قیمت، مقدار] از بهترین به بدترین */
  bids: [string, string][];
  asks: [string, string][];
}

export interface Candle {
  /** زمان شروع کندل (ISO) */
  time: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export interface Balance {
  asset: string;
  free: string;
  locked: string;
}

export interface OpenOrder {
  id: string;
  symbol: string;
  side: OrderSide;
  type: string;
  price: string;
  quantity: string;
  filled: string;
  status: string;
  createdAt?: string;
}

export interface ExchangeAdapter {
  id: string;
  name: string;
  nameFa: string;
  color: string;
  glyph: string;
  docsUrl: string;
  defaultBase: string;
  /** نمونه‌ی نماد به شکل خودِ صرافی، برای راهنمای ورودی */
  symbolExample: string;
  /** این صرافی علاوه بر کلید و رمز، Passphrase هم می‌خواهد */
  needsPassphrase?: boolean;
  /** متن راهنما برای ساخت کلید */
  keyHelp: string;
  /** «BTC/USDT» یا «btc-usdt» را به شکل نماد همان صرافی درمی‌آورد */
  symbol: (input: string) => string;
  ticker: (ctx: ProviderContext, symbol: string) => Promise<Ticker>;
  orderBook: (ctx: ProviderContext, symbol: string, depth: number) => Promise<OrderBook>;
  candles: (ctx: ProviderContext, symbol: string, interval: CandleInterval, limit: number) => Promise<Candle[]>;
  balances: (ctx: ProviderContext) => Promise<Balance[]>;
  openOrders: (ctx: ProviderContext, symbol?: string) => Promise<OpenOrder[]>;
  placeOrder: (ctx: ProviderContext, order: OrderInput) => Promise<{ id: string; raw: unknown }>;
  cancelOrder: (ctx: ProviderContext, symbol: string, orderId: string) => Promise<unknown>;
}

// ---------------------------------------------------------------- کمک‌تابع‌ها

export const hmacHex = (algo: "sha256" | "sha512", key: string | Buffer, data: string | Buffer) => createHmac(algo, key).update(data).digest("hex");
export const hmacBase64 = (algo: "sha256" | "sha512", key: string | Buffer, data: string | Buffer) => createHmac(algo, key).update(data).digest("base64");

export function baseOf(ctx: ProviderContext, fallback: string): string {
  return String(ctx.config.baseUrl || fallback).replace(/\/+$/, "");
}

export function credentials(ctx: ProviderContext, name: string, needsPassphrase = false) {
  const apiKey = String(ctx.config.apiKey ?? "").trim();
  const apiSecret = String(ctx.config.apiSecret ?? "").trim();
  const passphrase = String(ctx.config.passphrase ?? "").trim();
  if (!apiKey || !apiSecret) throw new ProviderError(`برای این کار، کلید و رمز API ${name} را در تنظیمات ثبت کنید.`);
  if (needsPassphrase && !passphrase) throw new ProviderError(`Passphrase کلید API ${name} ثبت نشده است.`);
  return { apiKey, apiSecret, passphrase };
}

/** پارامترهای خالی حذف می‌شوند تا امضا و درخواست یکی بمانند */
export function query(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  return q.toString();
}

export interface ExchangeRequest {
  method?: "GET" | "POST" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
}

/** یک درخواست به صرافی؛ خطای شبکه و خطای HTTP به ProviderError فارسی تبدیل می‌شود */
export async function exchangeFetch(name: string, url: string, init: ExchangeRequest = {}): Promise<any> {
  let res: Awaited<ReturnType<typeof netFetch>>;
  try {
    res = await netFetch(url, {
      method: init.method ?? "GET",
      headers: { accept: "application/json", "user-agent": "diba-mcp", ...init.headers },
      body: init.body,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: any) {
    throw new ProviderError(`اتصال به ${name} برقرار نشد: ${err?.message ?? err}`);
  }
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  if (!res.ok) {
    const reason = data?.msg || data?.message || data?.retMsg || (Array.isArray(data?.error) ? data.error.join("، ") : data?.error) || `HTTP ${res.status}`;
    throw new ProviderError(`${name}: ${reason}`, { status: res.status, body: data });
  }
  return data;
}

/** نماد را به دو بخش پایه و نقل‌قول می‌شکند: «btc/usdt»، «BTC-USDT»، «BTC_USDT» → ["BTC","USDT"] */
export function splitSymbol(input: string): [string, string] | null {
  const parts = String(input ?? "").trim().toUpperCase().split(/[\/\-_\s:]+/).filter(Boolean);
  return parts.length === 2 ? [parts[0], parts[1]] : null;
}

const zSymbol = (example: string) => z.string().trim().min(3).max(30).regex(/^[A-Za-z0-9\/\-_:]+$/, "نماد نامعتبر است").describe(`Trading pair, e.g. ${example} (BTC/USDT style is also accepted)`);
/** عدد مثبت به شکل رشته؛ نماد علمی و عدد منفی پذیرفته نمی‌شود */
const zAmount = z.string().trim().regex(/^(?:\d+\.?\d*|\.\d+)$/, "باید یک عدد مثبت باشد").refine((v) => Number(v) > 0, "باید بزرگ‌تر از صفر باشد");

export function tradingAllowed(ctx: ProviderContext): boolean {
  return String(ctx.config.allowTrading ?? "").toLowerCase() === "true";
}

function requireTrading(ctx: ProviderContext, name: string) {
  if (!tradingAllowed(ctx)) {
    throw new ProviderError(`معامله در ${name} خاموش است. برای ثبت یا لغو سفارش، «اجازه‌ی معامله» را در تنظیمات همین سرویس روشن کنید.`);
  }
}

/** از روی adapter یک سرویس کامل با ابزارهای هم‌شکل می‌سازد */
export function defineExchange(a: ExchangeAdapter): ProviderDef {
  const fields: ProviderField[] = [
    { key: "apiKey", label: "API Key", type: "secret", help: a.keyHelp },
    { key: "apiSecret", label: "API Secret", type: "secret", help: "فقط روی همین سرور ذخیره می‌شود و برای امضای درخواست‌ها استفاده می‌شود." },
    ...(a.needsPassphrase ? [{ key: "passphrase", label: "Passphrase", type: "secret" as const, help: "عبارتی که هنگام ساخت کلید API انتخاب کرده‌اید." }] : []),
    {
      key: "allowTrading",
      label: "اجازه‌ی معامله (ثبت و لغو سفارش)",
      type: "boolean",
      default: "false",
      help: "تا وقتی خاموش است، این سرویس فقط‌خواندنی است. پیشنهاد: کلید API را بدون دسترسی برداشت (Withdraw) و با محدودیت IP بسازید.",
    },
    { key: "baseUrl", label: "آدرس پایه API", type: "url", default: a.defaultBase },
  ];
  const sym = zSymbol(a.symbolExample);

  return {
    id: a.id,
    name: a.name,
    nameFa: a.nameFa,
    category: "banking",
    region: "international",
    color: a.color,
    glyph: a.glyph,
    description: `صرافی ${a.nameFa} با API رسمی — قیمت و بازار، موجودی، سفارش‌های باز و معامله (در صورت روشن بودن اجازه‌ی معامله)`,
    docsUrl: a.docsUrl,
    fields,
    // داده‌ی بازار عمومی است؛ اگر کلید ثبت شده باشد، خودِ کلید هم با خواندن موجودی آزمایش می‌شود
    test: async (ctx) => {
      const ticker = await a.ticker(ctx, a.symbol(a.symbolExample));
      if (!String(ctx.config.apiKey ?? "").trim()) return { market: "ok", ticker, account: "کلید API ثبت نشده؛ فقط داده‌ی بازار در دسترس است" };
      const balances = await a.balances(ctx);
      return { market: "ok", ticker, account: "ok", assets: balances.length, trading: tradingAllowed(ctx) ? "روشن" : "خاموش" };
    },
    tools: [
      defineTool({
        name: `${a.id}_get_ticker`,
        title: `قیمت لحظه‌ای ${a.nameFa}`,
        description: `Latest price and 24h statistics for a trading pair on ${a.name}. Public market data; no API key needed.`,
        input: { symbol: sym },
        annotations: { readOnlyHint: true, openWorldHint: true },
        handler: (args, ctx) => a.ticker(ctx, a.symbol(args.symbol)),
      }),
      defineTool({
        name: `${a.id}_get_orderbook`,
        title: `دفتر سفارش ${a.nameFa}`,
        description: `Order book (best bids and asks) for a trading pair on ${a.name}. Public market data.`,
        input: { symbol: sym, depth: z.number().int().min(1).max(50).optional().describe("Number of price levels per side (default 10)") },
        annotations: { readOnlyHint: true, openWorldHint: true },
        handler: (args, ctx) => a.orderBook(ctx, a.symbol(args.symbol), args.depth ?? 10),
      }),
      defineTool({
        name: `${a.id}_get_candles`,
        title: `کندل‌های ${a.nameFa}`,
        description: `OHLCV candles for a trading pair on ${a.name}, oldest first. Public market data.`,
        input: {
          symbol: sym,
          interval: z.enum(CANDLE_INTERVALS as [CandleInterval, ...CandleInterval[]]).optional().describe("Candle size (default 1h)"),
          limit: z.number().int().min(1).max(200).optional().describe("Number of candles (default 50)"),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
        handler: async (args, ctx) => {
          const rows = await a.candles(ctx, a.symbol(args.symbol), args.interval ?? "1h", args.limit ?? 50);
          return rows.sort((x, y) => x.time.localeCompare(y.time));
        },
      }),
      defineTool({
        name: `${a.id}_get_balances`,
        title: `موجودی ${a.nameFa}`,
        description: `Non-zero asset balances of the connected ${a.name} account. Requires an API key.`,
        input: {},
        annotations: { readOnlyHint: true, openWorldHint: true },
        handler: async (_args, ctx) => (await a.balances(ctx)).filter((b) => Number(b.free) > 0 || Number(b.locked) > 0),
      }),
      defineTool({
        name: `${a.id}_get_open_orders`,
        title: `سفارش‌های باز ${a.nameFa}`,
        description: `Open (unfilled) orders of the connected ${a.name} account. Requires an API key.`,
        input: { symbol: sym.optional() },
        annotations: { readOnlyHint: true, openWorldHint: true },
        handler: (args, ctx) => a.openOrders(ctx, args.symbol ? a.symbol(args.symbol) : undefined),
      }),
      defineTool({
        name: `${a.id}_place_order`,
        title: `ثبت سفارش در ${a.nameFa}`,
        description:
          `Place a REAL spot order on ${a.name} with the user's funds. Only call this when the user explicitly asked for this exact trade. ` +
          `Without confirm=true it returns a preview and sends nothing. Requires an API key and the "allow trading" setting.`,
        input: {
          symbol: sym,
          side: z.enum(["buy", "sell"]),
          type: z.enum(["market", "limit"]),
          quantity: zAmount.describe("Amount of the base asset, as a decimal string (e.g. \"0.001\")"),
          price: zAmount.optional().describe("Limit price, required for limit orders"),
          confirm: z.boolean().optional().describe("Must be true to actually send the order"),
        },
        annotations: { destructiveHint: true, openWorldHint: true },
        handler: async (args, ctx) => {
          requireTrading(ctx, a.nameFa);
          if (args.type === "limit" && !args.price) throw new ProviderError("برای سفارش limit قیمت لازم است.");
          if (args.type === "market" && args.price) throw new ProviderError("سفارش market قیمت نمی‌گیرد؛ قیمت را حذف کنید یا نوع را limit بگذارید.");
          const order: OrderInput = { symbol: a.symbol(args.symbol), side: args.side, type: args.type, quantity: args.quantity, price: args.price };
          if (args.confirm !== true) {
            return { sent: false, preview: order, note: "این فقط پیش‌نمایش است و سفارشی ثبت نشد. پس از تأیید کاربر، با confirm=true دوباره فراخوانی کنید." };
          }
          credentials(ctx, a.nameFa, a.needsPassphrase);
          const result = await a.placeOrder(ctx, order);
          return { sent: true, orderId: result.id, order, raw: result.raw };
        },
      }),
      defineTool({
        name: `${a.id}_cancel_order`,
        title: `لغو سفارش در ${a.nameFa}`,
        description: `Cancel an open order on ${a.name}. Requires an API key and the "allow trading" setting.`,
        input: { symbol: sym, order_id: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9\-_]+$/, "شناسه‌ی سفارش نامعتبر است") },
        annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
        handler: async (args, ctx) => {
          requireTrading(ctx, a.nameFa);
          credentials(ctx, a.nameFa, a.needsPassphrase);
          return { cancelled: true, orderId: args.order_id, raw: await a.cancelOrder(ctx, a.symbol(args.symbol), args.order_id) };
        },
      }),
    ],
  };
}
