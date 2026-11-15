/**
 * اجرای تست‌های واحد به‌صورت مستقل از shell.
 * چرا؟ `node --test "test/unit/**\/*.test.ts"` به glob شل و نسخه‌ی Node وابسته است
 * (روی Windows/cmd باز نمی‌شود و در Node ۲۰ کلاً پیدا نمی‌کند). اینجا فایل‌ها
 * با fs خوانده و صریح به اجراکننده‌ی تست داده می‌شوند.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const dir = "test/unit";
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".test.ts"))
  .sort()
  .map((f) => join(dir, f));

if (!files.length) {
  console.error(`[test-unit] هیچ فایل تستی در ${dir} پیدا نشد`);
  process.exit(1);
}

const r = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { stdio: "inherit" });
process.exit(r.status ?? 1);
