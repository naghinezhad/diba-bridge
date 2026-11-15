import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { hashPassword, RateLimiter, safeEqual, SignedSessions, verifyPassword } from "../core/auth.js";
import { handleSendReply, parseSendIntent, prepareSend } from "../core/agent-send.js";
import { dibaRouterChat, dibaRouterModels, dibaRouterTest, type DibaRouterMessage, type DibaRouterTool } from "../core/dibarouter.js";
import { compactConversation, compactToolResult, extractContextLimit, fitContextToBudget, isContextLimitError, selectAndCompactTools, summarizeContextError } from "../core/context.js";
import { SERVER_VERSION, type DibaMcpEngine } from "../core/engine.js";
import { configureProxy } from "../core/net.js";
import { proxyEnvOf, type AppProxyType } from "../core/store.js";
import { runNetcheck } from "../core/netcheck.js";
import { enrichChatTitles } from "../core/resolver.js";
import { hintFor, runSelfTest } from "../core/selftest.js";
import { handleEitaaBridgeWebhook } from "../providers/eitaa-client.js";

export interface RouterOptions {
  /** نمایش داشبورد (پیش‌فرض: true). در پروژه‌ی میزبان می‌توانید خاموشش کنید */
  dashboard?: boolean;
  /** دریافت خودکار پیام‌ها برای سرویس‌هایی که روشن کرده‌اند (پیش‌فرض: true) */
  inbox?: boolean;
  /** پوشه‌ی فایل‌های داشبورد */
  publicDir?: string;
}

const COOKIE = "dmcp_sid";
const SESSION_MAX_AGE = 12 * 60 * 60;
const defaultPublic = fileURLToPath(new URL("../../public", import.meta.url));

function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 10) return "••••••";
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

/** پرامپت دستیار: فقط وضعیت امن و خلاصه‌ی داشبورد را می‌بیند، نه توکن‌ها */
function agentSystemPrompt(engine: DibaMcpEngine, historySummary?: string): string {
  const readyList: string[] = [];
  const offList: string[] = [];
  for (const p of engine.describeProviders()) {
    if (p.ready) {
      const rcv = p.receive.supported ? (p.receive.enabled ? "، دریافت روشن" : "، دریافت خاموش") : "";
      readyList.push(`${p.nameFa} (${p.id}: ${p.tools.length} ابزار${rcv})`);
    } else {
      const reason = p.enabled ? `ناقص: ${p.missing.join("، ") || "تنظیم نشده"}` : "خاموش";
      offList.push(`${p.nameFa} (${reason})`);
    }
  }
  const inboxAlerts = engine.inbox
    .statuses()
    .filter((s) => s.enabled || s.lastError)
    .map((s) => `${s.provider}: ${s.lastError ? `خطا (${s.lastError.slice(0, 80)})` : "دریافت فعال"}`);

  return `تو «دستیار دیبا» هستی؛ دستیار فارسی داشبورد dibaMCP برای پیام‌رسان‌ها و ابزارهای MCP.
قواعد:
- فارسی، کوتاه، دقیق و عملی جواب بده. هیچ توکن یا رمزی را نگو.
- در پاسخ، نام فارسی سرویس را به کار ببر و شناسه‌ی انگلیسی را فقط در صورت نیاز در پرانتز بیاور.
- برای هر سؤال درباره‌ی وضعیت، آمادگی یا فهرست سرویس‌ها اول ابزار list_services را صدا بزن؛ برای پیدا کردن مقصد پیام از list_chats استفاده کن. به فهرست ثابت پایین اکتفا نکن.
- فهرست «سرویس‌های آماده» فقط وضعیت پیکربندی است (روشن + تنظیمات کامل)، نه اتصال زنده؛ اگر مطمئن نیستی با get_me یا get_chats همان سرویس بررسی کن.
- برای کارهای چندمرحله‌ای، در یک خط کوتاه برنامه را بگو (مثلاً «۱) پیدا کردن چت ۲) ارسال پیام») و بعد ابزارها را به ترتیب اجرا کن.
- اگر ابزاری خطا داد، متن خطا را بخوان؛ یک بار همان ابزار را با آرگومان‌های اصلاح‌شده صدا بزن. اگر باز هم نشد، علت را شفاف بگو و حدس نزن.
- ابزارهای نوشتنی (ارسال، حذف، تغییر) را فقط با درخواست صریح کاربر اجرا کن؛ ابزارهای حذف/خروج/بلاک/تغییر عضویت را فقط با درخواست صریح همان کار.
- اگر مقصد یا سرویس نامشخص است، اول list_services/list_chats را صدا بزن یا یک سؤال کوتاه بپرس؛ حدس نزن.
- اگر کاربر شناسه/chat_id/نام کاربری/شماره‌ی مشخصی داده، همان را بدون پرسش به ابزار بده و دوباره نپرس.
- «شناسه» را با «فهرست خالی چت‌ها» اشتباه نگیر؛ اگر شناسه داده شده، get_chat یا ابزار متناظر را با همان شناسه صدا بزن.
- برای «به [نام] پیام بده» مسیر آماده‌سازی/تأیید را طی کن؛ خودت مستقیم و بدون تأیید پیام نفرست.
- لازم نیست کاربر نام دقیق یا chat_id بدهد؛ نزدیک‌ترین مخاطبین را از چت‌های موجود، مخاطبین و حافظه پیدا کن و گزینه‌ها را نشان بده.
- هیچ chat_id، شناسه‌ی داخلی یا شماره‌ی کامل را در پاسخ نده؛ فقط نام نمایشی، سرویس و نوع چت (خصوصی/گروه/کانال) را بگو.
- قبل از ارسال، مخاطب و متن پیشنهادی را نشان بده و منتظر تأیید صریح («بله») بمان. اگر کاربر «لغو» گفت، ارسال را لغو کن.
- اگر چند مخاطب نزدیک هست، شماره‌ی گزینه یا نام را بپرس؛ خودت یکی را انتخاب نکن.
- متن پیام را طبیعی، کوتاه و متناسب با رابطه/آخرین گفتگو بنویس. از «سلام» تنها، متن تکراری، لینک/تبلیغ ناخواسته و ایموجی زیاد پرهیز کن.
- به گروه/کانال بدون درخواست صریح پیام نفرست.
- اگر مخاطب پیدا نشد، حدس نزن؛ نزدیک‌ترین چت‌های اخیر را نشان بده تا کاربر انتخاب کند.
- قبل از پرسیدن اطلاعاتی که ممکن است قبلاً گفته شده، memory_search را صدا بزن. اطلاعات پایدار جدید درباره‌ی کاربر/مخاطب (نام، لحن، رابطه، ترجیح) را با memory_remember ذخیره کن.
- بدون اجرای واقعی و تأیید کاربر نگو «پیام ارسال شد»؛ نتیجه‌ی مسیر تأیید/ارسال را ملاک قرار بده.
- خروجی خام ابزارها را کامل نریز؛ فقط نتیجه‌ی مفید و اقدام بعدی را بگو و شناسه‌های داخلی را افشا نکن.
- پاسخ نهایی باید بر اساس نتیجه‌ی واقعی ابزارها باشد؛ بدون اجرای ابزار نگو «انجام شد».
- مسیرهای داشبورد: #/overview، #/providers، #/triggers، #/playground، #/logs، #/connect، #/dibarouter.
- برای آدرس و توکن MCP کاربر را به تب «اتصال به هوش مصنوعی» ارجاع بده. DibaRouter: https://dibarouter.ir/api/v1

سرویس‌های آماده: ${readyList.join("؛ ") || "هیچکدام"}
سرویس‌های غیرفعال/ناقص: ${offList.join("؛ ") || "هیچکدام"}
دریافت پیام‌ها: ${inboxAlerts.join("؛ ") || "غیرفعال"}${historySummary ? `\n\n${historySummary}` : ""}`;
}

/** استخراج واقعیت‌های واضح از پیام کاربر (حافظه‌ی خودکار در کنار memory_remember) */
function autoFacts(text: string): string[] {
  const out: string[] = [];
  const remember = text.match(/(?:یادت باشه|به خاطر بسپار|ذخیره کن|remember that|remember)\s*[:\-]?\s*(.{3,300})/i);
  if (remember) out.push(remember[1].trim());
  const name = text.match(/(?:اسم|نام)\s*(?:من|کاربر)\s*(?:هست|است|:)?\s*([^\n،.؟!]{2,40})/i);
  if (name) {
    const value = name[1].replace(/\s+(?:است|هستم|هست)$/i, "").trim();
    if (value) out.push(`اسم/نام کاربر: ${value}`);
  }
  const callMe = text.match(/(?:من(?:و| را)?\s+)([^\n،.؟!]{2,30})\s*(?:صدا کن|صدا بزن|بنام)/i);
  if (callMe) out.push(`کاربر دوست دارد «${callMe[1].trim()}» صدا زده شود.`);
  return [...new Set(out)];
}

function assistantFallback(trace: Array<{ name: string; ok: boolean }>): string {
  if (!trace.length) {
    return "مدل پاسخی برنگرداند. لطفاً دوباره بپرسید؛ اگر تکرار شد، مدل دیگری را در تب «دیبا روتر» انتخاب کنید.";
  }
  const ok = trace.filter((t) => t.ok).length;
  return [
    `درخواست اجرا شد (${ok} از ${trace.length} ابزار موفق)، اما مدل پاسخی برای جمع‌بندی برنگرداند.`,
    ...trace.map((t) => `- ${t.ok ? "✓" : "✗"} ${t.name}`),
    "",
    "نتیجه‌ی کامل در صفحه‌ی «گزارش فراخوانی‌ها» ثبت شده است.",
  ].join("\n");
}

/** حذف شناسه‌های چت از نتیجه‌ی ابزارها پیش از دادن به مدل */
function stripChatIds(value: any): any {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stripChatIds);
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "chatId" || key === "chat_id" || key === "jid" || key === "peer_id") continue;
    if (key === "id" && (typeof item === "string" || typeof item === "number")) {
      const id = String(item);
      if (/@/.test(id) || /^\d{5,}$/.test(id)) continue;
    }
    out[key] = stripChatIds(item);
  }
  return out;
}

/** خلاصه‌ی خوانا و کوتاه وضعیت سرویس‌ها برای مدل (بدون آرایه‌ی بلند نام ابزارها). */
function servicesBrief(list: unknown): string {
  const items = Array.isArray(list) ? list : [];
  const ready: string[] = [];
  const off: string[] = [];
  for (const p of items as any[]) {
    const label = `${p.nameFa || p.name || p.id}`;
    if (p.ready) {
      ready.push(
        `${label}${p.receive ? " | دریافت روشن" : ""}${
          p.receiveError ? ` | خطای دریافت: ${String(p.receiveError).slice(0, 80)}` : ""
        }`,
      );
    } else {
      const reason = p.enabled ? `ناقص: ${(p.missing || []).join("، ") || "تنظیم ناقص"}` : "خاموش";
      off.push(`${label}: ${reason}`);
    }
  }
  return `سرویس‌های آماده (پیکربندی):\n${ready.join("\n") || "هیچ‌کدام"}\n\nغیرفعال/ناقص:\n${off.join("\n") || "هیچ‌کدام"}`;
}

function agentTools(engine: DibaMcpEngine, maxTools = 160): DibaRouterTool[] {
  // ابزارهای سیستمی همیشه در دسترس دستیار باشند تا وضعیت را حدس نزند
  const out: DibaRouterTool[] = [
    {
      type: "function",
      function: {
        name: "list_services",
        description:
          "وضعیت واقعی سرویس‌ها: فعال/آماده، فیلدهای ناقص، دریافت پیام و نام ابزارها. برای هر سؤال درباره‌ی سرویس‌ها یا آمادگی اول این را صدا بزن.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "list_chats",
        description:
          "فهرست چت‌ها/گروه‌ها/کانال‌ها با عنوان و آخرین پیام. برای پیدا کردن مقصد ارسال استفاده کن؛ شناسه‌ی چت را به کاربر نشان نده.",
        parameters: {
          type: "object",
          properties: { provider: { type: "string", description: "شناسه‌ی سرویس مثل bale_client، rubika_client، telegram_client" } },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "memory_search",
        description: "جستجوی حافظه‌ی دستیار: اطلاعات پایدار کاربر، مخاطبان شناخته‌شده و ارسال‌های اخیر.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "نام، موضوع یا عبارت برای جستجو" },
            limit: { type: "integer", minimum: 1, maximum: 20 },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "memory_remember",
        description: "ذخیره‌ی یک اطلاعات پایدار درباره‌ی کاربر یا مخاطب (نام، لحن، رابطه، ترجیح).",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "متن واقعیت پایدار" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["text"],
          additionalProperties: false,
        },
      },
    },
  ];
  for (const provider of engine.describeProviders()) {
    if (!provider.ready) continue;
    for (const tool of provider.tools) {
      const schema = JSON.parse(JSON.stringify(tool.schema ?? { type: "object", properties: {} }));
      delete schema.$schema;
      delete schema.$id;
      out.push({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: schema,
        },
      });
      if (out.length >= maxTools) return out;
    }
  }
  return out;
}

function normalizeSettings(body: any) {
  const proxyType: AppProxyType = ["none", "http", "socks5"].includes(body?.proxyType) ? body.proxyType : "none";
  const proxyUrl = typeof body?.proxyUrl === "string" ? body.proxyUrl.trim() : "";
  if (proxyType !== "none") {
    if (!proxyUrl) throw new Error("آدرس پروکسی الزامی است");
    let u: URL;
    try { u = new URL(proxyUrl); } catch { throw new Error("آدرس پروکسی معتبر نیست"); }
    if (!/^(https?|socks5?):$/.test(u.protocol)) throw new Error("پروتکل پروکسی باید http، https یا socks5 باشد");
    if (proxyType === "socks5" && !/^socks5?:$/.test(u.protocol)) throw new Error("برای پروکسی SOCKS5 آدرس socks5:// وارد کنید");
  }
  const logRetentionDays = Math.max(1, Math.min(365, Number(body?.logRetentionDays) || 14));
  const mcpWriteLimit = Math.max(1, Math.min(1000, Number(body?.mcpWriteLimit) || 30));
  return { proxyType, proxyUrl, logRetentionDays, mcpWriteLimit };
}

function applyProxySettings(settings: ReturnType<typeof normalizeSettings>) {
  const envPatch = proxyEnvOf(settings);
  for (const key of ["SOCKS_PROXY", "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY"]) {
    if (!(key in envPatch)) delete process.env[key];
  }
  Object.assign(process.env, envPatch);
  configureProxy(process.env);
}

/**
 * یک express.Router کامل:
 *   POST /mcp         ← اندپوینت MCP (Streamable HTTP، بدون نشست)
 *   /api/*            ← API داشبورد
 *   /                 ← داشبورد
 * پروژه‌ی میزبان: app.use("/diba-mcp", createDibaMcpRouter(engine))
 */
export function createDibaMcpRouter(engine: DibaMcpEngine, opts: RouterOptions = {}): Router {
  const router = express.Router();
  const env = process.env;
  const sessions = new SignedSessions(() => engine.store.sessionSecret, () => engine.store.sessionEpoch);
  const loginLimiter = new RateLimiter(8, 10 * 60_000);
  // محدودیت درخواست به اندپوینت MCP به ازای هر IP (پیش‌فرض ۱۲۰ در دقیقه)
  const mcpLimiter = new RateLimiter(Math.max(1, Number(env.MCP_RATE_LIMIT) || 120), 60_000);

  // کد راه‌اندازی اولیه — فقط وقتی هنوز رمز ادمین تعیین نشده
  let setupCode: string | null = null;
  const needsSetup = () => !env.ADMIN_PASSWORD && !engine.store.admin;
  if (needsSetup()) {
    setupCode = randomBytes(3).toString("hex").toUpperCase();
    console.error(`\n[diba-mcp] کد راه‌اندازی داشبورد: ${setupCode}\n`);
  }

  // ---------------- MCP ----------------
  const mcpAuth = (req: Request, res: Response, next: NextFunction) => {
    const h = req.headers.authorization ?? "";
    const bearer = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
    const extra = req.headers["x-mcp-token"] ?? req.headers["x-api-key"];
    const token = bearer || (typeof extra === "string" ? extra.trim() : "");
    if (!token || !safeEqual(token, engine.store.mcpToken)) {
      res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized: invalid MCP token" }, id: null });
      return;
    }
    next();
  };

  const mcpRate = (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "?";
    if (!mcpLimiter.allow(key)) {
      res
        .status(429)
        .set("Retry-After", String(mcpLimiter.retryAfter(key)))
        .json({ jsonrpc: "2.0", error: { code: -32029, message: `Rate limit exceeded (${mcpLimiter.max}/min)` }, id: null });
      return;
    }
    next();
  };

  router.post("/mcp", mcpRate, express.json({ limit: "30mb" }), mcpAuth, async (req, res) => {
    const server = engine.createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[diba-mcp] MCP error", err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });
  const notAllowed = (_req: Request, res: Response) => {
    res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)" }, id: null });
  };
  router.get("/mcp", notAllowed);
  router.delete("/mcp", notAllowed);

  // خطای پارس بدنه‌ی MCP باید JSON-RPC بماند، نه صفحه‌ی HTML اکسپرس
  router.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (req.path !== "/mcp" || res.headersSent) return next(err);
    const parseError = err?.type === "entity.parse.failed" || err instanceof SyntaxError;
    res.status(parseError ? 400 : 500).json({
      jsonrpc: "2.0",
      error: { code: parseError ? -32700 : -32603, message: parseError ? "Parse error" : "Internal server error" },
      id: null,
    });
  });

  if (opts.inbox !== false) engine.inbox.start();

  if (opts.dashboard === false) return router;

  // ---------------- API داشبورد ----------------
  const api = express.Router();
  // ابزارهای رسانه‌ای فایل انتخاب‌شده را به‌صورت data URL می‌فرستند
  api.use("/tools", express.json({ limit: "30mb" }));
  api.use(express.json({ limit: "1mb" }));

  const sid = (req: Request) => parseCookie(req.headers.cookie ?? "")[COOKIE];
  const setCookie = (req: Request, res: Response, value: string, maxAge?: number) => {
    const path = req.baseUrl.replace(/\/api$/, "") || "/";
    const secure = req.secure || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
    const age = maxAge === undefined ? "" : `; Max-Age=${maxAge}`;
    res.setHeader("Set-Cookie", `${COOKIE}=${value}; Path=${path}; HttpOnly; SameSite=Strict${secure}${age}`);
  };

  api.get("/auth/status", (req, res) => {
    res.json({ authenticated: sessions.valid(sid(req)), needsSetup: needsSetup(), version: SERVER_VERSION });
  });

  api.post("/auth/setup", (req, res) => {
    if (!needsSetup()) return void res.status(400).json({ error: "رمز ادمین قبلاً تعیین شده است" });
    if (!loginLimiter.allow(req.ip ?? "?")) return void res.status(429).json({ error: "تلاش زیاد؛ چند دقیقه بعد امتحان کنید" });
    const { code, password } = req.body ?? {};
    if (!setupCode || String(code ?? "").trim().toUpperCase() !== setupCode)
      return void res.status(403).json({ error: "کد راه‌اندازی اشتباه است (در کنسول سرور چاپ شده)" });
    if (typeof password !== "string" || password.length < 8)
      return void res.status(400).json({ error: "رمز باید حداقل ۸ کاراکتر باشد" });
    let settings;
    try {
      settings = normalizeSettings(req.body?.settings ?? {});
    } catch (err: any) {
      return void res.status(400).json({ error: String(err?.message ?? err) });
    }
    engine.store.updateSettings(settings);
    applyProxySettings(settings);
    engine.store.setAdmin(hashPassword(password));
    setupCode = null;
    setCookie(req, res, sessions.create(), SESSION_MAX_AGE);
    res.json({ ok: true, settings });
  });

  api.post("/auth/login", (req, res) => {
    if (!loginLimiter.allow(req.ip ?? "?")) return void res.status(429).json({ error: "تلاش زیاد؛ چند دقیقه بعد امتحان کنید" });
    const password = String(req.body?.password ?? "");
    const ok = env.ADMIN_PASSWORD
      ? safeEqual(password, env.ADMIN_PASSWORD)
      : engine.store.admin
        ? verifyPassword(password, engine.store.admin)
        : false;
    if (!ok) return void res.status(401).json({ error: "رمز عبور اشتباه است" });
    setCookie(req, res, sessions.create(), SESSION_MAX_AGE);
    res.json({ ok: true });
  });

  api.post("/auth/logout", (req, res) => {
    // خروج = باطل شدن همه‌ی نشست‌ها (فقط یک ادمین داریم)
    if (sessions.valid(sid(req))) engine.store.bumpSessionEpoch();
    setCookie(req, res, "", 0);
    res.json({ ok: true });
  });

  // EitaaBun پیام‌های جدید را به این آدرس می‌فرستد. توکن داخل query است چون
  // EitaaBun هدر سفارشی نمی‌فرستد. عمداً قبل از middleware ورود است.
  api.post("/eitaa-bridge/webhook", (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : undefined;
    const accepted = handleEitaaBridgeWebhook(req.body, token);
    res.status(accepted ? 200 : 202).json({ ok: accepted });
  });

  // از اینجا به بعد ورود لازم است
  api.use((req, res, next) => {
    if (!sessions.valid(sid(req))) return void res.status(401).json({ error: "ابتدا وارد شوید" });
    next();
  });

  // ---------------- تنظیمات نصب ----------------
  api.get("/settings", (_req, res) => {
    res.json({ ok: true, version: SERVER_VERSION, dataDir: engine.store.dir, passwordFromEnv: Boolean(env.ADMIN_PASSWORD), ...engine.store.settings() });
  });

  api.put("/settings", (req, res) => {
    let settings;
    try {
      settings = normalizeSettings(req.body ?? {});
    } catch (err: any) {
      return void res.status(400).json({ error: String(err?.message ?? err) });
    }
    const before = engine.store.settings();
    engine.store.updateSettings(settings);
    applyProxySettings(settings);
    res.json({
      ok: true,
      ...engine.store.settings(),
      restartRecommended: before.mcpWriteLimit !== settings.mcpWriteLimit || before.logRetentionDays !== settings.logRetentionDays,
    });
  });

  api.post("/settings/password", (req, res) => {
    if (env.ADMIN_PASSWORD) return void res.status(400).json({ error: "رمز از متغیر ADMIN_PASSWORD کنترل می‌شود" });
    const current = String(req.body?.currentPassword ?? "");
    const next = String(req.body?.newPassword ?? "");
    if (!engine.store.admin || !verifyPassword(current, engine.store.admin))
      return void res.status(400).json({ error: "رمز فعلی اشتباه است" });
    if (next.length < 8) return void res.status(400).json({ error: "رمز جدید باید حداقل ۸ کاراکتر باشد" });
    engine.store.setAdmin(hashPassword(next));
    // setAdmin نشست‌ها را باطل می‌کند؛ یک نشست تازه برای همین مرورگر بساز.
    setCookie(req, res, sessions.create(), SESSION_MAX_AGE);
    res.json({ ok: true });
  });

  // ---------------- دیبا روتر ----------------
  api.get("/dibarouter", (_req, res) => {
    const c = engine.store.dibarouter();
    res.json({
      baseUrl: c.baseUrl,
      model: c.model,
      hasApiKey: Boolean(c.apiKey),
      apiKeyMasked: maskKey(c.apiKey),
      apiKeyFromEnv: c.apiKeyFromEnv,
      baseUrlFromEnv: c.baseUrlFromEnv,
      modelFromEnv: c.modelFromEnv,
      configured: Boolean(c.apiKey),
      docsUrl: "https://dibarouter.ir/docs",
      keysUrl: "https://dibarouter.ir/keys",
      defaultBase: "https://dibarouter.ir/api/v1",
      defaultModel: "dibachain/diba-router-free",
    });
  });

  api.put("/dibarouter", (req, res) => {
    const body = req.body ?? {};
    if (body.baseUrl !== undefined) {
      try {
        const u = new URL(String(body.baseUrl));
        if (!/^https?:$/.test(u.protocol)) throw new Error("protocol");
      } catch {
        return void res.status(400).json({ error: "آدرس پایه باید یک URL معتبر http(s) باشد" });
      }
    }
    engine.store.updateDibarouter({
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
      apiKey: typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
    });
    const c = engine.store.dibarouter();
    res.json({
      ok: true,
      baseUrl: c.baseUrl,
      model: c.model,
      hasApiKey: Boolean(c.apiKey),
      apiKeyMasked: maskKey(c.apiKey),
      configured: Boolean(c.apiKey),
    });
  });

  api.post("/dibarouter/test", async (_req, res) => {
    const c = engine.store.dibarouter();
    if (!c.apiKey) return void res.status(400).json({ error: "اول کلید API دیبا روتر را ذخیره کنید" });
    try {
      const out = await dibaRouterTest(c);
      res.json({ ok: true, ...out });
    } catch (err: any) {
      res.status(err?.status && err.status < 500 ? 400 : 502).json({ error: String(err?.message ?? err) });
    }
  });

  api.get("/dibarouter/models", async (_req, res) => {
    try {
      const models = await dibaRouterModels(engine.store.dibarouter());
      res.json({ ok: true, count: models.length, models });
    } catch (err: any) {
      res.status(err?.status && err.status < 500 ? 400 : 502).json({ error: String(err?.message ?? err) });
    }
  });

  // ---------------- دستیار دیبا (چت‌بات داشبورد) ----------------
  api.post("/agent/chat", async (req, res) => {
    const compacted = compactConversation(req.body?.messages);
    if (!compacted.messages.length) return void res.status(400).json({ error: "پیامی برای دستیار ارسال نشد" });
    const c = engine.store.dibarouter();
    if (!c.apiKey) return void res.status(400).json({ error: "برای استفاده از دستیار، ابتدا دیبا روتر را در تب «دیبا روتر» وصل کنید" });
    const conversationId = String(req.body?.conversationId ?? "dashboard");
    const latestUser = [...compacted.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    if (latestUser) engine.memory.appendTurn({ role: "user", content: latestUser, conversationId });
    for (const fact of autoFacts(latestUser)) engine.memory.rememberFact(fact, ["auto"]);

    const wantStream = req.body?.stream === true;
    const sendSse = (event: string, data: unknown) => {
      if (!wantStream || res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    if (wantStream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
      sendSse("status", { text: "در حال آماده‌سازی کانتکست…" });
    }

    // دکمه‌ی «توقف» مرورگر را می‌بندد؛ همان لحظه کار سرور و درخواست مدل هم لغو می‌شود
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });
    const signal = abort.signal;
    const stopped = () => signal.aborted || res.writableEnded;

    const userTurns = compacted.messages.filter((m) => m.role === "user");
    const selectionText = userTurns.slice(-2).map((m) => m.content).join("\n");
    const hasExplicitChatTarget = /(?:^|\s)@[A-Za-z0-9_]{3,}|-?\d{5,}|\|/.test(latestUser);
    const sendIntent = parseSendIntent(latestUser);
    const forceSendTool =
      Boolean(sendIntent) &&
      !hasExplicitChatTarget &&
      !/(عکس|تصویر|فایل|ویدیو|photo|image|file|video)/i.test(latestUser);
    const allTools = agentTools(engine);
    let contextBudget = 5400;

    const toolTrace: Array<{ name: string; args: unknown; ok: boolean; ms?: number; error?: string; cached?: boolean; preloaded?: boolean }> = [];
    const callCache = new Map<string, { content: string; ok: boolean; error?: string }>();
    const preloadedBlocks: string[] = [];
    let lastReply = "";
    let memoryReply = "";
    const memoryTools = () => [...new Set(toolTrace.map((t) => t.name))];
    res.on("finish", () => {
      if (!memoryReply) return;
      engine.memory.appendTurn({ role: "assistant", content: memoryReply, conversationId, tools: memoryTools() });
    });
    const finalize = <P extends { reply?: string }>(payload: P): P => {
      memoryReply = String(payload.reply ?? memoryReply);
      return payload;
    };

    // داده‌ی پایه را خودمان می‌خوانیم تا مدل برای وضعیت سرویس‌ها حدس نزند
    const plainGreeting = /^(سلام|درود|وقت بخیر|صبح بخیر|شب بخیر|hi|hello|hey|thanks|ممنون|مرسی)[!؟.،\s]*$/i.test(selectionText.trim());
    const wantsChatList = /(لیست|فهرست|چت‌ها|چتها|گفتگوها|همه‌ی چت|همه چت|inbox|list chats|all chats)/i.test(selectionText);

    const preload = (name: string, args: Record<string, unknown>) => {
      sendSse("status", { text: name === "list_chats" ? "در حال خواندن فهرست چت‌ها…" : "در حال خواندن وضعیت سرویس‌ها…" });
      try {
        const provider = typeof args.provider === "string" ? args.provider : undefined;
        const content =
          name === "list_services"
            ? servicesBrief(engine.servicesSummary())
            : compactToolResult(stripChatIds(engine.chatsSummary(provider)) ?? null, 1800);
        toolTrace.push({ name, args, ok: true, ms: 0, preloaded: true });
        const cacheKey = name === "list_services" ? "list_services" : `${name}:${JSON.stringify(args)}`;
        callCache.set(cacheKey, { content, ok: true });
        preloadedBlocks.push(`[${name}]\n${content}`);
      } catch (err: any) {
        toolTrace.push({ name, args, ok: false, error: String(err?.message ?? err), preloaded: true });
      }
    };

    if (!plainGreeting && !forceSendTool) {
      preload("list_services", {});
      if (wantsChatList) preload("list_chats", {});
    }

    const memoryContext = engine.memory.promptContext(selectionText);
    const systemContent = `${agentSystemPrompt(engine, compacted.summary)}${
      preloadedBlocks.length
        ? `\n\nداده‌ی تازه‌ی ابزارها (همین حالا خوانده شد؛ به آن استناد کن):\n${preloadedBlocks.join("\n\n")}\n` +
          "این داده وضعیت پیکربندی و صندوق پیام است؛ برای اطمینان از اتصال زنده‌ی هر سرویس، ابزار get_me یا get_chats همان سرویس را صدا بزن."
        : ""
    }${memoryContext ? `\n\nحافظه‌ی ماندگار (از گفتگوهای قبلی):\n${memoryContext}` : ""}`;

    let messages: DibaRouterMessage[] = [
      { role: "system", content: systemContent },
      ...compacted.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const callModelWithRecovery = async (
      msgs: DibaRouterMessage[],
      tools: DibaRouterTool[],
      maxTokens: number,
      temperature: number,
      onDelta?: (delta: string) => void,
      forceTool?: string,
    ) => {
      const fitted = fitContextToBudget(msgs, tools, contextBudget);
      msgs = fitted.messages;
      tools = fitted.tools;
      const forcedChoice =
        forceTool && tools.some((t) => t.function.name === forceTool)
          ? ({ type: "function" as const, function: { name: forceTool } })
          : undefined;
      try {
        return await dibaRouterChat(c, msgs, {
          maxTokens,
          temperature,
          tools: tools.length ? tools : undefined,
          toolChoice: forcedChoice ?? (tools.length ? "auto" : "none"),
          onDelta,
          signal,
        });
      } catch (err: any) {
        let failure = err;
        if (isContextLimitError(failure)) {
          const reportedLimit = extractContextLimit(failure);
          contextBudget = Math.max(1800, Math.min(contextBudget - 1500, Math.floor((reportedLimit ?? 6000) * 0.5)));
          const tighter = fitContextToBudget(msgs, tools.slice(0, 6), contextBudget);
          try {
            return await dibaRouterChat(c, tighter.messages, {
              maxTokens: Math.min(maxTokens, 700),
              temperature,
              tools: tighter.tools.length ? tighter.tools : undefined,
              toolChoice: tighter.tools.length ? "auto" : "none",
              onDelta,
              signal,
            });
          } catch (retryErr: any) {
            if (isContextLimitError(retryErr)) {
              const e: any = new Error(summarizeContextError(retryErr));
              e.status = 400;
              throw e;
            }
            failure = retryErr;
          }
        }
        // اگر مدل tool_choice اجباری را نپذیرفت، با auto و همان ابزارها دوباره امتحان کن
        if (forcedChoice && tools.length && /tool|function|support|unsupported|tool_choice/i.test(String(failure?.message ?? failure))) {
          try {
            return await dibaRouterChat(c, msgs, {
              maxTokens,
              temperature,
              tools,
              toolChoice: "auto",
              onDelta,
              signal,
            });
          } catch (retryErr: any) {
            failure = retryErr;
          }
        }
        if (tools.length && /tool|function|support|unsupported/i.test(String(failure?.message ?? failure))) {
          return await dibaRouterChat(c, msgs, { maxTokens, temperature, onDelta, signal });
        }
        throw failure;
      }
    };

    // اگر پیش‌نویس ارسال منتظر تأیید است، پیام فعلی را به‌عنوان انتخاب/تأیید/لغو پردازش کن
    if (engine.memory.getPending(conversationId)) {
      try {
        sendSse("status", { text: "در حال بررسی پاسخ شما…" });
        const handled = await handleSendReply(engine, c, conversationId, latestUser, { signal });
        if (stopped()) return;
        if (handled) {
          toolTrace.push(...handled.toolTrace);
          const payload = finalize({
            ok: true,
            reply: handled.reply,
            model: c.model,
            toolTrace,
            compacted: compacted.compacted,
            pending: handled.pending,
            actions: handled.actions,
          });
          if (wantStream) {
            sendSse("delta", { delta: handled.reply });
            sendSse("done", payload);
            return void res.end();
          }
          return void res.json(payload);
        }
      } catch (err: any) {
        console.error("[diba-mcp] pending send failed", err?.message ?? err);
      }
    }

    // مرحله‌ی آماده‌سازی ارسال: نزدیک‌ترین مخاطبین + پیش‌نویس، بدون ارسال
    if (forceSendTool && sendIntent) {
      try {
        sendSse("status", { text: `در حال پیدا کردن نزدیک‌ترین مخاطب برای «${sendIntent.recipient}»…` });
        const result = await prepareSend(engine, c, sendIntent, {
          conversationId,
          allowGroup: /(گروه|کانال|group|channel)/i.test(latestUser),
          signal,
        });
        if (stopped()) return;
        toolTrace.push(...result.toolTrace);
        const payload = finalize({
          ok: true,
          reply: result.reply,
          model: c.model,
          toolTrace,
          compacted: compacted.compacted,
          pending: result.pending,
          actions: result.actions,
        });
        if (wantStream) {
          sendSse("delta", { delta: result.reply });
          sendSse("done", payload);
          return void res.end();
        }
        return void res.json(payload);
      } catch (err: any) {
        console.error("[diba-mcp] prepare send failed", err?.message ?? err);
        // در صورت خطای غیرمنتظره، جریان عادی دستیار ادامه می‌دهد
      }
    }

    try {
      for (let round = 0; round < 5; round++) {
        if (stopped()) return;
        let streamedThisRound = false;
        const onDelta = wantStream
          ? (delta: string) => {
              streamedThisRound = true;
              sendSse("delta", { delta });
            }
          : undefined;

        // برای هر دور، ابزارها را با توجه به درخواست، پاسخ قبلی و ابزارهای اجراشده انتخاب کن
        const roundQuery = [selectionText, lastReply, toolTrace.map((t) => t.name).join(" ")].filter(Boolean).join("\n");
        const roundTools = selectAndCompactTools(allTools, roundQuery, { maxTools: 20, maxToolTokens: 2200, blockDirectSend: true });
        sendSse("status", {
          text: round === 0 ? `در حال تحلیل درخواست (${roundTools.length} ابزار در دسترس)…` : "در حال بررسی نتایج و برنامه‌ریزی قدم بعد…",
        });

        const out = await callModelWithRecovery(
          messages,
          roundTools,
          1000,
          0.35,
          onDelta,
          round === 0 && forceSendTool ? "send_message_to" : undefined,
        );
        lastReply = out.reply || lastReply;
        if (stopped()) return;

        if (!out.reply && !out.toolCalls?.length) {
          try {
            const retryMessages = toolTrace.length
              ? [...messages, { role: "user" as const, content: "نتیجه‌ی ابزارهای بالا را به فارسی و کوتاه جمع‌بندی کن." }]
              : messages;
            const retry = await callModelWithRecovery(retryMessages, [], 700, 0.25, onDelta);
            if (retry.reply) {
              const payload = finalize({ ok: true, ...retry, toolTrace, compacted: compacted.compacted });
              if (wantStream) {
                if (!streamedThisRound) sendSse("delta", { delta: retry.reply });
                sendSse("done", payload);
                return void res.end();
              }
              return void res.json(payload);
            }
          } catch {
            // Fall through to local fallback
          }
          const fallback = assistantFallback(toolTrace);
          const payload = finalize({ ok: true, reply: fallback, model: c.model, toolTrace, compacted: compacted.compacted });
          if (wantStream) {
            sendSse("delta", { delta: fallback });
            sendSse("done", payload);
            return void res.end();
          }
          return void res.json(payload);
        }

        if (!out.toolCalls?.length) {
          const payload = finalize({ ok: true, ...out, reply: lastReply, toolTrace, compacted: compacted.compacted });
          if (wantStream) {
            if (!streamedThisRound && lastReply) sendSse("delta", { delta: lastReply });
            sendSse("done", payload);
            return void res.end();
          }
          return void res.json(payload);
        }

        messages.push({
          role: "assistant",
          content: out.reply || "",
          tool_calls: out.toolCalls,
        });

        for (const call of out.toolCalls) {
          const name = call.function.name;
          sendSse("status", { text: `در حال اجرای ${name}…` });

          // آرگومان نامعتبر را هرگز با {} اجرا نکن؛ به مدل فرصت اصلاح بده
          let args: Record<string, unknown> = {};
          let argsError = "";
          try {
            const parsed = JSON.parse(call.function.arguments || "{}");
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed;
            else argsError = "آرگومان‌ها باید یک آبجکت JSON باشند.";
          } catch {
            argsError = "JSON آرگومان‌ها معتبر نیست.";
          }
          if (argsError) {
            const item = { name, args: call.function.arguments, ok: false, error: argsError };
            toolTrace.push(item);
            sendSse("tool", item);
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              name,
              content: `ERROR: ${argsError} آرگومان‌های ابزار را اصلاح کن و همان ابزار را دوباره صدا بزن.`,
            });
            continue;
          }

          // از اجرای تکراری ابزار با همان آرگومان‌ها جلوگیری کن (مخصوصاً برای ارسال پیام)
          const cacheKey = name === "list_services" ? "list_services" : `${name}:${JSON.stringify(args)}`;
          const cached = callCache.get(cacheKey);
          if (cached) {
            const item = { name, args, ok: cached.ok, ms: 0, error: cached.error, cached: true };
            toolTrace.push(item);
            sendSse("tool", item);
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              name,
              content: `(این ابزار با همین آرگومان‌ها قبلاً اجرا شده؛ نتیجه‌ی قبلی)\n${cached.content}`,
            });
            continue;
          }

          const result = await engine.callTool(name, args, "mcp");
          if (stopped()) return;
          const item = { name, args, ok: result.ok, ms: result.ms, error: result.error };
          toolTrace.push(item);
          sendSse("tool", item);
          let content: string;
          if (!result.ok) content = `ERROR: ${result.error ?? "اجرای ابزار ناموفق بود"}`;
          else if (name === "list_services") content = servicesBrief(result.result);
          else if (name === "memory_search" || /(?:list_chats|get_chats|get_dialogs|get_contacts|find_contact|resolve_contact|get_history|get_messages|search_messages)/.test(name)) {
            content = compactToolResult(stripChatIds(result.result) ?? null, 2200);
          } else content = compactToolResult(result.result ?? null, 2200);
          callCache.set(cacheKey, { content, ok: result.ok, error: result.error });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name,
            content,
          });
        }
        if (wantStream) sendSse("status", { text: "در حال جمع‌بندی پاسخ…" });
      }

      // اگر به سقف دورها رسیدیم، یک جمع‌بندی نهایی بدون ابزار بگیر
      if (stopped()) return;
      let finalReply = lastReply;
      if (toolTrace.length) {
        try {
          sendSse("status", { text: "در حال آماده‌سازی پاسخ نهایی…" });
          const summary = await callModelWithRecovery(
            [
              ...messages,
              {
                role: "user" as const,
                content: "بر اساس نتایج ابزارهای بالا، پاسخ نهایی را فارسی، کوتاه و دقیق بده. اگر ابزاری خطا داد، علت و اقدام بعدی را بگو.",
              },
            ],
            [],
            800,
            0.25,
          );
          if (summary.reply) finalReply = summary.reply;
        } catch {
          // از lastReply استفاده می‌کنیم
        }
      }
      if (!finalReply) finalReply = "ابزارها اجرا شدند، اما مدل پاسخی برای جمع‌بندی برنگرداند. نتیجه را در گزارش‌ها ببینید.";
      if (stopped()) return;
      const payload = finalize({ ok: true, reply: finalReply, model: c.model, toolTrace, compacted: compacted.compacted, truncated: true });
      if (wantStream) {
        sendSse("delta", { delta: finalReply });
        sendSse("done", payload);
        return void res.end();
      }
      res.json(payload);
    } catch (err: any) {
      // کاربر پاسخ را متوقف کرده یا اتصال بسته شده؛ نوشتن روی پاسخ بسته فایده‌ای ندارد
      if (stopped()) {
        if (!res.writableEnded) res.end();
        return;
      }
      const message = isContextLimitError(err) ? summarizeContextError(err) : String(err?.message ?? err);
      if (wantStream) {
        sendSse("error", { error: message });
        return void res.end();
      }
      res.status(err?.status && err.status < 500 ? 400 : 502).json({ error: message });
    }
  });

  // تاریخچه و حافظه‌ی دستیار (برای همگام‌سازی بین دستگاه‌ها و بازبینی)
  api.get("/agent/history", (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
    const conversationId = typeof req.query.conversationId === "string" ? req.query.conversationId : "dashboard";
    res.json({
      conversationId,
      messages: engine.memory.history(limit, conversationId).map((t) => ({ role: t.role, content: t.content, at: t.at, tools: t.tools })),
    });
  });

  api.delete("/agent/history", (req, res) => {
    const conversationId = String(req.body?.conversationId ?? req.query.conversationId ?? "dashboard");
    const removed = engine.memory.clearHistory(conversationId);
    const pendingCleared = engine.memory.clearPending(conversationId);
    res.json({ ok: true, removed, pendingCleared });
  });

  api.get("/agent/memory", (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    res.json({ ...engine.memory.search(q, 20), facts: engine.memory.facts(50), stats: engine.memory.stats() });
  });

  api.get("/overview", (_req, res) => {
    const providers = engine.describeProviders();
    res.json({
      version: SERVER_VERSION,
      providers: providers.map(({ id, nameFa, name, color, glyph, enabled, ready, tools }) => ({
        id, nameFa, name, color, glyph, enabled, ready, toolCount: tools.length,
      })),
      activeTools: engine.activeTools().length + 1,
      totalTools: providers.reduce((s, p) => s + p.tools.length, 0) + 1,
      stats: engine.logger.stats(),
      recent: engine.logger.list(6),
      uptime: Math.round(process.uptime()),
    });
  });

  api.get("/providers", (_req, res) => res.json(engine.describeProviders()));

  api.put("/providers/:id", (req, res) => {
    const p = engine.provider(String(req.params.id));
    if (!p) return void res.status(404).json({ error: "سرویس پیدا نشد" });
    const { enabled, values } = req.body ?? {};
    const clean: Record<string, string> = {};
    for (const f of p.fields) {
      const v = values?.[f.key];
      if (typeof v !== "string") continue;
      if (f.type === "secret" && v === "") continue; // خالی = بدون تغییر
      if (f.type === "url" && v && !/^(https?|wss?|socks4a?|socks5h?):\/\//i.test(v))
        return void res.status(400).json({ error: `«${f.label}» باید با http، https، ws، wss یا socks5 شروع شود` });
      clean[f.key] = v;
    }
    if (values?.__clear && Array.isArray(values.__clear)) {
      for (const k of values.__clear) if (p.fields.some((f) => f.key === k)) clean[k] = "";
    }
    engine.updateProvider(p.id, { enabled: typeof enabled === "boolean" ? enabled : undefined, values: clean });
    res.json(engine.describeProviders().find((x) => x.id === p.id));
  });

  api.post("/providers/:id/test", async (req, res) => {
    res.json(await engine.testProvider(String(req.params.id)));
  });

  api.post("/tools/:name/call", async (req, res) => {
    res.json(await engine.callTool(String(req.params.name), req.body?.args ?? {}, "dashboard"));
  });

  // صفحه‌بندی‌شده: api.get("/logs", ...) با page/pageSize/ok/provider
  // سازگاری قبلی: بدون پارامتر page، همان آرایه‌ی محدود برگردانده می‌شود.
  api.get("/logs", (req, res) => {
    const q = req.query;
    const paginated = q.page !== undefined || q.pageSize !== undefined || q.ok !== undefined || q.provider !== undefined;
    if (!paginated) return void res.json(engine.logger.list(Number(q.limit) || 100));
    const ok = q.ok === "ok" || q.ok === "fail" ? q.ok : "all";
    res.json(
      engine.logger.page({
        page: Number(q.page) || 1,
        pageSize: Number(q.pageSize) || Number(q.limit) || 20,
        ok,
        provider: typeof q.provider === "string" ? q.provider : "",
      }),
    );
  });
  api.delete("/logs", (_req, res) => {
    engine.logger.clear();
    res.json({ ok: true });
  });

  api.get("/netcheck", async (_req, res) => res.json(await runNetcheck(engine)));

  // ---------------- تست کامل ----------------
  api.post("/providers/:id/selftest", async (req, res) => {
    try {
      res.json(await runSelfTest(engine, String(req.params.id), { send: req.body?.send === true, chatId: req.body?.chatId }));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  api.post("/providers/:id/actions/:name", async (req, res) => {
    res.json(await engine.runAction(String(req.params.id), String(req.params.name)));
  });

  // ---------------- ورود با حساب کاربری (کلاینت غیررسمی) ----------------
  api.post("/providers/:id/auth/browser/start", async (req, res) => {
    res.json(await engine.authBrowserStart(String(req.params.id)));
  });

  api.get("/providers/:id/auth/browser/:jobId", async (req, res) => {
    res.json(await engine.authBrowserStatus(String(req.params.id), String(req.params.jobId)));
  });

  api.get("/providers/:id/auth/qr", async (req, res) => {
    const id = String(req.params.id);
    res.json(await engine.authQr(id));
  });

  api.post("/providers/:id/auth/import", async (req, res) => {
    const id = String(req.params.id);
    if (!engine.provider(id)?.auth?.sessionImport) return void res.status(404).json({ error: "این سرویس ورود با نشست ندارد" });
    res.json(await engine.authImport(id, String(req.body?.session ?? "")));
  });

  api.post("/providers/:id/auth/:step", async (req, res) => {
    const id = String(req.params.id);
    const step = String(req.params.step);
    if (!["start", "code", "password", "logout"].includes(step)) return void res.status(404).json({ error: "قدم ورود ناشناخته است" });
    if (!engine.provider(id)?.auth) return void res.status(404).json({ error: "این سرویس ورود با حساب کاربری ندارد" });
    res.json(await engine.authStep(id, step as "start" | "code" | "password" | "logout", req.body ?? {}));
  });

  // ---------------- صندوق پیام‌ها ----------------
  api.get("/inbox", async (req, res) => {
    const provider = typeof req.query.provider === "string" ? req.query.provider : undefined;
    const chat = typeof req.query.chat === "string" ? req.query.chat : undefined;
    let chats = engine.inbox.chats();
    try {
      // نام واقعی چت‌های بی‌نام از خود سرویس خوانده می‌شود
      chats = await enrichChatTitles(engine, chats);
    } catch {
      // اگر نام‌خوانی شکست خورد، فهرست خام کافی است
    }
    res.json({
      statuses: engine.inbox.statuses().map((st) => ({ ...st, hint: st.lastError ? hintFor(st.lastError, "receive") : undefined })),
      chats,
      messages: provider && chat ? engine.inbox.messages(provider, { chatId: chat, limit: 100 }) : [],
    });
  });

  api.post("/inbox/:id/receive", (req, res) => {
    const p = engine.provider(String(req.params.id));
    if (!p?.receive) return void res.status(400).json({ error: "این پیام‌رسان دریافت پیام را پشتیبانی نمی‌کند" });
    if (engine.store.receiveFromEnv(p)) return void res.status(400).json({ error: `این تنظیم از env خوانده می‌شود (${p.id.toUpperCase()}_RECEIVE)` });
    engine.updateProvider(p.id, { receive: req.body?.enabled === true });
    res.json({ ok: true, status: engine.inbox.statuses().find((s) => s.provider === p.id) });
  });

  api.post("/inbox/:id/fetch", async (req, res) => {
    try {
      res.json({ ok: true, ...(await engine.inbox.fetchOnce(String(req.params.id))) });
    } catch (err: any) {
      res.json({ ok: false, error: err.message });
    }
  });

  api.delete("/inbox/:id", (req, res) => {
    if (!engine.provider(String(req.params.id))?.receive) return void res.status(404).json({ error: "پیدا نشد" });
    engine.inbox.clear(String(req.params.id));
    res.json({ ok: true });
  });

  // ---------------- تریگرها و اتوماسیون ----------------
  api.get("/triggers", (_req, res) => {
    res.json(engine.triggers.list());
  });

  api.post("/triggers", (req, res) => {
    const b = req.body ?? {};
    const name = String(b.name ?? "").trim();
    if (!name) return void res.status(400).json({ error: "نام تریگر الزامی است" });
    const item = engine.triggers.create({
      name,
      description: String(b.description ?? "").trim() || "تریگر سفارشی",
      category: b.category || "social",
      enabled: b.enabled !== false,
      event: b.event || "incoming_message",
      match: b.match && typeof b.match === "object" ? b.match : {},
      action: b.action && typeof b.action === "object" ? b.action : { type: "reply_template", template: "" },
    });
    res.json({ ok: true, trigger: item });
  });

  api.post("/triggers/reset-defaults", (_req, res) => {
    res.json({ ok: true, triggers: engine.triggers.resetDefaults() });
  });

  api.delete("/triggers/logs", (_req, res) => {
    engine.triggers.clearLogs();
    res.json({ ok: true });
  });

  api.put("/triggers/:id", (req, res) => {
    const updated = engine.triggers.update(String(req.params.id), req.body ?? {});
    if (!updated) return void res.status(404).json({ error: "تریگر پیدا نشد" });
    res.json({ ok: true, trigger: updated });
  });

  api.delete("/triggers/:id", (req, res) => {
    if (!engine.triggers.remove(String(req.params.id))) return void res.status(404).json({ error: "تریگر پیدا نشد" });
    res.json({ ok: true });
  });

  api.post("/triggers/:id/test", async (req, res) => {
    const r = await engine.triggers.testTrigger(String(req.params.id));
    res.json(r);
  });

  api.post("/triggers/:id/run", async (req, res) => {
    const vars = req.body?.vars && typeof req.body.vars === "object" ? req.body.vars : {};
    res.json(await engine.triggers.runManual(String(req.params.id), vars));
  });

  api.get("/connection", (_req, res) => {
    res.json({ token: engine.store.mcpToken, fromEnv: engine.store.mcpTokenFromEnv, dataDir: engine.store.dir });
  });

  // تست واقعی اندپوینت MCP از سمت سرور (tools/list با همان توکن)
  api.post("/connection/test", async (req, res) => {
    const prefix = req.originalUrl.split("?")[0].replace(/\/api\/connection\/test\/?$/, "");
    const url = `${req.protocol}://${req.get("host")}${prefix}/mcp`;
    const started = performance.now();
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${engine.store.mcpToken}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        signal: AbortSignal.timeout(15_000),
      });
      const text = await r.text();
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        return void res.status(502).json({ ok: false, url, error: `پاسخ نامعتبر از MCP: ${text.slice(0, 120)}` });
      }
      if (!r.ok || data?.error) {
        return void res.status(502).json({ ok: false, url, error: data?.error?.message ?? `HTTP ${r.status}` });
      }
      const tools = Array.isArray(data?.result?.tools) ? data.result.tools.length : 0;
      res.json({ ok: true, url, tools, ms: Math.round(performance.now() - started) });
    } catch (err: any) {
      res.status(502).json({ ok: false, url, error: String(err?.message ?? err) });
    }
  });

  api.post("/connection/rotate", (_req, res) => {
    if (engine.store.mcpTokenFromEnv) return void res.status(400).json({ error: "توکن از MCP_TOKEN در env خوانده می‌شود؛ آنجا عوضش کنید" });
    res.json({ token: engine.store.rotateMcpToken() });
  });

  router.use("/api", api);

  // ---------------- فایل‌های داشبورد ----------------
  router.use((req, res, next) => {
    // مسیرهای نسبی داشبورد به اسلش پایانی نیاز دارند
    if (req.method === "GET" && req.path === "/" && req.baseUrl && !req.originalUrl.split("?")[0].endsWith("/")) {
      return void res.redirect(301, req.originalUrl.replace(/(\?|$)/, "/$1"));
    }
    next();
  });
  // no-cache: مرورگر هر بار با ETag چک می‌کند؛ بعد از آپدیت، نسخه‌ی قدیمی داشبورد نمی‌ماند
  router.use(
    express.static(opts.publicDir ?? defaultPublic, {
      index: "index.html",
      etag: true,
      setHeaders: (res) => res.setHeader("Cache-Control", "no-cache"),
    }),
  );

  router.get(/^\/(overview|providers|inbox|triggers|playground|logs|dibarouter|connect)\/?$/, (req, res) => {
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    res.redirect(`/#/${req.params[0]}${qs}`);
  });

  return router;
}

function parseCookie(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
