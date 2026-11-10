import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalizeSoroushPhone, soroushClient } from "../../src/providers/soroush-client.ts";

describe("normalizeSoroushPhone", () => {
  test("۰۹ و +۹۸ و 98 را به فرم +98 تبدیل می‌کند", () => {
    assert.equal(normalizeSoroushPhone("09121234567"), "+989121234567");
    assert.equal(normalizeSoroushPhone("+98 912 123 4567"), "+989121234567");
    assert.equal(normalizeSoroushPhone("989121234567"), "+989121234567");
    assert.equal(normalizeSoroushPhone("00989121234567"), "+989121234567");
    assert.equal(normalizeSoroushPhone("۰۹۱۲۱۲۳۴۵۶۷"), "+989121234567");
  });
});

describe("soroushClient provider", () => {
  test("فیلدهای ورود و ابزارها را دارد", () => {
    assert.equal(soroushClient.id, "soroush_client");
    assert.equal(soroushClient.auth?.phoneField, "phone");
    assert.equal(soroushClient.auth?.sessionField, "session");
    assert.equal(soroushClient.fields.find((f) => f.key === "session")?.required, true);
    assert.equal(soroushClient.fields.some((f) => f.key === "apiId"), false);
    assert.equal(soroushClient.fields.some((f) => f.key === "apiHash"), false);
    const names = soroushClient.tools.map((t) => t.name);
    for (const name of [
      "soroush_client_get_me",
      "soroush_client_get_chat",
      "soroush_client_send_message",
      "soroush_client_send_photo",
      "soroush_client_send_file",
      "soroush_client_get_chats",
      "soroush_client_get_history",
      "soroush_client_get_updates",
      "soroush_client_list_groups",
      "soroush_client_create_group",
      "soroush_client_group_members",
      "soroush_client_add_group_members",
      "soroush_client_list_channels",
      "soroush_client_create_channel",
      "soroush_client_channel_members",
      "soroush_client_add_channel_members",
    ])
      assert.ok(names.includes(name), `missing ${name}`);
    assert.equal(typeof soroushClient.receive?.poll, "function");
  });
});
