/**
 * The assistant loop, independent of any transport.
 *
 * Both the dashboard chat (`/api/agent/chat`) and the OpenAI-compatible API (`/v1/chat/completions`)
 * call `runAgent`; they only differ in how they report progress and shape the answer.
 */
import { planContext, type ModelLimits } from "../context-budget.js";
import {
  compactConversation,
  compactToolResult,
  estimateRequestTokens,
  estimateTokens,
  extractContextLimit,
  fitContextToBudget,
  isContextLimitError,
  selectAndCompactTools,
  summarizeContextError,
} from "../context.js";
import { dibaRouterChat, type DibaRouterConfig, type DibaRouterMessage, type DibaRouterTool, type DibaRouterToolCall } from "../dibarouter.js";
import type { DibaMcpEngine } from "../engine.js";
import { handleSendReply, parseSendIntent, prepareSend } from "./chat-flow.js";

export interface AgentToolTrace {
  name: string;
  args: unknown;
  ok: boolean;
  ms?: number;
  error?: string;
  cached?: boolean;
  preloaded?: boolean;
}

export interface AgentRunOptions {
  /** Conversation so far; only user and assistant turns are used */
  messages: unknown;
  /** Keeps memory and a pending send confirmation tied to one conversation */
  conversationId?: string;
  signal?: AbortSignal;
  /** Upstream model for this run; defaults to the model saved in the dashboard */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Extra instructions from the caller, e.g. the system message of an API client */
  instructions?: string;
  onStatus?: (text: string) => void;
  onDelta?: (delta: string) => void;
  onTool?: (item: AgentToolTrace) => void;
}

export interface AgentRunResult {
  reply: string;
  model: string;
  routedModel?: string;
  cost?: number;
  toolTrace: AgentToolTrace[];
  compacted: boolean;
  pending?: unknown;
  actions?: unknown;
  /** The step budget ran out and the answer is a summary of what was done so far */
  truncated?: boolean;
  finishReason: "stop" | "length";
  usage: { promptTokens: number; completionTokens: number };
}

export class AgentError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "invalid_request",
  ) {
    super(message);
  }
}

const META_READ_ONLY = new Set(["list_services", "list_chats", "memory_search", "resolve_recipient"]);
const CHAT_LISTING = /(?:list_chats|get_chats|get_dialogs|get_contacts|find_contact|resolve_contact|get_history|get_messages|search_messages)/;
const MAX_PARALLEL_READS = 4;

/** Reasoning models wrap their scratch work in <think> tags; it is never part of the answer */
export function stripThinking(text: string): string {
  return String(text ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "")
    .trim();
}

/** Streaming counterpart of stripThinking: forwards deltas but swallows <think> blocks, even when a tag is split across chunks */
export function thinkingFilter(emit: (delta: string) => void) {
  const OPEN = "<think>";
  const CLOSE = "</think>";
  let buffer = "";
  let inside = false;
  const partialTail = (text: string, tag: string) => {
    for (let len = Math.min(tag.length - 1, text.length); len > 0; len--) {
      if (tag.startsWith(text.slice(-len).toLowerCase())) return len;
    }
    return 0;
  };
  return {
    push(delta: string) {
      buffer += delta;
      for (;;) {
        const lower = buffer.toLowerCase();
        if (inside) {
          const end = lower.indexOf(CLOSE);
          if (end === -1) {
            buffer = buffer.slice(buffer.length - partialTail(buffer, CLOSE));
            return;
          }
          buffer = buffer.slice(end + CLOSE.length);
          inside = false;
          continue;
        }
        const start = lower.indexOf(OPEN);
        if (start === -1) {
          const keep = partialTail(buffer, OPEN);
          const out = buffer.slice(0, buffer.length - keep);
          buffer = buffer.slice(buffer.length - keep);
          if (out) emit(out);
          return;
        }
        if (start > 0) emit(buffer.slice(0, start));
        buffer = buffer.slice(start + OPEN.length);
        inside = true;
      }
    },
    flush() {
      if (!inside && buffer) emit(buffer);
      buffer = "";
    },
  };
}

export function agentSystemPrompt(engine: DibaMcpEngine, historySummary?: string, compact = false, instructions = ""): string {
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
  const now = new Date();
  const clock = `${now.toISOString().slice(0, 16).replace("T", " ")} UTC (${new Intl.DateTimeFormat("fa-IR-u-nu-latn", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tehran" }).format(now)} به وقت تهران)`;
  const extra = instructions.trim() ? `\n\nدستورهای تکمیلی فراخواننده (اگر با قواعد ایمنی بالا تضاد ندارد رعایت کن):\n${instructions.trim().slice(0, 4000)}` : "";

  if (compact) {
    return `تو «دستیار دیبا» هستی؛ دستیار داشبورد dibaMCP برای شبکه‌های اجتماعی، سرویس‌های مالی و ابزارهای MCP. کوتاه، دقیق و عملی جواب بده و به زبان آخرین پیام کاربر بنویس (پیش‌فرض فارسی).
اکنون: ${clock}
قواعد:
- هیچ توکن، رمز، chat_id یا شماره‌ی کامل را در پاسخ نگو؛ فقط نام نمایشی و نام سرویس.
- وضعیت سرویس‌ها: list_services. پیدا کردن مقصد: list_chats. حدس نزن؛ اگر مبهم است یک سؤال کوتاه بپرس.
- عدد، قیمت، موجودی و وضعیت را فقط از نتیجه‌ی واقعی ابزار بگو و واحدش را بنویس.
- ابزارهای نوشتنی/حذف را فقط با درخواست صریح کاربر اجرا کن. به گروه/کانال بدون درخواست صریح پیام نده.
- برای «به [نام] پیام بده»: مخاطب و متن پیشنهادی را نشان بده و فقط پس از «بله» ارسال کن.
- ثبت سفارش در صرافی: اول بدون confirm (پیش‌نمایش)، فقط پس از تأیید صریح کاربر با confirm=true.
- اگر ابزاری خطا داد، یک بار با آرگومان اصلاح‌شده تکرار کن؛ بدون نتیجه‌ی واقعی ابزار نگو «انجام شد».
- خروجی خام ابزار را نریز؛ فقط نتیجه‌ی مفید را بگو.

سرویس‌های آماده: ${readyList.join("؛ ") || "هیچکدام"}${offList.length ? `\nغیرفعال/ناقص: ${offList.map((item) => item.split(" (")[0]).join("، ")}` : ""}${historySummary ? `\n\n${historySummary}` : ""}${extra}`;
  }

  return `تو «دستیار دیبا» هستی؛ دستیار داشبورد dibaMCP برای شبکه‌های اجتماعی و پیام‌رسان‌ها، سرویس‌های مالی (بانک و صرافی)، وردپرس و ابزارهای MCP.
اکنون: ${clock}

روش کار:
۱. هدف کاربر را دقیق مشخص کن. اگر درخواست چند بخش دارد، همه‌ی بخش‌ها را انجام بده، نه فقط اولی را.
۲. هر جا پاسخ به داده‌ی واقعی نیاز دارد (وضعیت، قیمت، موجودی، پیام، محتوا) اول ابزار خواندنی را صدا بزن. ابزارهای خواندنیِ مستقل را در همان نوبت با هم صدا بزن.
۳. نتیجه‌ی ابزار را با سؤال کاربر تطبیق بده؛ اگر ناقص یا خطا بود قدم بعدی را بردار، نه اینکه با حدس جواب بدهی.
۴. پاسخ نهایی را کوتاه و مستقیم بده: اول نتیجه، بعد در صورت نیاز جزئیات یا قدم بعدی. عددها و نام‌ها را عیناً از نتیجه‌ی ابزار بیاور و واحدشان را بنویس.

قواعد کلی:
- به زبان آخرین پیام کاربر جواب بده؛ پیش‌فرض فارسی. کوتاه، دقیق و عملی. هیچ توکن یا رمزی را نگو.
- در پاسخ، نام فارسی سرویس را به کار ببر و شناسه‌ی انگلیسی را فقط در صورت نیاز در پرانتز بیاور.
- برای هر سؤال درباره‌ی وضعیت، آمادگی یا فهرست سرویس‌ها اول ابزار list_services را صدا بزن؛ برای پیدا کردن مقصد پیام از list_chats استفاده کن. به فهرست ثابت پایین اکتفا نکن.
- فهرست «سرویس‌های آماده» فقط وضعیت پیکربندی است (روشن + تنظیمات کامل)، نه اتصال زنده؛ اگر مطمئن نیستی با get_me یا get_chats همان سرویس بررسی کن.
- اگر ابزاری خطا داد، متن خطا و فهرست پارامترهایش را بخوان؛ یک بار همان ابزار را با آرگومان‌های اصلاح‌شده صدا بزن. اگر باز هم نشد، علت را شفاف بگو و حدس نزن.
- یک ابزار را با همان آرگومان‌ها دوباره صدا نزن؛ نتیجه‌ی قبلی معتبر است.
- ابزارهای نوشتنی (ارسال، حذف، تغییر، انتشار، معامله) را فقط با درخواست صریح کاربر اجرا کن؛ ابزارهای حذف/خروج/بلاک/تغییر عضویت را فقط با درخواست صریح همان کار.
- اگر مقصد یا سرویس نامشخص است، اول list_services/list_chats را صدا بزن یا یک سؤال کوتاه بپرس؛ حدس نزن. در هر پاسخ حداکثر یک سؤال بپرس.
- پاسخ نهایی باید بر اساس نتیجه‌ی واقعی ابزارها باشد؛ بدون اجرای ابزار نگو «انجام شد».
- خروجی خام ابزارها را کامل نریز؛ فقط نتیجه‌ی مفید و اقدام بعدی را بگو و شناسه‌های داخلی را افشا نکن.

پیام‌رسان‌ها و شبکه‌های اجتماعی:
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
- بدون اجرای واقعی و تأیید کاربر نگو «پیام ارسال شد»؛ نتیجه‌ی مسیر تأیید/ارسال را ملاک قرار بده.

سرویس‌های مالی (بانک و صرافی):
- قیمت، دفتر سفارش و کندل صرافی‌ها بدون کلید در دسترس است؛ برای قیمت همیشه get_ticker همان صرافی را صدا بزن و از حافظه یا دانش قبلی قیمت نگو.
- برای مقایسه‌ی چند صرافی، get_ticker همه را در یک نوبت صدا بزن و واحد هر قیمت (ریال، تومان یا تتر) را کنار عدد بنویس؛ اگر واحدها فرق دارد پیش از مقایسه یکسانشان کن و بگو چه تبدیلی انجام دادی.
- موجودی و سفارش‌های باز به کلید API نیاز دارد؛ اگر ثبت نشده، بگو از کدام صفحه‌ی داشبورد ثبت می‌شود.
- ثبت سفارش فقط با درخواست صریح همان معامله: اول place_order را بدون confirm صدا بزن، پیش‌نمایش (نماد، سمت، نوع، مقدار، قیمت) را نشان بده و فقط پس از تأیید صریح کاربر با confirm=true تکرار کن. نماد، مقدار یا سمت معامله را هرگز حدس نزن.
- توصیه‌ی قطعی خرید یا فروش نده؛ داده و تحلیل بده و تصمیم را به کاربر واگذار کن.

وردپرس و بقیه سرویس‌ها:
- انتشار، ویرایش و حذف محتوا فقط با درخواست صریح؛ اگر کاربر وضعیت انتشار را نگفته، پیش‌نویس بساز و همین را بگو.

حافظه:
- قبل از پرسیدن اطلاعاتی که ممکن است قبلاً گفته شده، memory_search را صدا بزن. اطلاعات پایدار جدید درباره‌ی کاربر/مخاطب (نام، لحن، رابطه، ترجیح) را با memory_remember ذخیره کن.

داشبورد:
- مسیرها: #/overview، #/providers (شبکه‌های اجتماعی)، #/banking (سرویس‌های مالی)، #/services (بقیه سرویس‌ها)، #/triggers، #/playground، #/logs، #/connect، #/dibarouter، #/install، #/settings.
- برای آدرس و توکن MCP و API دستیار، کاربر را به تب «اتصال به هوش مصنوعی» ارجاع بده. DibaRouter: https://dibarouter.ir/api/v1

سرویس‌های آماده: ${readyList.join("؛ ") || "هیچکدام"}
سرویس‌های غیرفعال/ناقص: ${offList.join("؛ ") || "هیچکدام"}
دریافت پیام‌ها: ${inboxAlerts.join("؛ ") || "غیرفعال"}${historySummary ? `\n\n${historySummary}` : ""}${extra}`;
}

export function autoFacts(text: string): string[] {
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

export function stripChatIds(value: any): any {
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

/** Every tool the assistant may call, plus which of them only read data and may run side by side */
export function agentTools(engine: DibaMcpEngine, maxTools = 160): { tools: DibaRouterTool[]; readOnly: Set<string> } {
  const readOnly = new Set(META_READ_ONLY);
  const tools: DibaRouterTool[] = [
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
      if (tools.length >= maxTools) return { tools, readOnly };
      const schema = JSON.parse(JSON.stringify(tool.schema ?? { type: "object", properties: {} }));
      delete schema.$schema;
      delete schema.$id;
      if (tool.annotations?.readOnlyHint) readOnly.add(tool.name);
      tools.push({ type: "function", function: { name: tool.name, description: tool.description, parameters: schema } });
    }
  }
  return { tools, readOnly };
}

/** One line a model can use to repair a failed call: the tool's parameters and which are required */
export function parameterHint(tool: DibaRouterTool | undefined): string {
  const schema = tool?.function.parameters as { properties?: Record<string, any>; required?: string[] } | undefined;
  const props = Object.entries(schema?.properties ?? {});
  if (!props.length) return tool ? "This tool takes no parameters." : "";
  const required = new Set(schema?.required ?? []);
  const parts = props.slice(0, 14).map(([key, def]) => {
    const type = Array.isArray(def?.enum) ? def.enum.slice(0, 8).join("|") : String(def?.type ?? "any");
    return `${key}${required.has(key) ? "*" : ""}: ${type}`;
  });
  return `Parameters (* = required): ${parts.join(", ")}`;
}

/** Tools whose names share the most words with a name the model made up */
export function similarToolNames(name: string, tools: DibaRouterTool[], max = 5): string[] {
  const words = new Set(name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  if (!words.size) return [];
  return tools
    .map((t) => {
      const parts = t.function.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      return { name: t.function.name, score: parts.filter((p) => words.has(p)).length / Math.max(parts.length, words.size) };
    })
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((t) => t.name);
}

/** Keeps user and assistant turns as plain text; an API client may send content as a list of parts */
export function plainTurns(raw: unknown): Array<{ role: "user" | "assistant"; content: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const item of raw) {
    const role = (item as any)?.role;
    if (role !== "user" && role !== "assistant") continue;
    const content = contentText((item as any)?.content);
    if (content) out.push({ role, content });
  }
  return out;
}

export function contentText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part: any) => (typeof part === "string" ? part : part?.type === "text" || part?.type === "input_text" ? String(part.text ?? "") : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * Runs one assistant turn. Returns undefined when the caller aborted.
 * Throws AgentError for problems the caller can fix (no message, DibaRouter not connected, context too large).
 */
export async function runAgent(engine: DibaMcpEngine, modelLimits: ModelLimits, opts: AgentRunOptions): Promise<AgentRunResult | undefined> {
  const turns = plainTurns(opts.messages);
  if (!turns.length) throw new AgentError("پیامی برای دستیار ارسال نشد", 400, "no_message");
  const stored = engine.store.dibarouter();
  if (!stored.apiKey) throw new AgentError("برای استفاده از دستیار، ابتدا دیبا روتر را در تب «دیبا روتر» وصل کنید", 503, "model_not_configured");
  const c: DibaRouterConfig = opts.model ? { ...stored, model: opts.model } : stored;

  let plan = planContext(await modelLimits.limitOf(c.baseUrl, c.model));
  const compacted = compactConversation(turns, {
    keepRecent: plan.compact ? 4 : 6,
    maxHistoryChars: plan.historyChars,
    maxMessageChars: plan.messageChars,
    maxSummaryChars: plan.summaryChars,
  });
  if (!compacted.messages.length) throw new AgentError("پیامی برای دستیار ارسال نشد", 400, "no_message");

  const conversationId = String(opts.conversationId ?? "dashboard");
  const latestUser = [...compacted.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  if (latestUser) engine.memory.appendTurn({ role: "user", content: latestUser, conversationId });
  for (const fact of autoFacts(latestUser)) engine.memory.rememberFact(fact, ["auto"]);

  const signal = opts.signal;
  const stopped = () => Boolean(signal?.aborted);
  const status = (text: string) => opts.onStatus?.(text);
  const temperature = typeof opts.temperature === "number" && opts.temperature >= 0 && opts.temperature <= 2 ? opts.temperature : 0.35;
  const answerTokens = typeof opts.maxTokens === "number" && opts.maxTokens > 0 ? Math.floor(opts.maxTokens) : 1000;
  status("در حال آماده‌سازی کانتکست…");

  const userTurns = compacted.messages.filter((m) => m.role === "user");
  const selectionText = userTurns.slice(-2).map((m) => m.content).join("\n");
  const hasExplicitChatTarget = /(?:^|\s)@[A-Za-z0-9_]{3,}|-?\d{5,}|\|/.test(latestUser);
  const sendIntent = parseSendIntent(latestUser);
  const forceSendTool = Boolean(sendIntent) && !hasExplicitChatTarget && !/(عکس|تصویر|فایل|ویدیو|photo|image|file|video)/i.test(latestUser);
  const { tools: allTools, readOnly } = agentTools(engine);
  const toolByName = new Map(allTools.map((t) => [t.function.name, t]));
  let contextBudget = plan.inputTokens;

  const toolTrace: AgentToolTrace[] = [];
  const callCache = new Map<string, { content: string; ok: boolean; error?: string }>();
  const preloadedBlocks: string[] = [];
  const usage = { promptTokens: 0, completionTokens: 0 };
  let lastReply = "";
  let lastModel = c.model;
  let routedModel: string | undefined;
  let cost: number | undefined;
  let finishReason: "stop" | "length" = "stop";

  const done = (reply: string, extra: Partial<AgentRunResult> = {}): AgentRunResult => {
    const text = stripThinking(reply);
    if (text) engine.memory.appendTurn({ role: "assistant", content: text, conversationId, tools: [...new Set(toolTrace.map((t) => t.name))] });
    if (!usage.completionTokens) usage.completionTokens = estimateTokens(text);
    return { reply: text, model: lastModel, routedModel, cost, toolTrace, compacted: compacted.compacted, finishReason, usage, ...extra };
  };

  const plainGreeting = /^(سلام|درود|وقت بخیر|صبح بخیر|شب بخیر|hi|hello|hey|thanks|ممنون|مرسی)[!؟.،\s]*$/i.test(selectionText.trim());
  const wantsChatList = /(لیست|فهرست|چت‌ها|چتها|گفتگوها|همه‌ی چت|همه چت|inbox|list chats|all chats)/i.test(selectionText);

  const preload = (name: string, args: Record<string, unknown>) => {
    status(name === "list_chats" ? "در حال خواندن فهرست چت‌ها…" : "در حال خواندن وضعیت سرویس‌ها…");
    try {
      const provider = typeof args.provider === "string" ? args.provider : undefined;
      const content =
        name === "list_services"
          ? servicesBrief(engine.servicesSummary())
          : compactToolResult(stripChatIds(engine.chatsSummary(provider)) ?? null, Math.min(1800, plan.toolResultChars));
      toolTrace.push({ name, args, ok: true, ms: 0, preloaded: true });
      callCache.set(name === "list_services" ? "list_services" : `${name}:${JSON.stringify(args)}`, { content, ok: true });
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
  const systemContent = `${agentSystemPrompt(engine, compacted.summary, plan.compact, opts.instructions)}${
    preloadedBlocks.length
      ? `\n\nداده‌ی تازه‌ی ابزارها (همین حالا خوانده شد؛ به آن استناد کن):\n${preloadedBlocks.join("\n\n")}\n` +
        "این داده وضعیت پیکربندی و صندوق پیام است؛ برای اطمینان از اتصال زنده‌ی هر سرویس، ابزار get_me یا get_chats همان سرویس را صدا بزن."
      : ""
  }${memoryContext ? `\n\nحافظه‌ی ماندگار (از گفتگوهای قبلی):\n${memoryContext}` : ""}`;

  const messages: DibaRouterMessage[] = [
    { role: "system", content: systemContent },
    ...compacted.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const chat = async (msgs: DibaRouterMessage[], options: Parameters<typeof dibaRouterChat>[2]) => {
    usage.promptTokens += estimateRequestTokens(msgs, options?.tools ?? []);
    const out = await dibaRouterChat(c, msgs, options);
    usage.completionTokens += estimateTokens(`${out.reply}${(out.toolCalls ?? []).map((t) => t.function.arguments).join("")}`);
    lastModel = out.model || lastModel;
    routedModel = out.routedModel ?? routedModel;
    if (typeof out.cost === "number") cost = (cost ?? 0) + out.cost;
    return out;
  };

  const callModelWithRecovery = async (
    msgs: DibaRouterMessage[],
    tools: DibaRouterTool[],
    maxTokens: number,
    temp: number,
    onDelta?: (delta: string) => void,
    forceTool?: string,
  ) => {
    maxTokens = Math.min(maxTokens, plan.outputTokens);
    const fitted = fitContextToBudget(msgs, tools, contextBudget);
    msgs = fitted.messages;
    tools = fitted.tools;
    const forcedChoice =
      forceTool && tools.some((t) => t.function.name === forceTool) ? { type: "function" as const, function: { name: forceTool } } : undefined;
    try {
      return await chat(msgs, {
        maxTokens,
        temperature: temp,
        tools: tools.length ? tools : undefined,
        toolChoice: forcedChoice ?? (tools.length ? "auto" : "none"),
        onDelta,
        signal,
      });
    } catch (err: any) {
      let failure = err;
      for (let attempt = 0; attempt < 3 && isContextLimitError(failure); attempt++) {
        const reported = extractContextLimit(failure);
        const assumed = Math.floor(plan.contextLength * 0.6);
        plan = planContext(modelLimits.learn(c.baseUrl, c.model, Math.min(reported ?? assumed, plan.contextLength - 1)));
        contextBudget = plan.inputTokens;
        const lastTry = attempt === 2;
        const tighter = fitContextToBudget(msgs, lastTry ? [] : tools.slice(0, Math.min(6, plan.maxTools)), contextBudget);
        try {
          return await chat(tighter.messages, {
            maxTokens: Math.min(maxTokens, plan.outputTokens, 700),
            temperature: temp,
            tools: tighter.tools.length ? tighter.tools : undefined,
            toolChoice: tighter.tools.length ? "auto" : "none",
            onDelta,
            signal,
          });
        } catch (retryErr: any) {
          failure = retryErr;
        }
      }
      if (isContextLimitError(failure)) throw new AgentError(summarizeContextError(failure), 400, "context_length_exceeded");
      if (forcedChoice && tools.length && /tool|function|support|unsupported|tool_choice/i.test(String(failure?.message ?? failure))) {
        try {
          return await chat(msgs, { maxTokens, temperature: temp, tools, toolChoice: "auto", onDelta, signal });
        } catch (retryErr: any) {
          failure = retryErr;
        }
      }
      if (tools.length && /tool|function|support|unsupported/i.test(String(failure?.message ?? failure))) {
        return await chat(msgs, { maxTokens, temperature: temp, onDelta, signal });
      }
      throw failure;
    }
  };

  if (engine.memory.getPending(conversationId)) {
    try {
      status("در حال بررسی پاسخ شما…");
      const handled = await handleSendReply(engine, c, conversationId, latestUser, { signal });
      if (stopped()) return undefined;
      if (handled) {
        toolTrace.push(...handled.toolTrace);
        opts.onDelta?.(handled.reply);
        return done(handled.reply, { pending: handled.pending, actions: handled.actions });
      }
    } catch (err: any) {
      console.error("[diba-mcp] pending send failed", err?.message ?? err);
    }
  }

  if (forceSendTool && sendIntent) {
    try {
      status(`در حال پیدا کردن نزدیک‌ترین مخاطب برای «${sendIntent.recipient}»…`);
      const result = await prepareSend(engine, c, sendIntent, {
        conversationId,
        allowGroup: /(گروه|کانال|group|channel)/i.test(latestUser),
        signal,
      });
      if (stopped()) return undefined;
      toolTrace.push(...result.toolTrace);
      opts.onDelta?.(result.reply);
      return done(result.reply, { pending: result.pending, actions: result.actions });
    } catch (err: any) {
      console.error("[diba-mcp] prepare send failed", err?.message ?? err);
    }
  }

  /** Runs one tool call and returns the text the model sees */
  const execute = async (call: DibaRouterToolCall): Promise<string> => {
    const name = call.function.name;
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
      const item: AgentToolTrace = { name, args: call.function.arguments, ok: false, error: argsError };
      toolTrace.push(item);
      opts.onTool?.(item);
      return `ERROR: ${argsError} آرگومان‌های ابزار را اصلاح کن و همان ابزار را دوباره صدا بزن. ${parameterHint(toolByName.get(name))}`.trim();
    }

    const cacheKey = name === "list_services" ? "list_services" : `${name}:${JSON.stringify(args)}`;
    const cached = callCache.get(cacheKey);
    if (cached) {
      const item: AgentToolTrace = { name, args, ok: cached.ok, ms: 0, error: cached.error, cached: true };
      toolTrace.push(item);
      opts.onTool?.(item);
      return `(این ابزار با همین آرگومان‌ها قبلاً اجرا شده؛ نتیجه‌ی قبلی)\n${cached.content}`;
    }

    status(`در حال اجرای ${name}…`);
    const result = await engine.callTool(name, args, "mcp");
    const item: AgentToolTrace = { name, args, ok: result.ok, ms: result.ms, error: result.error };
    toolTrace.push(item);
    opts.onTool?.(item);
    let content: string;
    if (!result.ok) {
      const known = toolByName.get(name);
      const similar = known ? [] : similarToolNames(name, allTools);
      content = [
        `ERROR: ${result.error ?? "اجرای ابزار ناموفق بود"}`,
        known ? parameterHint(known) : similar.length ? `No tool is named "${name}". Closest tools: ${similar.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    } else if (name === "list_services") content = servicesBrief(result.result);
    else if (name === "memory_search" || CHAT_LISTING.test(name)) content = compactToolResult(stripChatIds(result.result) ?? null, plan.toolResultChars);
    else content = compactToolResult(result.result ?? null, plan.toolResultChars);
    callCache.set(cacheKey, { content, ok: result.ok, error: result.error });
    return content;
  };

  /** Read-only calls of one round run side by side; anything that writes runs alone, in the order the model asked */
  const executeRound = async (calls: DibaRouterToolCall[]): Promise<string[]> => {
    const results = new Array<string>(calls.length);
    const inFlight = new Map<string, Promise<string>>();
    let batch: Array<Promise<void>> = [];
    const flush = async () => {
      await Promise.all(batch);
      batch = [];
    };
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      if (!readOnly.has(call.function.name)) {
        await flush();
        if (stopped()) return results;
        results[i] = await execute(call);
        continue;
      }
      // the same read asked twice in one round is executed once
      const key = `${call.function.name}:${call.function.arguments}`;
      const running = inFlight.get(key) ?? execute(call);
      inFlight.set(key, running);
      batch.push(running.then((content) => void (results[i] = content)));
      if (batch.length >= MAX_PARALLEL_READS) await flush();
    }
    await flush();
    return results;
  };

  const maxRounds = plan.compact ? 5 : 8;
  let repeatedRounds = 0;
  try {
    for (let round = 0; round < maxRounds; round++) {
      if (stopped()) return undefined;
      let streamedThisRound = false;
      const filter = opts.onDelta
        ? thinkingFilter((delta) => {
            streamedThisRound = true;
            opts.onDelta!(delta);
          })
        : undefined;
      const onDelta = filter ? (delta: string) => filter.push(delta) : undefined;

      const roundQuery = [selectionText, lastReply, toolTrace.map((t) => t.name).join(" ")].filter(Boolean).join("\n");
      const roundTools = plan.maxTools
        ? selectAndCompactTools(allTools, roundQuery, { maxTools: plan.maxTools, maxToolTokens: plan.toolTokens, blockDirectSend: true })
        : [];
      status(round === 0 ? `در حال تحلیل درخواست (${roundTools.length} ابزار در دسترس)…` : "در حال بررسی نتایج و برنامه‌ریزی قدم بعد…");

      const out = await callModelWithRecovery(messages, roundTools, answerTokens, temperature, onDelta, round === 0 && forceSendTool ? "send_message_to" : undefined);
      filter?.flush();
      out.reply = stripThinking(out.reply);
      lastReply = out.reply || lastReply;
      if (out.finishReason === "length") finishReason = "length";
      if (stopped()) return undefined;

      if (!out.reply && !out.toolCalls?.length) {
        try {
          const retryMessages = toolTrace.length
            ? [...messages, { role: "user" as const, content: "نتیجه‌ی ابزارهای بالا را به زبان کاربر و کوتاه جمع‌بندی کن." }]
            : messages;
          const retry = await callModelWithRecovery(retryMessages, [], Math.min(answerTokens, 700), 0.25, onDelta);
          filter?.flush();
          const text = stripThinking(retry.reply);
          if (text) {
            if (!streamedThisRound) opts.onDelta?.(text);
            return done(text);
          }
        } catch {
          // fall through to the local fallback below
        }
        const fallback = assistantFallback(toolTrace);
        opts.onDelta?.(fallback);
        return done(fallback);
      }

      if (!out.toolCalls?.length) {
        if (!streamedThisRound && lastReply) opts.onDelta?.(lastReply);
        return done(lastReply);
      }

      messages.push({ role: "assistant", content: out.reply || "", tool_calls: out.toolCalls });
      const before = toolTrace.length;
      const contents = await executeRound(out.toolCalls);
      if (stopped()) return undefined;
      out.toolCalls.forEach((call, i) => {
        messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: contents[i] ?? "ERROR: ابزار اجرا نشد." });
      });

      // a round that only repeated earlier calls adds nothing; say so once, then stop looping
      const fresh = toolTrace.slice(before).some((t) => !t.cached);
      if (!fresh) {
        repeatedRounds++;
        if (repeatedRounds >= 2) break;
        messages.push({ role: "user", content: "همه‌ی این ابزارها قبلاً با همین آرگومان‌ها اجرا شده‌اند و نتیجه‌شان بالا هست. دوباره صدایشان نزن؛ با همین داده‌ها پاسخ نهایی را بده یا ابزار دیگری را امتحان کن." });
      } else repeatedRounds = 0;
      status("در حال جمع‌بندی پاسخ…");
    }

    if (stopped()) return undefined;
    let finalReply = lastReply;
    if (toolTrace.length) {
      try {
        status("در حال آماده‌سازی پاسخ نهایی…");
        const summary = await callModelWithRecovery(
          [
            ...messages,
            {
              role: "user" as const,
              content: "بر اساس نتایج ابزارهای بالا، پاسخ نهایی را به زبان کاربر، کوتاه و دقیق بده. اگر ابزاری خطا داد، علت و اقدام بعدی را بگو.",
            },
          ],
          [],
          Math.min(answerTokens, 800),
          0.25,
        );
        const text = stripThinking(summary.reply);
        if (text) finalReply = text;
      } catch {
        // keep the last partial answer
      }
    }
    if (!finalReply) finalReply = "ابزارها اجرا شدند، اما مدل پاسخی برای جمع‌بندی برنگرداند. نتیجه را در گزارش‌ها ببینید.";
    if (stopped()) return undefined;
    opts.onDelta?.(finalReply);
    return done(finalReply, { truncated: true });
  } catch (err: any) {
    if (stopped()) return undefined;
    if (err instanceof AgentError) throw err;
    if (isContextLimitError(err)) throw new AgentError(summarizeContextError(err), 400, "context_length_exceeded");
    throw err;
  }
}
