/**
 * دستیار دیبا — سطح‌بالای MCP.
 *
 * یک ابزار، یک جمله‌ی ساده، و تمام کار:
 *   «به عماد داخل تلگرام پیام بده که فردا جلسه داریم»
 *   → نیت: send | سرویس: telegram_client | مخاطب: عماد | متن: فردا جلسه داریم
 *
 * ترتیب پیدا کردن مخاطب همان چیزی است که کاربر انتظار دارد:
 *   ۱) چت‌های اخیر (شامل نام‌های انگلیسی با تطبیق آوایی)
 *   ۲) مخاطبین/دفترچه‌ی سرویس
 *   ۳) حافظه‌ی دستیار، و در آخر نزدیک‌ترین گزینه‌ها
 *
 * سیاست ارسال:
 *   - پیام صریح + مخاطب قطعی  → همان‌جا ارسال می‌شود (بدون سؤال اضافه)
 *   - پیام باید ساخته شود یا تطبیق قطعی نیست → پیش‌نویس + تأیید
 *   - چند گزینه → فهرست کوتاه بدون chat_id
 *
 * محدودیت‌ها: بدون افشای chat_id، با کش کوتاه‌مدت، خروجی فشرده برای کانتکست.
 */
import { createHmac } from "node:crypto";
import { buildDraft } from "./agent-send.js";
import { SEND_TOOLS } from "./contacts.js";
import { dibaRouterChat } from "./dibarouter.js";
import type { DibaMcpEngine } from "./engine.js";
import { parseRequest, isSmallTalk, type ParsedRequest, type ProviderWord } from "./intent.js";
import { publicTitle, providerLabel } from "./memory.js";
import { cleanText, matchName } from "./name-match.js";
import { listChatCandidates, resolveRecipient, type Resolution, type ResolvedCandidate } from "./resolver.js";

export type McpAgentAction =
  | "send"
  | "find"
  | "read"
  | "list_chats"
  | "status"
  | "capabilities"
  | "run"
  | "help"
  | "cancel"
  | "confirm";

export interface McpAgentInput {
  request: string;
  provider?: string;
  recipient?: string;
  selection_token?: string;
  text?: string;
  confirmation_token?: string;
  confirm?: boolean;
  conversation_id?: string;
  allow_group?: boolean;
  dry_run?: boolean;
  tool?: string;
  args?: Record<string, unknown>;
}

export interface McpAgentProvider {
  id: string;
  name: string;
  ready: boolean;
  enabled?: boolean;
  receive?: boolean;
  missing?: string[];
  can_send?: boolean;
}

export interface McpAgentCandidate {
  index: number;
  name: string;
  provider_id: string;
  provider: string;
  type: string;
  last_message?: string;
  match?: number;
  selection_token: string;
}

export interface McpAgentRecipient {
  name: string;
  provider_id: string;
  provider: string;
  type: string;
  selection_token: string;
}

export interface McpAgentResult {
  status: "done" | "need_provider" | "need_person" | "need_confirmation" | "need_info" | "error";
  action: McpAgentAction;
  message: string;
  conversation_id: string;
  providers?: McpAgentProvider[];
  candidates?: McpAgentCandidate[];
  recipient?: McpAgentRecipient;
  draft?: string;
  confirmation_token?: string;
  chats?: Array<{ name: string; type: string; provider: string; last_message?: string }>;
  messages?: Array<{ from: string; text: string; kind: string; date: string }>;
  capabilities?: Array<{ id: string; name: string; receive: boolean; read: string[]; write: string[] }>;
  sent?: { recipient: string; provider: string; text: string; message_id?: string };
  auto_sent?: boolean;
  suggestions?: string[];
  source?: string;
  /** خروجی خام ابزار وقتی assistant خودش ابزار را اجرا کرده است */
  result?: unknown;
}

const EXTRA_WORDS: Record<string, string[]> = {
  bale_client: ["بله", "bale", "پیام‌رسان بله"],
  eitaa_client: ["ایتا", "ایتایار", "eitaa"],
  rubika_client: ["روبیکا", "rubika"],
  soroush_client: ["سروش", "سروش پلاس", "سروش‌پلاس", "soroush", "splus"],
  telegram_client: ["تلگرام", "telegram", "tg"],
  whatsapp: ["واتس‌اپ", "واتساپ", "واتس اپ", "واتس", "whatsapp", "wa"],
  instagram: ["اینستاگرام", "اینستا", "instagram", "insta", "ig"],
  linkedin: ["لینکدین", "linkedin"],
  x: ["توییتر", "twitter", "ایکس"],
};

const MAX_CANDIDATES = 6;
const MAX_CHATS = 12;
const ALIAS_TTL_MS = 10 * 60_000;

function typeLabel(type: string): string {
  const t = String(type ?? "").toLowerCase();
  if (t === "group" || t === "chat") return "گروه";
  if (t === "channel") return "کانال";
  if (["private", "user", "dm", "direct"].includes(t)) return "خصوصی";
  return "چت";
}

function timeValue(value?: string): number {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function faNum(value: number): string {
  return String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}

function clip(value: unknown, max = 90): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** تاریخ‌ها ممکن است ISO، ثانیه، میلی‌ثانیه یا میکروثانیه باشند. */
function isoDate(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const ms = value > 1e14 ? value / 1000 : value > 1e11 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

export class McpAgent {
  private aliasCache = new Map<string, { at: number; values: string[] }>();

  constructor(private readonly engine: DibaMcpEngine) {}

  // ---------------- زیرساخت ----------------
  private providerName(id: string): string {
    return this.engine.provider(id)?.nameFa ?? providerLabel(id);
  }

  /** نام نمایشی؛ اگر عنوان فقط شناسه بود، نام کاربری یا نام واقعی جای آن می‌آید. */
  private showName(candidate: { title: string; type?: string; username?: string }): string {
    return publicTitle(candidate.title, candidate.type, candidate.username);
  }

  private providerWords(): ProviderWord[] {
    return this.engine.describeProviders().map((provider) => ({
      id: provider.id,
      words: [
        provider.nameFa,
        provider.name,
        provider.id,
        provider.id.replace(/_client$/, ""),
        ...(EXTRA_WORDS[provider.id] ?? []),
      ].filter(Boolean),
    }));
  }

  private normalizeProviderId(value?: string): string | undefined {
    const raw = cleanText(value ?? "").toLowerCase();
    if (!raw) return undefined;
    for (const provider of this.engine.describeProviders()) {
      const words = [provider.id, provider.nameFa, provider.name, ...(EXTRA_WORDS[provider.id] ?? [])];
      for (const word of words) {
        const w = cleanText(word).toLowerCase();
        if (!w) continue;
        if (raw === w || raw === w.replace(/_client$/, "")) return provider.id;
      }
    }
    for (const provider of this.engine.describeProviders()) {
      const words = [provider.id, provider.nameFa, provider.name, ...(EXTRA_WORDS[provider.id] ?? [])];
      if (words.some((word) => word && raw.includes(cleanText(word).toLowerCase()))) return provider.id;
    }
    return undefined;
  }

  private canSend(providerId: string): boolean {
    return Boolean(SEND_TOOLS[providerId]);
  }

  private selectionToken(candidate: { provider: string; chatId: string }): string {
    return createHmac("sha256", this.engine.store.sessionSecret)
      .update(`sel:${candidate.provider}:${candidate.chatId}`)
      .digest("base64url")
      .slice(0, 24);
  }

  private confirmationToken(candidate: { provider: string; chatId: string }, text: string): string {
    return createHmac("sha256", this.engine.store.sessionSecret)
      .update(`confirm:${candidate.provider}:${candidate.chatId}:${text}`)
      .digest("base64url")
      .slice(0, 32);
  }

  private toolToken(name: string, args: unknown): string {
    return createHmac("sha256", this.engine.store.sessionSecret)
      .update(`tool:${name}:${JSON.stringify(args ?? {})}`)
      .digest("base64url")
      .slice(0, 32);
  }

  private publicCandidate(candidate: ResolvedCandidate, index: number): McpAgentCandidate {
    return {
      index: index + 1,
      name: this.showName(candidate),
      provider_id: candidate.provider,
      provider: this.providerName(candidate.provider),
      type: typeLabel(candidate.type),
      last_message: candidate.lastText ? clip(candidate.lastText, 70) : undefined,
      match: candidate.score ? Math.round(candidate.score) : undefined,
      selection_token: this.selectionToken(candidate),
    };
  }

  private publicRecipient(candidate: ResolvedCandidate): McpAgentRecipient {
    return {
      name: this.showName(candidate),
      provider_id: candidate.provider,
      provider: this.providerName(candidate.provider),
      type: typeLabel(candidate.type),
      selection_token: this.selectionToken(candidate),
    };
  }

  private done(action: McpAgentAction, message: string, conversationId: string, extra: Partial<McpAgentResult> = {}): McpAgentResult {
    return { status: "done", action, message, conversation_id: conversationId, ...extra };
  }

  private error(action: McpAgentAction, message: string, conversationId = "mcp"): McpAgentResult {
    return { status: "error", action, message, conversation_id: conversationId };
  }

  private candidatesResult(
    action: McpAgentAction,
    lead: string,
    resolution: Resolution,
    conversationId: string,
  ): McpAgentResult {
    // گزینه‌های ضعیف حذف می‌شوند تا فهرست کوتاه و قابل‌اعتماد بماند
    const ranked = resolution.candidates
      .filter((candidate, index) => index < 3 || candidate.score >= 85)
      .slice(0, MAX_CANDIDATES);
    const candidates = ranked.map((candidate, index) => this.publicCandidate(candidate, index));
    const lines = candidates.map(
      (candidate) => `${faNum(candidate.index)}) ${candidate.name} — ${candidate.provider} (${candidate.type})`,
    );
    return {
      status: "need_person",
      action,
      conversation_id: conversationId,
      message: `${lead}\n${lines.join("\n")}\n\nشماره یا نام یکی را بفرست تا ادامه بدهم.`,
      candidates,
      source: resolution.sources.join(","),
      suggestions: candidates.map((candidate) => candidate.name),
    };
  }

  // ---------------- وضعیت و توانایی‌ها ----------------
  private status(conversationId: string): McpAgentResult {
    const summary = this.engine.servicesSummary();
    const providers: McpAgentProvider[] = summary.map((provider) => ({
      id: provider.id,
      name: provider.nameFa,
      ready: provider.ready,
      enabled: provider.enabled,
      receive: provider.receive,
      missing: provider.missing,
      can_send: this.canSend(provider.id),
    }));
    const readySend = providers.filter((p) => p.ready && p.can_send).map((p) => p.name);
    const readyRead = providers.filter((p) => p.ready && !p.can_send).map((p) => p.name);
    const off = providers.filter((p) => !p.ready).map((p) => p.name);
    const message = [
      readySend.length ? `آماده‌ی ارسال: ${readySend.join("، ")}` : "",
      readyRead.length ? `فقط خواندنی: ${readyRead.join("، ")}` : "",
      off.length ? `آماده نیست: ${off.join("، ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return this.done("status", message || "هیچ سرویسی آماده نیست؛ اول یکی را در داشبورد وصل کن.", conversationId, { providers });
  }

  private capabilities(conversationId: string): McpAgentResult {
    const capabilities = this.engine
      .describeProviders()
      .filter((provider) => provider.ready)
      .map((provider) => ({
        id: provider.id,
        name: provider.nameFa,
        receive: provider.receive.enabled,
        read: provider.tools.filter((tool) => tool.annotations?.readOnlyHint).map((tool) => tool.name).slice(0, 5),
        write: provider.tools.filter((tool) => !tool.annotations?.readOnlyHint).map((tool) => tool.name).slice(0, 6),
      }));
    const names = capabilities.map((item) => item.name);
    return this.done(
      "capabilities",
      `می‌توانم روی ${names.join("، ")} این کارها را انجام بدهم:\n` +
        "• پیدا کردن مخاطب و ارسال پیام (متن، عکس، فایل، موقعیت)\n" +
        "• خواندن پیام‌های اخیر، فهرست چت‌ها و وضعیت سرویس‌ها\n" +
        "• مدیریت گروه/کانال، مخاطبین، پروفایل و مدیا\n\n" +
        "برای هر کار خاص، همان جمله‌ی طبیعی کافی است؛ مثلاً «عکسی از نمونه‌کار به عماد در تلگرام بفرست».",
      conversationId,
      { capabilities },
    );
  }

  // ---------------- چت‌ها و پیام‌ها ----------------
  private async listChats(parsed: ParsedRequest, input: McpAgentInput, conversationId: string): Promise<McpAgentResult> {
    const explicit = this.normalizeProviderId(input.provider) ?? parsed.providerHints[0];
    const ready = this.engine.describeProviders().filter((provider) => provider.ready);
    const targets = explicit ? ready.filter((provider) => provider.id === explicit) : ready;
    if (!targets.length) {
      return this.error("list_chats", "سرویسی آماده نیست؛ اول در داشبورد یکی را وصل کن.", conversationId);
    }

    const rows: Array<{ name: string; type: string; provider: string; last_message?: string; at: number }> = [];
    const empty: string[] = [];
    for (const provider of targets) {
      const chats = await listChatCandidates(this.engine, provider.id);
      if (!chats.length) {
        empty.push(provider.nameFa);
        continue;
      }
      for (const chat of chats.slice(0, explicit ? MAX_CHATS : 4)) {
        rows.push({
          name: this.showName(chat),
          type: typeLabel(chat.type),
          provider: provider.nameFa,
          last_message: chat.lastText ? clip(chat.lastText, 70) : undefined,
          at: timeValue(chat.lastAt),
        });
      }
    }
    rows.sort((a, b) => b.at - a.at);
    const chats = rows.slice(0, MAX_CHATS).map(({ at, ...rest }) => rest);
    if (!chats.length) {
      return this.done(
        "list_chats",
        `چتی برای نمایش پیدا نشد.${empty.length ? ` (${empty.join("، ")} فهرست چت ندارند یا خالی‌اند)` : ""} ` +
          "اگر نام یک نفر را بدهی، مستقیم جستجو می‌کنم.",
        conversationId,
        { chats: [] },
      );
    }
    const lines = chats.map(
      (chat, index) => `${faNum(index + 1)}) ${chat.name} — ${chat.provider} — ${chat.type}${chat.last_message ? ` — «${chat.last_message}»` : ""}`,
    );
    return this.done("list_chats", `چت‌های اخیر:\n${lines.join("\n")}`, conversationId, { chats });
  }

  private async readMessages(parsed: ParsedRequest, input: McpAgentInput, conversationId: string): Promise<McpAgentResult> {
    const providerId = this.normalizeProviderId(input.provider) ?? parsed.providerHints[0];
    const person = cleanText(input.recipient ?? parsed.person ?? "");
    const sessionRecipient = this.engine.memory.sessionRecipient(conversationId);
    if (!person && sessionRecipient) {
      return this.readFromCandidate(
        { ...sessionRecipient, source: "memory" as const, score: 0, reason: "" },
        conversationId,
      );
    }
    if (!person) {
      return { status: "need_info", action: "read", conversation_id: conversationId, message: "پیام‌های چه کسی را بخوانم؟" };
    }
    const resolved = await this.resolveQuery(person, providerId, parsed.allowGroup);
    if (!resolved.resolution.best) {
      if (!resolved.resolution.candidates.length) {
        return this.error("read", `چتی برای «${person}» پیدا نکردم.`, conversationId);
      }
      return this.candidatesResult("read", "چند گزینه نزدیک بود:", resolved.resolution, conversationId);
    }
    return this.readFromCandidate(resolved.resolution.best, conversationId);
  }

  private async readFromCandidate(candidate: ResolvedCandidate, conversationId: string): Promise<McpAgentResult> {
    const raw = await this.history(candidate);
    const messages = raw.slice(0, 10).map((message) => ({
      from: message.out ? "من" : this.showName(candidate),
      text: clip(message.text, 160) || `[${message.kind}]`,
      kind: message.kind,
      date: message.date,
    }));
    if (!messages.length) {
      return this.done("read", `پیامی برای «${this.showName(candidate)}» پیدا نشد.`, conversationId, {
        recipient: this.publicRecipient(candidate),
      });
    }
    const lines = messages.map((message) => `${message.from}: ${message.text}`);
    return this.done(
      "read",
      `آخرین پیام‌های «${this.showName(candidate)}» در ${this.providerName(candidate.provider)}:\n${lines.join("\n")}`,
      conversationId,
      { recipient: this.publicRecipient(candidate), messages },
    );
  }

  private async history(candidate: ResolvedCandidate): Promise<Array<{ text: string; out: boolean; kind: string; date: string }>> {
    const provider = this.engine.provider(candidate.provider);
    const toolNames = new Set((provider?.tools ?? []).map((tool) => tool.name));
    const toolName = [`${candidate.provider}_get_history`, `${candidate.provider}_get_messages`].find((name) => toolNames.has(name));
    if (toolName) {
      try {
        const args =
          candidate.provider === "instagram"
            ? { thread_id: candidate.chatId, limit: 10 }
            : { chat_id: candidate.chatId, limit: 10 };
        const result = await this.engine.callTool(toolName, args, "dashboard");
        if (result.ok) {
          const payload = result.result as any;
          const list: any[] = Array.isArray(payload)
            ? payload
            : (payload?.messages ?? payload?.items ?? payload?.result?.messages ?? []);
          if (Array.isArray(list) && list.length) {
            return list.map((message) => ({
              text: String(message.text ?? message.caption ?? `[${message.kind ?? message.type ?? "پیام"}]`),
              out: Boolean(message.out ?? message.is_out ?? message.direction === "out"),
              kind: String(message.kind ?? message.type ?? "text"),
              date: isoDate(message.date),
            }));
          }
        }
      } catch {
        // از صندوق استفاده می‌کنیم
      }
    }
    return this.engine.inbox.messages(candidate.provider, { chatId: candidate.chatId, limit: 10 }).map((message) => ({
      text: String(message.text ?? `[${message.kind}]`),
      out: message.direction === "out",
      kind: message.kind,
      date: message.date,
    }));
  }

  // ---------------- اجرای مستقیم ابزار (دسترسی به همه‌ی امکانات) ----------------
  private async runTool(input: McpAgentInput, conversationId: string): Promise<McpAgentResult> {
    const name = String(input.tool ?? "").trim();
    if (!name) return this.error("run", "نام ابزار خالی است.", conversationId);
    const entry = this.engine.providers
      .flatMap((provider) => provider.tools.map((tool) => ({ provider, tool })))
      .find((item) => item.tool.name === name);
    if (!entry) return this.error("run", `ابزاری با نام «${name}» وجود ندارد.`, conversationId);

    const ready = this.engine.store.isReady(entry.provider);
    if (!ready) return this.error("run", `سرویس ${entry.provider.nameFa} آماده نیست.`, conversationId);

    const args = (input.args && typeof input.args === "object" ? input.args : {}) as Record<string, unknown>;
    const readOnly = entry.tool.annotations?.readOnlyHint === true;
    const token = this.toolToken(name, args);
    if (!readOnly) {
      if (!input.confirm) {
        return {
          status: "need_confirmation",
          action: "run",
          conversation_id: conversationId,
          message: `اجرای «${entry.tool.title}» روی ${entry.provider.nameFa} آماده است. برای تأیید، همان درخواست را با confirm=true و confirmation_token بفرست.`,
          draft: JSON.stringify({ tool: name, args }).slice(0, 600),
          confirmation_token: token,
        };
      }
      if (input.confirmation_token && input.confirmation_token !== token) {
        return this.error("run", "توکن تأیید این اجرا معتبر نیست؛ دوباره درخواست بده.", conversationId);
      }
    }

    const result = await this.engine.callTool(name, args, "mcp");
    if (!result.ok) return this.error("run", result.error ?? "اجرای ابزار ناموفق بود.", conversationId);
    return this.done("run", `«${entry.tool.title}» اجرا شد (${result.ms}ms).`, conversationId, {
      result: result.result,
    });
  }

  // ---------------- مخاطب ----------------
  private lastPerson(conversationId: string, request: string): string | undefined {
    if (!/(?:بهش|براش|به‌ش|همون|همان|اون|او)\b/u.test(request)) return undefined;
    const last = this.engine.memory.sessionRecipient(conversationId);
    return last ? last.title : undefined;
  }

  /** دریافت نسخه‌های املایی/ترنسلیت نام از مدل (فقط وقتی تطبیق قطعی نبود). */
  private async llmAliases(query: string): Promise<string[]> {
    const key = cleanText(query).toLowerCase();
    const cached = this.aliasCache.get(key);
    if (cached && Date.now() - cached.at < ALIAS_TTL_MS) return cached.values;
    const config = this.engine.store.dibarouter();
    const values: string[] = [];
    if (config.apiKey && key.length >= 3) {
      try {
        const out = await dibaRouterChat(
          config,
          [
            {
              role: "system",
              content:
                "You list spelling/transliteration variants of a person's first or full name: " +
                "Persian↔English, common nicknames, and likely spellings. " +
                "Return ONLY a JSON array of up to 5 short strings. No explanation.",
            },
            { role: "user", content: query },
          ],
          { maxTokens: 160, temperature: 0, signal: AbortSignal.timeout(6_000) },
        );
        const match = String(out.reply ?? "").match(/\[[\s\S]*?\]/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              const value = cleanText(item);
              if (value && value.length <= 48 && !values.includes(value)) values.push(value);
            }
          }
        }
      } catch {
        // بدون مدل هم تطبیق آوایی کار خودش را می‌کند
      }
    }
    const list = values.slice(0, 5);
    this.aliasCache.set(key, { at: Date.now(), values: list });
    if (this.aliasCache.size > 200) {
      for (const [oldKey] of [...this.aliasCache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 40)) {
        this.aliasCache.delete(oldKey);
      }
    }
    return list;
  }

  private async resolveQuery(
    person: string,
    providerId: string | undefined,
    allowGroup: boolean,
  ): Promise<{ resolution: Resolution; viaAlias: boolean }> {
    const base = await resolveRecipient(this.engine, person, { provider: providerId, allowGroup });
    if (base.confident) return { resolution: base, viaAlias: false };

    const variants = (await this.llmAliases(person)).filter(
      (variant) => cleanText(variant).toLowerCase() !== cleanText(person).toLowerCase(),
    );
    if (!variants.length) return { resolution: base, viaAlias: false };

    const merged = new Map<string, ResolvedCandidate>();
    const add = (candidate: ResolvedCandidate) => {
      const key = `${candidate.provider}:${candidate.chatId}`;
      const previous = merged.get(key);
      if (!previous || candidate.score > previous.score) merged.set(key, candidate);
    };
    for (const candidate of base.candidates) add(candidate);
    for (const variant of variants) {
      const other = await resolveRecipient(this.engine, variant, { provider: providerId, allowGroup });
      if (other.fallback) continue;
      for (const candidate of other.candidates) add(candidate);
    }
    const candidates = [...merged.values()].sort((a, b) => b.score - a.score || timeValue(b.lastAt) - timeValue(a.lastAt)).slice(0, 8);
    if (!candidates.length) return { resolution: base, viaAlias: false };
    const best = candidates[0];
    const second = candidates[1];
    const gap = best.score - (second?.score ?? 0);
    const confident = best.score >= 88 && (gap >= 8 || !second);
    return {
      resolution: {
        query: person,
        candidates,
        best,
        confidence: confident ? best.score : Math.min(best.score, 70),
        confident,
        exact: best.score >= 96,
        ambiguous: !confident && candidates.length > 1,
        fallback: false,
        sources: [...new Set(candidates.map((candidate) => candidate.source))],
        note: "با نسخه‌های املایی نام پیدا شد.",
      },
      viaAlias: confident,
    };
  }

  // ---------------- پیش‌نویس و ارسال ----------------
  private async compose(candidate: ResolvedCandidate, instruction: string, raw: string): Promise<string> {
    const config = this.engine.store.dibarouter();
    const text = await buildDraft(
      this.engine,
      config,
      { recipient: candidate.title, instruction: instruction ?? "", raw },
      { ...candidate, lastText: candidate.lastText },
      AbortSignal.timeout(25_000),
    );
    return text.ok ? text.text : "";
  }

  private async sendNow(
    candidate: ResolvedCandidate,
    text: string,
    allowGroup: boolean,
    conversationId: string,
    autoSent: boolean,
  ): Promise<McpAgentResult> {
    if (!this.canSend(candidate.provider)) {
      return this.error(
        "send",
        `سرویس ${this.providerName(candidate.provider)} ارسال پیام ندارد؛ فقط می‌توانم چت‌ها/پروفایلش را بخوانم.`,
        conversationId,
      );
    }
    const result = await this.engine.sendToRecipient({
      recipient: candidate.title,
      chatId: candidate.chatId,
      title: candidate.title,
      type: candidate.type,
      provider: candidate.provider,
      text,
      allowGroup,
      allowLinks: /https?:\/\//.test(text),
    });
    if (!result.ok) {
      return this.error("send", `ارسال به «${this.showName(candidate)}» انجام نشد: ${result.error}`, conversationId);
    }
    this.engine.memory.setSessionRecipient(conversationId, {
      provider: candidate.provider,
      chatId: candidate.chatId,
      title: candidate.title,
      type: candidate.type,
    });
    const name = this.showName(candidate);
    return this.done(
      "send",
      `پیام به «${name}» در ${this.providerName(candidate.provider)} ارسال شد.\n«${text}»`,
      conversationId,
      {
        recipient: this.publicRecipient(candidate),
        draft: text,
        auto_sent: autoSent,
        sent: {
          recipient: name,
          provider: this.providerName(candidate.provider),
          text,
          message_id: (result.result as any)?.message_id,
        },
      },
    );
  }

  private needConfirmation(
    candidate: ResolvedCandidate,
    text: string,
    conversationId: string,
    instruction: string,
    allowGroup: boolean,
  ): McpAgentResult {
    this.engine.memory.setPending({
      conversationId,
      query: candidate.title,
      instruction,
      candidates: [candidate],
      selected: candidate,
      text,
      stage: "confirm",
      allowGroup,
    });
    const name = this.showName(candidate);
    return {
      status: "need_confirmation",
      action: "send",
      conversation_id: conversationId,
      message: `مخاطب: ${name} — ${this.providerName(candidate.provider)}\nمتن: «${text}»\n\nارسال شود؟ («بله» بفرست یا confirm=true)`,
      recipient: this.publicRecipient(candidate),
      draft: text,
      confirmation_token: this.confirmationToken(candidate, text),
    };
  }

  private setChoosePending(
    person: string,
    instruction: string,
    resolution: Resolution,
    allowGroup: boolean,
    conversationId: string,
    ephemeral = false,
  ): void {
    // در حالت dry_run وضعیت ذخیره نمی‌شود تا درخواست بعدی ناخواسته از آن استفاده نکند
    if (ephemeral) return;
    this.engine.memory.setPending({
      conversationId,
      query: person,
      instruction,
      candidates: resolution.candidates.slice(0, MAX_CANDIDATES),
      stage: "choose",
      allowGroup,
    });
  }

  // ---------------- جریان اصلی ----------------
  async handle(input: McpAgentInput): Promise<McpAgentResult> {
    const conversationId = String(input.conversation_id ?? "").trim() || "mcp";
    const request = String(input.request ?? "").trim();
    if (input.tool) return this.runTool(input, conversationId);
    if (!request) return this.error("find", "درخواست خالی است.", conversationId);

    this.engine.memory.rememberTurn(conversationId, "user", request);
    const parsed = parseRequest(request, this.providerWords());

    if (parsed.action === "cancel") {
      const cleared = this.engine.memory.clearPending(conversationId);
      return this.done("cancel", cleared ? "پیش‌نویس لغو شد." : "چیزی برای لغو نبود.", conversationId);
    }
    if (parsed.action === "status") return this.status(conversationId);
    if (parsed.action === "capabilities") return this.capabilities(conversationId);
    if (parsed.action === "list_chats") return this.listChats(parsed, input, conversationId);

    const pending = this.engine.memory.getPending(conversationId);
    if (pending) {
      const handled = await this.continuePending(pending, input, parsed, request, conversationId);
      if (handled) return handled;
    }

    if (isSmallTalk(request)) {
      return this.done(
        "help",
        "سلام! بگو به کی و چه چیزی بفرستم. مثلاً: «به عماد در تلگرام پیام بده که فردا جلسه داریم» یا «چت‌های تلگرام را نشان بده».",
        conversationId,
        { suggestions: ["چت‌های تلگرام", "وضعیت سرویس‌ها", "به عماد پیام بده که سلام"] },
      );
    }

    if (parsed.action === "read") return this.readMessages(parsed, input, conversationId);

    if (parsed.action === "confirm") {
      return this.error("confirm", "الان پیش‌نویسی در انتظار تأیید نیست. بگو به چه کسی چه پیامی بفرستم.", conversationId);
    }

    const providerId = this.normalizeProviderId(input.provider) ?? parsed.providerHints[0];
    const person = cleanText(input.recipient ?? parsed.person ?? "") || this.lastPerson(conversationId, request);
    if (!person) {
      return {
        status: "need_info",
        action: parsed.action === "send" ? "send" : "find",
        conversation_id: conversationId,
        message: "برای چه کسی؟ نام، بخشی از نام، نام کاربری یا شماره را بگو و اگر چند سرویس داری، سرویس را هم بگو.",
        suggestions: ["به عماد در تلگرام پیام بده", "چت‌های واتس‌اپ"],
      };
    }

    const allowGroup = input.allow_group === true || parsed.allowGroup;
    const resolved = await this.resolveQuery(person, providerId, allowGroup);
    return this.decide(parsed, input, person, providerId, allowGroup, resolved, conversationId);
  }

  private async decide(
    parsed: ParsedRequest,
    input: McpAgentInput,
    person: string,
    providerId: string | undefined,
    allowGroup: boolean,
    resolved: { resolution: Resolution; viaAlias: boolean },
    conversationId: string,
  ): Promise<McpAgentResult> {
    const { resolution, viaAlias } = resolved;
    const wantsSend = parsed.action === "send";

    if (!resolution.best || resolution.fallback) {
      if (!resolution.candidates.length) {
        return this.error(
          "find",
          `هیچ چت یا مخاطبی برای «${person}» پیدا نکردم${providerId ? ` در ${this.providerName(providerId)}` : ""}. ` +
            "یک نام دقیق‌تر، بخشی از نام، نام کاربری یا شماره بده.",
          conversationId,
        );
      }
      this.setChoosePending(person, parsed.message ?? "", resolution, allowGroup, conversationId, input.dry_run === true);
      const lead = resolution.note ?? "نام دقیقی پیدا نشد؛ نزدیک‌ترین گزینه‌ها:";
      return this.candidatesResult(wantsSend ? "send" : "find", lead, resolution, conversationId);
    }

    if (!resolution.confident) {
      this.setChoosePending(person, parsed.message ?? "", resolution, allowGroup, conversationId, input.dry_run === true);
      return this.candidatesResult(wantsSend ? "send" : "find", "چند مخاطب نزدیک پیدا کردم:", resolution, conversationId);
    }

    const best = resolution.best;
    if (!wantsSend) {
      return this.done(
        "find",
        `مخاطب: ${this.showName(best)} — ${this.providerName(best.provider)} (${typeLabel(best.type)})`,
        conversationId,
        { recipient: this.publicRecipient(best), source: resolution.sources.join(",") },
      );
    }

    const explicit = cleanText(input.text ?? parsed.message ?? "");
    if (!this.canSend(best.provider)) {
      return this.error(
        "send",
        `سرویس ${this.providerName(best.provider)} ارسال پیام ندارد. می‌توانم پیام‌هایش را بخوانم یا چت‌هایش را نشان بدهم.`,
        conversationId,
      );
    }

    if (explicit.length >= 2) {
      if (input.dry_run) {
        return this.done(
          "send",
          `پیش‌نمایش (dry_run): به «${this.showName(best)}» در ${this.providerName(best.provider)}:\n«${explicit}»`,
          conversationId,
          { recipient: this.publicRecipient(best), draft: explicit },
        );
      }
      // تطبیق قطعی (به‌خصوص از راه املای نام) → اول تأیید بگیر
      if (viaAlias && !resolution.exact) {
        return this.needConfirmation(best, explicit, conversationId, parsed.message ?? "", allowGroup);
      }
      return this.sendNow(best, explicit, allowGroup, conversationId, true);
    }

    const text = await this.compose(best, parsed.message ?? "", parsed.raw);
    if (!text) {
      return {
        status: "need_info",
        action: "send",
        conversation_id: conversationId,
        message: `مخاطب «${this.showName(best)}» در ${this.providerName(best.provider)} پیدا شد. متن پیام را بگو.`,
        recipient: this.publicRecipient(best),
      };
    }
    return this.needConfirmation(best, text, conversationId, parsed.message ?? "", allowGroup);
  }

  // ---------------- ادامه‌ی گفتگو (انتخاب/تأیید/متن جدید) ----------------
  private async continuePending(
    pending: import("./memory.js").PendingSend,
    input: McpAgentInput,
    parsed: ParsedRequest,
    request: string,
    conversationId: string,
  ): Promise<McpAgentResult | undefined> {
    const candidates = pending.candidates as ResolvedCandidate[];
    const allowGroup = pending.allowGroup === true;

    let selected: ResolvedCandidate | undefined;
    if (input.selection_token) {
      selected = candidates.find((candidate) => this.selectionToken(candidate) === input.selection_token);
    }
    if (!selected && parsed.selection !== undefined) selected = candidates[parsed.selection];
    // انتخاب با نوشتن نام فقط وقتی است که درخواست جدیدِ کاملی («به X پیام بده») نباشد
    if (!selected && parsed.action !== "send") {
      const typed = cleanText(input.recipient ?? parsed.person ?? "");
      if (typed) {
        const match = matchName(typed, candidates.map((candidate) => candidate.title));
        if (match.score >= 85) selected = candidates.find((candidate) => candidate.title === match.field);
      }
    }

    if (selected && pending.stage === "choose") {
      return this.afterSelection(pending, selected, input, parsed, request, conversationId, allowGroup);
    }

    if (pending.stage === "choose") {
      if (parsed.action === "confirm" || parsed.action === "cancel") return undefined;
      // هر درخواست کامل و تازه («به مریم در تلگرام پیام بده که ...») فهرست قبلی را باطل می‌کند
      if (parsed.action === "send") {
        this.engine.memory.clearPending(conversationId);
        return undefined;
      }
      return this.candidatesResult("send", "شماره یا نام یکی از گزینه‌ها را بفرست:", {
        query: pending.query,
        candidates,
        best: candidates[0],
        confidence: 0,
        confident: false,
        exact: false,
        ambiguous: true,
        fallback: false,
        sources: [],
      }, conversationId);
    }

    // stage === confirm
    const selectedCandidate = (pending.selected ?? candidates[0]) as ResolvedCandidate;
    if (!selectedCandidate) return undefined;

    // درخواست ارسال به شخص دیگری (یا سرویس دیگر): پیش‌نویس قبلی را دور بریز
    const askedPerson = cleanText(input.recipient ?? parsed.person ?? "");
    if (parsed.action === "send") {
      const otherProvider =
        parsed.providerHints.length > 0 && !parsed.providerHints.includes(selectedCandidate.provider);
      const otherPerson = askedPerson && matchName(askedPerson, [selectedCandidate.title, selectedCandidate.username]).score < 60;
      if (otherProvider || otherPerson) {
        this.engine.memory.clearPending(conversationId);
        return undefined;
      }
      const newText = parsed.message?.trim();
      if (newText && newText.length >= 2) {
        this.engine.memory.updatePending(conversationId, { text: newText });
        return this.needConfirmation(selectedCandidate, newText, conversationId, newText, allowGroup);
      }
      if (pending.text) {
        return this.needConfirmation(selectedCandidate, pending.text, conversationId, pending.instruction ?? "", allowGroup);
      }
      return undefined;
    }

    if (parsed.action === "confirm" || input.confirm === true) {
      if (!pending.text) return this.error("send", "متن پیش‌نویس خالی است؛ دوباره بگو.", conversationId);
      const expected = this.confirmationToken(selectedCandidate, pending.text);
      if (input.confirmation_token && input.confirmation_token !== expected) {
        return this.error("send", "توکن تأیید معتبر نیست؛ دوباره درخواست بده.", conversationId);
      }
      const claimed = this.engine.memory.takePending(conversationId);
      if (!claimed?.selected || !claimed.text) {
        return this.error("send", "این پیش‌نویس منقضی شده؛ دوباره بگو به چه کسی پیام بدهم.", conversationId);
      }
      return this.sendNow(claimed.selected as ResolvedCandidate, claimed.text, allowGroup, conversationId, false);
    }

    // کاربر متن را عوض کرد: همان مخاطب، متن جدید
    const replaceable =
      request.length >= 3 &&
      !isSmallTalk(request) &&
      !["list_chats", "status", "read", "capabilities"].includes(parsed.action);
    if (replaceable) {
      const text = cleanText(request).replace(/^(?:متن|پیام)\s*[:：]\s*/u, "").trim();
      if (text) {
        const updated = this.engine.memory.updatePending(conversationId, { text, stage: "confirm" });
        if (updated) return this.needConfirmation(selectedCandidate, text, conversationId, pending.instruction, allowGroup);
      }
    }
    return undefined;
  }

  private async afterSelection(
    pending: import("./memory.js").PendingSend,
    selected: ResolvedCandidate,
    input: McpAgentInput,
    parsed: ParsedRequest,
    request: string,
    conversationId: string,
    allowGroup: boolean,
  ): Promise<McpAgentResult> {
    // متنِ همین درخواست بر متنِ ذخیره‌شده‌ی قدیمی اولویت دارد
    const instruction = cleanText(input.text ?? parsed.message ?? pending.instruction ?? "");
    if (!this.canSend(selected.provider)) {
      return this.error("send", `سرویس ${this.providerName(selected.provider)} ارسال پیام ندارد.`, conversationId);
    }
    if (instruction.length >= 2) {
      if (input.dry_run) {
        return this.done(
          "send",
          `پیش‌نمایش (dry_run): به «${this.showName(selected)}»:\n«${instruction}»`,
          conversationId,
          { recipient: this.publicRecipient(selected), draft: instruction },
        );
      }
      return this.sendNow(selected, instruction, allowGroup, conversationId, true);
    }
    const text = await this.compose(selected, "", pending.query);
    if (!text) {
      this.engine.memory.updatePending(conversationId, { selected, stage: "confirm" });
      return {
        status: "need_info",
        action: "send",
        conversation_id: conversationId,
        message: `«${this.showName(selected)}» انتخاب شد. متن پیام را بگو.`,
        recipient: this.publicRecipient(selected),
      };
    }
    return this.needConfirmation(selected, text, conversationId, pending.instruction ?? "", allowGroup);
  }
}
