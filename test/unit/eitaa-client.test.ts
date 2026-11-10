import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { eitaaClient, handleEitaaBridgeWebhook, normalizeEitaaPhone } from "../../src/providers/eitaa-client.ts";

describe("normalizeEitaaPhone", () => {
  test("۰۹ و +۹۸ و 98 را به فرم +98 تبدیل می‌کند", () => {
    assert.equal(normalizeEitaaPhone("09121234567"), "+989121234567");
    assert.equal(normalizeEitaaPhone("+98 912 123 4567"), "+989121234567");
    assert.equal(normalizeEitaaPhone("989121234567"), "+989121234567");
    assert.equal(normalizeEitaaPhone("۰۰۹۸۹۱۲۱۲۳۴۵۶۷"), "+989121234567");
  });
});

describe("eitaaClient provider", () => {
  test("فیلدهای پل، ورود و ابزارها را دارد", () => {
    assert.equal(eitaaClient.id, "eitaa_client");
    assert.equal(eitaaClient.auth?.phoneField, "phone");
    assert.equal(eitaaClient.auth?.sessionField, "session");
    assert.equal(eitaaClient.fields.find((f) => f.key === "bridgeUrl")?.default, "http://127.0.0.1:1234");
    assert.equal(eitaaClient.fields.find((f) => f.key === "session")?.required, true);
    const names = eitaaClient.tools.map((t) => t.name);
    for (const name of [
      "eitaa_client_get_me",
      "eitaa_client_get_chat",
      "eitaa_client_send_message",
      "eitaa_client_get_chats",
      "eitaa_client_get_history",
      "eitaa_client_get_updates",
    ])
      assert.ok(names.includes(name), `missing ${name}`);
    assert.equal(typeof eitaaClient.receive?.poll, "function");
  });

  test("webhook بدون نشست فعال پذیرفته نمی‌شود", () => {
    assert.equal(handleEitaaBridgeWebhook({ phone: "+989121234567", updates: [] }, "diba-eitaa"), false);
  });
});
