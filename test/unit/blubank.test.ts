import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { configureProxy } from "../../src/core/net.ts";
import type { ProviderContext } from "../../src/core/types.ts";
import { blubank, decodeProto, extractStrings } from "../../src/providers/blubank.ts";

/** یک پیام protobuf ساده می‌سازد: field 1 = varint، field 2 = string. */
function protoFixture(): Buffer {
  const parts: Buffer[] = [];
  parts.push(Buffer.from([0x08, 0x2a])); // field 1, varint 42
  const text = Buffer.from("سلام", "utf8");
  parts.push(Buffer.from([0x12, text.length]));
  parts.push(text);
  return Buffer.concat(parts);
}

describe("blubank provider", () => {
  before(() => configureProxy({} as NodeJS.ProcessEnv));

  test("provider در فهرست با دسته‌ی banking و ابزارهای ورود/موجودی/کارت ثبت شده است", () => {
    assert.equal(blubank.id, "blubank");
    assert.equal(blubank.category, "banking");
    assert.equal(blubank.region, "iran");
    assert.equal(blubank.unofficial, true);
    const names = blubank.tools.map((t) => t.name);
    for (const expected of [
      "blubank_key_exchange",
      "blubank_login",
      "blubank_verify_otp",
      "blubank_get_balance",
      "blubank_list_cards",
      "blubank_get_user_profile",
      "blubank_identities",
      "blubank_list_transactions",
      "blubank_raw_request",
    ]) {
      assert.ok(names.includes(expected), `ابزار ${expected} ثبت نشده`);
    }
  });

  test("decodeProto فیلدهای varint و string را می‌خواند", () => {
    const fields = decodeProto(protoFixture());
    assert.equal(fields.length, 2);
    assert.equal(fields[0].field, 1);
    assert.equal(fields[0].value, 42);
    assert.equal(fields[1].field, 2);
    assert.equal((fields[1].value as Buffer).toString("utf8"), "سلام");
  });

  test("extractStrings رشته‌های خوانا را بیرون می‌کشد", () => {
    const strings = extractStrings(protoFixture());
    assert.ok(strings.includes("سلام"));
  });

  test("decodeProto روی بافر ناقص/نامعتبر بی‌نهایت حلقه نمی‌زند", () => {
    // varint بدون بایت پایانی
    assert.doesNotThrow(() => decodeProto(Buffer.from([0x08, 0x80])));
    // طول رشته بیشتر از بافر
    assert.doesNotThrow(() => decodeProto(Buffer.from([0x12, 0xff, 0x01, 0x41])));
    // wire ناشناخته
    assert.doesNotThrow(() => decodeProto(Buffer.from([0x0f])));
    // بافر خالی
    assert.deepEqual(decodeProto(Buffer.alloc(0)), []);
  });

  test("decodeProto فیلد ۰ را متوقف می‌کند", () => {
    assert.deepEqual(decodeProto(Buffer.from([0x00, 0x08, 0x2a])), []);
  });

  test("بدون توکن، فراخوانی ابزار خطای احراز هویت می‌دهد", async () => {
    const ctx = { config: {} } as unknown as ProviderContext;
    const tool = blubank.tools.find((t) => t.name === "blubank_get_balance")!;
    await assert.rejects(() => tool.handler({}, ctx), /Access Token|Cookie/);
  });

  describe("با سرور آزمایشی", () => {
    let server: Server;
    let base = "";
    let lastPath = "";
    let lastAuth = "";

    before(async () => {
      server = createServer((req, res) => {
        lastPath = req.url ?? "";
        lastAuth = String(req.headers.authorization ?? "");
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          res.writeHead(200, { "content-type": "application/x-protobuf" });
          res.end(protoFixture());
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    after(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    test("موجودی از اندپوینت درست خوانده و decode می‌شود", async () => {
      const ctx = { config: { baseUrl: base, accessToken: "test-token" } } as unknown as ProviderContext;
      const tool = blubank.tools.find((t) => t.name === "blubank_get_balance")!;
      const result: any = await tool.handler({}, ctx);
      assert.equal(lastPath, "/account/deposit/list/all");
      assert.equal(lastAuth, "Bearer test-token");
      assert.ok(result.strings.includes("سلام"));
    });

    test("کارت‌ها از اندپوینت profile خوانده می‌شود", async () => {
      const ctx = { config: { baseUrl: base, accessToken: "test-token" } } as unknown as ProviderContext;
      const tool = blubank.tools.find((t) => t.name === "blubank_list_cards")!;
      await tool.handler({}, ctx);
      assert.equal(lastPath, "/account-profile/profile/list");
    });
  });
});
