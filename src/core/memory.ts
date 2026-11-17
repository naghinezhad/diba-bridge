import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface AssistantFact {
  id: string;
  text: string;
  tags: string[];
  at: string;
}

export interface KnownRecipient {
  id: string;
  provider: string;
  chatId: string;
  title: string;
  type?: string;
  aliases: string[];
  lastUsed: string;
  sendCount: number;
}

export interface AssistantTurn {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  at: string;
  tools?: string[];
}

export interface SendRecord {
  id: string;
  at: string;
  provider: string;
  chatId: string;
  title?: string;
  textHash: string;
  preview: string;
  ok: boolean;
  error?: string;
}

export interface PendingCandidate {
  provider: string;
  chatId: string;
  title: string;
  type: string;
  lastText?: string;
  score?: number;
}

export interface PendingSend {
  id: string;
  conversationId: string;
  createdAt: string;
  expiresAt: string;
  query: string;
  instruction: string;
  candidates: PendingCandidate[];
  selected?: PendingCandidate;
  text?: string;
  stage: "choose" | "confirm";
  allowGroup?: boolean;
}

interface MemoryFile {
  version: 1;
  facts: AssistantFact[];
  recipients: KnownRecipient[];
  turns: AssistantTurn[];
  sends: SendRecord[];
  pending: Record<string, PendingSend>;
}

const LIMITS = {
  facts: 500,
  recipients: 800,
  turns: 600,
  sends: 2000,
} as const;

const PROVIDER_LABELS: Record<string, string> = {
  bale_client: "بله",
  eitaa_client: "ایتا",
  rubika_client: "روبیکا",
  soroush_client: "سروش‌پلاس",
  telegram_client: "تلگرام",
  whatsapp: "واتس‌اپ",
};

export function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] || id;
}

export function publicTitle(title: string, type?: string, username?: string): string {
  const raw = String(title ?? "").trim();
  const compact = raw.replace(/[\s@._+-]/g, "");
  if (
    !raw ||
    /^[\d|@._+-]+$/.test(raw) ||
    /^\d{6,}$/.test(compact) ||
    /@(?:s\.whatsapp\.net|g\.us|c\.us|lid)$/i.test(raw)
  ) {
    const handle = String(username ?? "").trim().replace(/^@+/, "");
    if (handle && !/^\d+$/.test(handle)) return `@${handle}`.slice(0, 60);
    if (type === "group" || type === "chat") return "گروه بدون نام";
    if (type === "channel") return "کانال بدون نام";
    const tail = raw.replace(/\D/g, "").slice(-4);
    return tail.length === 4 ? `مخاطب بدون نام (…${tail})` : "مخاطب بدون نام";
  }
  return raw.slice(0, 60).replace(/\+?\d{7,}/g, (digits) => `${digits.slice(0, 4)}…${digits.slice(-3)}`);
}

export function normalizePersonName(value: string): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u0640\u200C\u200D]/g, "")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[أإآ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ی")
    .replace(/[^\p{L}\p{N}@._\-\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function hashText(text: string): string {
  return createHash("sha256").update(String(text ?? "")).digest("hex").slice(0, 32);
}

function iso(now = Date.now()): string {
  return new Date(now).toISOString();
}

const SYNONYM_GROUPS = [
  ["اسم", "نام"],
  ["شماره", "موبایل", "تلفن"],
  ["پروفایل", "حساب"],
  ["مخاطب", "مخاطبین", "مخاطب‌ها"],
];

function expandQueryTokens(query: string): string[] {
  const tokens = normalizePersonName(query).split(" ").filter(Boolean);
  const set = new Set(tokens);
  for (const group of SYNONYM_GROUPS) {
    if (group.some((word) => tokens.includes(normalizePersonName(word)))) {
      for (const word of group) set.add(normalizePersonName(word));
    }
  }
  return [...set];
}

function matches(query: string, ...fields: Array<string | undefined>): number {
  const tokens = expandQueryTokens(query);
  if (!tokens.length) return 0;
  const q = tokens.join(" ");
  const qTokens = new Set(tokens);
  let best = 0;
  for (const field of fields) {
    const f = normalizePersonName(field ?? "");
    if (!f) continue;
    if (f === q) best = Math.max(best, 100);
    else if (f.startsWith(q) || q.startsWith(f)) best = Math.max(best, 80);
    else if (f.includes(q)) best = Math.max(best, 60);
    else {
      const fTokens = new Set(f.split(" ").filter(Boolean));
      const hits = [...qTokens].filter((t) => fTokens.has(t)).length;
      if (hits) best = Math.max(best, 35 + Math.round((hits / Math.max(qTokens.size, 1)) * 20));
    }
  }
  return best;
}

export interface EphemeralTurn {
  role: "user" | "assistant";
  content: string;
  at: number;
}

interface EphemeralSession {
  at: number;
  turns: EphemeralTurn[];
  lastRecipient?: { provider: string; chatId: string; title: string; type: string; at: number };
}

const SESSION_TTL_MS = 30 * 60_000;
const SESSION_MAX_TURNS = 12;

export class AssistantMemory {
  private file: string;
  private data: MemoryFile;
  private sessions = new Map<string, EphemeralSession>();

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.file = join(dataDir, "assistant.json");
    this.data = this.load();
  }

  private empty(): MemoryFile {
    return { version: 1, facts: [], recipients: [], turns: [], sends: [], pending: {} };
  }

  private load(): MemoryFile {
    if (!existsSync(this.file)) return this.empty();
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8"));
      const data = parsed && typeof parsed === "object" ? parsed : {};
      return {
        version: 1,
        facts: Array.isArray(data.facts) ? data.facts : [],
        recipients: Array.isArray(data.recipients) ? data.recipients : [],
        turns: Array.isArray(data.turns) ? data.turns : [],
        sends: Array.isArray(data.sends) ? data.sends : [],
        pending: data.pending && typeof data.pending === "object" && !Array.isArray(data.pending) ? data.pending : {},
      };
    } catch {
      return this.empty();
    }
  }

  private persist() {
    const json = JSON.stringify(this.data, null, 2);
    const tmp = this.file + ".tmp";
    try {
      writeFileSync(tmp, json, { mode: 0o600 });
      try {
        renameSync(tmp, this.file);
      } catch {
        try {
          writeFileSync(this.file, json, { mode: 0o600 });
        } catch {
        }
        try {
          unlinkSync(tmp);
        } catch {
        }
      }
    } catch {
      try {
        writeFileSync(this.file, json, { mode: 0o600 });
      } catch {
      }
    }
  }

  private trim() {
    if (this.data.facts.length > LIMITS.facts) this.data.facts = this.data.facts.slice(-LIMITS.facts);
    if (this.data.recipients.length > LIMITS.recipients) this.data.recipients = this.data.recipients.slice(-LIMITS.recipients);
    if (this.data.turns.length > LIMITS.turns) this.data.turns = this.data.turns.slice(-LIMITS.turns);
    if (this.data.sends.length > LIMITS.sends) this.data.sends = this.data.sends.slice(-LIMITS.sends);
    const now = Date.now();
    for (const [id, pending] of Object.entries(this.data.pending)) {
      if (new Date(pending.expiresAt).getTime() <= now) delete this.data.pending[id];
    }
  }

  rememberFact(text: string, tags: string[] = []): AssistantFact | undefined {
    const clean = String(text ?? "").trim();
    if (clean.length < 2) return undefined;
    const normalized = normalizePersonName(clean);
    const existing = this.data.facts.find((f) => normalizePersonName(f.text) === normalized);
    if (existing) {
      existing.at = iso();
      for (const tag of tags) if (tag && !existing.tags.includes(tag)) existing.tags.push(tag);
      this.persist();
      return existing;
    }
    const fact: AssistantFact = { id: randomUUID(), text: clean.slice(0, 1000), tags: tags.filter(Boolean).slice(0, 8), at: iso() };
    this.data.facts.push(fact);
    this.trim();
    this.persist();
    return fact;
  }

  facts(limit = 20): AssistantFact[] {
    return this.data.facts.slice(-Math.max(1, limit)).reverse();
  }

  upsertRecipient(input: {
    provider: string;
    chatId: string;
    title: string;
    type?: string;
    aliases?: string[];
    sentAt?: string;
    increment?: boolean;
  }): KnownRecipient {
    const provider = String(input.provider ?? "").trim();
    const chatId = String(input.chatId ?? "").trim();
    const title = String(input.title ?? "").trim();
    if (!provider || !chatId) throw new Error("provider و chatId برای مخاطب لازم است");
    const id = `${provider}:${chatId}`;
    const at = input.sentAt ?? iso();
    let item = this.data.recipients.find((r) => r.id === id);
    if (!item) {
      item = { id, provider, chatId, title, type: input.type, aliases: [], lastUsed: at, sendCount: 0 };
      this.data.recipients.push(item);
    }
    item.title = title || item.title;
    if (input.type) item.type = input.type;
    item.lastUsed = at;
    if (input.increment) item.sendCount += 1;
    const aliases = [title, ...(input.aliases ?? [])].filter(Boolean);
    for (const alias of aliases) {
      if (!item.aliases.some((a) => normalizePersonName(a) === normalizePersonName(alias))) item.aliases.push(alias);
    }
    if (item.aliases.length > 12) item.aliases = item.aliases.slice(-12);
    this.trim();
    this.persist();
    return item;
  }

  search(query: string, limit = 8) {
    const q = String(query ?? "").trim();
    const facts = q
      ? this.data.facts
          .map((f) => ({ ...f, score: matches(q, f.text, ...f.tags) }))
          .filter((f) => f.score >= 30)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
      : this.facts(limit);
    const recipients = (q ? this.findRecipients(q, limit) : []).map(({ chatId, ...r }) => ({
      ...r,
      title: publicTitle(r.title, r.type),
    }));
    return { facts, recipients };
  }

  findRecipients(query: string, limit = 8): Array<KnownRecipient & { match: number }> {
    return this.data.recipients
      .map((r) => ({ ...r, match: matches(query, r.title, ...r.aliases, r.chatId) }))
      .filter((r) => r.match >= 40)
      .sort((a, b) => b.match - a.match || b.lastUsed.localeCompare(a.lastUsed))
      .slice(0, limit);
  }

  recipient(provider: string, chatId: string): KnownRecipient | undefined {
    return this.data.recipients.find((r) => r.provider === provider && r.chatId === chatId);
  }

  knownRecipients(limit = 500): KnownRecipient[] {
    return this.data.recipients.slice(-Math.max(1, limit));
  }

  appendTurn(input: {
    role: "user" | "assistant";
    content: string;
    conversationId?: string;
    tools?: string[];
    at?: string;
  }): AssistantTurn | undefined {
    const content = String(input.content ?? "").trim();
    if (!content) return undefined;
    const conversationId = String(input.conversationId ?? "dashboard");
    const last = this.data.turns[this.data.turns.length - 1];
    if (
      last &&
      last.role === input.role &&
      last.conversationId === conversationId &&
      last.content === content &&
      Date.now() - new Date(last.at).getTime() < 5_000
    ) {
      return last;
    }
    const turn: AssistantTurn = {
      id: randomUUID(),
      conversationId,
      role: input.role,
      content: content.slice(0, 4000),
      at: input.at ?? iso(),
      tools: input.tools?.filter(Boolean).slice(0, 20),
    };
    this.data.turns.push(turn);
    this.trim();
    this.persist();
    return turn;
  }

  history(limit = 20, conversationId = "dashboard"): AssistantTurn[] {
    return this.data.turns
      .filter((t) => t.conversationId === conversationId)
      .slice(-Math.max(1, limit));
  }

  clearHistory(conversationId = "dashboard"): number {
    const before = this.data.turns.length;
    this.data.turns = this.data.turns.filter((t) => t.conversationId !== conversationId);
    const removed = before - this.data.turns.length;
    if (removed) this.persist();
    return removed;
  }

  private sessionOf(conversationId: string): EphemeralSession | undefined {
    const session = this.sessions.get(conversationId);
    if (!session) return undefined;
    if (Date.now() - session.at > SESSION_TTL_MS) {
      this.sessions.delete(conversationId);
      return undefined;
    }
    return session;
  }

  rememberTurn(conversationId: string, role: "user" | "assistant", content: string): void {
    const text = String(content ?? "").trim();
    if (!text) return;
    const session = this.sessionOf(conversationId) ?? { at: Date.now(), turns: [] };
    const last = session.turns[session.turns.length - 1];
    if (last && last.role === role && last.content === text.slice(0, 600)) {
      session.at = Date.now();
      this.sessions.set(conversationId, session);
      return;
    }
    session.turns.push({ role, content: text.slice(0, 600), at: Date.now() });
    if (session.turns.length > SESSION_MAX_TURNS) session.turns = session.turns.slice(-SESSION_MAX_TURNS);
    session.at = Date.now();
    this.sessions.set(conversationId, session);
    if (this.sessions.size > 200) {
      const stale = [...this.sessions.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 50);
      for (const [id] of stale) this.sessions.delete(id);
    }
  }

  recentTurns(conversationId: string, limit = 6): EphemeralTurn[] {
    const session = this.sessionOf(conversationId);
    return session ? session.turns.slice(-Math.max(1, limit)) : [];
  }

  setSessionRecipient(
    conversationId: string,
    recipient: { provider: string; chatId: string; title: string; type: string },
  ): void {
    const session = this.sessionOf(conversationId) ?? { at: Date.now(), turns: [] };
    session.lastRecipient = { ...recipient, at: Date.now() };
    session.at = Date.now();
    this.sessions.set(conversationId, session);
  }

  sessionRecipient(conversationId: string): EphemeralSession["lastRecipient"] {
    return this.sessionOf(conversationId)?.lastRecipient;
  }

  clearSession(conversationId: string): void {
    this.sessions.delete(conversationId);
  }

  setPending(input: {
    conversationId: string;
    query: string;
    instruction: string;
    candidates: PendingCandidate[];
    selected?: PendingCandidate;
    text?: string;
    stage: "choose" | "confirm";
    allowGroup?: boolean;
    ttlMs?: number;
  }): PendingSend {
    const now = Date.now();
    const pending: PendingSend = {
      id: randomUUID(),
      conversationId: input.conversationId,
      createdAt: iso(now),
      expiresAt: iso(now + (input.ttlMs ?? 10 * 60_000)),
      query: input.query,
      instruction: input.instruction,
      candidates: input.candidates.slice(0, 8),
      selected: input.selected,
      text: input.text,
      stage: input.stage,
      allowGroup: input.allowGroup,
    };
    this.data.pending[input.conversationId] = pending;
    this.trim();
    this.persist();
    return pending;
  }

  getPending(conversationId: string): PendingSend | undefined {
    const pending = this.data.pending[conversationId];
    if (!pending) return undefined;
    if (new Date(pending.expiresAt).getTime() <= Date.now()) {
      delete this.data.pending[conversationId];
      this.persist();
      return undefined;
    }
    return pending;
  }

  updatePending(conversationId: string, patch: Partial<Omit<PendingSend, "id" | "conversationId" | "createdAt">>): PendingSend | undefined {
    const pending = this.getPending(conversationId);
    if (!pending) return undefined;
    Object.assign(pending, patch);
    pending.expiresAt = iso(Date.now() + 10 * 60_000);
    this.persist();
    return pending;
  }

  clearPending(conversationId: string): boolean {
    if (!this.data.pending[conversationId]) return false;
    delete this.data.pending[conversationId];
    this.persist();
    return true;
  }

  takePending(conversationId: string): PendingSend | undefined {
    const pending = this.getPending(conversationId);
    if (!pending) return undefined;
    delete this.data.pending[conversationId];
    this.persist();
    return pending;
  }

  recordSend(input: {
    provider: string;
    chatId: string;
    title?: string;
    text: string;
    ok: boolean;
    error?: string;
    at?: string;
  }): SendRecord {
    const record: SendRecord = {
      id: randomUUID(),
      at: input.at ?? iso(),
      provider: input.provider,
      chatId: input.chatId,
      title: input.title,
      textHash: hashText(input.text),
      preview: String(input.text ?? "").replace(/\s+/g, " ").slice(0, 160),
      ok: input.ok,
      error: input.error,
    };
    this.data.sends.push(record);
    this.trim();
    this.persist();
    return record;
  }

  sendsSince(sinceMs: number, filter: { provider?: string; chatId?: string; okOnly?: boolean } = {}): SendRecord[] {
    const cutoff = Date.now() - sinceMs;
    return this.data.sends.filter(
      (s) =>
        new Date(s.at).getTime() >= cutoff &&
        (!filter.provider || s.provider === filter.provider) &&
        (!filter.chatId || s.chatId === filter.chatId) &&
        (!filter.okOnly || s.ok),
    );
  }

  hasRecentText(provider: string, chatId: string, text: string, windowMs = 24 * 60 * 60_000): boolean {
    const hash = hashText(text);
    const cutoff = Date.now() - windowMs;
    return this.data.sends.some(
      (s) => s.ok && s.provider === provider && s.chatId === chatId && s.textHash === hash && new Date(s.at).getTime() >= cutoff,
    );
  }

  stats() {
    return {
      facts: this.data.facts.length,
      recipients: this.data.recipients.length,
      turns: this.data.turns.length,
      sends: this.data.sends.length,
    };
  }

  promptContext(query: string, now = Date.now()): string {
    const lines: string[] = [];
    const facts = query
      ? this.data.facts
          .map((f) => ({ ...f, score: matches(query, f.text, ...f.tags) }))
          .filter((f) => f.score >= 30)
          .sort((a, b) => b.score - a.score)
          .slice(0, 6)
      : this.facts(6);
    if (facts.length) {
      lines.push("حافظه‌ی کاربر:");
      for (const f of facts) lines.push(`- ${f.text}`);
    }

    const recipients = query ? this.findRecipients(query, 6) : [];
    if (recipients.length) {
      lines.push("مخاطبان شناخته‌شده (از حافظه):");
      for (const r of recipients) lines.push(`- ${publicTitle(r.title, r.type)} — ${providerLabel(r.provider)}`);
    }

    const recent = this.data.sends.slice(-5).reverse();
    if (recent.length) {
      lines.push("ارسال‌های اخیر (برای پرهیز از تکرار):");
      for (const s of recent) {
        const when = Math.max(0, Math.round((now - new Date(s.at).getTime()) / 60_000));
        lines.push(`- ${when} دقیقه پیش به ${publicTitle(s.title || "مخاطب")} در ${providerLabel(s.provider)}: «${s.preview}»${s.ok ? "" : " (ناموفق)"}`);
      }
    }
    return lines.join("\n").slice(0, 2400);
  }
}
