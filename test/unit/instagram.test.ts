import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { DibaMcpEngine } from "../../src/core/engine.ts";
import { instagram } from "../../src/providers/instagram.ts";

describe("instagram provider", () => {
  test("فیلدهای نام کاربری و نشست بدون API Key را دارد", () => {
    const keys = instagram.fields.map((f) => f.key);
    assert.deepEqual(keys, ["username", "session", "proxyUrl"]);
    assert.equal(instagram.auth?.credentials, "username");
    assert.equal(instagram.auth?.phoneField, "username");
    assert.equal(instagram.auth?.sessionField, "session");
    assert.deepEqual(
      instagram.tools.map((t) => t.name),
      [
        "instagram_get_me",
        "instagram_get_user",
        "instagram_get_media",
        "instagram_get_comments",
        "instagram_list_chats",
        "instagram_get_messages",
        "instagram_publish_photo",
      ],
    );
  });

  test("شروع ورود نام کاربری را نرمال می‌کند و نامعتبر را رد می‌کند", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "diba-mcp-ig-"));
    const engine = new DibaMcpEngine({ dataDir, providers: [instagram], env: {} });
    try {
      const bad = await engine.authStep("instagram", "start", { phone: "bad user!" });
      assert.equal(bad.ok, false);
      assert.match(bad.error!, /معتبر نیست/);

      const ok = await engine.authStep("instagram", "start", { phone: "@Test.User_1" });
      assert.equal(ok.ok, true);
      const res = ok.result as any;
      assert.equal(res.step, "password");
      assert.ok(typeof res.transactionHash === "string" && res.transactionHash.startsWith("ig-"));

      const resolved = engine.store.resolve(instagram);
      assert.equal(resolved.values.username, "Test.User_1");

      assert.ok(engine.describeProviders()[0].auth?.sessionImport?.title);
      const noCookie = await engine.authImport("instagram", "");
      assert.equal(noCookie.ok, false);
      assert.match(noCookie.error!, /sessionid/);
      const junk = await engine.authImport("instagram", "not a cookie");
      assert.equal(junk.ok, false);
      assert.match(junk.error!, /sessionid/);

      const out = await engine.authStep("instagram", "logout");
      assert.equal(out.ok, true);
      assert.equal((out.result as any).step, "done");
      assert.equal(engine.store.resolve(instagram).values.username, "");
      assert.equal(engine.store.resolve(instagram).values.session, "");
    } finally {
      engine.inbox.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
