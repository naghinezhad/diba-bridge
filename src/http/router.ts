import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { hashPassword, RateLimiter, safeEqual, SignedSessions, verifyPassword } from "../core/auth.js";
import { dibaRouterChat, dibaRouterModels, dibaRouterTest, type DibaRouterMessage, type DibaRouterTool } from "../core/dibarouter.js";
import { compactConversation, compactToolResult, extractContextLimit, fitContextToBudget, isContextLimitError, selectAndCompactTools, summarizeContextError } from "../core/context.js";
import { SERVER_VERSION, type DibaMcpEngine } from "../core/engine.js";
import { runNetcheck } from "../core/netcheck.js";
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
- برای اطلاعات زنده یا کارهای خواسته‌شده، ابزار مناسب را اجرا کن و نتیجه‌ی خام را کامل نریز؛ فقط خلاصه‌ی مفید و اقدام بعدی را بگو.
- ابزارهای نوشتنی (ارسال، حذف، تغییر) را فقط با درخواست صریح کاربر اجرا کن؛ اگر مقصد «خودم» است از شناسه‌ی حساب کاربر استفاده کن و اگر مقصد نامشخص است با get_chats پیدایش کن یا بپرس.
- مسیرهای داشبورد: #/overview، #/providers، #/inbox، #/playground، #/logs، #/connect، #/dibarouter.
- MCP endpoint: http://127.0.0.1:3790/mcp | DibaRouter: https://dibarouter.ir/api/v1

سرویس‌های آماده: ${readyList.join("؛ ") || "هیچکدام"}
سرویس‌های غیرفعال/ناقص: ${offList.join("؛ ") || "هیچکدام"}
دریافت پیام‌ها: ${inboxAlerts.join("؛ ") || "غیرفعال"}${historySummary ? `\n\n${historySummary}` : ""}`;
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

function agentTools(engine: DibaMcpEngine, maxTools = 160): DibaRouterTool[] {
  const out: DibaRouterTool[] = [];
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
    const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
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
    engine.store.setAdmin(hashPassword(password));
    setupCode = null;
    setCookie(req, res, sessions.create(), SESSION_MAX_AGE);
    res.json({ ok: true });
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

    const latestUser = [...compacted.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const allTools = agentTools(engine);
    let roundTools = selectAndCompactTools(allTools, latestUser, { maxTools: 20, maxToolTokens: 2200 });
    let contextBudget = 5400;

    let messages: DibaRouterMessage[] = [
      { role: "system", content: agentSystemPrompt(engine, compacted.summary) },
      ...compacted.messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const toolTrace: Array<{ name: string; args: unknown; ok: boolean; ms?: number; error?: string }> = [];
    let lastReply = "";

    const callModelWithRecovery = async (
      msgs: DibaRouterMessage[],
      tools: DibaRouterTool[],
      maxTokens: number,
      temperature: number,
      onDelta?: (delta: string) => void,
    ) => {
      const fitted = fitContextToBudget(msgs, tools, contextBudget);
      msgs = fitted.messages;
      tools = fitted.tools;
      try {
        return await dibaRouterChat(c, msgs, {
          maxTokens,
          temperature,
          tools: tools.length ? tools : undefined,
          toolChoice: tools.length ? "auto" : "none",
          onDelta,
        });
      } catch (err: any) {
        if (isContextLimitError(err)) {
          const reportedLimit = extractContextLimit(err);
          contextBudget = Math.max(1800, Math.min(contextBudget - 1500, Math.floor((reportedLimit ?? 6000) * 0.5)));
          const tighter = fitContextToBudget(msgs, tools.slice(0, 6), contextBudget);
          try {
            return await dibaRouterChat(c, tighter.messages, {
              maxTokens: Math.min(maxTokens, 700),
              temperature,
              tools: tighter.tools.length ? tighter.tools : undefined,
              toolChoice: tighter.tools.length ? "auto" : "none",
              onDelta,
            });
          } catch (retryErr: any) {
            if (isContextLimitError(retryErr)) {
              const e: any = new Error(summarizeContextError(retryErr));
              e.status = 400;
              throw e;
            }
            throw retryErr;
          }
        }
        if (tools.length && /tool|function|support|unsupported/i.test(String(err?.message ?? err))) {
          return await dibaRouterChat(c, msgs, { maxTokens, temperature, onDelta });
        }
        throw err;
      }
    };

    try {
      for (let round = 0; round < 5; round++) {
        let streamedThisRound = false;
        const onDelta = wantStream
          ? (delta: string) => {
              streamedThisRound = true;
              sendSse("delta", { delta });
            }
          : undefined;

        const out = await callModelWithRecovery(messages, roundTools, 1000, 0.35, onDelta);
        lastReply = out.reply || lastReply;

        if (!out.reply && !out.toolCalls?.length) {
          try {
            const retryMessages = toolTrace.length
              ? [...messages, { role: "user" as const, content: "نتیجه‌ی ابزارهای بالا را به فارسی و کوتاه جمع‌بندی کن." }]
              : messages;
            const retry = await callModelWithRecovery(retryMessages, [], 700, 0.25, onDelta);
            if (retry.reply) {
              const payload = { ok: true, ...retry, toolTrace, compacted: compacted.compacted };
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
          const payload = { ok: true, reply: fallback, model: c.model, toolTrace, compacted: compacted.compacted };
          if (wantStream) {
            sendSse("delta", { delta: fallback });
            sendSse("done", payload);
            return void res.end();
          }
          return void res.json(payload);
        }

        if (!out.toolCalls?.length) {
          const payload = { ok: true, ...out, reply: lastReply, toolTrace, compacted: compacted.compacted };
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
          let args: Record<string, unknown> = {};
          try {
            const parsed = JSON.parse(call.function.arguments || "{}");
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed;
          } catch {
            // آرگومان نامعتبر به موتور فرستاده می‌شود.
          }
          const result = await engine.callTool(name, args, "mcp");
          const item = { name, args, ok: result.ok, ms: result.ms, error: result.error };
          toolTrace.push(item);
          sendSse("tool", item);
          const content = result.ok
            ? compactToolResult(result.result ?? null, 2200)
            : `ERROR: ${result.error ?? "اجرای ابزار ناموفق بود"}`;
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name,
            content,
          });
        }
        if (wantStream) sendSse("status", { text: "در حال جمع‌بندی پاسخ…" });
      }

      const finalReply = lastReply || "ابزارها اجرا شدند، اما مدل پاسخی برای جمع‌بندی برنگرداند. نتیجه را در گزارش‌ها ببینید.";
      const payload = { ok: true, reply: finalReply, model: c.model, toolTrace, compacted: compacted.compacted, truncated: true };
      if (wantStream) {
        sendSse("delta", { delta: finalReply });
        sendSse("done", payload);
        return void res.end();
      }
      res.json(payload);
    } catch (err: any) {
      const message = isContextLimitError(err) ? summarizeContextError(err) : String(err?.message ?? err);
      if (wantStream) {
        sendSse("error", { error: message });
        return void res.end();
      }
      res.status(err?.status && err.status < 500 ? 400 : 502).json({ error: message });
    }
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
      if (f.type === "url" && v && !/^(https?|wss?):\/\//i.test(v))
        return void res.status(400).json({ error: `«${f.label}» باید با http، https، ws یا wss شروع شود` });
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

  api.get("/logs", (req, res) => res.json(engine.logger.list(Number(req.query.limit) || 100)));
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
  api.post("/providers/:id/auth/:step", async (req, res) => {
    const id = String(req.params.id);
    const step = String(req.params.step);
    if (!["start", "code", "password", "logout"].includes(step)) return void res.status(404).json({ error: "قدم ورود ناشناخته است" });
    if (!engine.provider(id)?.auth) return void res.status(404).json({ error: "این سرویس ورود با حساب کاربری ندارد" });
    res.json(await engine.authStep(id, step as "start" | "code" | "password" | "logout", req.body ?? {}));
  });

  // ---------------- صندوق پیام‌ها ----------------
  api.get("/inbox", (req, res) => {
    const provider = typeof req.query.provider === "string" ? req.query.provider : undefined;
    const chat = typeof req.query.chat === "string" ? req.query.chat : undefined;
    res.json({
      statuses: engine.inbox.statuses().map((st) => ({ ...st, hint: st.lastError ? hintFor(st.lastError, "receive") : undefined })),
      chats: engine.inbox.chats(),
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

  api.get("/connection", (_req, res) => {
    res.json({ token: engine.store.mcpToken, fromEnv: engine.store.mcpTokenFromEnv });
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
