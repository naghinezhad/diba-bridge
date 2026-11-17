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
