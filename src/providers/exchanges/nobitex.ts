import { createPrivateKey, sign } from "node:crypto";
import type { ProviderContext } from "../../core/types.js";
import { ProviderError } from "../../core/types.js";
import { baseOf, credentials, defineExchange, exchangeFetch, query, splitByQuote, type CandleInterval, type ExchangeAdapter } from "./common.js";

const NAME = "نوبیتکس";
const BASE = "https://apiv2.nobitex.ir";
const USER_AGENT = "TraderBot/DibaBridge-5.0.0";
const QUOTES = ["IRT", "RLS", "USDT"];
const RESOLUTIONS: Partial<Record<CandleInterval, [string, number]>> = {
  "1m": ["1", 60],
  "5m": ["5", 300],
  "15m": ["15", 900],
  "1h": ["60", 3600],
  "4h": ["240", 14_400],
  "1d": ["D", 86_400],
};

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export function nobitexSign(privateKey: string, timestamp: string, method: string, pathWithQuery: string, body = ""): string {
  const seed = Buffer.from(privateKey.trim(), "base64url").subarray(0, 32);
  if (seed.length !== 32) throw new ProviderError(`${NAME}: کلید خصوصی API معتبر نیست (باید کلید Ed25519 به شکل Base64 باشد).`);
  const key = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
  const signature = sign(null, Buffer.from(`${timestamp}${method.toUpperCase()}${pathWithQuery}${body}`, "utf8"), key);
  return signature.toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

function toSymbol(input: string): string {
  const parts = splitByQuote(input, QUOTES);
  if (!parts) return input.trim().toUpperCase();
  return `${parts[0]}${parts[1] === "RLS" ? "IRT" : parts[1]}`;
}

function currencies(symbol: string): { src: string; dst: string; rial: boolean } {
  const parts = splitByQuote(symbol, QUOTES);
  if (!parts) throw new ProviderError(`${NAME}: نماد ${symbol} شناخته نشد. نمونه: BTCIRT یا BTCUSDT.`);
  const rial = parts[1] !== "USDT";
  return { src: parts[0].toLowerCase(), dst: rial ? "rls" : "usdt", rial };
}

function unwrap(data: any) {
  if (data?.status && data.status !== "ok") throw new ProviderError(`${NAME}: ${data.message || data.code || "خطای ناشناخته"}`, data);
  return data;
}

async function pub(ctx: ProviderContext, pathWithQuery: string) {
  return unwrap(await exchangeFetch(NAME, `${baseOf(ctx, BASE)}${pathWithQuery}`, { headers: { "user-agent": USER_AGENT } }));
}

async function authed(ctx: ProviderContext, method: "GET" | "POST", pathWithQuery: string, payload?: Record<string, unknown>) {
  const { apiKey, apiSecret } = credentials(ctx, NAME, false, "optional");
  const body = payload ? JSON.stringify(payload) : "";
  const headers: Record<string, string> = { "user-agent": USER_AGENT };
  if (body) headers["content-type"] = "application/json";
  if (apiSecret) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    headers["Nobitex-Key"] = apiKey;
    headers["Nobitex-Timestamp"] = timestamp;
    headers["Nobitex-Signature"] = nobitexSign(apiSecret, timestamp, method, pathWithQuery, body);
  } else {
    headers.authorization = `Token ${apiKey}`;
  }
  return unwrap(await exchangeFetch(NAME, `${baseOf(ctx, BASE)}${pathWithQuery}`, { method, headers, body: body || undefined }));
}

const adapter: ExchangeAdapter = {
  id: "nobitex",
  name: "Nobitex",
  nameFa: NAME,
  region: "iran",
  color: "#6f2dbd",
  glyph: "ن",
  docsUrl: "https://apidocs.nobitex.ir",
  defaultBase: BASE,
  symbolExample: "BTCIRT",
  secret: "optional",
  keyLabel: "توکن یا کلید عمومی API",
  secretLabel: "کلید خصوصی API (اختیاری)",
  secretHelp: "فقط اگر «کلید API» جدید نوبیتکس را ساخته‌اید: کلید خصوصی Ed25519 را اینجا بگذارید. با توکن ساده این فیلد خالی می‌ماند.",
  keyHelp: "از پنل نوبیتکس ← تنظیمات ← API بسازید. برای خواندن موجودی دسترسی READ کافی است؛ دسترسی برداشت را روشن نکنید و کلید را به IP همین سرور محدود کنید.",
  note: "On Nobitex, IRT (Toman) markets are quoted in Rial: every price, including limit prices you send, is in IRR (1 Toman = 10 Rial). USDT markets are in USDT.",
  symbol: toSymbol,

  async ticker(ctx, symbol) {
    const { src, dst } = currencies(symbol);
    const stats = (await pub(ctx, `/market/stats?${query({ srcCurrency: src, dstCurrency: dst })}`)).stats?.[`${src}-${dst}`];
    if (!stats || stats.latest === undefined) throw new ProviderError(`${NAME}: بازار ${symbol} پیدا نشد.`);
    return {
      symbol,
      last: String(stats.latest),
      bid: stats.bestBuy,
      ask: stats.bestSell,
      high24h: stats.dayHigh,
      low24h: stats.dayLow,
      volume24h: stats.volumeSrc,
      changePercent24h: stats.dayChange,
    };
  },

  async orderBook(ctx, symbol, depth) {
    const book = await pub(ctx, `/v3/orderbook/${encodeURIComponent(symbol)}`);
    let bids: [string, string][] = book.bids ?? [];
    let asks: [string, string][] = book.asks ?? [];
    if (bids.length && asks.length && Number(bids[0][0]) > Number(asks[0][0])) [bids, asks] = [asks, bids];
    return { symbol, bids: bids.slice(0, depth), asks: asks.slice(0, depth) };
  },

  async candles(ctx, symbol, interval, limit) {
    const resolution = RESOLUTIONS[interval];
    if (!resolution) throw new ProviderError(`${NAME}: کندل ${interval} پشتیبانی نمی‌شود. بازه‌های موجود: ${Object.keys(RESOLUTIONS).join("، ")}.`);
    const to = Math.floor(Date.now() / 1000);
    const data = await exchangeFetch(NAME, `${baseOf(ctx, BASE)}/market/udf/history?${query({ symbol, resolution: resolution[0], from: to - resolution[1] * (limit + 1), to })}`, {
      headers: { "user-agent": USER_AGENT },
    });
    if (data?.s === "no_data") return [];
    if (data?.s !== "ok") throw new ProviderError(`${NAME}: ${data?.errmsg || "کندل‌ها خوانده نشد"}`, data);
    const factor = currencies(symbol).rial ? 10 : 1;
    const price = (v: unknown) => String(Number((Number(v) * factor).toFixed(8)));
    const times: number[] = data.t ?? [];
    return times
      .map((t, i) => ({ time: new Date(t * 1000).toISOString(), open: price(data.o[i]), high: price(data.h[i]), low: price(data.l[i]), close: price(data.c[i]), volume: String(data.v[i]) }))
      .slice(-limit);
  },

  async balances(ctx) {
    const wallets: any[] = (await authed(ctx, "POST", "/users/wallets/list", { type: "spot" })).wallets ?? [];
    return wallets.map((w) => ({ asset: String(w.currency).toUpperCase(), free: String(w.activeBalance ?? w.balance ?? "0"), locked: String(w.blockedBalance ?? "0") }));
  },

  async openOrders(ctx, symbol) {
    const filter = symbol ? currencies(symbol) : undefined;
    const rows: any[] = (await authed(ctx, "GET", `/market/orders/list?${query({ status: "open", details: 2, srcCurrency: filter?.src, dstCurrency: filter?.dst })}`)).orders ?? [];
    return rows.map((o) => ({
      id: String(o.id),
      symbol: String(o.market ?? `${o.srcCurrency}-${o.dstCurrency}`),
      side: o.type === "sell" ? "sell" : "buy",
      type: String(o.execution ?? "").toLowerCase(),
      price: String(o.price ?? ""),
      quantity: String(o.amount ?? ""),
      filled: String(o.matchedAmount ?? "0"),
      status: String(o.status ?? ""),
      createdAt: o.created_at,
    }));
  },

  async placeOrder(ctx, order) {
    const { src, dst } = currencies(order.symbol);
    const raw = await authed(ctx, "POST", "/market/orders/add", {
      type: order.side,
      execution: order.type,
      srcCurrency: src,
      dstCurrency: dst,
      amount: order.quantity,
      ...(order.price ? { price: order.price } : {}),
    });
    return { id: String(raw.order?.id ?? ""), raw };
  },

  async cancelOrder(ctx, _symbol, orderId) {
    if (!/^\d+$/.test(orderId)) throw new ProviderError(`${NAME}: شناسه‌ی سفارش باید عدد باشد.`);
    return authed(ctx, "POST", "/market/orders/update-status", { order: Number(orderId), status: "canceled" });
  },
};

export const nobitex = defineExchange(adapter);
