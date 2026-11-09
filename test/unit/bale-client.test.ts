import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  BALE_CLIENT_DEFAULT_BASE_URL,
  BALE_CLIENT_DEFAULT_WS_URL,
  baleClient,
  normalizeBalePhone,
  parseBaleSession,
  toBaleSession,
} from "../../src/providers/bale-client.ts";
import { ProviderError } from "../../src/core/types.ts";

describe("normalizeBalePhone", () => {
  test("۰۹ داخلی و رقم‌های فارسی را به فرمت بین‌المللی تبدیل می‌کند", () => {
    assert.equal(normalizeBalePhone("09121234567"), "989121234567");
    assert.equal(normalizeBalePhone("۰۹۱۲۱۲۳۴۵۶۷"), "989121234567");
  });

  test("+98 و 0098 و 912 را می‌پذیرد", () => {
    assert.equal(normalizeBalePhone("+98 912 123 4567"), "989121234567");
    assert.equal(normalizeBalePhone("00989121234567"), "989121234567");
    assert.equal(normalizeBalePhone("9121234567"), "989121234567");
  });

  test("فاصله و خط تیره را پاک می‌کند", () => {
    assert.equal(normalizeBalePhone("+98-912-123-4567"), "989121234567");
  });
});

describe("Bale session string", () => {
  test("به شکل userId:jwt ساخته و خوانده می‌شود", () => {
    assert.equal(toBaleSession(12345, "eyJhbGciOi.abc.def"), "12345:eyJhbGciOi.abc.def");
    assert.deepEqual(parseBaleSession("12345:eyJhbGciOi.abc.def"), { userId: 12345, jwt: "eyJhbGciOi.abc.def" });
  });

  test("نشست خالی یا بدخطا می‌دهد", () => {
    assert.throws(() => parseBaleSession(""), ProviderError);
    assert.throws(() => parseBaleSession("abc:def"), ProviderError);
    assert.throws(() => parseBaleSession("123:"), ProviderError);
  });
});

describe("baleClient provider", () => {
  test("فیلدهای لازم و ورود با حساب کاربری را دارد", () => {
    assert.equal(baleClient.id, "bale_client");
    assert.equal(baleClient.auth?.phoneField, "phone");
    assert.equal(baleClient.auth?.sessionField, "session");
    assert.equal(baleClient.fields.find((f) => f.key === "session")?.required, true);
    assert.equal(baleClient.fields.find((f) => f.key === "baseUrl")?.default, BALE_CLIENT_DEFAULT_BASE_URL);
    assert.equal(baleClient.fields.find((f) => f.key === "wsUrl")?.default, BALE_CLIENT_DEFAULT_WS_URL);
  });

  test("ابزارهای ارسال، دریافت و فهرست گفتگوها را دارد", () => {
    const names = baleClient.tools.map((t) => t.name);
    for (const name of [
      "bale_client_get_me",
      "bale_client_get_chat",
      "bale_client_send_message",
      "bale_client_get_dialogs",
      "bale_client_get_history",
      "bale_client_get_updates",
    ])
      assert.ok(names.includes(name), `missing ${name}`);
  });

  test("دریافت پیام پشتیبانی می‌شود", () => {
    assert.equal(typeof baleClient.receive?.poll, "function");
  });
});
