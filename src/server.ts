/**
 * راه‌اندازهای آماده — هم CLI (diba-mcp) و هم main.ts/stdio.ts/netcheck.ts از این‌ها استفاده می‌کنند.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import express from "express";
import type { Server } from "node:http";
import { Writable } from "node:stream";
import { runNetcheck } from "./core/netcheck.js";
import { createDibaMcp } from "./index.js";

export interface HttpOptions {
  port?: number;
  host?: string;
  dataDir?: string;
  trustProxy?: string;
  /** بنر شروع را چاپ کند (پیش‌فرض true) */
  banner?: boolean;
}

/** داشبورد + اندپوینت MCP روی HTTP */
export function startHttp(opts: HttpOptions = {}): Promise<{ url: string; server: Server; dataDir: string }> {
  const port = opts.port ?? 3790;
  const host = opts.host ?? "127.0.0.1";
  const dibaMcp = createDibaMcp({ dataDir: opts.dataDir });
  const dataDir = dibaMcp.dataDir;

  const app = express();
  app.disable("x-powered-by");
  if (opts.trustProxy) app.set("trust proxy", /^\d+$/.test(opts.trustProxy) ? Number(opts.trustProxy) : opts.trustProxy);
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  app.use("/", dibaMcp.router());

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const url = `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`;
      if (opts.banner !== false) {
        console.error(`\n  dibaMCP v${dibaMcp.version}`);
        console.error(`  داشبورد:      ${url}/`);
        console.error(`  اندپوینت MCP: ${url}/mcp`);
        console.error(`  پوشه‌ی داده:  ${dataDir}\n`);
      }
      resolve({ url, server, dataDir });
    });
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") console.error(`[diba-mcp] پورت ${port} اشغال است. با --port یک پورت دیگر بدهید.`);
      reject(err);
    });
  });
}

/**
 * اجرا با stdio (Claude Desktop و ...). هیچ چیزی روی stdout چاپ نمی‌شود.
 * MCP روی stdout پیام JSON-RPC رد و بدل می‌کند؛ برای همین هر لاگ کتابخانه‌ها
 * (مثل pino/Baileys که مستقیم روی stdout می‌نویسند) به stderr هدایت می‌شود.
 */
export async function startStdio(opts: { dataDir?: string } = {}) {
  const protocolStdout = process.stdout;
  const writeProtocol = protocolStdout.write.bind(protocolStdout);
  const guardedStdout = new Writable({
    write(chunk, encoding, callback) {
      writeProtocol(chunk as any, encoding as BufferEncoding, callback);
    },
  });

  process.stdout.write = ((chunk: any, encoding?: any, callback?: any) => {
    if (typeof encoding === "function") {
      callback = encoding;
      encoding = undefined;
    }
    return process.stderr.write(chunk, encoding, callback);
  }) as typeof process.stdout.write;

  console.log = (...args: any[]) => console.error(...args);
  console.info = (...args: any[]) => console.error(...args);
  console.debug = (...args: any[]) => console.error(...args);
  const dibaMcp = createDibaMcp({ dataDir: opts.dataDir });
  // ابزار list_chats و دریافت پیام‌ها در حالت stdio هم کار کنند
  dibaMcp.engine.inbox.start();
  await dibaMcp.createMcpServer().connect(new StdioServerTransport(process.stdin, guardedStdout));
  console.error(`[diba-mcp] stdio آماده است — ${dibaMcp.engine.activeTools().length} ابزار فعال — داده: ${dibaMcp.dataDir}`);
}

/** چاپ نتیجه‌ی تست دسترسی شبکه؛ خروجی true یعنی همه در دسترس بودند */
export async function printNetcheck(opts: { dataDir?: string } = {}): Promise<boolean> {
  const { engine } = createDibaMcp({ dataDir: opts.dataDir });
  const r = await runNetcheck(engine);
  const via = r.proxy.type === "direct" ? "مستقیم (بدون پراکسی)" : `${r.proxy.type} → ${r.proxy.target}`;
  console.log(`\nمسیر خروجی: ${via}`);
  console.log(`IP خروجی:   ${r.egressIp ?? "نامعلوم"}\n`);
  for (const x of r.results) {
    const info = x.reachable ? `HTTP ${x.status}` : x.error;
    console.log(`${x.reachable ? "✅" : "❌"} ${x.name.padEnd(10)} ${String(x.ms).padStart(5)}ms  ${info}\n   ${x.url}`);
  }
  const ok = r.results.filter((x) => x.reachable).length;
  console.log(`\n${ok} از ${r.results.length} سرویس در دسترس است.`);
  if (ok < r.results.length && r.proxy.type === "direct") {
    console.log("برای سرویس‌های بسته، SOCKS_PROXY یا HTTPS_PROXY را به یک سرور داخل ایران تنظیم کنید (DEPLOY.md).");
  }
  return ok === r.results.length;
}
