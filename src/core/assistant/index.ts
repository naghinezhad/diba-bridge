/**
 * دستیار دیبا.
 *
 * لایه‌ها (هر لایه فقط به لایه‌های پایین‌تر از خودش وابسته است):
 *   name-match  → تطبیق آوایی نام فارسی/انگلیسی
 *   text        → برچسب‌ها و تشخیص پاسخ‌های کوتاه («بله»، «لغو»، «دومی»)
 *   policy      → سرویس‌های دارای ارسال، گروه/کانال، کیفیت متن
 *   intent      → جمله‌ی کاربر → نیت، مخاطب، سرویس و متن
 *   resolver    → پیدا کردن مخاطب در چت‌ها، مخاطبین و حافظه
 *   draft       → ساخت پیش‌نویس پیام با مدل
 *   agent       → ابزار MCP «diba_agent» (یک جمله → انجام کار)
 *   chat-flow   → جریان دومرحله‌ای ارسال در گفتگوی داشبورد
 */
export { DibaAgent } from "./agent.js";
export type { AgentAction, AgentCandidate, AgentInput, AgentProvider, AgentRecipient, AgentResult } from "./agent.js";
export { handleSendReply, parseSendIntent, prepareSend } from "./chat-flow.js";
export type { ChatFlowResult, ChatFlowTraceItem } from "./chat-flow.js";
export { buildDraft } from "./draft.js";
export type { DraftResult, SendIntent } from "./draft.js";
export { parseRequest } from "./intent.js";
export type { ParsedRequest } from "./intent.js";
export { canSendWith, checkMessageQuality, isGroupLike, SEND_TOOLS } from "./policy.js";
export { clearResolverCache, enrichChatTitles, listChatCandidates, resolveRecipient } from "./resolver.js";
export type { Resolution, ResolvedCandidate } from "./resolver.js";
