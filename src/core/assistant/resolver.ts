import type { DibaMcpEngine } from "../engine.js";
import { cleanText, matchName, looksLikePhone } from "./name-match.js";
import { canSendWith, isGroupLike } from "./policy.js";
import { timeValue } from "./text.js";

export type CandidateSource = "chat" | "contact" | "memory" | "search";

export interface ResolvedCandidate {
  provider: string;
  chatId: string;
  title: string;
  type: string;
  username?: string;
  lastText?: string;
  lastAt?: string;
  source: CandidateSource;
  score: number;
  reason: string;
}

export interface Resolution {
  query: string;
  candidates: ResolvedCandidate[];
  best?: ResolvedCandidate;
  confidence: number;
  confident: boolean;
  exact: boolean;
  ambiguous: boolean;
  fallback: boolean;
  sources: CandidateSource[];
  note?: string;
  reason?: string;
}

interface RawCandidate {
  provider: string;
  chatId: string;
  title: string;
  type: string;
  username?: string;
  lastText?: string;
  lastAt?: string;
  source: CandidateSource;
}

const CHAT_TOOL_SPECS: Record<string, Array<{ tool: string; args: Record<string, unknown> }>> = {
  bale_client: [{ tool: "bale_client_get_dialogs", args: { limit: 100 } }],
  eitaa_client: [{ tool: "eitaa_client_get_chats", args: { limit: 100 } }],
  rubika_client: [{ tool: "rubika_client_get_chats", args: { limit: 100 } }],
  soroush_client: [{ tool: "soroush_client_get_chats", args: { limit: 100 } }],
  telegram_client: [{ tool: "telegram_client_get_chats", args: { limit: 100 } }],
  whatsapp: [{ tool: "whatsapp_get_chats", args: { limit: 100 } }],
  instagram: [{ tool: "instagram_list_chats", args: { limit: 20 } }],
};

const CONTACT_TOOL_SPECS: Record<string, Array<{ tool: string; args: Record<string, unknown> }>> = {
  whatsapp: [
    { tool: "whatsapp_get_contacts", args: { limit: 300 } },
    { tool: "whatsapp_find_contact", args: {} },
  ],
};

const CHAT_CACHE_MS = 60_000;
const CONTACT_CACHE_MS = 120_000;
const TOOL_TIMEOUT_MS = 8_000;

interface ResolverCaches {
  chats: Map<string, { at: number; items: RawCandidate[] }>;
  contacts: Map<string, { at: number; items: RawCandidate[] }>;
  names: Map<string, { at: number; name: string }>;
}

const cachesByEngine = new WeakMap<object, ResolverCaches>();

function cachesOf(engine: DibaMcpEngine): ResolverCaches {
  let caches = cachesByEngine.get(engine);
  if (!caches) {
    caches = { chats: new Map(), contacts: new Map(), names: new Map() };
    cachesByEngine.set(engine, caches);
  }
  return caches;
}

export function clearResolverCache(engine: DibaMcpEngine, provider?: string): void {
  const caches = cachesOf(engine);
  if (!provider) {
    caches.chats.clear();
    caches.contacts.clear();
    caches.names.clear();
    return;
  }
  caches.chats.delete(provider);
  for (const key of [...caches.contacts.keys()]) if (key.startsWith(`${provider}:`)) caches.contacts.delete(key);
  for (const key of [...caches.names.keys()]) if (key.startsWith(`${provider}:`)) caches.names.delete(key);
}

function asArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  for (const key of ["chats", "dialogs", "contacts", "matches", "users", "result", "data"]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function typeOf(raw: any): string {
  const value = raw?.type ?? raw?.chat_type ?? raw?.chatType ?? "unknown";
  if (typeof value === "number") {
    return value === 1 || value === 4 ? "private" : value === 2 ? "group" : value === 3 ? "channel" : "unknown";
  }
  return String(value || "unknown").toLowerCase();
}

function toCandidate(provider: string, raw: any, source: CandidateSource): RawCandidate | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const chatId = String(raw.chat_id ?? raw.chatId ?? raw.id ?? raw.jid ?? raw.peer_id ?? "").trim();
  if (!chatId) return undefined;
  const usernameRaw = raw.username ? String(raw.username).replace(/^@+/, "") : "";
  const title = String(
    raw.title ?? raw.name ?? raw.full_name ?? raw.notify ?? raw.push_name ?? (usernameRaw ? `@${usernameRaw}` : chatId),
  ).trim();
  return {
    provider,
    chatId,
    title: title || chatId,
    type: typeOf(raw),
    username: usernameRaw ? `@${usernameRaw}` : undefined,
    lastText: raw.last_message ?? raw.lastMessage ?? raw.last_text ?? raw.text,
    lastAt: raw.last_date ?? raw.lastAt ?? raw.last_message_at ?? raw.lastMessageAt ?? raw.timestamp ?? raw.date,
    source,
  };
}

function withTimeout<T>(promise: Promise<T>, ms = TOOL_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

const NAME_CACHE_MS = 10 * 60_000;
const NAME_LOOKUP_LIMIT = 10;

function nameFromPayload(payload: unknown, chatId: string, depth = 0): string | undefined {
  if (!payload || typeof payload !== "object" || depth > 2) return undefined;
  const record = payload as Record<string, unknown>;

  const clean = (value: unknown): string => {
    const text = String(value ?? "").trim();
    if (!text || text.length > 80) return "";
    if (text === chatId) return "";
    if (/^[\d\s@._+\-|:]+$/.test(text)) return "";
    return text;
  };

  for (const key of ["name", "title", "full_name", "fullName", "display_name", "displayName", "push_name", "verified_name", "notify"]) {
    const value = clean(record[key]);
    if (value) return value;
  }
  const first = clean(record.first_name ?? record.firstName);
  if (first) {
    const last = clean(record.last_name ?? record.lastName);
    return last ? `${first} ${last}` : first;
  }
  const username = clean(record.username);
  if (username) return username.startsWith("@") ? username : `@${username}`;

  for (const value of Object.values(record)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const found = nameFromPayload(value, chatId, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

async function enrichNames(
  engine: DibaMcpEngine,
  providerId: string,
  items: Array<{ chatId: string; title?: string; username?: string }>,
): Promise<void> {
  const anonymous = items
    .filter((item) => isPlaceholderTitle(item.title ?? "", item.chatId))
    .slice(0, NAME_LOOKUP_LIMIT);
  if (!anonymous.length) return;
  const provider = engine.provider(providerId);
  const tool = provider?.tools.find((candidate) => candidate.name === `${providerId}_get_chat`);
  const nameCache = cachesOf(engine).names;

  await Promise.all(
    anonymous.map(async (item) => {
      const key = `${providerId}:${item.chatId}`;
      const cached = nameCache.get(key);
      if (cached && Date.now() - cached.at < NAME_CACHE_MS) {
        if (cached.name) item.title = cached.name;
        return;
      }

      let name: string | undefined;
      if (tool) {
        try {
          const result = await withTimeout(engine.callTool(tool.name, { chat_id: item.chatId }, "dashboard"));
          if (result.ok) name = nameFromPayload(result.result, item.chatId);
        } catch {
        }
      }
      if (!name && item.username) name = item.username;
      nameCache.set(key, { at: Date.now(), name: name ?? "" });
      if (name) item.title = name;
    }),
  );
}

export async function enrichChatTitles<T extends { provider: string; chatId: string; title?: string; username?: string }>(
  engine: DibaMcpEngine,
  chats: T[],
): Promise<T[]> {
  const grouped = new Map<string, T[]>();
  for (const chat of chats) {
    const list = grouped.get(chat.provider) ?? [];
    list.push(chat);
    grouped.set(chat.provider, list);
  }
  await Promise.all([...grouped.entries()].map(([providerId, list]) => enrichNames(engine, providerId, list)));
  return chats;
}

function fromInbox(engine: DibaMcpEngine, provider?: string): RawCandidate[] {
  return engine.inbox.chats(provider).map((chat) => ({
    provider: chat.provider,
    chatId: chat.chatId,
    title: chat.title || chat.chatId,
    type: chat.type,
    lastText: chat.lastText,
    lastAt: chat.lastDate,
    source: "chat" as const,
  }));
}

async function liveChats(engine: DibaMcpEngine, providerId: string): Promise<RawCandidate[]> {
  const chatCache = cachesOf(engine).chats;
  const cached = chatCache.get(providerId);
  if (cached && Date.now() - cached.at < CHAT_CACHE_MS) return cached.items;
  const provider = engine.provider(providerId);
  if (!provider) return [];
  const toolNames = new Set(provider.tools.map((tool) => tool.name));
  const specs = (CHAT_TOOL_SPECS[providerId] ?? []).filter((spec) => toolNames.has(spec.tool));
  const items: RawCandidate[] = [];
  const results = await Promise.allSettled(
    specs.map((spec) => withTimeout(engine.callTool(spec.tool, spec.args, "dashboard"))),
  );
  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value.ok) continue;
    for (const raw of asArray(result.value.result)) {
      const candidate = toCandidate(providerId, raw, "chat");
      if (candidate) items.push(candidate);
    }
  }
  chatCache.set(providerId, { at: Date.now(), items });
  return items;
}

async function serviceContacts(engine: DibaMcpEngine, providerId: string, query: string): Promise<RawCandidate[]> {
  const provider = engine.provider(providerId);
  if (!provider) return [];
  const toolNames = new Set(provider.tools.map((tool) => tool.name));
  const specs = (CONTACT_TOOL_SPECS[providerId] ?? []).filter((spec) => toolNames.has(spec.tool));
  if (!specs.length) return [];
  const contactCache = cachesOf(engine).contacts;
  const items: RawCandidate[] = [];
  for (const spec of specs) {
    const cacheKey = `${providerId}:${spec.tool}`;
    const cached = contactCache.get(cacheKey);
    const usesQuery = Object.keys(spec.args).length === 0;
    if (!usesQuery && cached && Date.now() - cached.at < CONTACT_CACHE_MS) {
      items.push(...cached.items);
      continue;
    }
    const args = usesQuery ? { ...spec.args, query } : spec.args;
    try {
      const result = await withTimeout(engine.callTool(spec.tool, args, "dashboard"));
      if (!result.ok) continue;
      const list = asArray(result.result)
        .map((raw) => toCandidate(providerId, raw, "contact"))
        .filter(Boolean) as RawCandidate[];
      items.push(...list);
      if (!usesQuery) contactCache.set(cacheKey, { at: Date.now(), items: list });
    } catch {
    }
  }
  return items;
}

function memoryCandidates(engine: DibaMcpEngine, provider?: string): RawCandidate[] {
  return engine.memory
    .knownRecipients(800)
    .filter((r) => !provider || r.provider === provider)
    .map((r) => ({
      provider: r.provider,
      chatId: r.chatId,
      title: r.title,
      type: r.type ?? "unknown",
      username: r.aliases.find((alias) => alias.startsWith("@")),
      lastAt: r.lastUsed,
      source: "memory" as const,
    }));
}

async function directSearch(engine: DibaMcpEngine, providerId: string, query: string): Promise<RawCandidate[]> {
  const provider = engine.provider(providerId);
  if (!provider) return [];
  const toolNames = new Set(provider.tools.map((tool) => tool.name));
  const items: RawCandidate[] = [];
  try {
    if (looksLikePhone(query) && toolNames.has("whatsapp_resolve_contact")) {
      const digits = cleanText(query).replace(/\D/g, "");
      const result = await withTimeout(engine.callTool("whatsapp_resolve_contact", { phone: digits }, "dashboard"));
      if (result.ok) {
        const candidate = toCandidate(providerId, result.result, "search");
        if (candidate) items.push({ ...candidate, title: candidate.title || cleanText(query) });
      }
    }
  } catch {
  }
  return items;
}

function isPlaceholderTitle(title: string, chatId: string): boolean {
  const text = String(title ?? "").trim();
  if (!text) return true;
  if (text === String(chatId ?? "")) return true;
  return /^[\d\s@._+\-|]+$/.test(text);
}

function dedupe(items: RawCandidate[]): RawCandidate[] {
  const map = new Map<string, RawCandidate>();
  for (const item of items) {
    const key = `${item.provider}:${item.chatId}`;
    const previous = map.get(key);
    if (!previous) {
      map.set(key, item);
      continue;
    }
    const title =
      isPlaceholderTitle(previous.title, previous.chatId) && !isPlaceholderTitle(item.title, item.chatId)
        ? item.title
        : previous.title || item.title;
    const newer = timeValue(item.lastAt) > timeValue(previous.lastAt) ? item : previous;
    map.set(key, {
      ...previous,
      title,
      username: previous.username || item.username,
      lastText: newer.lastText ?? previous.lastText ?? item.lastText,
      lastAt: newer.lastAt ?? previous.lastAt ?? item.lastAt,
      type: previous.type !== "unknown" ? previous.type : item.type,
      source: sourceRank(previous.source) <= sourceRank(item.source) ? previous.source : item.source,
    });
  }
  return [...map.values()];
}

function sourceRank(source: CandidateSource): number {
  return { memory: 0, chat: 1, contact: 2, search: 3 }[source];
}

function scoreOf(candidate: RawCandidate, query: string, allowGroup: boolean): { score: number; reason: string } {
  const match = matchName(query, [candidate.title, candidate.username]);
  let score = match.score;
  let reason = match.reason;
  const digits = cleanText(query).replace(/\D/g, "");
  if (digits.length >= 6) {
    const haystack = `${candidate.chatId} ${candidate.title}`.replace(/\D/g, "");
    if (haystack.includes(digits) && score < 95) {
      score = 95;
      reason = "digits";
    }
  }
  if (!score) return { score: 0, reason: "" };

  if (candidate.source === "memory") score += 6;
  else if (candidate.source === "chat") score += 4;
  else if (candidate.source === "contact") score += 3;
  if (candidate.lastAt) {
    const age = Date.now() - timeValue(candidate.lastAt);
    if (age >= 0 && age < 24 * 60 * 60_000) score += 4;
    else if (age >= 0 && age < 7 * 24 * 60 * 60_000) score += 2;
  }
  if (isGroupLike(candidate.type) && !allowGroup) score -= 25;
  return { score: Math.max(0, Math.min(100, score)), reason };
}

export async function listChatCandidates(engine: DibaMcpEngine, providerId: string): Promise<ResolvedCandidate[]> {
  const live = await liveChats(engine, providerId);
  const merged = dedupe([...fromInbox(engine, providerId), ...live]);
  await enrichNames(engine, providerId, merged);
  return merged
    .sort((a, b) => timeValue(b.lastAt) - timeValue(a.lastAt))
    .map((candidate) => ({ ...candidate, score: 0, reason: "" }));
}

export interface ResolveOptions {
  provider?: string;
  allowGroup?: boolean;
  limit?: number;
  sendableOnly?: boolean;
  force?: boolean;
}

export async function resolveRecipient(
  engine: DibaMcpEngine,
  query: string,
  opts: ResolveOptions = {},
): Promise<Resolution> {
  const clean = cleanText(query);
  const allowGroup = opts.allowGroup === true;
  if (!clean) {
    return {
      query: clean,
      candidates: [],
      confidence: 0,
      confident: false,
      exact: false,
      ambiguous: false,
      fallback: false,
      sources: [],
      reason: "نام مخاطب خالی است.",
    };
  }
  if (opts.force) clearResolverCache(engine, opts.provider);

  const providers = engine
    .describeProviders()
    .filter((p) => p.ready && (!opts.provider || p.id === opts.provider) && (!opts.sendableOnly || canSendWith(p.id)))
    .map((p) => p.id);

  const pool: RawCandidate[] = [...memoryCandidates(engine, opts.provider), ...fromInbox(engine, opts.provider)];
  const live = await Promise.all(providers.map((id) => liveChats(engine, id)));
  for (const list of live) pool.push(...list);
  if (providers.length <= 3) {
    const contacts = await Promise.all(providers.map((id) => serviceContacts(engine, id, clean)));
    for (const list of contacts) pool.push(...list);
    const searched = await Promise.all(providers.map((id) => directSearch(engine, id, clean)));
    for (const list of searched) pool.push(...list);
  }

  const scoped = dedupe(pool).filter((candidate) => providers.includes(candidate.provider));
  const rank = (): ResolvedCandidate[] =>
    scoped
      .map((candidate) => {
        const { score, reason } = scoreOf(candidate, clean, allowGroup);
        return { ...candidate, score, reason };
      })
      .filter((candidate) => candidate.score >= 45)
      .sort((a, b) => b.score - a.score || timeValue(b.lastAt) - timeValue(a.lastAt));

  let scored = rank();
  if (!scored.length || (scored[0]?.score ?? 0) < 88) {
    const grouped = new Map<string, RawCandidate[]>();
    for (const candidate of scoped) {
      const list = grouped.get(candidate.provider) ?? [];
      list.push(candidate);
      grouped.set(candidate.provider, list);
    }
    await Promise.all([...grouped.entries()].map(([providerId, list]) => enrichNames(engine, providerId, list)));
    scored = rank();
  }

  let top = scored.slice(0, Math.max(1, opts.limit ?? 8));
  let fallback = false;
  let note: string | undefined;
  if (!top.length) {
    fallback = true;
    top = dedupe(pool)
      .filter((candidate) => (allowGroup || !isGroupLike(candidate.type)) && providers.includes(candidate.provider))
      .sort((a, b) => timeValue(b.lastAt) - timeValue(a.lastAt))
      .slice(0, 6)
      .map((candidate) => ({ ...candidate, score: 20, reason: "nearby" }));
    if (top.length) note = "نام دقیقی پیدا نشد؛ نزدیک‌ترین چت‌های اخیر را می‌آورم.";
  }

  const best = top[0];
  const second = top[1];
  const gap = best ? best.score - (second?.score ?? 0) : 0;
  const exact = Boolean(best && best.score >= 96);
  const confident = Boolean(best && !fallback && best.score >= 88 && (gap >= 8 || !second));
  const ambiguous = !fallback && top.length > 1 && !confident;
  const sources = [...new Set(top.map((candidate) => candidate.source))];
  const reason = !best
    ? "مخاطبی با این نام/شناسه پیدا نشد."
    : fallback
      ? "مخاطبی با این نام پیدا نشد؛ نزدیک‌ترین چت‌های اخیر را نشان می‌دهم."
      : ambiguous
        ? "چند مخاطب نزدیک پیدا شد؛ باید یکی انتخاب شود."
        : !confident
          ? "تطبیق نام با اطمینان کافی انجام نشد."
          : undefined;

  return {
    query: clean,
    candidates: top,
    best,
    confidence: fallback ? 0 : confident ? best?.score ?? 0 : Math.min(best?.score ?? 0, 70),
    confident,
    exact,
    ambiguous,
    fallback,
    sources,
    note,
    reason,
  };
}
