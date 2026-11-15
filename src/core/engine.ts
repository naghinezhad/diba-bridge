import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { redact } from "./http.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RateLimiter } from "./auth.js";
import { checkMessageQuality, resolveRecipient, SEND_TOOLS, type RecipientCandidate } from "./contacts.js";
import { Inbox } from "./inbox.js";
import { TriggerEngine } from "./triggers.js";
import { CallLogger } from "./logger.js";
import { AssistantMemory, publicTitle } from "./memory.js";
import { McpAgent } from "./mcp-agent.js";
import { summarizeForLog } from "./media.js";
import { ConfigStore, envKey } from "./store.js";
import { ProviderError, type AuthStep, type ProviderContext, type ProviderDef, type ToolDef } from "./types.js";

// پیام‌های خطای اعتبارسنجی به فارسی
z.config(z.locales.fa());

export const SERVER_NAME = "diba-mcp";
/** نسخه از package.json خوانده می‌شود (هم در src و هم در dist دو پوشه بالاتر است) */
export const SERVER_VERSION: string = (() => {
  try {
    return JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
  } catch {
    return "0.0.0";
  }
})();

export interface EngineOptions {
  /** پوشه‌ی ذخیره‌ی config.json */
  dataDir: string;
  providers: ProviderDef[];
  env?: NodeJS.ProcessEnv;
}

export interface CallResult {
  ok: boolean;
  ms: number;
  result?: unknown;
  error?: string;
}

/**
 * قلب پروژه: نگهداری سرویس‌ها، تنظیمات، لاگ و ساخت سرور MCP.
 * هم نسخه‌ی مستقل (main.ts) و هم پروژه‌ی میزبان از همین کلاس استفاده می‌کنند.
 */
export class DibaMcpEngine {
  readonly store: ConfigStore;
  readonly logger: CallLogger;
  /** حافظه‌ی ماندگار دستیار: گفتگوها، اطلاعات کاربر و مخاطبان */
  readonly memory: AssistantMemory;
  readonly providers: ProviderDef[];
  /** متغیرهای محیطی مؤثر (برای حالت MCP و تنظیمات) */
  readonly env: NodeJS.ProcessEnv;
  /** صندوق پیام‌های ورودی */
  readonly inbox: Inbox;
  readonly triggers: TriggerEngine;
  readonly version = SERVER_VERSION;
  /** سقف فراخوانی ابزارهای «نوشتنی» (ارسال پیام و ...) از طرف مدل در دقیقه */
  private writeLimiter: RateLimiter;
  private toolIndex = new Map<string, { tool: ToolDef<any>; provider: ProviderDef }>();

  constructor(opts: EngineOptions) {
    const env = opts.env ?? process.env;
    this.env = env;
    this.store = new ConfigStore(opts.dataDir, env);
    this.memory = new AssistantMemory(opts.dataDir);
    this.logger = new CallLogger({
      dir: env.LOG_TO_FILE === "false" ? undefined : join(opts.dataDir, "logs"),
      retentionDays: Number(env.LOG_RETENTION_DAYS) || 14,
    });
    this.writeLimiter = new RateLimiter(Math.max(1, Number(env.MCP_WRITE_LIMIT) || 30), 60_000);
    this.providers = opts.providers;
    for (const p of this.providers) {
      for (const t of p.tools) {
        if (this.toolIndex.has(t.name)) throw new Error(`نام ابزار تکراری است: ${t.name}`);
        this.toolIndex.set(t.name, { tool: t, provider: p });
      }
    }
    this.inbox = new Inbox(opts.dataDir, this.store, this.providers, (p) => this.contextOf(p));
    this.triggers = new TriggerEngine(opts.dataDir, this);
    this.inbox.onIncoming = (msg) => {
      void this.triggers.onIncomingMessage(msg);
    };
  }

  /** چیزی که ابزارها و تست‌ها از یک سرویس می‌بینند */
  contextOf(p: ProviderDef): ProviderContext {
    return {
      config: this.store.resolve(p).values,
      dataDir: this.store.dir,
      inbox: this.inbox.isActive(p) ? this.inbox.access(p.id) : undefined,
    };
  }

  /** تغییر تنظیمات یک سرویس + هماهنگ کردن دریافت پیام‌ها */
  updateProvider(id: string, patch: { enabled?: boolean; receive?: boolean; values?: Record<string, string> }) {
    this.store.update(id, patch);
    this.inbox.sync();
  }

  /** اجرای یک کار مدیریتی (فقط از داشبورد) */
  async runAction(id: string, name: string): Promise<CallResult> {
    const p = this.provider(id);
    const action = p?.actions?.[name];
    const started = performance.now();
    if (!p || !action) return { ok: false, ms: 0, error: "این کار برای این سرویس تعریف نشده" };
    if (this.store.missingFields(p).length) return { ok: false, ms: 0, error: "اول اتصال این سرویس را کامل کنید" };
    const ctx = this.contextOf(p);
    try {
      const result = await action.run(ctx);
      return { ok: true, ms: Math.round(performance.now() - started), result };
    } catch (err: any) {
      return { ok: false, ms: Math.round(performance.now() - started), error: redact(err?.message ?? String(err), Object.values(ctx.config)) };
    }
  }

  provider(id: string) {
    return this.providers.find((p) => p.id === id);
  }

  /** ابزارهایی که الان قابل استفاده‌اند (سرویس فعال + تنظیمات کامل) */
  activeTools() {
    return [...this.toolIndex.values()].filter(({ provider }) => this.store.isReady(provider));
  }

  /**
   * خلاصه‌ی وضعیت سرویس‌ها برای ابزار `list_services`.
   * هم MCP و هم دستیار داشبورد از همین منبع استفاده می‌کنند تا پاسخ‌ها grounded باشند.
   */
  servicesSummary() {
    const inboxStatus = new Map(this.inbox.statuses().map((s) => [s.provider, s]));
    return this.providers.map((p) => {
      const values = this.store.resolve(p).values;
      const status = inboxStatus.get(p.id);
      return {
        id: p.id,
        name: p.name,
        nameFa: p.nameFa,
        enabled: this.store.isEnabled(p),
        ready: this.store.isReady(p),
        missing: this.store.missingFields(p),
        hasDefaultChat: Boolean(values.defaultChatId),
        receive: this.store.isReceiving(p),
        receiveError: status?.lastError ?? null,
        tools: p.tools.map((t) => t.name),
      };
    });
  }

  /** چت‌های دریافتی برای ابزار `list_chats` (MCP و دستیار). */
  chatsSummary(provider?: string) {
    const statuses = this.inbox.statuses().filter((s) => s.supported && (!provider || s.provider === provider));
    return {
      receiving: statuses.map((s) => ({ provider: s.provider, enabled: s.enabled, lastError: s.lastError })),
      chats: this.inbox.chats(provider).slice(0, 100),
    };
  }

  /** پیدا کردن مخاطب با نام/شماره/نام کاربری در همه‌ی سرویس‌های آماده */
  async resolveRecipient(name: string, opts: { provider?: string; force?: boolean } = {}) {
    return resolveRecipient(this, name, opts);
  }

  private candidatesBrief(candidates: RecipientCandidate[]): string {
    return candidates
      .slice(0, 6)
      .map((c) => `${c.title} — ${c.provider} (${c.type})`)
      .join("، ");
  }

  /**
   * ارسال پیام به مخاطب با نام — با resolve، کنترل کیفیت، ضدتکرار و محدودیت نرخ.
   * این مسیر برای دستیار است تا بدون پرسیدن، اما ایمن، ارسال کند.
   */
  async sendToRecipient(input: {
    recipient: string;
    text: string;
    provider?: string;
    chatId?: string;
    title?: string;
    type?: string;
    allowGroup?: boolean;
    allowLinks?: boolean;
    dryRun?: boolean;
  }): Promise<CallResult> {
    const started = performance.now();
    const ms = () => Math.round(performance.now() - started);
    const recipient = String(input.recipient ?? "").trim();
    const text = String(input.text ?? "").trim();
    if (!recipient && !input.chatId) return { ok: false, ms: 0, error: "نام مخاطب را مشخص کن." };
    if (!text) return { ok: false, ms: 0, error: "متن پیام خالی است." };

    let best: RecipientCandidate | undefined;
    let candidates: RecipientCandidate[] = [];
    let ambiguous = false;
    let confidence = 100;
    let resolutionReason: string | undefined;
    if (input.chatId && input.provider) {
      // مسیر داخلی: مخاطب قبلاً resolve شده است
      best = {
        provider: input.provider,
        chatId: input.chatId,
        title: input.title || recipient || input.chatId,
        type: input.type || "unknown",
        source: "memory",
      };
    } else {
      const resolution = await this.resolveRecipient(recipient, { provider: input.provider });
      candidates = resolution.candidates;
      best = resolution.best;
      ambiguous = resolution.ambiguous;
      confidence = resolution.confidence;
      resolutionReason = resolution.reason;
    }
    const near = this.candidatesBrief(candidates);
    if (!best) {
      return {
        ok: false,
        ms: ms(),
        error:
          `مخاطب «${recipient}» پیدا نشد. ${resolutionReason ?? ""} ` +
          `${near ? `نزدیک‌ترین گزینه‌ها: ${near}. ` : ""}` +
          "نام دقیق‌تر یا سرویس را مشخص کن؛ به مخاطب حدسی پیام نفرست.",
        result: { candidates },
      };
    }
    if (ambiguous || confidence < 85) {
      return {
        ok: false,
        ms: ms(),
        error:
          `مخاطب «${recipient}» با اطمینان کافی مشخص نشد. ${resolutionReason ?? ""} ` +
          `${near ? `گزینه‌ها: ${near}. ` : ""}` +
          "برای جلوگیری از ارسال به فرد اشتباه، نام/سرویس دقیق را بپرس.",
        result: { candidates },
      };
    }

    const groupLike = !["private", "user", "dm", "direct", "unknown"].includes(best.type);
    if (groupLike && !input.allowGroup) {
      return {
        ok: false,
        ms: ms(),
        error: `«${best.title}» یک گروه/کانال است، نه چت خصوصی. ارسال به گروه/کانال فقط با درخواست صریح و allow_group مجاز است.`,
        result: { candidate: best },
      };
    }

    const prior = this.memory.recipient(best.provider, best.chatId);
    const firstContact = !prior || prior.sendCount === 0;
    const quality = checkMessageQuality(text, {
      allowLinks: input.allowLinks === true,
      firstContact,
    });
    if (!quality.ok) {
      return {
        ok: false,
        ms: ms(),
        error: `متن پیام از نظر کیفیت/ریسک رد شد: ${quality.reasons.join(" ")} متن را طبیعی‌تر و کوتاه‌تر بازنویسی کن.`,
        result: { candidate: best, quality },
      };
    }

    // محدودیت نرخ برای کاهش ریسک بن
    const perMinute = this.memory.sendsSince(60_000, { provider: best.provider, chatId: best.chatId }).length;
    if (perMinute >= 2) {
      return { ok: false, ms: ms(), error: "به این مخاطب در یک دقیقه‌ی اخیر دو پیام/تلاش ارسال شده؛ کمی صبر کن تا ریسک محدودیت کم شود." };
    }
    const perDay = this.memory.sendsSince(24 * 60 * 60_000, { provider: best.provider, chatId: best.chatId }).length;
    if (perDay >= 8) {
      return { ok: false, ms: ms(), error: "سقف ارسال روزانه به این مخاطب پر شده است؛ فردا یا با درخواست صریح دیگری امتحان کن." };
    }
    const globalHour = this.memory.sendsSince(60 * 60_000, { okOnly: true }).length;
    if (globalHour >= 20) {
      return { ok: false, ms: ms(), error: "سقف ارسال ساعتی دستیار پر شده است؛ برای جلوگیری از بن، کمی بعد تلاش کن." };
    }
    const globalDay = this.memory.sendsSince(24 * 60 * 60_000, { okOnly: true }).length;
    if (globalDay >= 100) {
      return { ok: false, ms: ms(), error: "سقف ارسال روزانه‌ی دستیار پر شده است؛ برای جلوگیری از بن ارسال را متوقف کن." };
    }
    if (this.memory.hasRecentText(best.provider, best.chatId, text, 24 * 60 * 60_000)) {
      return { ok: false, ms: ms(), error: "همین متن در ۲۴ ساعت گذشته برای این مخاطب ارسال شده؛ متن را تغییر بده." };
    }

    const sendTool = SEND_TOOLS[best.provider];
    const provider = this.provider(best.provider);
    if (!sendTool || !provider || !this.store.isReady(provider) || !provider.tools.some((t) => t.name === sendTool)) {
      return { ok: false, ms: ms(), error: `ابزار ارسال برای «${best.provider}» در دسترس نیست.` };
    }

    const preview = {
      provider: best.provider,
      chat_id: best.chatId,
      title: best.title,
      type: best.type,
      text,
      quality: quality.score,
      candidate: best,
    };
    if (input.dryRun) return { ok: true, ms: ms(), result: { dry_run: true, ...preview } };

    const sent = await this.callTool(sendTool, { chat_id: best.chatId, text }, "mcp");
    this.memory.recordSend({
      provider: best.provider,
      chatId: best.chatId,
      title: best.title,
      text,
      ok: sent.ok,
      error: sent.error,
    });
    if (!sent.ok) {
      return { ok: false, ms: ms(), error: sent.error ?? "ارسال ناموفق بود.", result: preview };
    }
    this.memory.upsertRecipient({
      provider: best.provider,
      chatId: best.chatId,
      title: best.title,
      type: best.type,
      aliases: [recipient, best.username ?? ""],
      increment: true,
    });
    return {
      ok: true,
      ms: ms(),
      result: {
        ...preview,
        message_id: (sent.result as any)?.message_id,
        send_result: sent.result,
      },
    };
  }

  /** اجرای یک ابزار با اعتبارسنجی ورودی و ثبت لاگ */
  async callTool(name: string, rawArgs: unknown, source: "mcp" | "dashboard"): Promise<CallResult> {
    const entry = this.toolIndex.get(name);
    const meta = ["list_services", "list_chats", "memory_search", "memory_remember", "resolve_recipient", "send_message_to"].includes(name);
    const started = performance.now();
    const finish = (r: Omit<CallResult, "ms">): CallResult => {
      const ms = Math.round(performance.now() - started);
      this.logger.add({
        tool: name,
        provider: entry?.provider.id ?? (meta ? "system" : "?"),
        source,
        ok: r.ok,
        ms,
        args: summarizeForLog(rawArgs),
        error: r.error,
        result: r.ok ? JSON.stringify(r.result ?? null).slice(0, 2000) : undefined,
      });
      void this.triggers.onToolEvent({ tool: name, args: rawArgs, ok: r.ok, error: r.error, ms, source });
      return { ...r, ms };
    };

    // ابزارهای سیستمی (در toolIndex نیستند) — برای MCP و دستیار یکسان
    if (!entry) {
      const a = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Record<string, any>;
      if (name === "list_services") return finish({ ok: true, result: this.servicesSummary() });
      if (name === "list_chats") {
        return finish({ ok: true, result: this.chatsSummary(typeof a.provider === "string" ? a.provider : undefined) });
      }
      if (name === "memory_search") {
        const query = String(a.query ?? "");
        return finish({ ok: true, result: { ...this.memory.search(query, Number(a.limit) || 8), stats: this.memory.stats() } });
      }
      if (name === "memory_remember") {
        const fact = this.memory.rememberFact(String(a.text ?? a.fact ?? ""), Array.isArray(a.tags) ? a.tags.map(String) : []);
        return finish(fact ? { ok: true, result: { saved: true, fact } } : { ok: false, error: "متن حافظه خالی است." });
      }
      if (name === "resolve_recipient") {
        const result = await this.resolveRecipient(String(a.name ?? a.recipient ?? ""), {
          provider: typeof a.provider === "string" ? a.provider : undefined,
        });
        return finish({ ok: true, result });
      }
      if (name === "send_message_to") {
        const result = await this.sendToRecipient({
          recipient: String(a.recipient ?? a.name ?? ""),
          text: String(a.text ?? ""),
          provider: typeof a.provider === "string" ? a.provider : undefined,
          allowGroup: a.allow_group === true || a.allowGroup === true,
          allowLinks: a.allow_links === true || a.allowLinks === true,
          dryRun: a.dry_run === true || a.dryRun === true,
        });
        return finish({ ok: result.ok, result: result.result, error: result.error });
      }
      return finish({ ok: false, error: `ابزاری با نام «${name}» وجود ندارد` });
    }
    const { tool, provider } = entry;
    if (!this.store.isEnabled(provider)) return finish({ ok: false, error: `سرویس ${provider.nameFa} غیرفعال است` });
    const missing = this.store.missingFields(provider);
    if (missing.length) return finish({ ok: false, error: `تنظیمات ${provider.nameFa} کامل نیست: ${missing.join("، ")}` });

    if (source === "mcp" && !tool.annotations?.readOnlyHint && !this.writeLimiter.allow("mcp")) {
      return finish({
        ok: false,
        error: `محدودیت ارسال: حداکثر ${this.writeLimiter.max} فراخوانی ارسالی در دقیقه. ${this.writeLimiter.retryAfter("mcp")} ثانیه دیگر دوباره امتحان کنید.`,
      });
    }

    const parsed = z.object(tool.input).safeParse(rawArgs ?? {});
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "ورودی"}: ${i.message}`).join(" | ");
      return finish({ ok: false, error: `ورودی نامعتبر — ${msg}` });
    }

    const ctx = this.contextOf(provider);
    const values = ctx.config;
    try {
      const result = await tool.handler(parsed.data, ctx);
      this.recordSent(provider, tool.name, parsed.data as Record<string, unknown>, result, source);
      return finish({ ok: true, result });
    } catch (err: any) {
      const msg = err instanceof ProviderError ? err.message : `خطای داخلی: ${err?.message ?? err}`;
      return finish({ ok: false, error: redact(msg, Object.values(values)) });
    }
  }

  /** پیام‌های ارسالی حساب را در گفتگوی همان چت ثبت می‌کند */
  private recordSent(provider: ProviderDef, toolName: string, args: Record<string, unknown>, result: unknown, source: "mcp" | "dashboard") {
    if (!/_send_/.test(toolName)) return;
    try {
      const r: any = result;
      // بعضی سرویس‌ها (مثل بله با حساب کاربری) نام کاربری را به شناسه‌ی چت تبدیل می‌کنند
      const resolvedChat = r?.chat_id ?? r?.result?.chat_id;
      const chatId = String(resolvedChat || args.chat_id || this.store.resolve(provider).values.defaultChatId || "");
      if (!chatId) return;
      const messageId = r?.message_id ?? r?.result?.message_id ?? r?.data?.message_id;
      const kind = /_send_photo$/.test(toolName)
        ? "photo"
        : /_send_(document|file)$/.test(toolName)
          ? "file"
          : /_send_location$/.test(toolName)
            ? "location"
            : "text";
      const media = [args.photo, args.document, args.file].find((v) => typeof v === "string") as string | undefined;
      const text =
        (args.text as string | undefined) ??
        (args.caption as string | undefined) ??
        (kind === "location" ? `${args.latitude}, ${args.longitude}` : undefined);
      this.inbox.recordOutgoing(provider.id, {
        chatId,
        messageId: messageId !== undefined ? String(messageId) : undefined,
        text,
        kind,
        source,
        mediaUrl: media && /^https?:\/\//i.test(media) ? media : undefined,
      });
    } catch (err) {
      console.error("[diba-mcp] ثبت پیام ارسالی ناموفق بود", err);
    }
  }

  /** تست اتصال یک سرویس (حتی اگر غیرفعال باشد) */
  async testProvider(id: string): Promise<CallResult> {
    const p = this.provider(id);
    const started = performance.now();
    const ms = () => Math.round(performance.now() - started);
    if (!p) return { ok: false, ms: 0, error: "سرویس پیدا نشد" };
    if (!p.test) return { ok: false, ms: 0, error: "این سرویس تست اتصال ندارد" };
    const missing = this.store.missingFields(p);
    if (missing.length) return { ok: false, ms: 0, error: `اول این فیلدها را پر کنید: ${missing.join("، ")}` };
    const ctx = this.contextOf(p);
    const values = ctx.config;
    try {
      return { ok: true, ms: ms(), result: await p.test(ctx) };
    } catch (err: any) {
      return { ok: false, ms: ms(), error: redact(err?.message ?? String(err), Object.values(values)) };
    }
  }

  /**
   * یک قدم از ورود با حساب کاربری (کلاینت غیررسمی) را اجرا می‌کند.
   * start ← شماره، code ← کد پیامک/بله، password ← رمز دومرحله‌ای، logout ← خروج.
   */
  async authStep(
    id: string,
    step: "start" | "code" | "password" | "logout",
    input: Record<string, unknown> = {},
  ): Promise<CallResult> {
    const p = this.provider(id);
    const started = performance.now();
    const ms = () => Math.round(performance.now() - started);
    if (!p?.auth) return { ok: false, ms: 0, error: "این سرویس ورود با حساب کاربری ندارد" };
    const resolved = this.store.resolve(p);
    if (step === "logout" && resolved.fromEnv[p.auth.sessionField]) {
      return { ok: false, ms: 0, error: `نشست از env خوانده می‌شود (${envKey(p.id, p.auth.sessionField)})؛ برای خروج آن را از env بردارید.` };
    }

    const ctx = this.contextOf(p);
    const save = (values: Record<string, string>) => this.store.update(p.id, { values });
    try {
      let result: AuthStep;
      if (step === "start") result = await p.auth.start(ctx, String(input.phone ?? ""), save);
      else if (step === "code")
        result = await p.auth.verifyCode(ctx, String(input.transactionHash ?? ""), String(input.code ?? ""), save);
      else if (step === "password")
        result = await p.auth.verifyPassword(ctx, String(input.transactionHash ?? ""), String(input.password ?? ""), save);
      else result = await p.auth.logout(ctx, save);

      if (result.step === "done" && step !== "logout") this.store.update(p.id, { enabled: true });
      this.inbox.sync();
      return { ok: true, ms: ms(), result };
    } catch (err: any) {
      const secrets = Object.values(ctx.config).filter((v) => v && v.length > 8);
      return { ok: false, ms: ms(), error: redact(err?.message ?? String(err), secrets) };
    }
  }

  /**
   * ورود جایگزین با کوکی/نشست آماده (برای سرویس‌هایی مثل اینستاگرام که
   * ورود با رمز از سمت سرور مسدود می‌شود).
   */
  async authImport(id: string, raw: string): Promise<CallResult> {
    const p = this.provider(id);
    const started = performance.now();
    const ms = () => Math.round(performance.now() - started);
    const importer = p?.auth?.sessionImport;
    if (!p || !importer) return { ok: false, ms: 0, error: "این سرویس ورود با نشست ندارد" };
    const resolved = this.store.resolve(p);
    if (resolved.fromEnv[p.auth!.sessionField]) {
      return { ok: false, ms: 0, error: `نشست از env خوانده می‌شود (${envKey(p.id, p.auth!.sessionField)})؛ آنجا را عوض کنید.` };
    }
    const ctx = this.contextOf(p);
    const save = (values: Record<string, string>) => this.store.update(p.id, { values });
    try {
      const result = await importer.run(ctx, String(raw ?? ""), save);
      if (result.step === "done") this.store.update(p.id, { enabled: true });
      this.inbox.sync();
      return { ok: true, ms: ms(), result };
    } catch (err: any) {
      // کوکی ورودی هم می‌تواند راز باشد و نباید در پیام خطا برگردد
      const secrets = [String(raw ?? ""), ...Object.values(ctx.config).filter((v) => v && v.length > 8)];
      return { ok: false, ms: ms(), error: redact(err?.message ?? String(err), secrets) };
    }
  }

  /**
   * باز کردن پنجره‌ی واقعی مرورگر برای ورود (Instagram iframe را مسدود می‌کند).
   */
  async authBrowserStart(id: string): Promise<CallResult> {
    const started = performance.now();
    const p = this.provider(id);
    if (!p?.auth?.browserLogin) return { ok: false, ms: 0, error: "این سرویس ورود با پنجره‌ی مرورگر ندارد" };
    try {
      const result = await p.auth.browserLogin.start(this.contextOf(p));
      return { ok: true, ms: Math.round(performance.now() - started), result };
    } catch (err: any) {
      return { ok: false, ms: Math.round(performance.now() - started), error: String(err?.message ?? err) };
    }
  }

  async authBrowserStatus(id: string, jobId: string): Promise<CallResult> {
    const started = performance.now();
    const p = this.provider(id);
    if (!p?.auth?.browserLogin) return { ok: false, ms: 0, error: "این سرویس ورود با پنجره‌ی مرورگر ندارد" };
    const resolved = this.store.resolve(p);
    if (resolved.fromEnv[p.auth.sessionField]) {
      return { ok: false, ms: 0, error: `نشست از env خوانده می‌شود (${envKey(p.id, p.auth.sessionField)})؛ آنجا را عوض کنید.` };
    }
    try {
      const save = (values: Record<string, string>) => this.store.update(p.id, { values });
      const result = await p.auth.browserLogin.status(this.contextOf(p), jobId, save);
      if (result.step === "done") {
        this.store.update(p.id, { enabled: true });
        this.inbox.sync();
      }
      return { ok: true, ms: Math.round(performance.now() - started), result };
    } catch (err: any) {
      return { ok: false, ms: Math.round(performance.now() - started), error: String(err?.message ?? err) };
    }
  }

  /**
   * وضعیت QR جاری برای ورود (بدون شروع دوباره‌ی جریان).
   */
  async authQr(id: string): Promise<CallResult> {
    const started = performance.now();
    const p = this.provider(id);
    if (!p?.auth?.getQr) return { ok: false, ms: 0, error: "این سرویس QR ندارد" };
    try {
      const result = await p.auth.getQr(this.contextOf(p));
      return { ok: true, ms: Math.round(performance.now() - started), result };
    } catch (err: any) {
      return { ok: false, ms: Math.round(performance.now() - started), error: String(err?.message ?? err) };
    }
  }

  /**
   * یک McpServer تازه با ابزارهای فعال می‌سازد.
   * در حالت HTTP بدون‌نشست، برای هر درخواست یک نمونه ساخته می‌شود تا تغییر
   * تنظیمات در داشبورد بلافاصله اعمال شود.
   */
  createMcpServer(): McpServer {
    // MCP_MODE:
    //   agent (پیش‌فرض) → فقط ابزار سطح‌بالای diba_agent
    //   tools          → ابزارهای سطح‌پایین قبلی
    //   both           → هر دو
    const mode = String(this.env.MCP_MODE ?? "agent").toLowerCase();
    const agentMode = mode !== "tools";
    const lowLevel = mode === "tools" || mode === "both";
    const instructions = agentMode
      ? lowLevel
        ? "Prefer diba_agent for every user task: it understands one plain sentence, finds the right person across chats and contacts first, then sends or asks for one short confirmation. Low-level tools stay available for explicit automation."
        : "Diba messaging assistant. ALWAYS call diba_agent with the user's sentence as `request`. " +
          "It infers the service from the sentence, searches chats first and then contacts (matching Persian and English spellings), " +
          "returns the closest candidates when unsure, sends immediately when both the person and the text are explicit, " +
          "and otherwise asks for one confirmation. Pass conversation_id to keep the thread, selection_token to pick a candidate, " +
          "and confirm=true to approve a pending draft. It also lists chats, reads messages, reports capabilities and can run any provider tool. " +
          "NEVER ask the user for chat IDs."
      : "Tools for messaging and social services (Bale, Eitaa, Rubika, Soroush Plus, Telegram, WhatsApp, Instagram, X, LinkedIn). " +
        "Tool names are prefixed with the service id. Call list_services first if unsure what is configured; call list_chats to find a destination chat_id. " +
        "list_services shows configuration, not live connectivity — call a provider's get_me/get_chats tool to verify a connection.";
    const server = new McpServer(
      { name: SERVER_NAME, version: SERVER_VERSION },
      { instructions },
    );

    if (agentMode) {
      const agent = new McpAgent(this);
      server.registerTool(
        "diba_agent",
        {
          title: "دستیار دیبا",
          description:
            "Diba assistant for ALL messaging tasks — one tool, one plain sentence. " +
            "Understands Persian and English, infers the service from the sentence, and finds the person by checking recent chats first, then contacts, then memory (Persian and English spellings are matched phonetically). " +
            "If the match is unique and the text is explicit it sends right away; if the person is ambiguous it returns up to 6 candidates with selection_token; if the text must be written it returns a draft with confirmation_token. " +
            "Follow-ups work too: pass conversation_id and reply «بله» or pick a number. " +
            "Also supports list_chats, read messages, capabilities, and running any provider tool via tool+args. Chat IDs are never exposed.",
          inputSchema: {
            request: z.string().max(2000).optional().describe("The user's sentence, Persian or English. May be a follow-up like «بله» or «۱»."),
            provider: z.string().optional().describe("Only when the service is known up front (id or Persian name, e.g. telegram_client or تلگرام)"),
            recipient: z.string().optional().describe("Explicit person name/username/phone, when the client already knows it"),
            selection_token: z.string().optional().describe("Opaque token of a candidate from a previous need_person response; not a chat ID"),
            text: z.string().max(1500).optional().describe("Message text approved by the user"),
            confirmation_token: z.string().optional().describe("Token from need_confirmation, when approving a draft"),
            confirm: z.boolean().optional().describe("true approves a pending draft or a write tool call"),
            conversation_id: z.string().max(64).optional().describe("Thread id to keep short-term context between calls (default: mcp)"),
            allow_group: z.boolean().optional().describe("true only when the user explicitly wants to message a group/channel"),
            dry_run: z.boolean().optional().describe("true returns what would be sent, without sending"),
            tool: z.string().optional().describe("Low-level tool name to run directly (advanced access to every provider capability)"),
            args: z.record(z.string(), z.unknown()).optional().describe("Arguments for `tool`"),
          },
          annotations: { openWorldHint: true },
        },
        async (args) => {
          try {
            const result = await agent.handle({ ...args, request: args.request ?? "" });
            return {
              content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
              isError: result.status === "error",
            };
          } catch (err: any) {
            const result = {
              status: "error",
              action: "find",
              message: `خطای دستیار: ${String(err?.message ?? err)}`,
              conversation_id: "mcp",
            };
            return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], isError: true };
          }
        },
      );
      if (!lowLevel) return server;
    }

    server.registerTool(
      "list_services",
      {
        title: "فهرست سرویس‌ها",
        description:
          "List configured services (messengers and social networks) with enabled/ready state, missing fields, receive status and tool names. Use this before claiming which services are available.",
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      async () => {
        return { content: [{ type: "text", text: JSON.stringify(this.servicesSummary(), null, 2) }] };
      },
    );

    server.registerTool(
      "list_chats",
      {
        title: "فهرست چت‌ها",
        description:
          "List chats (users, groups, channels) that have recently messaged the connected accounts, with their chat_id, title and last message. " +
          "Use it to find the chat_id to send to. Only works for messengers where 'receive messages' is turned on in the dashboard.",
        inputSchema: { provider: z.string().optional().describe("Messenger id, e.g. bale_client or rubika_client") },
        annotations: { readOnlyHint: true },
      },
      async ({ provider }) => {
        return { content: [{ type: "text", text: JSON.stringify(this.chatsSummary(provider), null, 2) }] };
      },
    );

    server.registerTool(
      "memory_search",
      {
        title: "جستجوی حافظه‌ی دستیار",
        description:
          "Search the assistant's persistent memory: user facts, known recipients and recent outbound messages. Use it before asking the user to repeat something.",
        inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(20).optional() },
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        const r = await this.callTool("memory_search", args, "mcp");
        const data: any = r.ok ? JSON.parse(JSON.stringify(r.result ?? {})) : { error: r.error };
        if (Array.isArray(data.recipients)) {
          data.recipients = data.recipients.map(({ chatId, ...rest }: any) => rest);
        }
        if (Array.isArray(data.sends)) {
          data.sends = data.sends.map(({ chatId, ...rest }: any) => rest);
        }
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], isError: !r.ok };
      },
    );

    server.registerTool(
      "memory_remember",
      {
        title: "ذخیره در حافظه‌ی دستیار",
        description:
          "Store a durable fact about the user or a recipient (name, preference, relationship, tone). Use only for stable information, not transient chat.",
        inputSchema: { text: z.string().min(2).max(1000), tags: z.array(z.string()).max(8).optional() },
        annotations: { idempotentHint: true },
      },
      async (args) => {
        const r = await this.callTool("memory_remember", args, "mcp");
        return {
          content: [{ type: "text", text: JSON.stringify(r.ok ? r.result : { error: r.error }, null, 2) }],
          isError: !r.ok,
        };
      },
    );

    server.registerTool(
      "resolve_recipient",
      {
        title: "پیدا کردن مخاطب با نام",
        description:
          "Resolve a person/chat name (or phone/username) to chat candidates across the connected accounts, with provider, type and last message. Chat IDs are hidden by default; set include_ids only for low-level automation.",
        inputSchema: {
          name: z.string().min(1).describe("Person name, username or phone number"),
          provider: z.string().optional().describe("Optional provider id, e.g. whatsapp or telegram_client"),
          include_ids: z.boolean().optional().describe("Include raw chat IDs (default false)"),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async (args) => {
        const includeIds = Boolean(args?.include_ids);
        const r = await this.callTool("resolve_recipient", args, "mcp");
        let data: any = r.ok ? JSON.parse(JSON.stringify(r.result ?? {})) : { error: r.error };
        if (data && typeof data === "object" && !includeIds) {
          if (Array.isArray(data.candidates)) {
            data.candidates = data.candidates.map(({ chatId, title, type, username, ...rest }: any) => ({
              ...rest,
              title: publicTitle(title, type, username),
              type,
            }));
          }
          if (data.best && typeof data.best === "object") {
            const { chatId, title, type, username, ...best } = data.best;
            data.best = { ...best, title: publicTitle(title, type, username), type };
          }
        }
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], isError: !r.ok };
      },
    );

    server.registerTool(
      "send_message_to",
      {
        title: "ارسال پیام به مخاطب با نام",
        description:
          "Send a text to a named person/chat. Resolves the recipient, refuses ambiguous/group targets, checks message quality, duplicate text and rate limits. Prefer this over low-level *_send_message tools when the user says 'send a message to X'. Chat IDs are never returned.",
        inputSchema: {
          recipient: z.string().min(1).describe("Recipient name, username or phone"),
          text: z.string().min(1).max(1500),
          provider: z.string().optional(),
          allow_group: z.boolean().optional().describe("Only if the user explicitly asked to message a group/channel"),
          allow_links: z.boolean().optional().describe("Set true only if the user asked to include a link"),
          dry_run: z.boolean().optional(),
        },
        annotations: { openWorldHint: true },
      },
      async (args) => {
        const r = await this.callTool("send_message_to", args, "mcp");
        const data: any = r.ok ? JSON.parse(JSON.stringify(r.result ?? {})) : { error: r.error, details: r.result };
        const strip = (value: any): any => {
          if (Array.isArray(value)) return value.map(strip);
          if (value && typeof value === "object") {
            const out: Record<string, unknown> = {};
            for (const [key, item] of Object.entries(value)) {
              if (key === "chatId" || key === "chat_id" || key === "jid" || key === "peer_id") continue;
              if (key === "title" && typeof item === "string") {
                out[key] = publicTitle(item, (value as any).type);
                continue;
              }
              out[key] = strip(item);
            }
            return out;
          }
          return value;
        };
        if (data && typeof data === "object") {
          delete data.chat_id;
          delete data.chatId;
          if (data.candidate) data.candidate = strip(data.candidate);
          if (data.send_result) data.send_result = strip(data.send_result);
          if (data.details) data.details = strip(data.details);
        }
        const clean = strip(data);
        return { content: [{ type: "text", text: JSON.stringify(clean, null, 2) }], isError: !r.ok };
      },
    );

    for (const { tool } of this.activeTools()) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.input,
          annotations: { title: tool.title, ...tool.annotations },
        },
        async (args: unknown) => {
          const r = await this.callTool(tool.name, args, "mcp");
          return r.ok
            ? { content: [{ type: "text" as const, text: JSON.stringify(r.result ?? { ok: true }, null, 2) }] }
            : { content: [{ type: "text" as const, text: r.error ?? "خطا" }], isError: true };
        },
      );
    }
    return server;
  }

  // ---------- داده برای داشبورد ----------
  describeProviders() {
    return this.providers.map((p) => {
      const { values, fromEnv } = this.store.resolve(p);
      return {
        id: p.id,
        name: p.name,
        nameFa: p.nameFa,
        category: p.category,
        color: p.color,
        glyph: p.glyph,
        description: p.description,
        docsUrl: p.docsUrl,
        enabled: this.store.isEnabled(p),
        enabledFromEnv: this.store.enabledFromEnv(p),
        ready: this.store.isReady(p),
        missing: this.store.missingFields(p),
        hasTest: Boolean(p.test),
        receive: {
          supported: Boolean(p.receive),
          enabled: this.store.isReceiving(p),
          fromEnv: this.store.receiveFromEnv(p),
        },
        actions: Object.entries(p.actions ?? {}).map(([name, a]) => ({ name, title: a.title })),
        auth: p.auth
          ? {
              title: p.auth.title,
              description: p.auth.description,
              phoneField: p.auth.phoneField,
              sessionField: p.auth.sessionField,
              codeInput: p.auth.codeInput !== false,
              qr: Boolean(p.auth.qr),
              sessionImport: p.auth.sessionImport
                ? {
                    title: p.auth.sessionImport.title,
                    hint: p.auth.sessionImport.hint,
                    placeholder: p.auth.sessionImport.placeholder,
                  }
                : undefined,
              browserLogin: p.auth.browserLogin
                ? { title: p.auth.browserLogin.title, hint: p.auth.browserLogin.hint }
                : undefined,
              inputLabel: p.auth.inputLabel,
              inputPlaceholder: p.auth.inputPlaceholder,
              startLabel: p.auth.startLabel,
              passwordHint: p.auth.passwordHint,
              credentials: p.auth.credentials,
              loggedIn: Boolean(values[p.auth.sessionField]),
            }
          : undefined,
        fields: p.fields.map((f) => ({
          ...f,
          envName: envKey(p.id, f.key),
          fromEnv: fromEnv[f.key],
          // مقدار secret هیچ‌وقت کامل به مرورگر نمی‌رود
          value: f.type === "secret" ? "" : values[f.key] ?? "",
          masked: f.type === "secret" && values[f.key] ? maskSecret(values[f.key]) : "",
          hasValue: Boolean(values[f.key]),
        })),
        tools: p.tools.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          annotations: t.annotations ?? {},
          schema: z.toJSONSchema(z.object(t.input), { io: "input" }),
        })),
      };
    });
  }
}

function maskSecret(s: string) {
  return s.length <= 8 ? "••••" : `${s.slice(0, 4)}••••${s.slice(-4)}`;
}
