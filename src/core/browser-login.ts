/**
 * Minimal headful-Chrome login helper for providers whose login page cannot be
 * embedded (Instagram blocks iframes and its session cookie is HttpOnly).
 *
 * The user signs in on the real site in a visible Chrome window. We read the
 * resulting cookies over the Chrome DevTools Protocol and hand them back to the
 * provider, then close the temporary browser profile.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

export interface BrowserLoginStart {
  jobId: string;
  hint: string;
}

interface BrowserJob {
  id: string;
  child: ChildProcess;
  port: number;
  profile: string;
  createdAt: number;
  cookies?: Record<string, string>;
  readyHits?: number;
  lastHint?: string;
  error?: string;
  closed: boolean;
}

const jobs = new Map<string, BrowserJob>();
const JOB_TTL_MS = 20 * 60_000;

function chromePath(): string | undefined {
  return [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean).find((p) => existsSync(p as string)) as string | undefined;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const address = s.address();
      const port = typeof address === "object" && address ? address.port : 0;
      s.close(() => resolve(port));
    });
  });
}

function closeJob(job: BrowserJob) {
  if (job.closed) return;
  job.closed = true;
  try { job.child.kill(); } catch { /* ignore */ }
  setTimeout(() => { try { rmSync(job.profile, { recursive: true, force: true }); } catch { /* ignore */ } }, 500);
}

interface CdpResponse {
  id?: number;
  result?: any;
  error?: { message?: string };
}

interface BrowserProbe {
  cookies?: Record<string, string>;
  ready: boolean;
  hint?: string;
}

async function cdpProbe(port: number, urls: string[]): Promise<BrowserProbe | undefined> {
  const list = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2_000) });
  if (!list.ok) return undefined;
  const targets = await list.json() as any[];
  const page = targets.find((t) => t.type === "page" && /instagram\.com/i.test(String(t.url || ""))) || targets.find((t) => t.type === "page");
  if (!page?.webSocketDebuggerUrl) return undefined;

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let nextId = 0;
  const pending = new Map<number, (value: CdpResponse) => void>();
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as CdpResponse;
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)?.(msg);
        pending.delete(msg.id);
      }
    } catch { /* ignore malformed CDP frames */ }
  });
  const send = (method: string, params: Record<string, unknown> = {}) => new Promise<CdpResponse>((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
      setTimeout(() => reject(new Error("CDP connection timeout")), 2_000);
    });
    await send("Network.enable");
    const res = await send("Network.getCookies", { urls });
    const rawCookies = res.result?.cookies;
    const cookies: Record<string, string> = {};
    if (Array.isArray(rawCookies)) {
      for (const c of rawCookies) {
        if (c?.name && c?.value) cookies[String(c.name)] = String(c.value);
      }
    }

    const info = await send("Runtime.evaluate", {
      expression: `JSON.stringify({
        href: location.href,
        hasPassword: !!document.querySelector('input[name="pass"], input[type="password"]'),
        hasCode: !!document.querySelector('input[name="verificationCode"], input[autocomplete="one-time-code"], input[name="security_code"]'),
        text: (document.body?.innerText || "").slice(0, 500)
      })`,
      returnByValue: true,
    });
    let pageInfo: any = {};
    try { pageInfo = JSON.parse(info.result?.result?.value || "{}"); } catch { /* ignore */ }
    const href = String(pageInfo.href || page.url || "");
    const blockedPath = /accounts\/login|auth_platform|challenge|checkpoint|two_factor|emailsignup|accounts\/password|security|recaptcha/i.test(href);
    const challengeText = /two-factor|two factor|security code|verification code|confirm it'?s you|checkpoint|recaptcha|whatsapp/i.test(String(pageInfo.text || ""));
    const hasSession = Boolean(cookies.sessionid && (cookies.ds_user_id || cookies.csrftoken));
    const ready = hasSession && !blockedPath && !pageInfo.hasPassword && !pageInfo.hasCode && !challengeText;
    const hint = challengeText || blockedPath
      ? "اگر اینستاگرام کد واتساپ/پیامک یا تأیید دو مرحله‌ای خواست، همان‌جا وارد کنید؛ تا تکمیل نشود کوکی نهایی خوانده نمی‌شود."
      : "در پنجره‌ی Chrome وارد اینستاگرام شوید؛ پس از تکمیل ورود، کوکی خودکار خوانده می‌شود.";
    return { cookies: Object.keys(cookies).length ? cookies : undefined, ready, hint };
  } finally {
    try { ws.close(); } catch { /* ignore */ }
  }
}

export async function startBrowserLogin(opts: {
  url: string;
  cookieUrls: string[];
  hint: string;
}): Promise<BrowserLoginStart> {
  const executable = chromePath();
  if (!executable) throw new Error("Google Chrome پیدا نشد. CHROME_PATH را تنظیم کنید یا Chrome نصب کنید.");
  const port = await freePort();
  const profile = mkdtempSync(join(tmpdir(), "diba-browser-login-"));
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.SOCKS_PROXY || process.env.socks_proxy || process.env.ALL_PROXY;
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
    ...(proxy ? [`--proxy-server=${proxy}`] : []),
    opts.url,
  ];
  const child = spawn(executable, args, { stdio: "ignore", windowsHide: false });
  const job: BrowserJob = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, child, port, profile, createdAt: Date.now(), closed: false };
  const expiry = setTimeout(() => { if (!job.closed) closeJob(job); jobs.delete(job.id); }, JOB_TTL_MS);
  expiry.unref?.();
  child.once("exit", () => {
    clearTimeout(expiry);
    if (!job.cookies && !job.closed) job.error = "پنجره‌ی ورود بسته شد؛ دوباره تلاش کنید.";
  });
  jobs.set(job.id, job);
  return { jobId: job.id, hint: opts.hint };
}

export async function pollBrowserLogin(jobId: string, cookieUrls: string[]): Promise<
  | { pending: true; hint?: string }
  | { pending: false; cookieString: string; cookies: Record<string, string> }
> {
  const job = jobs.get(jobId);
  if (!job) throw new Error("جلسه‌ی ورود مرورگر پیدا نشد؛ دوباره شروع کنید.");
  if (Date.now() - job.createdAt > JOB_TTL_MS) {
    job.error = "زمان ورود مرورگر تمام شد؛ دوباره شروع کنید.";
  }
  if (job.error) {
    closeJob(job);
    jobs.delete(jobId);
    throw new Error(job.error);
  }
  if (job.child.exitCode !== null) {
    job.error = "پنجره‌ی ورود بسته شد؛ دوباره تلاش کنید.";
    jobs.delete(jobId);
    throw new Error(job.error);
  }
  const probe = await cdpProbe(job.port, cookieUrls).catch(() => undefined);
  if (probe?.cookies) job.cookies = probe.cookies;
  if (!probe || !job.cookies) {
    return { pending: true, hint: probe?.hint || "در پنجره‌ی Chrome وارد اینستاگرام شوید؛ پس از ورود، کوکی خودکار خوانده می‌شود." };
  }
  if (!probe.ready) {
    job.readyHits = 0;
    return { pending: true, hint: probe.hint };
  }
  job.readyHits = (job.readyHits ?? 0) + 1;
  // Two consecutive healthy probes avoid importing a half-finished 2FA session.
  if (job.readyHits < 2) {
    return { pending: true, hint: "ورود کامل شد؛ در حال خواندن کوکی نشست…" };
  }
  const cookieString = Object.entries(job.cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  const cookies = job.cookies;
  closeJob(job);
  jobs.delete(jobId);
  return { pending: false, cookieString, cookies };
}

export function cancelBrowserLogin(jobId: string) {
  const job = jobs.get(jobId);
  if (job) {
    closeJob(job);
    jobs.delete(jobId);
  }
}

export function cancelAllBrowserLogins() {
  for (const job of jobs.values()) closeJob(job);
  jobs.clear();
}
