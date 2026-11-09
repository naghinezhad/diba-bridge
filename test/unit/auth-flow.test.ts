import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { DibaMcpEngine } from "../../src/core/engine.ts";
import type { ProviderDef } from "../../src/core/types.ts";

function fakeProvider(calls: string[]): ProviderDef {
  return {
    id: "fake_client",
    name: "Fake Client",
    nameFa: "کلاینت تست",
    category: "messenger",
    color: "#000",
    glyph: "ت",
    description: "test",
    fields: [
      { key: "phone", label: "phone", type: "text" },
      { key: "session", label: "session", type: "secret", required: true },
    ],
    auth: {
      title: "ورود تست",
      description: "test",
      phoneField: "phone",
      sessionField: "session",
      async start(_ctx, phone, save) {
        calls.push("start");
        save({ phone });
        return { step: "code", transactionHash: "tx-1" };
      },
      async verifyCode(_ctx, transactionHash, code, save) {
        calls.push(`code:${transactionHash}:${code}`);
        save({ session: "42:jwt" });
        return { step: "done", user: { id: 42, name: "کاربر" } };
      },
      async verifyPassword() {
        calls.push("password");
        return { step: "done" };
      },
      async logout(_ctx, save) {
        calls.push("logout");
        save({ session: "" });
        return { step: "done" };
      },
    },
    tools: [],
  };
}

describe("authStep", () => {
  test("شماره ← کد ← آماده شدن سرویس ← خروج", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "diba-mcp-auth-"));
    const calls: string[] = [];
    const provider = fakeProvider(calls);
    const engine = new DibaMcpEngine({ dataDir, providers: [provider], env: {} });
    try {
      const start = await engine.authStep(provider.id, "start", { phone: "09121234567" });
      assert.equal(start.ok, true);
      assert.deepEqual(start.result, { step: "code", transactionHash: "tx-1" });

      const meta = engine.describeProviders()[0];
      assert.equal(meta.auth?.loggedIn, false);
      assert.equal(meta.auth?.sessionField, "session");

      const code = await engine.authStep(provider.id, "code", { transactionHash: "tx-1", code: "12345" });
      assert.equal(code.ok, true);
      assert.equal((code.result as any).step, "done");
      assert.equal(engine.store.isEnabled(provider), true);
      assert.equal(engine.store.isReady(provider), true);
      assert.equal(engine.describeProviders()[0].auth?.loggedIn, true);

      const out = await engine.authStep(provider.id, "logout");
      assert.equal(out.ok, true);
      assert.equal(engine.store.isReady(provider), false);
      assert.deepEqual(calls, ["start", "code:tx-1:12345", "logout"]);
    } finally {
      engine.inbox.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("سرویس بدون auth خطای خوانا می‌دهد", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "diba-mcp-auth-"));
    const plain: ProviderDef = {
      id: "plain",
      name: "Plain",
      nameFa: "ساده",
      category: "utility",
      color: "#000",
      glyph: "س",
      description: "test",
      fields: [],
      tools: [],
    };
    const engine = new DibaMcpEngine({ dataDir, providers: [plain], env: {} });
    try {
      const r = await engine.authStep("plain", "start", {});
      assert.equal(r.ok, false);
      assert.match(r.error!, /ورود/);
    } finally {
      engine.inbox.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
