/**
 * مدیریت، خلاصه‌سازی و کنترل سقف کانتکست برای ارسال به مدل (DibaRouter / Agent Chat).
 * هدف: جلوگیری از خطای Context Limit در مدل‌های کوچک (مثل 8192 توکن) و حفظ اطلاعات کلیدی.
 */

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface CompactHistoryResult {
  summary?: string;
  messages: ChatTurn[];
  compacted: boolean;
  stats: {
    originalCount: number;
    originalChars: number;
    finalChars: number;
  };
}

const NOISY_KEYS = new Set([
  "raw",
  "bytes",
  "base64",
  "dataurl",
  "cookies",
  "constants",
  "file_reference",
  "access_hash",
  "sizes",
  "reply_markup",
  "entities",
]);

function truncateText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function extractIdentifiers(text: string): string[] {
  const found = new Set<string>();
  const matches = text.match(/(?:@[A-Za-z0-9_]{2,32}|-?\d{5,18}|[a-z]+_[a-z0-9_]+)/g) ?? [];
  for (const m of matches) {
    found.add(m);
    if (found.size >= 4) break;
  }
  return [...found];
}

/**
 * تخمین محافظه‌کارانه تعداد توکن‌ها:
 * کاراکترهای غیرلاتین (فارسی/عربی) معمولاً ~۱.۵ کاراکتر بر توکن و لاتین ~۳.۵ کاراکتر بر توکن هستند.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let nonAscii = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) nonAscii++;
  }
  const ascii = text.length - nonAscii;
  return Math.ceil(ascii / 3.4 + nonAscii / 1.45);
}

export function estimateRequestTokens(messages: unknown[], tools: unknown[] = []): number {
  let total = 0;
  for (const m of messages) {
    total += 6 + estimateTokens(JSON.stringify(m));
  }
  if (tools.length) {
    total += 24 + estimateTokens(JSON.stringify(tools));
  }
  return total;
}

/**
 * تشخیص خطای سرریز کانتکست از پیام خطای مدل/روتر و استخراج سقف توکن در صورت وجود.
 */
export function isContextLimitError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? "");
  return /exceeds the available context size|context.?length|maximum context|too many tokens|context_length_exceeded|prompt is too long|max_tokens.*exceed/i.test(
    msg,
  );
}

export function extractContextLimit(err: unknown): number | undefined {
  const msg = String((err as any)?.message ?? err ?? "");
  const m =
    msg.match(/available context size\s*\((\d+)\s*tokens?\)/i) ??
    msg.match(/maximum context length is\s*(\d+)/i) ??
    msg.match(/context(?:_length| size)[^\d]{0,15}(\d{3,6})/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 512 ? n : undefined;
}

export function summarizeContextError(err: unknown): string {
  const msg = String((err as any)?.message ?? err ?? "");
  const limit = extractContextLimit(msg);
  const reqMatch = msg.match(/request\s*\((\d+)\s*tokens?\)/i);
  const reqTokens = reqMatch ? Number(reqMatch[1]) : undefined;
  if (limit && reqTokens) {
    return `حجم پیام و ابزارها (${reqTokens} توکن) از سقف حافظه‌ی این مدل (${limit} توکن) بیشتر شد. گفتگو خلاصه شد؛ لطفاً دوباره ارسال کنید یا در تب «دیبا روتر» مدل با کانتکست بزرگ‌تر انتخاب کنید.`;
  }
  if (limit) {
    return `حجم کانتکست از سقف این مدل (${limit} توکن) بیشتر شد. لطفاً گفتگوی کوتاه‌تری بفرستید یا مدل دیگری انتخاب کنید.`;
  }
  return "حجم پیام یا خروجی ابزارها از سقف کانتکست مدل بیشتر شد. لطفاً یک گفتگوی تازه یا کوتاه‌تر ارسال کنید.";
}

/**
 * تاریخچه‌ی گفتگو را در صورت طولانی شدن فشرده می‌کند:
 * ۶ پیام آخر را کامل‌تر نگه می‌دارد و پیام‌های قدیمی‌تر را به یک خلاصه‌ی نکته‌ای تبدیل می‌کند.
 */
export function compactConversation(
  rawMessages: unknown,
  opts: {
    keepRecent?: number;
    maxHistoryChars?: number;
    maxMessageChars?: number;
    maxSummaryChars?: number;
  } = {},
): CompactHistoryResult {
  const keepRecent = opts.keepRecent ?? 6;
  const maxHistoryChars = opts.maxHistoryChars ?? 4500;
  const maxMessageChars = opts.maxMessageChars ?? 1600;
  const maxSummaryChars = opts.maxSummaryChars ?? 1000;

  const list = Array.isArray(rawMessages) ? rawMessages : [];
  const normalized: ChatTurn[] = [];
  let originalChars = 0;

  for (const item of list) {
    const role = (item as any)?.role;
    const rawContent = (item as any)?.content;
    if ((role !== "user" && role !== "assistant") || typeof rawContent !== "string") continue;
    const content = rawContent.trim();
    if (!content) continue;
    originalChars += content.length;
    normalized.push({ role, content });
  }

  const recentRaw = normalized.slice(-keepRecent);
  const olderRaw = normalized.slice(0, Math.max(0, normalized.length - keepRecent));

  const trimmedAll = normalized.map((m) => ({
    role: m.role,
    content: truncateText(m.content, maxMessageChars),
  }));
  const trimmedTotal = trimmedAll.reduce((sum, m) => sum + m.content.length, 0);

  if (olderRaw.length === 0 && trimmedTotal <= maxHistoryChars) {
    return {
      messages: trimmedAll,
      compacted: false,
      stats: { originalCount: normalized.length, originalChars, finalChars: trimmedTotal },
    };
  }

  const recent: ChatTurn[] = [];
  let usedChars = 0;
  const recentBudget = Math.max(1200, maxHistoryChars - maxSummaryChars);
  for (let i = recentRaw.length - 1; i >= 0; i--) {
    const item = recentRaw[i];
    const text = truncateText(item.content, maxMessageChars);
    if (recent.length > 0 && usedChars + text.length > recentBudget) {
      olderRaw.push(item);
      continue;
    }
    recent.unshift({ role: item.role, content: text });
    usedChars += text.length;
  }

  const bullets: string[] = [];
  let summaryChars = 0;
  for (const m of olderRaw) {
    const who = m.role === "user" ? "کاربر" : "دستیار";
    const snippet = truncateText(m.content, 110);
    const ids = extractIdentifiers(m.content);
    const idNote = ids.length ? ` [${ids.join("، ")}]` : "";
    const line = `- ${who}: ${snippet}${idNote}`;
    if (summaryChars + line.length + 1 > maxSummaryChars) break;
    bullets.push(line);
    summaryChars += line.length + 1;
  }

  const omitted = olderRaw.length - bullets.length;
  const header =
    omitted > 0
      ? `خلاصه‌ی ${bullets.length} پیام قبلی (${omitted} پیام قدیمی‌تر حذف شد):`
      : `خلاصه‌ی پیام‌های قبلی:`;
  const summary = bullets.length ? `${header}\n${bullets.join("\n")}` : undefined;
  const finalChars = usedChars + (summary?.length ?? 0);

  return {
    summary,
    messages: recent,
    compacted: Boolean(summary) || finalChars < originalChars,
    stats: {
      originalCount: normalized.length,
      originalChars,
      finalChars,
    },
  };
}

function compactSchemaNode(node: any): any {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(compactSchemaNode);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "$schema" || k === "$id" || k === "title" || k === "additionalProperties" || k === "default") continue;
    if (k === "description" && typeof v === "string") {
      out[k] = truncateText(v, 55);
      continue;
    }
    out[k] = compactSchemaNode(v);
  }
  return out;
}

const PROVIDER_KEYWORDS: Record<string, string[]> = {
  bale: ["bale", "بله"],
  bale_client: ["bale", "بله"],
  eitaa: ["eitaa", "ایتا", "ایتایار"],
  eitaa_client: ["eitaa", "ایتا"],
  rubika: ["rubika", "روبیکا"],
  rubika_client: ["rubika", "روبیکا"],
  soroush: ["soroush", "سروش"],
  soroush_client: ["soroush", "سروش"],
  telegram: ["telegram", "تلگرام"],
  telegram_client: ["telegram", "تلگرام"],
  whatsapp: ["whatsapp", "واتساپ", "واتس‌اپ", "واتس"],
  instagram: ["instagram", "اینستاگرام", "اینستا"],
  linkedin: ["linkedin", "لینکدین"],
  x: ["twitter", "ایکس", "توییتر"],
};

/**
 * ابزارها را متناسب با پیام کاربر و بودجه توکن انتخاب و اسکیمای آن‌ها را فشرده می‌کند
 * تا مدل‌های با کانتکست 8192 سرریز نکنند.
 *
 * قواعد مهم:
 *  - `list_services` و `list_chats` همیشه در فهرست هستند تا مدل وضعیت را حدس نزند.
 *  - ابزارهای نوشتنی فقط وقتی درخواست ارسال/ویرایش/حذف صریح باشد وارد می‌شوند.
 *  - ابزارهای خطرناک (حذف/خروج/بن) فقط با درخواست صریح حذف/خروج.
 *  - اگر سرویسی در پیام نام برده شده، ابزارهای همان سرویس اولویت می‌گیرند.
 */
const META_TOOL_NAMES = new Set([
  "list_services",
  "list_chats",
  "memory_search",
  "memory_remember",
  "resolve_recipient",
  "send_message_to",
]);
const WRITE_TOOL_RE =
  /(^|_)(send|post|publish|upload|create|add|invite|join|leave|delete|remove|kick|ban|promote|demote|edit|set|update|mark_read|archive|pin|react|reply|forward|share|logout|login|rotate)(_|$)/;
const DESTRUCTIVE_TOOL_RE = /(delete|remove|leave|kick|ban|demote|clear|reset|drop|logout|revoke|archive)/;
const READ_TOOL_RE = /(^|_)(get|list|find|resolve|search|inspect|info|chats|history|messages|contacts|members|session|updates)(_|$)/;

function providerPrefixOf(name: string): string {
  let best = "";
  for (const key of Object.keys(PROVIDER_KEYWORDS)) {
    if (name.startsWith(`${key}_`) && key.length > best.length) best = key;
  }
  return best;
}

export function selectAndCompactTools<T extends { type: "function"; function: { name: string; description?: string; parameters?: any } }>(
  tools: T[],
  userText: string,
  opts: { maxTools?: number; maxToolTokens?: number; blockDirectSend?: boolean } = {},
): T[] {
  const maxTools = opts.maxTools ?? 24;
  const maxToolTokens = opts.maxToolTokens ?? 2600;
  const query = userText.toLowerCase();

  const wantsSend =
    /(بفرست|بفرستم|ارسال|پیام بده|پیام بفرست|send|post|publish|share|forward|reply|منتشر|آپلود|upload)/.test(query);
  const wantsCreate = /(بساز|ایجاد|ساخت|اضافه|عضو|دعوت|create|new|add|invite|join)/.test(query);
  const wantsEdit = /(ویرایش|تغییر|اصلاح|edit|update|set|rename|pin|archive|mark|read)/.test(query);
  const wantsDestructive =
    /(حذف|پاک|بیرون|اخراج|بن|بلاک|مسدود|غیرفعال|خروج|leave|delete|remove|kick|ban|logout|revoke|clear)/.test(query);
  const wantsStatus = /(وضعیت|آماده|سرویس|اتصال|متصل|سلامت|ready|status|health|connection|چه خبر)/.test(query);
  const wantsChats = /(چت|گفتگو|مخاطب|لیست|فهرست|chat|contact|inbox|گروه|کانال)/.test(query);
  const wantsProfile = /(پروفایل|حساب|من کی|profile|account)/.test(query);
  const wantsMemory = /(یادت|حافظه|قبلاً|قبلا|به یاد|ذخیره|فراموش|اسم من|نام من|یادت باشه|به خاطر بسپار)/.test(query);
  const allowWrites = wantsSend || wantsCreate || wantsEdit || wantsDestructive;
  const hasHighLevelSend = tools.some((t) => t.function.name === "send_message_to");
  // اگر کاربر خودش chat_id/یوزرنیم داده، ابزار سطح‌پایین هم مجاز است
  const explicitTarget = /(?:^|\s)@[A-Za-z0-9_]{3,}|-?\d{5,}|\|/.test(userText);

  // سلام/تشکر ساده نیازی به ابزار ندارد
  const plainGreeting = /^(سلام|درود|وقت بخیر|صبح بخیر|شب بخیر|hi|hello|hey|thanks|ممنون|مرسی)[!؟.،\s]*$/i.test(userText.trim());
  if (plainGreeting) return [];

  const mentionedPlatforms = new Set<string>();
  for (const [key, kws] of Object.entries(PROVIDER_KEYWORDS)) {
    if (kws.some((kw) => query.includes(kw))) mentionedPlatforms.add(key.replace(/_client$/, ""));
  }

  const scored: Array<{ tool: T; score: number; index: number; platform: string }> = [];
  tools.forEach((t, index) => {
    const name = t.function.name.toLowerCase();
    const prefix = providerPrefixOf(name);
    const platform = prefix.replace(/_client$/, "");
    const isMeta = META_TOOL_NAMES.has(name);
    const isWrite = WRITE_TOOL_RE.test(name);
    const isDestructive = DESTRUCTIVE_TOOL_RE.test(name);
    const isSend = /(send_|post|publish|upload|share|forward|reply)/.test(name);
    const isEdit = /(edit|update|set|mark|pin|archive|rename)/.test(name);
    const isCreate = /(add|invite|join|create)/.test(name);

    // برای ارسال به «نام مخاطب» از ابزار سطح‌بالا استفاده کن، نه انتخاب دستی chat_id
    const directTextSend = /(?:^|_)(?:send_message|send_msg|send_dm|send_text)$/.test(name);
    if (hasHighLevelSend && !explicitTarget && directTextSend) return;
    // در دستیار داشبورد ارسال مستقیم متن ممنوع است؛ فقط مسیر آماده‌سازی/تأیید
    if (opts.blockDirectSend && directTextSend) return;
    // ابزار سطح‌بالای ارسال فقط وقتی کاربر ارسال خواسته باشد
    if (name === "send_message_to" && !wantsSend) return;

    if (!isMeta) {
      // ابزار نوشتنی فقط با درخواست متناسب با همان نوع کار
      if (isWrite) {
        if (isDestructive) {
          if (!wantsDestructive) return;
        } else if (isSend) {
          if (!wantsSend) return;
        } else if (isEdit) {
          if (!wantsEdit) return;
        } else if (isCreate) {
          if (!wantsCreate && !wantsEdit) return;
        } else if (!allowWrites) {
          return;
        }
        // اگر سرویس مشخصی نام برده شده، ارسال/تغییر از سرویس دیگر را نشان نده
        if (mentionedPlatforms.size && platform && !mentionedPlatforms.has(platform)) return;
      }
    }

    let score = 0;
    if (name === "list_services") score += 220;
    else if (name === "list_chats") score += 140;
    else if (name === "send_message_to") score += wantsSend ? 150 : 0;
    else if (name === "resolve_recipient") score += wantsSend ? 90 : wantsChats ? 20 : 0;
    else if (name === "memory_search") score += wantsMemory ? 80 : 10;
    else if (name === "memory_remember") score += wantsMemory ? 60 : 0;
    else {
      if (platform && mentionedPlatforms.has(platform)) score += 60;
      if (wantsStatus && /(get_me|get_session)/.test(name)) score += 8;
      if (wantsChats && /(list_chats|get_chats|get_dialogs|get_contacts|find_contact|resolve_contact|get_chat$|get_messages)/.test(name)) score += 30;
      if (wantsProfile && /(get_me|get_user|get_session|get_profile)/.test(name)) score += 25;
      if (wantsSend && isSend) score += 40;
      if (wantsCreate && isCreate) score += 30;
      if (wantsEdit && isEdit) score += 25;
      if (wantsDestructive && isDestructive) score += 40;
      if (READ_TOOL_RE.test(name)) score += 5;
    }
    scored.push({ tool: t, score, index, platform });
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  const selected: T[] = [];
  const usedNames = new Set<string>();
  const counts = new Map<string, number>();
  let usedTokens = 24;

  const push = (tool: T, force = false) => {
    const name = tool.function.name;
    if (usedNames.has(name)) return;
    const compact = {
      type: "function" as const,
      function: {
        name,
        description: truncateText(tool.function.description || "", 75),
        parameters: compactSchemaNode(tool.function.parameters ?? { type: "object", properties: {} }),
      },
    } as T;
    const cost = estimateTokens(JSON.stringify(compact));
    if (!force && selected.length > 0 && usedTokens + cost > maxToolTokens) return;
    selected.push(compact);
    usedNames.add(name);
    usedTokens += cost;
    const lower = name.toLowerCase();
    if (!META_TOOL_NAMES.has(lower)) {
      const platform = providerPrefixOf(lower).replace(/_client$/, "");
      if (platform) counts.set(platform, (counts.get(platform) ?? 0) + 1);
    }
  };

  // ۱) ابزارهای سیستمی/سطح‌بالا همیشه و حتی اگر بودجه تنگ باشد
  const forceNames = ["list_services", "list_chats"];
  if (wantsSend) forceNames.push("send_message_to", "resolve_recipient");
  if (wantsMemory) forceNames.push("memory_search");
  for (const name of forceNames) {
    const t = tools.find((x) => x.function.name === name);
    if (t) push(t, true);
  }

  // ۲) بقیه‌ی ابزارها با سقف هر پلتفرم
  for (const item of scored) {
    if (selected.length >= maxTools) break;
    if (META_TOOL_NAMES.has(item.tool.function.name.toLowerCase())) continue;
    const limit = mentionedPlatforms.size ? (mentionedPlatforms.has(item.platform) ? 12 : 1) : 3;
    if (item.platform && (counts.get(item.platform) ?? 0) >= limit) continue;
    push(item.tool);
  }
  return selected;
}

/**
 * کل آرایه‌ی پیام‌ها + ابزارها را پیش از فراخوانی مدل به سقف توکن ایمن می‌رساند.
 * پیام‌های قدیمی‌تر ابزارها یا تاریخچه را فشرده می‌کند، اما سیستم‌پرامپت و آخرین پیام کاربر را حفظ می‌کند.
 */
export function fitContextToBudget<M extends { role: string; content?: string; tool_calls?: unknown }>(
  messages: M[],
  tools: any[],
  maxInputTokens = 5600,
): { messages: M[]; tools: any[]; trimmed: boolean } {
  let msgs = messages.map((m) => ({ ...m }));
  let activeTools = tools.slice();
  let trimmed = false;

  if (estimateRequestTokens(msgs, activeTools) <= maxInputTokens) {
    return { messages: msgs, tools: activeTools, trimmed: false };
  }

  // ۱. کوتاه کردن خروجی ابزارها (قدیمی‌ترها به ۳۰۰ کاراکتر، و در صورت نیاز آخرین خروجی ابزار به ۶۰۰ کاراکتر)
  for (let i = 1; i < msgs.length - 1; i++) {
    const limit = i < msgs.length - 2 ? 300 : 800;
    if (msgs[i].role === "tool" && typeof msgs[i].content === "string" && msgs[i].content!.length > limit) {
      msgs[i].content = truncateText(msgs[i].content!, limit);
      trimmed = true;
    }
    if (estimateRequestTokens(msgs, activeTools) <= maxInputTokens) {
      return { messages: msgs, tools: activeTools, trimmed };
    }
  }

  // ۲. کاهش تعداد ابزارها در صورت نیاز
  while (activeTools.length > 6 && estimateRequestTokens(msgs, activeTools) > maxInputTokens) {
    activeTools = activeTools.slice(0, Math.max(6, Math.floor(activeTools.length * 0.6)));
    trimmed = true;
  }

  // ۳. حذف پیام‌های غیرسیستمی قدیمی (به جز آخرین پیام)
  while (msgs.length > 2 && estimateRequestTokens(msgs, activeTools) > maxInputTokens) {
    msgs.splice(1, 1);
    trimmed = true;
  }

  // ۴. اگر هنوز از سقف بالاتر است، ابزارها را خالی کن تا مدل حداقل پاسخ متنی بدهد
  if (activeTools.length && estimateRequestTokens(msgs, activeTools) > maxInputTokens) {
    activeTools = [];
    trimmed = true;
  }

  // ۵. آخرین لایه: کوتاه کردن سیستم‌پرامپت/پیام‌های بلند
  if (estimateRequestTokens(msgs, activeTools) > maxInputTokens && msgs[0]?.content && msgs[0].content.length > 900) {
    msgs[0].content = truncateText(msgs[0].content, 900);
    trimmed = true;
  }

  return { messages: msgs, tools: activeTools, trimmed };
}

function distillValue(value: unknown, maxItems: number, maxStr: number, depth = 0): unknown {
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    if (/^data:[^;]+;base64,/i.test(value)) {
      return `[data-url ${Math.round((value.length * 0.75) / 1024)}KB]`;
    }
    if (/^https?:\/\//i.test(value) && value.length > 160) {
      return `${value.slice(0, 157)}…`;
    }
    return value.length > maxStr ? `${value.slice(0, maxStr - 1)}…` : value;
  }
  if (depth >= 5) return "[…]";
  if (Array.isArray(value)) {
    const sliced = value.slice(0, maxItems).map((v) => distillValue(v, maxItems, maxStr, depth + 1));
    if (value.length > maxItems) {
      sliced.push({ _more: value.length - maxItems });
    }
    return sliced;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (NOISY_KEYS.has(k.toLowerCase()) && typeof v === "object" && v !== null) continue;
      if (v === undefined || v === null || v === "") continue;
      out[k] = distillValue(v, maxItems, maxStr, depth + 1);
    }
    return out;
  }
  return String(value);
}

/**
 * خروجی ابزار را پیش از ارسال به مدل فشرده می‌کند تا ضمن حفظ شناسه‌ها و ساختار معتبر JSON،
 * کانتکست مدل‌های کوچک پر نشود.
 */
export function compactToolResult(result: unknown, maxChars = 2400): string {
  if (result === undefined) return "null";
  const raw = JSON.stringify(result);
  if (raw.length <= maxChars) return raw;

  const passes: Array<[number, number]> = [
    [10, 220],
    [6, 150],
    [3, 90],
    [2, 55],
  ];

  for (const [maxItems, maxStr] of passes) {
    const distilled = JSON.stringify(distillValue(result, maxItems, maxStr));
    if (distilled.length <= maxChars) return distilled;
  }

  const smallest = JSON.stringify(distillValue(result, 2, 55));
  return `${smallest.slice(0, Math.max(1, maxChars - 16))}…[truncated]`;
}
