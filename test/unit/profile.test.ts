import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { normalizeLogo, normalizeProfile, normalizeWebsite, PROFILE_LIMITS, ProfileError } from "../../src/core/profile.ts";
import { ConfigStore } from "../../src/core/store.ts";

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (extra = 32) => `data:image/png;base64,${Buffer.concat([PNG_HEADER, Buffer.alloc(extra, 1)]).toString("base64")}`;

describe("مشخصات سازمان — اعتبارسنجی", () => {
  test("متن‌ها تمیز و کوتاه می‌شوند و نام شرکت الزامی است", () => {
    const p = normalizeProfile({ orgName: "  فروشگاه\u0000  آسمان\n", ownerName: "سارا", description: "خط اول\nخط دوم", website: "" });
    assert.equal(p.orgName, "فروشگاه آسمان");
    assert.equal(p.description, "خط اول\nخط دوم");
    assert.equal(p.website, "");
    assert.equal("logo" in p, false, "وقتی logo در بدنه نیست، لوگوی فعلی دست نمی‌خورد");
    assert.throws(() => normalizeProfile({ orgName: " " }), (e: unknown) => e instanceof ProfileError && e.field === "orgName");
    assert.throws(() => normalizeProfile(null), ProfileError);
    assert.throws(() => normalizeProfile({ orgName: "x".repeat(PROFILE_LIMITS.orgName + 1) }), ProfileError);
  });

  test("آدرس سایت فقط http/https و بدون نام کاربری پذیرفته می‌شود", () => {
    assert.equal(normalizeWebsite("example.com"), "https://example.com");
    assert.equal(normalizeWebsite("http://shop.example.ir/path/"), "http://shop.example.ir/path");
    for (const bad of ["javascript:alert(1)", "data:text/html,<script>1</script>", "ftp://example.com", "https://user:pass@example.com", "not a url", "https://nodot"]) {
      assert.throws(() => normalizeWebsite(bad), ProfileError, bad);
    }
  });

  test("لوگو: فقط تصویر بیت‌مپ واقعی و کوچک‌تر از سقف", () => {
    assert.equal(normalizeLogo(""), "");
    assert.equal(normalizeLogo(png()), png());
    assert.throws(() => normalizeLogo(`data:image/svg+xml;base64,${Buffer.from("<svg onload=alert(1)/>").toString("base64")}`), ProfileError);
    assert.throws(() => normalizeLogo(`data:image/png;base64,${Buffer.from("<html><script>1</script>").toString("base64")}`), ProfileError);
    assert.throws(() => normalizeLogo("https://example.com/logo.png"), ProfileError);
    assert.throws(() => normalizeLogo(`data:text/html;base64,${Buffer.from("<b>x</b>").toString("base64")}`), ProfileError);
    assert.throws(() => normalizeLogo(png(PROFILE_LIMITS.logoBytes)), ProfileError);
    assert.throws(() => normalizeLogo(42), ProfileError);
  });
});

describe("مشخصات سازمان — ذخیره‌سازی", () => {
  test("نصب اولیه تا ثبت نشدن لازم است و مشخصات در config.json می‌ماند", () => {
    const dir = mkdtempSync(join(tmpdir(), "diba-profile-"));
    const store = new ConfigStore(dir, {});
    assert.equal(store.needsInstall, true);
    assert.equal(store.profile().installed, false);

    store.updateProfile({ orgName: "فروشگاه آسمان", website: "https://example.com", logo: png() });
    assert.equal(store.needsInstall, true, "ذخیره‌ی مشخصات به‌تنهایی نصب را کامل نمی‌کند");
    store.markInstalled();

    const reopened = new ConfigStore(dir, {});
    assert.equal(reopened.needsInstall, false);
    assert.equal(reopened.profile().orgName, "فروشگاه آسمان");
    assert.equal(reopened.profile().logo, png());
    assert.ok(!Number.isNaN(Date.parse(reopened.profile().installedAt)));

    reopened.updateProfile({ logo: "", website: "" });
    assert.equal(reopened.profile().logo, "");
    assert.equal(reopened.profile().orgName, "فروشگاه آسمان");
    assert.equal(reopened.needsInstall, false);
    const raw = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    assert.equal("logo" in raw.profile, false);
    if (process.platform !== "win32") assert.equal(statSync(join(dir, "config.json")).mode & 0o777, 0o600);
  });
});
