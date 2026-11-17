import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, verify } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, test } from "node:test";
import { configureProxy } from "../../src/core/net.ts";
import type { ProviderContext, ProviderDef } from "../../src/core/types.ts";
import { abantether } from "../../src/providers/exchanges/abantether.ts";
import { bitpin } from "../../src/providers/exchanges/bitpin.ts";
import { decimalMinus, splitByQuote, trimDecimal } from "../../src/providers/exchanges/common.ts";
import { nobitex, nobitexSign } from "../../src/providers/exchanges/nobitex.ts";
import { tabdeal, tabdealSign } from "../../src/providers/exchanges/tabdeal.ts";
import { wallex } from "../../src/providers/exchanges/wallex.ts";

const EXCHANGES: ProviderDef[] = [nobitex, wallex, bitpin, tabdeal, abantether];
const tool = (p: ProviderDef, suffix: string) => p.tools.find((t) => t.name === `${p.id}_${suffix}`)!;
const names = (p: ProviderDef) => p.tools.map((t) => t.name.slice(p.id.length + 1));

describe("صرافی‌های ایرانی — ساختار", () => {
  test("همه ایرانی و مالی‌اند و معامله پیش‌فرض خاموش است", () => {
    for (const p of EXCHANGES) {
      assert.deepEqual([p.category, p.region], ["banking", "iran"], p.id);
      assert.equal(p.fields.find((f) => f.key === "allowTrading")?.default, "false", p.id);
      for (const t of p.tools) {
        const trading = /_(place|cancel)_order$/.test(t.name);
        assert.equal(Boolean(t.annotations?.destructiveHint), trading, t.name);
        assert.equal(Boolean(t.annotations?.readOnlyHint), !trading, t.name);
      }
    }
  });

  test("فقط ابزارهایی ساخته می‌شود که صرافی واقعاً دارد", () => {
    const full = ["get_ticker", "get_orderbook", "get_candles", "get_balances", "get_open_orders", "place_order", "cancel_order"];
    assert.deepEqual(names(nobitex), full);
    assert.deepEqual(names(wallex), full);
    assert.deepEqual(names(bitpin), full.filter((n) => n !== "get_candles"));
    assert.deepEqual(names(tabdeal), full.filter((n) => n !== "get_candles"));
    assert.deepEqual(names(abantether), ["get_ticker", "get_balances", "get_open_orders", "place_order", "cancel_order"]);
  });

  test("فیلد Secret فقط برای صرافی‌هایی است که دارند", () => {
    const hasSecret = (p: ProviderDef) => p.fields.some((f) => f.key === "apiSecret");
    assert.deepEqual(EXCHANGES.map(hasSecret), [true, false, true, true, false]);
  });

  test("نماد چسبیده با ارز نقل‌قول شکسته می‌شود و اعداد بدون خطای اعشار حساب می‌شوند", () => {
    assert.deepEqual(splitByQuote("BTCIRT", ["IRT", "USDT"]), ["BTC", "IRT"]);
    assert.deepEqual(splitByQuote("usdtirt", ["IRT", "USDT"]), ["USDT", "IRT"]);
    assert.deepEqual(splitByQuote("btc/usdt", ["IRT", "USDT"]), ["BTC", "USDT"]);
    assert.equal(splitByQuote("USDT", ["IRT", "USDT"]), null);
    assert.equal(trimDecimal("17400000102.0000000000000000"), "17400000102");
    assert.equal(trimDecimal("0.00150"), "0.0015");
    assert.equal(trimDecimal("-0.00000000000000000000"), "0");
    assert.equal(decimalMinus("0.3", "0.1"), "0.2");
    assert.equal(decimalMinus("188.000994", "0"), "188.000994");
    assert.equal(decimalMinus("1", "2.5"), "-1.5");
  });

  test("بدون اجازه‌ی معامله، ثبت و لغو سفارش رد می‌شود", async () => {
    for (const p of EXCHANGES) {
      const ctx = { config: { apiKey: "k", apiSecret: "s", allowTrading: "false", baseUrl: "http://127.0.0.1:9" } } as unknown as ProviderContext;
      await assert.rejects(() => tool(p, "place_order").handler({ symbol: "BTC/IRT", side: "buy", type: "market", quantity: "1", confirm: true }, ctx), /معامله .* خاموش است/);
      await assert.rejects(() => tool(p, "cancel_order").handler({ symbol: "BTC/IRT", order_id: "1" }, ctx), /معامله .* خاموش است/);
    }
  });
});

describe("صرافی‌های ایرانی — امضا", () => {
  const seed = Buffer.alloc(32, 7);
  const privateKey = seed.toString("base64url");
  const publicKey = createPublicKey(createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" }));

  test("نوبیتکس: امضای Ed25519 روی timestamp + METHOD + مسیر + بدنه", () => {
    const signature = nobitexSign(privateKey, "1700000000", "post", "/market/orders/add", '{"type":"buy"}');
    assert.doesNotMatch(signature, /[+/]/, "باید Base64 امن برای URL باشد");
    const ok = verify(null, Buffer.from('1700000000POST/market/orders/add{"type":"buy"}'), publicKey, Buffer.from(signature, "base64url"));
    assert.equal(ok, true);
    assert.throws(() => nobitexSign("short", "1", "GET", "/x"), /کلید خصوصی/);
  });

  test("تبدیل: HMAC-SHA256 به شکل hex، هم‌شکل با بایننس", () => {
    const secret = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j";
    const qs = "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559";
    assert.equal(tabdealSign(secret, qs), "c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71");
  });

  describe("با سرور آزمایشی", () => {
    let server: Server;
    let base = "";
    const seen: { method: string; url: string; path: string; headers: IncomingMessage["headers"]; body: string }[] = [];
    const replies: Record<string, unknown> = {
      // Nobitex
      "/market/stats": { status: "ok", stats: { "btc-rls": { latest: "174900000000", bestBuy: "174899999790", bestSell: "174900000000", dayHigh: "177656699990", dayLow: "173000000000", volumeSrc: "9.06", dayChange: "0.31" } } },
      "/v3/orderbook/BTCIRT": { status: "ok", bids: [["175000000000", "1"], ["175100000000", "2"]], asks: [["174900000000", "3"], ["174800000000", "4"]] },
      "/market/udf/history": { s: "ok", t: [1700000000, 1700003600], o: [17490000000, 17500000000], h: [17510000000, 17520000000], l: [17480000000, 17490000000], c: [17500000000, 17515000000.5], v: [0.5, 0.25] },
      "/users/wallets/list": { status: "ok", wallets: [{ currency: "rls", balance: "1000", blockedBalance: "250", activeBalance: "750" }, { currency: "btc", balance: "0", blockedBalance: "0", activeBalance: "0" }] },
      "/market/orders/add": { status: "ok", order: { id: 25 } },
      "/market/orders/update-status": { status: "failed", code: "OrderNotFound", message: "Order does not exist." },
      // Wallex
      "/v1/markets": { success: true, result: { symbols: { BTCTMN: { stats: { lastPrice: "17450927733.0000", bidPrice: "17450927727.00", askPrice: "17450927734.00", "24h_highPrice": "17793369090.0", "24h_lowPrice": "17265444887.0", "24h_volume": "3.7397798700", "24h_ch": -0.27 } } } } },
      "/v1/account/balances": { success: true, result: { balances: { BTC: { asset: "BTC", value: "0.3", locked: "0.1" }, TMN: { asset: "TMN", value: "0", locked: "0" } } } },
      "POST /v1/account/orders": { __status: 422, success: false, message: "اطلاعات وارد شده اشتباه‌است.", code: 422, result: { quantity: ["مقدار کمتر از حد مجاز است."] } },
      "DELETE /v1/account/orders": { success: true, result: { clientOrderId: "wx-1", status: "CANCELED" } },
      // Bitpin
      "/api/v1/usr/authenticate/": { access: "ACCESS-1", refresh: "REFRESH-1" },
      "/api/v1/wlt/wallets/": [{ asset: "USDT", balance: "100.5", frozen: "0.5", service: "main" }],
      "GET /api/v1/odr/orders/": [{ id: 9, symbol: "BTC_IRT", side: "sell", type: "limit", price: "17500000000", base_amount: "0.01", dealed_base_amount: "0.004", state: "active", created_at: "2026-01-01T00:00:00Z" }],
      "POST /api/v1/odr/orders/": { id: 77, state: "initial" },
      // Tabdeal
      "/r/api/v1/trades": [{ price: "17400000102.0000", time: 1 }, { price: "17400000111.0000000000000000", time: 5 }],
      "/r/api/v1/depth": { bids: [["17400000100.0000", "0.00240000"]], asks: [["17478321081.0000", "0.00115455"]] },
      "/r/api/v1/get-funding-asset": [{ asset: "IRT", free: "5000.00", freeze: "0" }],
      "/api/v1/order": { orderId: 555, status: "NEW" },
      // AbanTether
      "/api/v1/manager/otc/ticker": { data: { markets: { BTCIRT: { symbol: "BTC", buy_price: "17521915646.680000", sell_price: "17424775975.120000", active: true } } } },
      "/api/v1/accounting/balances": { data: [{ symbol: "USDT", balance: "188.000994", available: "188.000994", blocked: "-0.00000000000000000000" }] },
      "/api/v1/order_handler/orders/otc": { data: [{ id: "a1", base_symbol: "TON", quote_symbol: "IRT", side: "buy", type: "limit", status: "open", price: "10.00", volume: { base: "0.0", quote: "1200000.00" }, filled_volume: { base: "0.0", quote: "0.0" } }, { id: "a2", base_symbol: "TON", quote_symbol: "IRT", side: "sell", type: "market", status: "rejected", volume: { base: "5", quote: "0" }, filled_volume: { base: "0", quote: "0" } }] },
      "/api/v1/order_handler/orders/otc/market": { data: { id: "6720a893239459d8b5b6b8cd", status: "new" } },
    };

    before(async () => {
      configureProxy({} as NodeJS.ProcessEnv);
      server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          const path = new URL(req.url ?? "/", "http://x").pathname;
          seen.push({ method: req.method ?? "", url: req.url ?? "", path, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
          const reply: any = replies[`${req.method} ${path}`] ?? replies[path];
          const { __status, ...payload } = reply && !Array.isArray(reply) ? reply : { __status: undefined };
          res.writeHead(reply === undefined ? 404 : __status ?? 200, { "content-type": "application/json" });
          res.end(JSON.stringify(reply === undefined ? { message: "not found" } : Array.isArray(reply) ? reply : payload));
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    after(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    beforeEach(() => {
      seen.length = 0;
    });

    const ctx = (extra: Record<string, string> = {}) => ({ config: { baseUrl: base, apiKey: "KEY", apiSecret: "", allowTrading: "true", ...extra } }) as unknown as ProviderContext;
    const last = () => seen.at(-1)!;

    test("نوبیتکس: نماد تومانی به جفت ریالی می‌رود و دو طرف دفتر سفارش اصلاح می‌شود", async () => {
      const ticker: any = await tool(nobitex, "get_ticker").handler({ symbol: "BTC/IRT" }, ctx());
      assert.match(last().url, /srcCurrency=btc&dstCurrency=rls/);
      assert.deepEqual([ticker.symbol, ticker.last, ticker.bid, ticker.ask], ["BTCIRT", "174900000000", "174899999790", "174900000000"]);
      const book: any = await tool(nobitex, "get_orderbook").handler({ symbol: "BTCIRT", depth: 1 }, ctx());
      assert.deepEqual([book.bids, book.asks], [[["174900000000", "3"]], [["175000000000", "1"]]]);
    });

    test("نوبیتکس: کندل بازار ریالی از تومان به ریال تبدیل می‌شود و کندل هفتگی خطای روشن می‌دهد", async () => {
      const rows: any = await tool(nobitex, "get_candles").handler({ symbol: "BTCIRT", interval: "1h", limit: 2 }, ctx());
      assert.match(last().url, /symbol=BTCIRT&resolution=60&from=\d+&to=\d+/);
      assert.deepEqual(rows.map((r: any) => r.close), ["175000000000", "175150000005"]);
      await assert.rejects(() => tool(nobitex, "get_candles").handler({ symbol: "BTCIRT", interval: "1w" }, ctx()), /1w پشتیبانی نمی‌شود/);
    });

    test("نوبیتکس: با توکن ساده هدر Authorization و با کلید خصوصی هدرهای امضا فرستاده می‌شود", async () => {
      assert.deepEqual(await tool(nobitex, "get_balances").handler({}, ctx()), [{ asset: "RLS", free: "750", locked: "250" }]);
      assert.equal(last().headers.authorization, "Token KEY");
      assert.equal(last().headers["nobitex-signature"], undefined);
      assert.match(String(last().headers["user-agent"]), /^TraderBot\//);

      await tool(nobitex, "get_balances").handler({}, ctx({ apiSecret: privateKey }));
      const req = last();
      assert.equal(req.headers.authorization, undefined);
      assert.equal(req.headers["nobitex-key"], "KEY");
      const signed = `${req.headers["nobitex-timestamp"]}POST/users/wallets/list${req.body}`;
      assert.equal(verify(null, Buffer.from(signed), publicKey, Buffer.from(String(req.headers["nobitex-signature"]), "base64url")), true);
    });

    test("نوبیتکس: سفارش با ارز ریالی ثبت می‌شود و خطای status=failed به پیام تبدیل می‌شود", async () => {
      const sent: any = await tool(nobitex, "place_order").handler({ symbol: "BTC/IRT", side: "buy", type: "limit", quantity: "0.001", price: "174000000000", confirm: true }, ctx());
      assert.equal(sent.orderId, "25");
      assert.deepEqual(JSON.parse(last().body), { type: "buy", execution: "limit", srcCurrency: "btc", dstCurrency: "rls", amount: "0.001", price: "174000000000" });
      await assert.rejects(() => tool(nobitex, "cancel_order").handler({ symbol: "BTCIRT", order_id: "5684" }, ctx()), /Order does not exist/);
      assert.deepEqual(JSON.parse(last().body), { order: 5684, status: "canceled" });
      await assert.rejects(() => tool(nobitex, "cancel_order").handler({ symbol: "BTCIRT", order_id: "abc" }, ctx()), /باید عدد باشد/);
    });

    test("والکس: IRT همان TMN است، کلید در X-API-Key می‌رود و موجودی آزاد = کل منهای قفل‌شده", async () => {
      const ticker: any = await tool(wallex, "get_ticker").handler({ symbol: "btc/irt" }, ctx());
      assert.deepEqual([ticker.symbol, ticker.last, ticker.changePercent24h], ["BTCTMN", "17450927733", "-0.27"]);
      assert.deepEqual(await tool(wallex, "get_balances").handler({}, ctx()), [{ asset: "BTC", free: "0.2", locked: "0.1" }]);
      assert.equal(last().headers["x-api-key"], "KEY");
    });

    test("والکس: دلیل خطای اعتبارسنجی از result خوانده می‌شود و لغو با clientOrderId است", async () => {
      await assert.rejects(() => tool(wallex, "place_order").handler({ symbol: "BTCTMN", side: "buy", type: "market", quantity: "0.0000001", confirm: true }, ctx()), /مقدار کمتر از حد مجاز است/);
      assert.deepEqual(JSON.parse(last().body), { symbol: "BTCTMN", type: "MARKET", side: "BUY", quantity: "0.0000001" });
      await tool(wallex, "cancel_order").handler({ symbol: "BTCTMN", order_id: "wx-1" }, ctx());
      assert.deepEqual([last().method, last().url], ["DELETE", "/v1/account/orders?clientOrderId=wx-1"]);
    });

    test("بیت‌پین: یک بار ورود با کلید و رمز، سپس Bearer برای همه‌ی درخواست‌ها", async () => {
      const c = ctx({ apiKey: "BP-KEY", apiSecret: "BP-SECRET" });
      assert.deepEqual(await tool(bitpin, "get_balances").handler({}, c), [{ asset: "USDT", free: "100", locked: "0.5" }]);
      const orders: any = await tool(bitpin, "get_open_orders").handler({ symbol: "BTC/IRT" }, c);
      assert.deepEqual(orders[0], { id: "9", symbol: "BTC_IRT", side: "sell", type: "limit", price: "17500000000", quantity: "0.01", filled: "0.004", status: "active", createdAt: "2026-01-01T00:00:00Z" });
      assert.match(last().url, /state=active&symbol=BTC_IRT/);
      assert.equal(last().headers.authorization, "Bearer ACCESS-1");
      const logins = seen.filter((r) => r.path === "/api/v1/usr/authenticate/");
      assert.equal(logins.length, 1, "توکن دسترسی باید نگه داشته شود");
      assert.deepEqual(JSON.parse(logins[0].body), { api_key: "BP-KEY", secret_key: "BP-SECRET" });

      const sent: any = await tool(bitpin, "place_order").handler({ symbol: "BTC_IRT", side: "sell", type: "limit", quantity: "0.01", price: "17500000000", confirm: true }, c);
      assert.equal(sent.orderId, "77");
      assert.deepEqual(JSON.parse(last().body), { symbol: "BTC_IRT", type: "limit", side: "sell", base_amount: "0.01", price: "17500000000" });
    });

    test("تبدیل: قیمت از آخرین معامله، خواندن از /r/api و ثبت سفارش امضاشده از /api", async () => {
      const ticker: any = await tool(tabdeal, "get_ticker").handler({ symbol: "BTC/IRT" }, ctx());
      assert.deepEqual(ticker, { symbol: "BTCIRT", last: "17400000111", bid: "17400000100", ask: "17478321081" });

      const c = ctx({ apiSecret: "tb-secret" });
      assert.deepEqual(await tool(tabdeal, "get_balances").handler({}, c), [{ asset: "IRT", free: "5000", locked: "0" }]);
      assert.equal(last().path, "/r/api/v1/get-funding-asset");

      const sent: any = await tool(tabdeal, "place_order").handler({ symbol: "BTCIRT", side: "buy", type: "limit", quantity: "0.001", price: "17400000000", confirm: true }, c);
      assert.equal(sent.orderId, "555");
      const req = last();
      assert.deepEqual([req.method, req.path, req.headers["x-mbx-apikey"]], ["POST", "/api/v1/order", "KEY"]);
      const [qs, signature] = req.url.split("?")[1].split("&signature=");
      assert.match(qs, /^symbol=BTCIRT&side=BUY&type=LIMIT&quantity=0\.001&price=17400000000&timestamp=\d+$/);
      assert.equal(signature, tabdealSign("tb-secret", qs));
    });

    test("آبان‌تتر: قیمت خرید و فروش جدا، کلید خام در Authorization و فقط سفارش‌های باز", async () => {
      const ticker: any = await tool(abantether, "get_ticker").handler({ symbol: "BTC/IRT" }, ctx());
      assert.deepEqual(ticker, { symbol: "BTCIRT", last: "17521915646.68", bid: "17424775975.12", ask: "17521915646.68" });
      assert.match(last().url, /coin=BTC/);
      assert.deepEqual(await tool(abantether, "get_balances").handler({}, ctx()), [{ asset: "USDT", free: "188.000994", locked: "0" }]);
      assert.equal(last().headers.authorization, "KEY");
      const orders: any = await tool(abantether, "get_open_orders").handler({}, ctx());
      assert.deepEqual(orders.map((o: any) => [o.id, o.symbol, o.quantity]), [["a1", "TONIRT", "1200000.00"]]);
    });

    test("آبان‌تتر: سفارش به مسیر نوع خودش می‌رود و توضیح مقدار خرید به مدل گفته می‌شود", async () => {
      const sent: any = await tool(abantether, "place_order").handler({ symbol: "TON/IRT", side: "buy", type: "market", quantity: "1200000", confirm: true }, ctx());
      assert.equal(sent.orderId, "6720a893239459d8b5b6b8cd");
      assert.equal(last().path, "/api/v1/order_handler/orders/otc/market");
      assert.deepEqual(JSON.parse(last().body), { side: "buy", base_symbol: "TON", quote_symbol: "IRT", volume: "1200000" });
      assert.match(String(tool(abantether, "place_order").input.quantity.description), /BUY orders: amount of the quote currency/);
    });

    test("بدون کلید، داده‌ی بازار کار می‌کند ولی موجودی خطای روشن می‌دهد", async () => {
      const noKey = ctx({ apiKey: "" });
      assert.ok(await tool(wallex, "get_ticker").handler({ symbol: "BTCTMN" }, noKey));
      for (const p of [nobitex, wallex, abantether]) await assert.rejects(() => tool(p, "get_balances").handler({}, noKey), /کلید API/);
      for (const p of [bitpin, tabdeal]) await assert.rejects(() => tool(p, "get_balances").handler({}, ctx()), /کلید و رمز API/);
    });
  });
});
