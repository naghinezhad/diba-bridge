import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { hashPassword, RateLimiter, safeEqual, SignedSessions, verifyPassword } from "../core/auth.js";
import { AgentError, runAgent } from "../core/assistant/runner.js";
import { SEND_TOOLS } from "../core/assistant/policy.js";
import { PostTemplateStore, type PostTarget } from "../core/post-templates.js";
import { dibaRouterModels, dibaRouterTest } from "../core/dibarouter.js";
import { SERVER_VERSION, type DibaMcpEngine } from "../core/engine.js";
import { ModelLimits } from "../core/context-budget.js";
import { configureProxy, probeViaProxy } from "../core/net.js";
import { ProxyManager, ProxyPoolError } from "../core/proxy-manager.js";
import { normalizeProfile, ProfileError, PROFILE_LIMITS } from "../core/profile.js";
import { normalizeTrigger, TriggerValidationError } from "../core/trigger-schema.js";
import { proxyEnvOf, type AppProxyType } from "../core/store.js";
import { runNetcheck } from "../core/netcheck.js";
import { enrichChatTitles } from "../core/assistant/resolver.js";
import { hintFor, runSelfTest } from "../core/selftest.js";
import { handleEitaaBridgeWebhook } from "../providers/eitaa-client.js";
import { createOpenAiRouter } from "./openai-api.js";

export interface RouterOptions {
  dashboard?: boolean;
  inbox?: boolean;
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

export function createDibaMcpRouter(engine: DibaMcpEngine, opts: RouterOptions = {}): Router {
  const router = express.Router();
  const env = process.env;
  const sessions = new SignedSessions(() => engine.store.sessionSecret, () => engine.store.sessionEpoch);
  const postTemplates = new PostTemplateStore(engine.store.dir);
  const POST_CHAT_TOOLS: Record<string, string> = {
    bale_client: "bale_client_get_dialogs",
    eitaa_client: "eitaa_client_get_chats",
    rubika_client: "rubika_client_get_chats",
    soroush_client: "soroush_client_get_chats",
    telegram_client: "telegram_client_get_chats",
    whatsapp: "whatsapp_get_chats",
  };
  const POST_CHAT_INFO_TOOLS: Record<string, string> = {
    bale_client: "bale_client_get_chat",
    eitaa_client: "eitaa_client_get_chat",
    rubika_client: "rubika_client_get_chat",
    soroush_client: "soroush_client_get_chat",
    telegram_client: "telegram_client_get_chat",
    whatsapp: "whatsapp_get_chat",
  };
  const postChatNames = new Map<string, string>();
  const loginLimiter = new RateLimiter(8, 10 * 60_000);
  const mcpLimiter = new RateLimiter(Math.max(1, Number(env.MCP_RATE_LIMIT) || 120), 60_000);

  const needsSetup = () => !env.ADMIN_PASSWORD && !engine.store.admin;
  if (needsSetup()) {
    console.error("\n[diba-mcp] رمز داشبورد هنوز ساخته نشده است؛ داشبورد را باز کنید و نصب را کامل کنید.\n");
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

  // the assistant's OpenAI-compatible API uses the MCP token, so it is available with or without the dashboard
  const modelLimits = new ModelLimits(() => dibaRouterModels(engine.store.dibarouter()));
  router.use("/v1", createOpenAiRouter(engine, { modelLimits, limiter: mcpLimiter }));

  if (opts.dashboard === false) return router;

  const api = express.Router();
  api.use("/tools", express.json({ limit: "30mb" }));
  api.use(express.json({ limit: "1mb" }));

  const sid = (req: Request) => parseCookie(req.headers.cookie ?? "")[COOKIE];
  const setCookie = (req: Request, res: Response, value: string, maxAge?: number) => {
    const path = req.baseUrl.replace(/\/api$/, "") || "/";
    const secure = req.secure || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
    const age = maxAge === undefined ? "" : `; Max-Age=${maxAge}`;
    res.setHeader("Set-Cookie", `${COOKIE}=${value}; Path=${path}; HttpOnly; SameSite=Strict${secure}${age}`);
  };

  const installServices = () =>
    engine.describeProviders().map((p) => ({
      id: p.id,
      name: p.name,
      nameFa: p.nameFa,
      category: p.category,
      region: p.region,
      color: p.color,
      glyph: p.glyph,
      description: p.description,
      enabled: p.enabled,
      enabledFromEnv: p.enabledFromEnv,
      ready: p.ready,
      toolCount: p.tools.length,
    }));

  const servicesProblem = (raw: unknown): string | null => {
    if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string")) return "فهرست سرویس‌ها معتبر نیست";
    const known = new Set(engine.providers.map((p) => p.id));
    const unknown = raw.filter((id: string) => !known.has(id));
    return unknown.length ? `سرویس ناشناخته: ${unknown.join("، ")}` : null;
  };

  const applyServices = (ids: string[]): string[] => {
    const selected = new Set(ids);
    const failed: string[] = [];
    for (const p of engine.providers) {
      if (engine.store.enabledFromEnv(p)) continue;
      const want = selected.has(p.id);
      if (engine.store.isEnabled(p) === want) continue;
      try {
        engine.updateProvider(p.id, { enabled: want });
      } catch (err) {
        console.error(`[diba-mcp] تغییر وضعیت سرویس ${p.id} ناموفق بود`, err);
        failed.push(p.nameFa);
      }
    }
    return failed;
  };

  const parseInstall = (body: any): { profile: ReturnType<typeof normalizeProfile>; services: string[] } | { error: string; field: string } => {
    let profile;
    try {
      profile = normalizeProfile(body?.profile);
    } catch (err) {
      if (err instanceof ProfileError) return { error: err.message, field: err.field };
      throw err;
    }
    const problem = servicesProblem(body?.services);
    if (problem) return { error: problem, field: "services" };
    return { profile, services: body.services as string[] };
  };

  const completeInstall = (input: { profile: ReturnType<typeof normalizeProfile>; services: string[] }) => {
    engine.store.updateProfile(input.profile);
    const failed = applyServices(input.services);
    return { profile: engine.store.markInstalled(), services: installServices(), failed };
  };

  api.get("/auth/status", (req, res) => {    const authenticated = sessions.valid(sid(req));
    res.json({
      authenticated,
      needsSetup: needsSetup(),
      version: SERVER_VERSION,
      ...(authenticated ? { needsInstall: engine.store.needsInstall, profile: engine.store.profile() } : {}),
    });
  });

  api.post("/auth/setup", (req, res) => {
    if (!needsSetup()) return void res.status(400).json({ error: "رمز ادمین قبلاً تعیین شده است" });
    if (!loginLimiter.allow(req.ip ?? "?")) return void res.status(429).json({ error: "تلاش زیاد؛ چند دقیقه بعد امتحان کنید" });
    const { password } = req.body ?? {};
    if (typeof password !== "string" || password.length < 8)
      return void res.status(400).json({ error: "رمز باید حداقل ۸ کاراکتر باشد" });
    let settings;
    try {
      settings = normalizeSettings(req.body?.settings ?? {});
    } catch (err: any) {
      return void res.status(400).json({ error: String(err?.message ?? err) });
    }
    const install = req.body?.install === undefined ? null : parseInstall(req.body.install);
    if (install && "error" in install) return void res.status(400).json(install);
    engine.store.updateSettings(settings);
    applyProxySettings(settings);
    engine.store.setAdmin(hashPassword(password));
    setCookie(req, res, sessions.create(), SESSION_MAX_AGE);
    res.json({ ok: true, settings, ...(install ? completeInstall(install) : {}) });
  });

  api.get("/auth/setup-info", (_req, res) => {
    if (!needsSetup()) return void res.status(403).json({ error: "راه‌اندازی اولیه قبلاً انجام شده است" });
    res.json({ profile: engine.store.profile(), services: installServices(), limits: PROFILE_LIMITS });
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
    if (sessions.valid(sid(req))) engine.store.bumpSessionEpoch();
    setCookie(req, res, "", 0);
    res.json({ ok: true });
  });

  api.post("/eitaa-bridge/webhook", (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : undefined;
    const accepted = handleEitaaBridgeWebhook(req.body, token);
    res.status(accepted ? 200 : 202).json({ ok: accepted });
  });

  api.use((req, res, next) => {
    if (!sessions.valid(sid(req))) return void res.status(401).json({ error: "ابتدا وارد شوید" });
    next();
  });

  const postIsIdLike = (value: unknown, chatId: string): boolean => {
    const text = String(value ?? "").trim();
    if (!text) return true;
    if (text === chatId) return true;
    return /^[\d\s|@._:\-]+$/.test(text);
  };
  const postNameOf = (raw: any, chatId: string): string => {
    const nick = typeof raw?.nick === "object" ? raw.nick?.value : raw?.nick;
    const fullName = [raw?.first_name, raw?.last_name].filter(Boolean).join(" ");
    const candidates = [
      raw?.title,
      raw?.name,
      raw?.display_name,
      raw?.displayName,
      raw?.full_name,
      raw?.fullName,
      raw?.contact_name,
      raw?.contactName,
      raw?.push_name,
      raw?.pushName,
      nick,
      fullName,
      raw?.username,
    ];
    for (const candidate of candidates) {
      const text = String(candidate ?? "").trim();
      if (text && !postIsIdLike(text, chatId)) return text.slice(0, 160);
    }
    return "";
  };
  const normalizePostTarget = (provider: string, raw: any, inboxTitle?: string): (PostTarget & { lastText?: string }) | null => {
    const chatId = String(raw?.chat_id ?? raw?.chatId ?? raw?.id ?? raw?.object_guid ?? raw?.guid ?? raw?.peer_id ?? "").trim();
    if (!chatId) return null;
    const typeRaw = String(raw?.type ?? raw?.chat_type ?? raw?.kind ?? "private").toLowerCase();
    const type = /channel/.test(typeRaw) ? "channel" : /group|supergroup|chat/.test(typeRaw) ? "group" : "private";
    const inboxName = inboxTitle && !postIsIdLike(inboxTitle, chatId) ? inboxTitle.trim().slice(0, 160) : "";
    const lastRaw = raw?.last_message ?? raw?.lastText ?? raw?.last_text;
    const lastText = typeof lastRaw === "string" ? lastRaw.trim().slice(0, 200) : "";
    return {
      provider,
      chatId,
      title: postNameOf(raw, chatId) || inboxName || chatId,
      type,
      lastText: lastText || undefined,
    };
  };

  api.get("/posts/chats", async (req, res) => {
    const provider = String(req.query.provider ?? "");
    const tool = POST_CHAT_TOOLS[provider];
    if (!tool) return void res.status(400).json({ error: "این سرویس برای ارسال پست پشتیبانی نمی‌شود." });
    const r = await engine.callTool(tool, { limit: 100 }, "dashboard");
    if (!r.ok) return void res.status(502).json({ error: r.error ?? "دریافت فهرست گفتگوها ناموفق بود." });
    const result: any = r.result;
    const list = Array.isArray(result?.chats) ? result.chats : Array.isArray(result?.dialogs) ? result.dialogs : Array.isArray(result) ? result : [];
    const inboxTitles = new Map(
      engine.inbox
        .chats(provider)
        .filter((chat) => chat.title && !postIsIdLike(chat.title, chat.chatId))
        .map((chat) => [chat.chatId, String(chat.title)]),
    );
    for (const [chatId, title] of inboxTitles) postChatNames.set(`${provider}:${chatId}`, title);
    const chats = list.map((x: any) => {
      const chatId = String(x?.chat_id ?? x?.chatId ?? x?.id ?? x?.object_guid ?? x?.guid ?? x?.peer_id ?? "").trim();
      const cached = postChatNames.get(`${provider}:${chatId}`);
      const chat = normalizePostTarget(provider, x, inboxTitles.get(chatId) || cached);
      if (chat && cached) chat.title = cached;
      return chat;
    }).filter(Boolean) as Array<PostTarget & { lastText?: string }>;
    const missingNames = chats.filter((x) => postIsIdLike(x.title, x.chatId)).slice(0, 20);
    const infoTool = POST_CHAT_INFO_TOOLS[provider];
    if (infoTool && missingNames.length) {
      await Promise.all(missingNames.map(async (chat) => {
        const info = await engine.callTool(infoTool, { chat_id: chat.chatId }, "dashboard");
        if (!info.ok) return;
        const name = postNameOf(info.result, chat.chatId);
        if (name) {
          chat.title = name;
          postChatNames.set(`${provider}:${chat.chatId}`, name);
        }
      }));
    }
    const seen = new Set<string>();
    res.json({ chats: chats.filter((x) => !seen.has(x.chatId) && seen.add(x.chatId)) });
  });

  api.get("/post-templates", (_req, res) => {
    res.json({ templates: postTemplates.list() });
  });

  api.post("/post-templates", (req, res) => {
    try {
      res.json({ ok: true, template: postTemplates.create(req.body) });
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message ?? err) });
    }
  });

  api.put("/post-templates/:id", (req, res) => {
    try {
      res.json({ ok: true, template: postTemplates.update(String(req.params.id), req.body) });
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message ?? err) });
    }
  });

  api.delete("/post-templates/:id", (req, res) => {
    try {
      postTemplates.remove(String(req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message ?? err) });
    }
  });

  api.post("/posts/send", async (req, res) => {
    const text = String(req.body?.text ?? "").trim();
    if (!text) return void res.status(400).json({ error: "متن پست خالی است." });
    if (text.length > 4096) return void res.status(400).json({ error: "متن پست حداکثر ۴۰۹۶ کاراکتر است." });
    if (req.body?.confirm !== true) return void res.status(400).json({ error: "ارسال باید تأیید شود." });
    const rawTargets = Array.isArray(req.body?.targets) ? req.body.targets : [];
    const seen = new Set<string>();
    const targets: PostTarget[] = [];
    for (const item of rawTargets) {
      const provider = String(item?.provider ?? "").trim();
      const chatId = String(item?.chatId ?? item?.chat_id ?? "").trim();
      if (!provider || !chatId) continue;
      const key = `${provider}:${chatId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ provider, chatId, title: String(item?.title ?? "").trim().slice(0, 160) || undefined, type: String(item?.type ?? "").trim().slice(0, 24) || undefined });
      if (targets.length >= 200) break;
    }
    if (!targets.length) return void res.status(400).json({ error: "حداقل یک مقصد انتخاب کنید." });
    const results: any[] = [];
    for (const target of targets) {
      const channelPost = target.provider === "whatsapp" && target.type === "channel";
      const tool = channelPost ? "whatsapp_channel_send" : SEND_TOOLS[target.provider];
      if (!tool) {
        results.push({ target, ok: false, error: "این سرویس برای ارسال پست پشتیبانی نمی‌شود." });
        continue;
      }
      const args = channelPost ? { channel: target.chatId, text } : { chat_id: target.chatId, text };
      const r = await engine.callTool(tool, args, "dashboard");
      results.push({ target, ok: r.ok, error: r.error, ms: r.ms });
    }
    res.json({ ok: results.every((r) => r.ok), results });
  });

  api.get("/install", (_req, res) => {
    res.json({
      needsInstall: engine.store.needsInstall,
      profile: engine.store.profile(),
      services: installServices(),
      limits: PROFILE_LIMITS,
    });
  });

  api.post("/install", (req, res) => {
    const install = parseInstall(req.body);
    if ("error" in install) return void res.status(400).json(install);
    res.json({ ok: true, ...completeInstall(install) });
  });

  api.put("/install/services", (req, res) => {
    const raw = req.body?.services;
    const problem = servicesProblem(raw);
    if (problem) return void res.status(400).json({ error: problem, field: "services" });
    const failed = applyServices(raw);
    res.json({ ok: true, services: installServices(), failed });
  });

  api.put("/profile", (req, res) => {
    let profile;
    try {
      profile = normalizeProfile(req.body);
    } catch (err) {
      if (err instanceof ProfileError) return void res.status(400).json({ error: err.message, field: err.field });
      throw err;
    }
    res.json({ ok: true, profile: engine.store.updateProfile(profile) });
  });

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
    const pool = engine.store.proxyPool();
    const active = pool.entries.find((p) => p.id === pool.activeId);
    if (active && active.url !== settings.proxyUrl) engine.store.saveProxyPool({ ...pool, auto: false, activeId: undefined });
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
    setCookie(req, res, sessions.create(), SESSION_MAX_AGE);
    res.json({ ok: true });
  });

  const probeTargets = String(env.PROXY_TEST_URLS ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u));
  const proxies = new ProxyManager({
    store: engine.store,
    probe: probeViaProxy,
    probeOptions: probeTargets.length ? { targets: probeTargets } : undefined,
    apply: ({ proxyType, proxyUrl }) => {
      const current = engine.store.settings();
      const settings = { proxyType, proxyUrl, logRetentionDays: current.logRetentionDays, mcpWriteLimit: current.mcpWriteLimit };
      engine.store.updateSettings(settings);
      applyProxySettings(settings);
    },
  });
  proxies.schedule();

  const proxyRoute = (handler: (req: Request, res: Response) => unknown) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof ProxyPoolError) return void res.status(400).json({ error: err.message });
      next(err);
    }
  };

  api.get("/proxies", (_req, res) => {
    res.json(proxies.describe());
  });

  api.post("/proxies", proxyRoute((req, res) => {
    const text = typeof req.body?.list === "string" ? req.body.list : "";
    if (text.length > 20_000) throw new ProxyPoolError("فهرست خیلی طولانی است");
    const result = proxies.add(text);
    proxies.schedule();
    res.json({ ok: true, ...result, ...proxies.describe() });
  }));

  api.post("/proxies/test", proxyRoute(async (_req, res) => {
    res.json({ ok: true, ...(await proxies.test()) });
  }));

  api.put("/proxies/auto", proxyRoute((req, res) => {
    proxies.setAuto(req.body?.auto === true);
    res.json({ ok: true, ...proxies.describe() });
  }));

  api.put("/proxies/:id", proxyRoute((req, res) => {
    const id = String(req.params.id);
    if (req.body?.active === true) proxies.activate(id);
    else if (typeof req.body?.enabled === "boolean") proxies.setEnabled(id, req.body.enabled);
    else throw new ProxyPoolError("تغییر نامعتبر است");
    proxies.schedule();
    res.json({ ok: true, ...proxies.describe() });
  }));

  api.delete("/proxies/:id", proxyRoute((req, res) => {
    proxies.remove(String(req.params.id));
    proxies.schedule();
    res.json({ ok: true, ...proxies.describe() });
  }));

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
      const config = engine.store.dibarouter();
      const models = await dibaRouterModels(config);
      modelLimits.remember(config.baseUrl, models);
      res.json({ ok: true, count: models.length, models });
    } catch (err: any) {
      res.status(err?.status && err.status < 500 ? 400 : 502).json({ error: String(err?.message ?? err) });
    }
  });

  api.post("/agent/chat", async (req, res) => {
    const wantStream = req.body?.stream === true;
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });
    // the stream opens on the first event, so a request that fails up front still gets a JSON error
    const sendSse = (event: string, data: unknown) => {
      if (!wantStream || res.writableEnded) return;
      if (!res.headersSent) {
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders?.();
      }
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await runAgent(engine, modelLimits, {
        messages: req.body?.messages,
        conversationId: String(req.body?.conversationId ?? "dashboard"),
        signal: abort.signal,
        onStatus: (text) => sendSse("status", { text }),
        onDelta: wantStream ? (delta) => sendSse("delta", { delta }) : undefined,
        onTool: (item) => sendSse("tool", item),
      });
      if (!result) {
        if (!res.writableEnded) res.end();
        return;
      }
      const { finishReason: _finishReason, usage: _usage, ...rest } = result;
      const payload = { ok: true, ...rest };
      if (wantStream) {
        sendSse("done", payload);
        return void res.end();
      }
      res.json(payload);
    } catch (err: any) {
      if (abort.signal.aborted) {
        if (!res.writableEnded) res.end();
        return;
      }
      const message = String(err?.message ?? err);
      if (wantStream && res.headersSent) {
        sendSse("error", { error: message });
        return void res.end();
      }
      res.status(err instanceof AgentError || (err?.status && err.status < 500) ? 400 : 502).json({ error: message });
    }
  });

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
      providers: providers.map(({ id, nameFa, name, category, region, color, glyph, enabled, ready, tools }) => ({
        id, nameFa, name, category, region, color, glyph, enabled, ready, toolCount: tools.length,
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
      if (f.type === "secret" && v === "") continue;
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

  api.get("/inbox", async (req, res) => {
    const provider = typeof req.query.provider === "string" ? req.query.provider : undefined;
    const chat = typeof req.query.chat === "string" ? req.query.chat : undefined;
    let chats = engine.inbox.chats();
    try {
      chats = await enrichChatTitles(engine, chats);
    } catch {
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

  api.get("/triggers", (_req, res) => {
    res.json(engine.triggers.list());
  });

  const parseTrigger = (res: Response, body: unknown) => {
    try {
      return normalizeTrigger(body);
    } catch (err) {
      if (!(err instanceof TriggerValidationError)) throw err;
      res.status(400).json({ error: err.message, field: err.field });
      return null;
    }
  };

  api.post("/triggers", (req, res) => {
    const input = parseTrigger(res, req.body);
    if (!input) return;
    res.json({ ok: true, trigger: engine.triggers.create({ ...input, description: input.description || "تریگر سفارشی" }) });
  });

  api.post("/triggers/reset-defaults", (_req, res) => {
    res.json({ ok: true, triggers: engine.triggers.resetDefaults() });
  });

  api.delete("/triggers/logs", (_req, res) => {
    engine.triggers.clearLogs();
    res.json({ ok: true });
  });

  api.put("/triggers/:id", (req, res) => {
    const id = String(req.params.id);
    const current = engine.triggers.list().triggers.find((t) => t.id === id);
    if (!current) return void res.status(404).json({ error: "تریگر پیدا نشد" });
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    if (Object.keys(body).every((k) => k === "enabled")) {
      if (typeof body.enabled !== "boolean") return void res.status(400).json({ error: "وضعیت تریگر نامعتبر است", field: "enabled" });
      return void res.json({ ok: true, trigger: engine.triggers.update(id, { enabled: body.enabled }) });
    }
    const input = parseTrigger(res, { ...current, ...body });
    if (!input) return;
    res.json({ ok: true, trigger: engine.triggers.replace(id, { ...input, enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled }) });
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

  api.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    const tooLarge = err?.type === "entity.too.large";
    const badJson = err?.type === "entity.parse.failed";
    if (!tooLarge && !badJson) console.error("[diba-mcp] API error", err);
    res
      .status(tooLarge ? 413 : badJson ? 400 : 500)
      .json({ error: tooLarge ? "حجم درخواست بیشتر از حد مجاز است" : badJson ? "بدنه‌ی درخواست JSON معتبر نیست" : "خطای داخلی سرور؛ جزئیات در لاگ سرور ثبت شد" });
  });

  router.use("/api", api);

  router.use((req, res, next) => {
    if (req.method === "GET" && req.path === "/" && req.baseUrl && !req.originalUrl.split("?")[0].endsWith("/")) {
      return void res.redirect(301, req.originalUrl.replace(/(\?|$)/, "/$1"));
    }
    next();
  });
  router.use(
    express.static(opts.publicDir ?? defaultPublic, {
      index: "index.html",
      etag: true,
      setHeaders: (res) => res.setHeader("Cache-Control", "no-cache"),
    }),
  );

  router.get(/^\/(overview|providers|banking|install|inbox|triggers|playground|logs|dibarouter|connect)\/?$/, (req, res) => {
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
