#!/usr/bin/env node
/**
 * EitaaBun bridge runner.
 *
 * Usage:
 *   npm run eitaa:bridge
 *
 * Downloads EitaaBun (https://github.com/ghaemifard/EitaaBun) into .eitaa-bridge
 * on first run, installs its deps with Bun, and starts its local HTTP bridge on
 * http://127.0.0.1:1234.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.cwd(), ".eitaa-bridge");
const tarball = "https://codeload.github.com/ghaemifard/EitaaBun/tar.gz/refs/heads/main";
const repo = "https://github.com/ghaemifard/EitaaBun.git";

function run(command, args, cwd = process.cwd(), env = process.env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit", shell: process.platform === "win32" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code}`))));
  });
}

async function has(command) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
    child.on("error", () => resolvePromise(false));
    child.on("exit", (code) => resolvePromise(code === 0));
  });
}

async function download() {
  await mkdir(root, { recursive: true });
  console.log("Downloading EitaaBun into .eitaa-bridge ...");
  const res = await fetch(tarball, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const archive = resolve(process.cwd(), ".eitaa-bridge-download.tar.gz");
  await writeFile(archive, Buffer.from(await res.arrayBuffer()));
  try {
    await run("tar", ["-xzf", archive, "-C", root, "--strip-components=1"]);
  } finally {
    await rm(archive, { force: true });
  }
}

async function main() {
  if (!(await has("bun"))) {
    console.error("Bun لازم است. نصب: https://bun.sh  (در ویندوز: winget install Oven-sh.Bun)");
    process.exit(1);
  }
  if (!existsSync(root)) {
    try {
      await download();
    } catch (err) {
      console.error("دانلود EitaaBun ناموفق بود:", err?.message || err);
      if (await has("git")) {
        console.log(`تلاش با git: ${repo}`);
        await run("git", ["clone", "--depth", "1", repo, root]);
      } else {
        process.exit(1);
      }
    }
  }
  console.log("Installing EitaaBun dependencies ...");
  const bunTemp = resolve(root, ".tmp");
  await mkdir(bunTemp, { recursive: true });
  const bunEnv = { ...process.env, TMPDIR: bunTemp, TMP: bunTemp, TEMP: bunTemp };
  await run("bun", ["install"], root, bunEnv);
  console.log("Starting EitaaBun bridge on http://127.0.0.1:1234 ...");
  await run("bun", ["run", "index.ts"], root, bunEnv);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
