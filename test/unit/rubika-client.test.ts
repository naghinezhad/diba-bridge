import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalizeRubikaPhone, parseRubikaSession, rubikaClient } from "../../src/providers/rubika-client.ts";
import { ProviderError } from "../../src/core/types.ts";

describe("normalizeRubikaPhone", () => {
  test("۰۹ و +۹۸ و 98 را به فرم بین‌المللی 98 تبدیل می‌کند", () => {
    assert.equal(normalizeRubikaPhone("09121234567"), "989121234567");
    assert.equal(normalizeRubikaPhone("+98 912 123 4567"), "989121234567");
    assert.equal(normalizeRubikaPhone("989121234567"), "989121234567");
    assert.equal(normalizeRubikaPhone("00989121234567"), "989121234567");
    assert.equal(normalizeRubikaPhone("۰۹۱۲۱۲۳۴۵۶۷"), "989121234567");
  });
});

describe("Rubika session JSON", () => {
  test("نشست معتبر را می‌خواند", () => {
    const raw = JSON.stringify({
      phone: "09121234567",
      auth: "a".repeat(32),
      guid: "u0abc",
      agent: "test-agent",
      private_key: "-----BEGIN RSA PRIVATE KEY-----\nx\n-----END RSA PRIVATE KEY-----",
    });
    const s = parseRubikaSession(raw);
    assert.equal(s.phone, "09121234567");
    assert.equal(s.guid, "u0abc");
    assert.equal(s.auth.length, 32);
  });

  test("JSON خراب یا ناقص خطا می‌دهد", () => {
    assert.throws(() => parseRubikaSession("not-json"), ProviderError);
    assert.throws(() => parseRubikaSession(JSON.stringify({ phone: "0912" })), ProviderError);
  });
});

describe("rubikaClient provider", () => {
  test("فیلدهای ورود و ابزارها را دارد", () => {
    assert.equal(rubikaClient.id, "rubika_client");
    assert.equal(rubikaClient.auth?.phoneField, "phone");
    assert.equal(rubikaClient.auth?.sessionField, "session");
    assert.equal(rubikaClient.fields.find((f) => f.key === "session")?.required, true);
    const names = rubikaClient.tools.map((t) => t.name);
    for (const name of [
      "rubika_client_get_me",
      "rubika_client_get_chat",
      "rubika_client_send_message",
      "rubika_client_send_photo",
      "rubika_client_send_file",
      "rubika_client_get_chats",
      "rubika_client_get_history",
      "rubika_client_get_updates",
      "rubika_client_list_groups",
      "rubika_client_create_group",
      "rubika_client_group_members",
      "rubika_client_add_group_members",
      "rubika_client_list_channels",
      "rubika_client_create_channel",
      "rubika_client_channel_members",
      "rubika_client_add_channel_members",
    ])
      assert.ok(names.includes(name), `missing ${name}`);
    assert.equal(typeof rubikaClient.receive?.poll, "function");
  });
});
