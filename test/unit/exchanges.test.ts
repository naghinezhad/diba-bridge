import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { configureProxy } from "../../src/core/net.ts";
import type { ProviderContext, ProviderDef } from "../../src/core/types.ts";
import { binance, binanceSign } from "../../src/providers/exchanges/binance.ts";
import { bybit, bybitSign } from "../../src/providers/exchanges/bybit.ts";
import { splitSymbol } from "../../src/providers/exchanges/common.ts";
import { kraken, krakenSign } from "../../src/providers/exchanges/kraken.ts";
import { kucoin, kucoinPassphrase, kucoinSign } from "../../src/providers/exchanges/kucoin.ts";
import { okx, okxSign } from "../../src/providers/exchanges/okx.ts";

const EXCHANGES: ProviderDef[] = [binance, bybit, okx, kucoin, kraken];
const tool = (p: ProviderDef, suffix: string) => p.tools.find((t) => t.name === `${p.id}_${suffix}`)!;

describe("صرافی‌ها — امضا", () => {
  test("بایننس: نمونه‌ی مستندات رسمی", () => {
    const secret = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j";
    const qs = "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559";
    assert.equal(binanceSign(secret, qs), "c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71");
  });

  test("کراکن: نمونه‌ی مستندات رسمی", () => {
    const secret = "kQH5HW/8p1uGOVjbgWA7FunAmGO8lsSUXNsu3eow76sz84Q18fWxnyRzBHCd3pd5nE9qa99HAZtuZuj6F1huXg==";
    const body = "nonce=1616492376594&ordertype=limit&pair=XBTUSD&price=37500&type=buy&volume=1.25";
    assert.equal(krakenSign(secret, "/0/private/AddOrder", "1616492376594", body), "4/dpxb3iT4tp/ZCVEwSnEsLxx0bqyhLpdfOpc6fn7OR8+UClSV5n9E6aSS8MPtnRfp32bAb0nmbRn6H8ndwLUQ==");
  });

  test("بای‌بیت، OKX و کوکوین: رشته‌ی امضا طبق مستندات ساخته می‌شود", () => {
    const h = (data: string, enc: "hex" | "base64") => createHmac("sha256", "s3cret").update(data).digest(enc);
    assert.equal(bybitSign("s3cret", "1700000000000", "KEY", "5000", "category=spot&symbol=BTCUSDT"), h("1700000000000KEY5000category=spot&symbol=BTCUSDT", "hex"));
    assert.equal(okxSign("s3cret", "2026-01-01T00:00:00.000Z", "get", "/api/v5/account/balance?ccy=BTC"), h("2026-01-01T00:00:00.000ZGET/api/v5/account/balance?ccy=BTC", "base64"));
    assert.equal(kucoinSign("s3cret", "1700000000000", "post", "/api/v1/orders", '{"a":1}'), h('1700000000000POST/api/v1/orders{"a":1}', "base64"));
    assert.equal(kucoinPassphrase("s3cret", "pass"), h("pass", "base64"));
  });
});

describe("صرافی‌ها — ساختار مشترک", () => {
  test("هر صرافی همان هفت ابزار را دارد و ابزارهای معامله مخرب علامت خورده‌اند", () => {
    for (const p of EXCHANGES) {
      assert.deepEqual(
        p.tools.map((t) => t.name.slice(p.id.length + 1)),
        ["get_ticker", "get_orderbook", "get_candles", "get_balances", "get_open_orders", "place_order", "cancel_order"],
      );
      for (const t of p.tools) {
        const trading = /_(place|cancel)_order$/.test(t.name);
        assert.equal(Boolean(t.annotations?.destructiveHint), trading, t.name);
        assert.equal(Boolean(t.annotations?.readOnlyHint), !trading, t.name);
      }
      assert.equal(p.fields.find((f) => f.key === "allowTrading")?.default, "false", `${p.id}: معامله باید پیش‌فرض خاموش باشد`);
      assert.equal(p.fields.some((f) => f.key === "passphrase"), p.id === "okx" || p.id === "kucoin");
    }
  });

  test("نماد با هر جداکننده‌ای به دو بخش پایه و نقل‌قول شکسته می‌شود", () => {
    for (const input of ["btc/usdt", "BTC-USDT", "btc_usdt", " btc usdt "]) assert.deepEqual(splitSymbol(input), ["BTC", "USDT"], input);
    // نماد چسبیده قابل تفکیک نیست و همان‌طور که هست به صرافی داده می‌شود
    assert.equal(splitSymbol("BTCUSDT"), null);
  });

  test("بدون اجازه‌ی معامله، ثبت و لغو سفارش رد می‌شود", async () => {
    for (const p of EXCHANGES) {
      const ctx = { config: { apiKey: "k", apiSecret: "s", passphrase: "p", allowTrading: "false", baseUrl: "http://127.0.0.1:9" } } as unknown as ProviderContext;
      await assert.rejects(() => tool(p, "place_order").handler({ symbol: "BTC/USDT", side: "buy", type: "market", quantity: "0.001", confirm: true }, ctx), /معامله .* خاموش است/);
      await assert.rejects(() => tool(p, "cancel_order").handler({ symbol: "BTC/USDT", order_id: "1" }, ctx), /معامله .* خاموش است/);
    }
  });
});

describe("صرافی‌ها — درخواست‌ها با سرور آزمایشی", () => {
  let server: Server;
  let base = "";
  const seen: { method: string; url: string; headers: IncomingMessage["headers"]; body: string }[] = [];
  /** پاسخ هر مسیر؛ کلید = pathname */
  const replies: Record<string, unknown> = {
    // Binance
    "/api/v3/ticker/24hr": { symbol: "BTCUSDT", lastPrice: "65000.10", bidPrice: "65000.00", askPrice: "65000.20", highPrice: "66000", lowPrice: "64000", volume: "1234.5", priceChangePercent: "1.25" },
    "/api/v3/klines": [[1700003600000, "2", "3", "1", "2.5", "10"], [1700000000000, "1", "2", "0.5", "1.5", "20"]],
    "/api/v3/account": { balances: [{ asset: "BTC", free: "0.5", locked: "0.1" }, { asset: "ETH", free: "0", locked: "0" }] },
    "/api/v3/order": { orderId: 987, status: "NEW" },
    // Bybit
    "/v5/market/tickers": { retCode: 0, result: { list: [{ symbol: "BTCUSDT", lastPrice: "65000", bid1Price: "64999", ask1Price: "65001", highPrice24h: "66000", lowPrice24h: "64000", volume24h: "100", price24hPcnt: "0.0125" }] } },
    "/v5/order/create": { retCode: 0, result: { orderId: "by-1" } },
    "/v5/account/wallet-balance": { retCode: 10003, retMsg: "API key is invalid." },
    // OKX
    "/api/v5/market/ticker": { code: "0", data: [{ instId: "BTC-USDT", last: "65000", bidPx: "64999", askPx: "65001", high24h: "66000", low24h: "64000", vol24h: "100", open24h: "64000" }] },
    "/api/v5/trade/order": { code: "1", msg: "Operation failed.", data: [{ sCode: "51008", sMsg: "Order failed. Insufficient balance." }] },
    // KuCoin
    "/api/v1/market/stats": { code: "200000", data: { symbol: "BTC-USDT", last: "65000", buy: "64999", sell: "65001", high: "66000", low: "64000", vol: "100", changeRate: "-0.02" } },
    "/api/v1/orders/abc-1": { code: "200000", data: { cancelledOrderIds: ["abc-1"] } },
    // Kraken
    "/0/public/Ticker": { error: [], result: { XBTUSDT: { a: ["65001", "1", "1"], b: ["64999", "1", "1"], c: ["65000", "0.1"], v: ["10", "100"], h: ["65500", "66000"], l: ["64500", "64000"], o: "64000" } } },
    "/0/private/BalanceEx": { error: [], result: { XXBT: { balance: "1.5", hold_trade: "0.5" } } },
    "/0/private/AddOrder": { error: ["EOrder:Insufficient funds"] },
  };

  before(async () => {
    configureProxy({} as NodeJS.ProcessEnv);
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
        const reply = replies[new URL(req.url ?? "/", "http://x").pathname];
        res.writeHead(reply === undefined ? 404 : 200, { "content-type": "application/json" });
        res.end(JSON.stringify(reply ?? { msg: "not found" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const ctx = (extra: Record<string, string> = {}) => ({ config: { baseUrl: base, apiKey: "KEY", apiSecret: Buffer.from("secret").toString("base64"), passphrase: "pass", allowTrading: "true", ...extra } }) as unknown as ProviderContext;
  const last = () => seen.at(-1)!;

  test("قیمت در همه‌ی صرافی‌ها به یک شکل برمی‌گردد و درصد تغییر یکدست است", async () => {
    const out: Record<string, any> = {};
    for (const p of [binance, bybit, okx, kucoin, kraken]) out[p.id] = await tool(p, "get_ticker").handler({ symbol: "BTC/USDT" }, ctx());
    assert.equal(out.binance.last, "65000.10");
    assert.equal(out.binance.changePercent24h, "1.25");
    assert.equal(out.bybit.changePercent24h, "1.25", "نسبت بای‌بیت به درصد تبدیل می‌شود");
    assert.equal(out.okx.changePercent24h, "1.5625", "OKX از قیمت باز ۲۴ساعته حساب می‌شود");
    assert.equal(out.kucoin.changePercent24h, "-2");
    assert.equal(out.kraken.high24h, "66000", "کراکن: خانه‌ی دوم = ۲۴ ساعت اخیر");
    assert.equal(out.kraken.changePercent24h, undefined, "کراکن قیمت ۲۴ ساعت پیش را نمی‌دهد");
    for (const id of Object.keys(out)) assert.equal(out[id].bid < out[id].ask, true, id);
  });

  test("نماد ورودی به قالب هر صرافی فرستاده می‌شود", async () => {
    await tool(binance, "get_ticker").handler({ symbol: "btc-usdt" }, ctx());
    assert.match(last().url, /symbol=BTCUSDT/);
    await tool(okx, "get_ticker").handler({ symbol: "btc/usdt" }, ctx());
    assert.match(last().url, /instId=BTC-USDT/);
    await tool(kraken, "get_ticker").handler({ symbol: "BTC/USDT" }, ctx());
    assert.match(last().url, /pair=XBTUSDT/);
  });

  test("کندل‌ها همیشه از قدیم به جدید مرتب می‌شوند", async () => {
    const rows: any = await tool(binance, "get_candles").handler({ symbol: "BTCUSDT" }, ctx());
    assert.deepEqual(rows.map((r: any) => r.open), ["1", "2"]);
    assert.match(last().url, /interval=1h&limit=50/);
  });

  test("بایننس: درخواست امضاشده با کلید در هدر و موجودی صفر حذف می‌شود", async () => {
    const balances: any = await tool(binance, "get_balances").handler({}, ctx());
    assert.deepEqual(balances, [{ asset: "BTC", free: "0.5", locked: "0.1" }]);
    const req = last();
    assert.equal(req.headers["x-mbx-apikey"], "KEY");
    const [qs, signature] = req.url.split("?")[1].split("&signature=");
    assert.equal(signature, binanceSign(Buffer.from("secret").toString("base64"), qs));
    assert.doesNotMatch(req.url, /secret/);
  });

  test("ثبت سفارش بدون confirm فقط پیش‌نمایش است و چیزی فرستاده نمی‌شود", async () => {
    const before = seen.length;
    const preview: any = await tool(binance, "place_order").handler({ symbol: "BTC/USDT", side: "buy", type: "limit", quantity: "0.001", price: "60000" }, ctx());
    assert.equal(preview.sent, false);
    assert.equal(seen.length, before);
    await assert.rejects(() => tool(binance, "place_order").handler({ symbol: "BTC/USDT", side: "buy", type: "limit", quantity: "0.001", confirm: true }, ctx()), /قیمت لازم است/);

    const sent: any = await tool(binance, "place_order").handler({ symbol: "BTC/USDT", side: "sell", type: "limit", quantity: "0.001", price: "70000", confirm: true }, ctx());
    assert.deepEqual([sent.sent, sent.orderId], [true, "987"]);
    assert.equal(last().method, "POST");
    assert.match(last().url, /symbol=BTCUSDT&side=SELL&type=LIMIT&quantity=0\.001&price=70000&timeInForce=GTC/);
  });

  test("بای‌بیت: بدنه‌ی JSON امضا می‌شود و خطای retCode به پیام تبدیل می‌شود", async () => {
    const sent: any = await tool(bybit, "place_order").handler({ symbol: "BTC/USDT", side: "buy", type: "market", quantity: "0.01", confirm: true }, ctx());
    assert.equal(sent.orderId, "by-1");
    const req = last();
    assert.deepEqual(JSON.parse(req.body), { category: "spot", symbol: "BTCUSDT", side: "Buy", orderType: "Market", qty: "0.01", marketUnit: "baseCoin" });
    assert.equal(req.headers["x-bapi-sign"], bybitSign(Buffer.from("secret").toString("base64"), String(req.headers["x-bapi-timestamp"]), "KEY", "5000", req.body));
    await assert.rejects(() => tool(bybit, "get_balances").handler({}, ctx()), /API key is invalid/);
  });

  test("OKX و کراکن: خطای سفارش با دلیل صرافی برمی‌گردد", async () => {
    await assert.rejects(() => tool(okx, "place_order").handler({ symbol: "BTC/USDT", side: "buy", type: "market", quantity: "1", confirm: true }, ctx()), /Insufficient balance/);
    assert.equal(last().headers["ok-access-passphrase"], "pass");
    await assert.rejects(() => tool(kraken, "place_order").handler({ symbol: "BTC/USDT", side: "buy", type: "market", quantity: "1", confirm: true }, ctx()), /Insufficient funds/);
    const req = last();
    assert.match(req.body, /^nonce=\d+&pair=XBTUSDT&type=buy&ordertype=market&volume=1$/);
    assert.equal(req.headers["api-sign"], krakenSign(Buffer.from("secret").toString("base64"), "/0/private/AddOrder", new URLSearchParams(req.body).get("nonce")!, req.body));
  });

  test("کراکن: موجودی آزاد = کل منهای درگیر در سفارش؛ کوکوین: لغو با DELETE و Passphrase امضاشده", async () => {
    assert.deepEqual(await tool(kraken, "get_balances").handler({}, ctx()), [{ asset: "XXBT", free: "1", locked: "0.5" }]);
    const cancelled: any = await tool(kucoin, "cancel_order").handler({ symbol: "BTC-USDT", order_id: "abc-1" }, ctx());
    assert.equal(cancelled.cancelled, true);
    const req = last();
    assert.deepEqual([req.method, req.url], ["DELETE", "/api/v1/orders/abc-1"]);
    assert.equal(req.headers["kc-api-passphrase"], kucoinPassphrase(Buffer.from("secret").toString("base64"), "pass"));
    assert.equal(req.headers["kc-api-key-version"], "2");
  });

  test("بدون کلید API، داده‌ی بازار کار می‌کند ولی موجودی خطای روشن می‌دهد", async () => {
    const noKey = ctx({ apiKey: "", apiSecret: "" });
    assert.ok(await tool(kucoin, "get_ticker").handler({ symbol: "BTC-USDT" }, noKey));
    await assert.rejects(() => tool(kucoin, "get_balances").handler({}, noKey), /کلید و رمز API/);
    await assert.rejects(() => tool(okx, "get_balances").handler({}, ctx({ passphrase: "" })), /Passphrase/);
  });
});
