import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { ConfigStore, dockerizeLocalProxy, envKey } from "../../src/core/store.ts";
import { baleClient, rubikaClient } from "../../src/providers/index.ts";

const dir = () => mkdtempSync(join(tmpdir(), "diba-store-"));

describe("envKey", () => {
  test("camelCase field names become SNAKE env names", () => {
    assert.equal(envKey("bale", "token"), "BALE_TOKEN");
    assert.equal(envKey("rubika", "baseUrl"), "RUBIKA_BASE_URL");
    assert.equal(envKey("eitaa", "defaultChatId"), "EITAA_DEFAULT_CHAT_ID");
  });
});

describe("ConfigStore", () => {
  test("creates config with a token and session secret", () => {
    const d = dir();
    const s = new ConfigStore(d, {});
    assert.match(s.mcpToken, /^dmcp_/);
    assert.ok(s.sessionSecret.length >= 32);
    // ویندوز حالت فایل POSIX ندارد؛ مجوز ۶۰۰ فقط روی لینوکس/مک قابل بررسی است
    if (process.platform !== "win32") assert.equal(statSync(join(d, "config.json")).mode & 0o777, 0o600);
  });

  test("values persist across instances", () => {
    const d = dir();
    new ConfigStore(d, {}).update("bale_client", { enabled: true, values: { session: "  abc:def  " } });
    const s2 = new ConfigStore(d, {});
    assert.equal(s2.resolve(baleClient).values.session, "abc:def"); // trim شده
    assert.equal(s2.isReady(baleClient), true);
  });

  test("env overrides file and is reported as fromEnv", () => {
    const d = dir();
    const s = new ConfigStore(d, { BALE_CLIENT_SESSION: "from-env", BALE_CLIENT_ENABLED: "true" });
    s.update("bale_client", { enabled: false, values: { session: "from-file" } });
    const r = s.resolve(baleClient);
    assert.equal(r.values.session, "from-env");
    assert.equal(r.fromEnv.session, true);
    assert.equal(s.isEnabled(baleClient), true);
  });

  test("missing required fields block readiness", () => {
    const s = new ConfigStore(dir(), {});
    s.update("rubika_client", { enabled: true });
    assert.deepEqual(s.missingFields(rubikaClient), ["session"]);
    assert.equal(s.isReady(rubikaClient), false);
  });

  test("empty string clears a stored value", () => {
    const s = new ConfigStore(dir(), {});
    s.update("bale_client", { values: { session: "x" } });
    s.update("bale_client", { values: { session: "" } });
    assert.equal(s.resolve(baleClient).values.session, "");
  });

  test("corrupt config is backed up instead of silently lost", () => {
    const d = dir();
    writeFileSync(join(d, "config.json"), "{ not json");
    const s = new ConfigStore(d, {});
    assert.match(s.mcpToken, /^dmcp_/);
    const backups = readdirSync(d).filter((f) => f.startsWith("config.json.corrupt-"));
    assert.equal(backups.length, 1);
    assert.equal(readFileSync(join(d, backups[0]), "utf8"), "{ not json");
  });

  test("old config without session fields is upgraded in place", () => {
    const d = dir();
    writeFileSync(join(d, "config.json"), JSON.stringify({ version: 1, mcpToken: "imcp_old", providers: {} }));
    const s = new ConfigStore(d, {});
    assert.equal(s.mcpToken, "imcp_old");
    assert.ok(s.sessionSecret);
    assert.ok(JSON.parse(readFileSync(join(d, "config.json"), "utf8")).sessionSecret);
  });

  test("rotating the token and setting admin bump state correctly", () => {
    const s = new ConfigStore(dir(), {});
    const t = s.mcpToken;
    assert.notEqual(s.rotateMcpToken(), t);
    const e = s.sessionEpoch;
    s.setAdmin({ salt: "a", hash: "b" });
    assert.equal(s.sessionEpoch, e + 1);
  });

  test("MCP_TOKEN in env wins and cannot be rotated away", () => {
    const s = new ConfigStore(dir(), { MCP_TOKEN: "env-token" });
    assert.equal(s.mcpToken, "env-token");
    assert.equal(s.mcpTokenFromEnv, true);
    assert.equal(existsSync(s["file" as never]), true);
  });
});

describe("dockerizeLocalProxy", () => {
  test("داخل کانتینر، نشانی محلی پراکسی (حتی با نام کاربری/رمز) به میزبان اشاره می‌کند", () => {
    const before = process.env.DOCKER_CONTAINER;
    try {
      delete process.env.DOCKER_CONTAINER;
      assert.equal(dockerizeLocalProxy("socks5://127.0.0.1:1080"), "socks5://127.0.0.1:1080");
      process.env.DOCKER_CONTAINER = "1";
      assert.equal(dockerizeLocalProxy("socks5://127.0.0.1:1080"), "socks5://host.docker.internal:1080");
      assert.equal(dockerizeLocalProxy("http://localhost:3128/"), "http://host.docker.internal:3128/");
      assert.equal(dockerizeLocalProxy("socks5://user:pass@127.0.0.1:1080"), "socks5://user:pass@host.docker.internal:1080");
      assert.equal(dockerizeLocalProxy("http://[::1]:3128"), "http://host.docker.internal:3128");
      assert.equal(dockerizeLocalProxy("socks5://10.0.0.5:1080"), "socks5://10.0.0.5:1080");
      assert.equal(dockerizeLocalProxy("http://user@proxy.example.com:8080"), "http://user@proxy.example.com:8080");
    } finally {
      if (before === undefined) delete process.env.DOCKER_CONTAINER;
      else process.env.DOCKER_CONTAINER = before;
    }
  });
});
