import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compactToolResult } from "./context.js";
import { dibaRouterChat } from "./dibarouter.js";
import { netFetch } from "./net.js";
import type { IncomingMessage } from "./types.js";

export type TriggerEvent = "incoming_message" | "tool_called" | "tool_error" | "manual";
export type TriggerActionType = "reply_template" | "ai_reply" | "forward" | "call_tool" | "webhook";
export type TriggerCategory = "social" | "ai" | "mcp" | "forward" | "webhook";

export interface TriggerMatch {
  provider?: string;
  chatType?: "private" | "group" | "channel" | "*";
  chatId?: string;
  contains?: string;
  toolName?: string;
}

export interface TriggerAction {
  type: TriggerActionType;
  template?: string;
  systemPrompt?: string;
  targetProvider?: string;
  targetChatId?: string;
  toolName?: string;
  toolArgs?: string;
  webhookUrl?: string;
}

export interface TriggerDef {
  id: string;
  name: string;
  description: string;
  category: TriggerCategory;
  enabled: boolean;
  builtin?: boolean;
  event: TriggerEvent;
  match: TriggerMatch;
  action: TriggerAction;
  hitCount?: number;
  lastRunAt?: string;
  lastError?: string;
}

export interface TriggerLog {
  id: string;
  triggerId: string;
  triggerName: string;
  event: TriggerEvent;
  ok: boolean;
  detail: string;
  at: string;
  demo?: boolean;
}

interface TriggersFile {
  seedVersion?: number;
  triggers: TriggerDef[];
  logs: TriggerLog[];
}

export interface TriggerHost {
  store: {
    dibarouter: () => { baseUrl: string; apiKey: string; model: string };
    resolve: (p: any) => { values: Record<string, string> };
    isReady: (p: any) => boolean;
  };
  provider: (id: string) => any;
  callTool: (name: string, args: unknown, source: "mcp" | "dashboard") => Promise<{ ok: boolean; result?: unknown; error?: string }>;
}

const MAX_LOGS = 150;

export const TRIGGER_SEED_VERSION = 4;

export function defaultTriggers(): TriggerDef[] {
  return [
    {
      id: "social-welcome",
      name: "خوش‌آمدگویی /start و سلام",
      description: "پاسخ خودکار به پیام‌های شروع و سلام در چت خصوصی همه‌ی پیام‌رسان‌ها",
      category: "social",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "private", contains: "/start, سلام, درود, hi, hello" },
      action: {
        type: "reply_template",
        template:
          "سلام {{sender}} عزیز 👋\nبه پشتیبانی خوش آمدید. سوال یا درخواستتان را بنویسید تا همان لحظه راهنمایی‌تان کنیم.\n— پیام شما در {{provider}} دریافت شد.",
      },
    },
    {
      id: "social-pricing-faq",
      name: "استعلام قیمت و تعرفه",
      description: "ارسال پاسخ آماده هنگام پرسش درباره‌ی قیمت، هزینه، تعرفه یا اشتراک",
      category: "social",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "*", contains: "قیمت, تعرفه, هزینه, چند, خرید, اشتراک, پلن" },
      action: {
        type: "reply_template",
        template:
          "تعرفه‌ی سرویس‌ها 👇\n• پایه: ۴۹۰ هزار تومان / ماه\n• حرفه‌ای: ۹۹۰ هزار تومان / ماه\n• سازمانی: بر اساس نیاز\nبرای مشاوره‌ی رایگان شماره‌ی خودتان را بفرستید تا تماس بگیریم.",
      },
    },
    {
      id: "social-support-ticket",
      name: "پشتیبانی و ثبت تیکت خودکار",
      description: "پاسخ فوری به پیام‌های حاوی مشکل، خطا، پشتیبانی یا تیکت",
      category: "social",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "*", contains: "پشتیبانی, تیکت, مشکل, خرابی, خطا, support" },
      action: {
        type: "reply_template",
        template:
          "درخواست پشتیبانی شما ثبت شد ✅\nشماره‌ی پیگیری: {{chatId}}-{{provider}}\nکارشناس ما حداکثر تا ۲ ساعت کاری پاسخ می‌دهد. ({{sender}})",
      },
    },
    {
      id: "social-business-hours",
      name: "پاسخ خارج از ساعت کاری",
      description: "وقتی کسی بیرون از ساعت کاری پیام می‌دهد، زمان پاسخ‌گویی بعدی را اعلام می‌کند",
      category: "social",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "private", contains: "ساعت کاری, کی پاسخ, الان هستید, پاسخ نمی‌دهید" },
      action: {
        type: "reply_template",
        template:
          "الان خارج از ساعت کاری هستیم 🕘\nساعت پاسخ‌گویی: شنبه تا چهارشنبه ۹ تا ۱۷، پنجشنبه ۹ تا ۱۳.\nپیام شما ({{sender}}) ذخیره شد و اول وقت کاری پاسخ می‌دهیم.",
      },
    },
    {
      id: "social-order-tracking",
      name: "پیگیری وضعیت سفارش",
      description: "ارسال لینک پیگیری وقتی کاربر شماره سفارش یا وضعیت سفارش را می‌پرسد",
      category: "social",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "*", contains: "سفارش, مرسوله, پیگیری, پست, ارسال شد, کد رهگیری" },
      action: {
        type: "reply_template",
        template:
          "برای پیگیری سفارش، شماره سفارش را با پیشوند # بفرستید.\nوضعیت مرسوله: https://tracking.example.com/{{chatId}}\nاگر بیش از ۳ روز طول کشید به همین چت اطلاع دهید.",
      },
    },
    {
      id: "social-store-location",
      name: "آدرس و موقعیت فروشگاه",
      description: "پاسخ آماده به پرسش‌های آدرس، شعبه، نقشه و ساعات حضور",
      category: "social",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "*", contains: "آدرس, کجاست, شعبه, نقشه, موقعیت, گوگل مپ" },
      action: {
        type: "reply_template",
        template:
          "📍 آدرس فروشگاه مرکزی:\nتهران، خیابان ولیعصر، پلاک ۱۲۰۰، طبقه‌ی ۳\nhttps://maps.example.com/diba\nپارکینگ اختصاصی دارد؛ حضوری هم می‌توانید خرید کنید.",
      },
    },
    {
      id: "social-thanks-feedback",
      name: "تشکر و نظرسنجی رضایت",
      description: "پس از اعلام رضایت مشتری، تشکر و لینک نظرسنجی کوتاه می‌فرستد",
      category: "social",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "*", contains: "ممنون, مرسی, تشکر, عالی بود, دستت درد نکنه" },
      action: {
        type: "reply_template",
        template:
          "ممنون از لطف شما {{sender}} 🌟\nاگر ۳۰ ثانیه وقت دارید، رضایت‌تان را ثبت کنید:\nhttps://survey.example.com/diba?chat={{chatId}}\nنظر شما مسیر بهتر شدن ما را می‌سازد.",
      },
    },
    {
      id: "social-group-rules",
      name: "ارسال قوانین گروه",
      description: "وقتی عبارت «قوانین» در گروه نوشته شد، متن قوانین را می‌فرستد",
      category: "social",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "group", contains: "قوانین, rules, مقررات" },
      action: {
        type: "reply_template",
        template:
          "📌 قوانین گروه {{chatTitle}}:\n۱) تبلیغ و لینک بدون اجازه ممنوع است.\n۲) احترام به همه‌ی اعضا الزامی است.\n۳) سوال تخصصی را در تاپیک مربوطه بپرسید.\n۴) تخلف = حذف بدون اطلاع قبلی.",
      },
    },
    {
      id: "social-human-handoff",
      name: "ارجاع به اپراتور انسانی",
      description: "وقتی کاربر صریحاً درخواست انسان یا مدیر می‌کند، تایید و مسیر ارجاع را می‌گوید",
      category: "social",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "*", contains: "اپراتور, مدیر, انسان, آدم واقعی, وصل کن" },
      action: {
        type: "reply_template",
        template:
          "درخواست شما برای گفتگو با کارشناس ثبت شد 🙋\nظرف ۱۵ دقیقه یکی از همکاران به همین چت می‌آید. اگر فوری است «فوری» بنویسید تا در اولویت قرار بگیرید.\n({{sender}} | {{provider}})",
      },
    },
    {
      id: "social-unsubscribe",
      name: "توقف ارسال و لغو اشتراک",
      description: "لغو اشتراک خبرنامه یا پیام‌های تبلیغاتی با یک پیام",
      category: "social",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "*", contains: "لغو, توقف, قطع پیام, unsubscribe, خسته شدم" },
      action: {
        type: "reply_template",
        template:
          "اشتراک پیام‌های ما برای این چت لغو شد ✅\nاز این پس فقط پاسخ‌های پشتیبانی دریافت می‌کنید. برای فعال‌سازی مجدد «شروع» را بفرستید.",
      },
    },
    {
      id: "social-instagram-dm",
      name: "خوش‌آمدگویی دایرکت اینستاگرام",
      description: "پاسخ اولیه به دایرکت اینستاگرام همراه راهنمای خرید از لینک بایو",
      category: "social",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "instagram", chatType: "private", contains: "سلام, قیمت, موجود, خرید, dm" },
      action: {
        type: "reply_template",
        template:
          "سلام {{sender}} 🌿\nمحصولات و قیمت‌ها در لینک بایو است. اگر سایز یا رنگ خاصی می‌خواهید همین‌جا بنویسید تا راهنمایی کنیم.\nارسال به همه‌ی شهرها انجام می‌شود.",
      },
    },

    {
      id: "ai-assistant-default",
      name: "دستیار هوشمند پیش‌فرض",
      description: "پاسخ هوشمند به همه‌ی پیام‌های خصوصی، بدون نیاز به کلمه‌ی کلیدی",
      category: "ai",
      enabled: true,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "private" },
      action: {
        type: "ai_reply",
        systemPrompt:
          "تو دستیار هوشمند و خوش‌برخورد کسب‌وکار هستی. به سؤال کاربر به فارسی روان، کوتاه و دقیق پاسخ بده. اگر سؤال درباره‌ی قیمت، قرارداد، سفارش یا موضوعی است که اطلاعات مطمئن نداری، از خودت عدد یا وعده نساز و کاربر را به کارشناس انسانی ارجاع بده. اگر کاربر فقط سلام کرد، خوش‌آمد بگو و بپرس چطور می‌توانی کمک کنی.",
      },
    },
    {
      id: "ai-private-qa",
      name: "پاسخ هوشمند با دیبا روتر (AI)",
      description: "پاسخ خودکار کوتاه به سوال‌های چت خصوصی با مدل دیبا روتر",
      category: "ai",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "private", contains: "؟, ?, چطور, چگونه, راهنما, کمک" },
      action: {
        type: "ai_reply",
        systemPrompt:
          "تو پشتیبان فارسی dibaMCP هستی. بر اساس اطلاعات عمومی محصول پاسخ بده، هرگز قیمت یا قرارداد جدید از خودت نساز و اگر مطمئن نیستی کاربر را به کارشناس انسانی ارجاع بده.",
      },
    },
    {
      id: "ai-group-summary",
      name: "خلاصه‌سازی گفتگو با /summary",
      description: "خلاصه‌ی ۳ بولتی گفتگو وقتی در گروه یا چت خصوصی دستور /summary بیاید",
      category: "ai",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "*", contains: "/summary, خلاصه کن, جمع‌بندی" },
      action: {
        type: "ai_reply",
        systemPrompt:
          "پیام زیر را به فارسی و در قالب حداکثر ۳ بولت کوتاه خلاصه کن، تصمیم‌ها و کارهای باز را جدا مشخص کن.",
      },
    },
    {
      id: "ai-translate",
      name: "ترجمه‌ی خودکار پیام",
      description: "ترجمه‌ی پیام‌های انگلیسی مشتریان خارجی به فارسی و پاسخ دوزبانه",
      category: "ai",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "*", contains: "/translate, ترجمه, translate" },
      action: {
        type: "ai_reply",
        systemPrompt:
          "متن کاربر را به فارسی روان ترجمه کن، سپس یک پاسخ کوتاه دوزبانه (فارسی و انگلیسی) برای پاسخ دادن بنویس. هیچ توضیح اضافه‌ای نده.",
      },
    },
    {
      id: "ai-sentiment-escalate",
      name: "تشخیص نارضایتی و ارجاع فوری",
      description: "لحن عصبانی یا تهدید به شکایت را تشخیص می‌دهد و پاسخ آرام‌کننده می‌فرستد",
      category: "ai",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "*", contains: "شکایت, پشیمون, کلاهبرداری, افتضاح, عصبانی, تهدید" },
      action: {
        type: "ai_reply",
        systemPrompt:
          "کاربر ناراضی است. با لحن آرام و بدون توجیه‌تراشی عذرخواهی کن، مشکل را در یک جمله جمع‌بندی کن و بگو کارشناس ارشد تا ۱۰ دقیقه پیگیری می‌کند. هرگز قول refund قطعی نده.",
      },
    },
    {
      id: "ai-lead-scoring",
      name: "امتیازدهی و دسته‌بندی لید",
      description: "پیام‌های فروش را به لید گرم/سرد دسته‌بندی می‌کند و پاسخ مناسب می‌دهد",
      category: "ai",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "*", contains: "بودجه, تیم, سازمان, دمو, پیش‌فاکتور, قرارداد" },
      action: {
        type: "ai_reply",
        systemPrompt:
          "تو دستیار فروش B2B هستی. از متن پیام، اندازه‌ی احتمالی مشتری و فوریت را حدس بزن، در حداکثر ۲ جمله پاسخ بده و یک سوال کشف نیاز بپرس. عدد یا تخفیف اعلام نکن.",
      },
    },
    {
      id: "ai-content-draft",
      name: "پیش‌نویس پست شبکه‌های اجتماعی",
      description: "با دستور /post یک پیش‌نویس پست فارسی با هشتگ برای بازبینی می‌سازد",
      category: "ai",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "*", contains: "/post, /draft, پیش‌نویس, کپشن" },
      action: {
        type: "ai_reply",
        systemPrompt:
          "بر اساس موضوعی که کاربر می‌دهد یک کپشن فارسی جذاب در حداکثر ۴ خط با ۵ هشتگ مرتبط و یک CTA بنویس. لحن صمیمی و حرفه‌ای، بدون ایموجی زیاد.",
      },
    },
    {
      id: "ai-faq-knowledge",
      name: "پاسخ از دانشنامه‌ی محصول",
      description: "پاسخ دقیق به سوال‌های فنی محصول بر اساس دامنه‌ی دانش تعیین‌شده",
      category: "ai",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "private", contains: "چطور کار می‌کند, تفاوت, مقایسه, سازگار, نصب, api" },
      action: {
        type: "ai_reply",
        systemPrompt:
          "تو کارشناس فنی محصول هستی. فقط بر اساس دانش محصول پاسخ بده؛ اگر اطلاعات کافی نیست صریح بگو «این مورد را باید تیم فنی تایید کند» و سوال را خلاصه کن. پاسخ حداکثر ۴ جمله.",
      },
    },
    {
      id: "ai-product-recommend",
      name: "پیشنهاد محصول بر اساس نیاز",
      description: "با پرسیدن نیاز مشتری، بین پلن‌ها و محصولات بهترین گزینه را پیشنهاد می‌دهد",
      category: "ai",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "*", contains: "کدام را بخرم, پیشنهاد, مناسب من, بهترین, مقایسه کن" },
      action: {
        type: "ai_reply",
        systemPrompt:
          "فروشنده‌ی مشاوره‌ای هستی. اول یک سوال کوتاه درباره‌ی نیاز و مقیاس کار بپرس، سپس حداکثر دو گزینه با دلیل پیشنهاد بده. قیمت اعلام نکن و به تیم فروش ارجاع بده.",
      },
    },

    {
      id: "forward-urgent-alert",
      name: "فوروارد پیام‌های فوری به مدیر",
      description: "ارسال فوری پیام‌های حاوی «فوری» یا «اضطراری» به چت پیش‌فرض بله",
      category: "forward",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "*", contains: "فوری, مهم, اضطراری, urgent, asap" },
      action: {
        type: "forward",
        targetProvider: "bale_client",
        template: "🚨 پیام فوری از {{provider}} ({{sender}} | چت {{chatId}}):\n{{text}}",
      },
    },
    {
      id: "bridge-bale-to-telegram",
      name: "همگام‌سازی بله ← تلگرام",
      description: "فوروارد خودکار پیام‌های ورودی بله به چت پیش‌فرض تلگرام",
      category: "forward",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "bale_client", chatType: "*" },
      action: {
        type: "forward",
        targetProvider: "telegram_client",
        template: "📩 از بله ({{sender}}):\n{{text}}",
      },
    },
    {
      id: "bridge-telegram-to-bale",
      name: "همگام‌سازی تلگرام ← بله",
      description: "فوروارد خودکار پیام‌های ورودی تلگرام به چت پیش‌فرض بله",
      category: "forward",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "telegram_client", chatType: "*" },
      action: {
        type: "forward",
        targetProvider: "bale_client",
        template: "📨 از تلگرام ({{sender}}):\n{{text}}",
      },
    },
    {
      id: "forward-sales-leads",
      name: "ارسال لیدهای فروش به تیم فروش",
      description: "پیام‌های حاوی درخواست قیمت یا دمو را به گروه فروش در تلگرام می‌فرستد",
      category: "forward",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "private", contains: "قیمت, دمو, پیش‌فاکتور, خرید, مشاوره" },
      action: {
        type: "forward",
        targetProvider: "telegram_client",
        template: "💼 لید فروش تازه\nسرویس: {{provider}}\nفرستنده: {{sender}}\nچت: {{chatId}}\nمتن: {{text}}",
      },
    },
    {
      id: "forward-vip-customers",
      name: "پیگیری مشتریان VIP",
      description: "پیام مشتریان کلیدی در اینستاگرام را به چت خصوصی مدیر در بله می‌فرستد",
      category: "forward",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "instagram", chatType: "private" },
      action: {
        type: "forward",
        targetProvider: "bale_client",
        template: "⭐ مشتری VIP\n{{sender}} (اینستاگرام)\n{{text}}",
      },
    },
    {
      id: "forward-file-archive",
      name: "آرشیو فایل‌های دریافتی",
      description: "پیام‌های روبیکا را برای بایگانی به کانال آرشیو تلگرام منتقل می‌کند",
      category: "forward",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "rubika_client", chatType: "*" },
      action: {
        type: "forward",
        targetProvider: "telegram_client",
        template: "🗂 آرشیو از روبیکا\n{{sender}} | {{chatTitle}}\n{{text}}",
      },
    },
    {
      id: "forward-eitaa-alerts",
      name: "هشدار پیام‌های ایتا",
      description: "پیام‌های مهم ایتا را به سروش‌پلاس تیم پشتیبانی منتقل می‌کند",
      category: "forward",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "eitaa_client", chatType: "*", contains: "فوری, مشکل, سفارش, شکایت" },
      action: {
        type: "forward",
        targetProvider: "soroush_client",
        template: "🔔 از ایتا ({{sender}}):\n{{text}}",
      },
    },
    {
      id: "forward-x-mentions",
      name: "منشن‌های ایکس به بله",
      description: "پیام‌های ورودی ایکس را برای پیگیری سریع به بله مدیر می‌فرستد",
      category: "forward",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "x", chatType: "*" },
      action: {
        type: "forward",
        targetProvider: "bale_client",
        template: "🐦 منشن تازه در ایکس\n{{sender}}: {{text}}",
      },
    },

    {
      id: "mcp-tool-error-alert",
      name: "هشدار خطای ابزارهای MCP",
      description: "هر وقت یک ابزار MCP خطا داد، گزارش کوتاه خطا را به چت پیش‌فرض بله بفرست",
      category: "mcp",
      enabled: false,
      builtin: true,
      event: "tool_error",
      match: { toolName: "*" },
      action: {
        type: "forward",
        targetProvider: "bale_client",
        template: "⚠️ خطای MCP در ابزار {{toolName}}:\n{{error}}\nآرگومان‌ها: {{args}}",
      },
    },
    {
      id: "mcp-send-audit-log",
      name: "ممیزی ارسال‌های MCP",
      description: "هر ارسال یا انتشار موفق از طریق مدل را برای دفتر ممیزی به Webhook می‌فرستد",
      category: "mcp",
      enabled: false,
      builtin: true,
      event: "tool_called",
      match: { toolName: "*_send_*, *_publish_*, *_post*" },
      action: {
        type: "webhook",
        webhookUrl: "",
      },
    },
    {
      id: "webhook-mcp-audit",
      name: "وبهوک همه‌ی ابزارهای MCP",
      description: "هر فراخوانی ابزار MCP را به آدرس Webhook بیرونی برای لاگ مرکزی می‌فرستد",
      category: "mcp",
      enabled: false,
      builtin: true,
      event: "tool_called",
      match: { toolName: "*" },
      action: {
        type: "webhook",
        webhookUrl: "",
      },
    },
    {
      id: "mcp-tool-error-webhook",
      name: "وبهوک خطاهای ابزار MCP",
      description: "خطاهای ابزار را به سامانه‌ی مانیتورینگ (Grafana / ناظر) می‌فرستد",
      category: "mcp",
      enabled: false,
      builtin: true,
      event: "tool_error",
      match: { toolName: "*" },
      action: {
        type: "webhook",
        webhookUrl: "",
      },
    },
    {
      id: "mcp-health-ping",
      name: "دستور /ping برای سلامت سرویس",
      description: "با دریافت /ping حساب پاسخ می‌دهد و وضعیت اتصال را تایید می‌کند",
      category: "mcp",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "*", contains: "/ping, تست حساب, حساب فعالی" },
      action: {
        type: "call_tool",
        toolName: "bale_client_send_message",
        toolArgs: '{"chat_id":"{{chatId}}","text":"✅ حساب متصل است — {{provider}} | {{sender}}"}',
      },
    },
    {
      id: "mcp-broadcast-command",
      name: "ارسال فوری با دستور /broadcast",
      description: "با دستور /broadcast متن، همان پیام به‌عنوان اعلان از طریق بله به چت مقصد می‌رود",
      category: "mcp",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "private", contains: "/broadcast" },
      action: {
        type: "call_tool",
        toolName: "bale_client_send_message",
        toolArgs: '{"chat_id":"{{chatId}}","text":"📣 اعلان دریافت شد و در صف ارسال قرار گرفت.\\nفرستنده: {{sender}}"}',
      },
    },

    {
      id: "webhook-incoming-all",
      name: "وبهوک همه‌ی پیام‌ها (n8n / Make)",
      description: "ارسال JSON همه‌ی پیام‌های ورودی به آدرس Webhook بیرونی برای اتوماسیون",
      category: "webhook",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "*" },
      action: {
        type: "webhook",
        webhookUrl: "",
      },
    },
    {
      id: "webhook-crm-lead",
      name: "ثبت لید در CRM",
      description: "پیام‌های فروش را به وبهوک CRM (HubSpot / دیدار / پیام‌گستر) می‌فرستد",
      category: "webhook",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "private", contains: "قیمت, خرید, دمو, مشاوره" },
      action: {
        type: "webhook",
        webhookUrl: "",
      },
    },
    {
      id: "webhook-sheets-journal",
      name: "ثبت پیام‌ها در Google Sheets",
      description: "هر پیام ورودی را به‌صورت یک ردیف در شیت گزارش ثبت می‌کند",
      category: "webhook",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "*" },
      action: {
        type: "webhook",
        webhookUrl: "",
      },
    },
    {
      id: "webhook-slack-alert",
      name: "اعلان پیام‌های مهم در Slack",
      description: "پیام‌های حاوی کلمات کلیدی را به کانال تیم در Slack می‌فرستد",
      category: "webhook",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "*", contains: "فوری, خرابی, قطعی, down, critical" },
      action: {
        type: "webhook",
        webhookUrl: "",
      },
    },
    {
      id: "webhook-external-ai",
      name: "اتصال به سرویس AI بیرونی",
      description: "پیام‌های پرسشی را به سرویس هوش مصنوعی دلخواه (n8n / Flowise) می‌فرستد",
      category: "webhook",
      enabled: false,
      builtin: true,
      event: "incoming_message",
      match: { provider: "*", chatType: "private", contains: "؟, کمک, راهنمایی" },
      action: {
        type: "webhook",
        webhookUrl: "",
      },
    },
  ];
}

interface DemoLogSeed {
  triggerId: string;
  ok: boolean;
  detail: string;
  minutesAgo: number;
}

const DEMO_LOG_SEEDS: DemoLogSeed[] = [
  { triggerId: "social-welcome", ok: true, detail: "پاسخ خوش‌آمدگویی به bale_client:10427631 ارسال شد", minutesAgo: 6 },
  { triggerId: "social-pricing-faq", ok: true, detail: "تعرفه‌ها به instagram:8812043 ارسال شد", minutesAgo: 15 },
  { triggerId: "ai-private-qa", ok: true, detail: "پاسخ هوشمند دیبا روتر به telegram:7751204 ارسال شد", minutesAgo: 24 },
  { triggerId: "social-support-ticket", ok: true, detail: "تیکت شماره‌ی RUB-10987 برای rubika:1098723 ثبت شد", minutesAgo: 41 },
  { triggerId: "forward-urgent-alert", ok: true, detail: "پیام فوری از eitaa:582014 به چت پیش‌فرض بله فوروارد شد", minutesAgo: 58 },
  { triggerId: "mcp-tool-error-alert", ok: false, detail: "سرویس مقصد (bale) آماده نیست", minutesAgo: 77 },
  { triggerId: "webhook-incoming-all", ok: false, detail: "آدرس Webhook معتبر نیست", minutesAgo: 96 },
  { triggerId: "social-order-tracking", ok: true, detail: "لینک پیگیری سفارش به whatsapp:989121234567 ارسال شد", minutesAgo: 121 },
  { triggerId: "bridge-bale-to-telegram", ok: true, detail: "پیام بله به چت پیش‌فرض تلگرام همگام شد", minutesAgo: 156 },
  { triggerId: "ai-group-summary", ok: true, detail: "خلاصه‌ی ۴۲ پیام گروه به bale:-1002771539 ارسال شد", minutesAgo: 191 },
  { triggerId: "social-business-hours", ok: true, detail: "پاسخ خارج از ساعت کاری به soroush:77120 ارسال شد", minutesAgo: 244 },
  { triggerId: "mcp-send-audit-log", ok: false, detail: "Webhook HTTP 502", minutesAgo: 302 },
  { triggerId: "ai-lead-scoring", ok: true, detail: "لید گرم با امتیاز ۸۲ برای تیم فروش برچسب خورد", minutesAgo: 361 },
  { triggerId: "social-human-handoff", ok: true, detail: "پرونده‌ی چت به کارشناس انسانی ارجاع شد", minutesAgo: 424 },
  { triggerId: "webhook-crm-lead", ok: true, detail: "لید در CRM با وضعیت 201 ثبت شد", minutesAgo: 512 },
  { triggerId: "forward-sales-leads", ok: true, detail: "لید فروش به گروه تلگرام تیم فروش ارسال شد", minutesAgo: 603 },
  { triggerId: "social-group-rules", ok: true, detail: "قوانین گروه برای عضو تازه ارسال شد", minutesAgo: 704 },
  { triggerId: "ai-sentiment-escalate", ok: true, detail: "لحن ناراضی تشخیص داده شد و هشدار ارجاع رفت", minutesAgo: 826 },
  { triggerId: "social-thanks-feedback", ok: true, detail: "لینک نظرسنجی رضایت به rubika:995120 ارسال شد", minutesAgo: 934 },
  { triggerId: "forward-x-mentions", ok: false, detail: "سرویس مقصد (bale) آماده نیست", minutesAgo: 1082 },
];

export function demoLogs(): TriggerLog[] {
  const presets = defaultTriggers();
  const byId = new Map(presets.map((t) => [t.id, t] as const));
  const now = Date.now();
  return DEMO_LOG_SEEDS.map((seed, i) => {
    const preset = byId.get(seed.triggerId);
    return {
      id: `demo-${(i + 1).toString().padStart(2, "0")}`,
      triggerId: seed.triggerId,
      triggerName: preset?.name ?? seed.triggerId,
      event: preset?.event ?? "incoming_message",
      ok: seed.ok,
      detail: seed.detail,
      at: new Date(now - seed.minutesAgo * 60_000).toISOString(),
      demo: true,
    };
  });
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

function matchPattern(pattern: string | undefined, value: string): boolean {
  const p = String(pattern ?? "").trim();
  if (!p || p === "*") return true;
  const parts = p
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return true;
  const lower = value.toLowerCase();
  return parts.some((part) => {
    if (part.includes("*")) {
      const re = new RegExp(`^${part.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i");
      return re.test(value);
    }
    return lower.includes(part.toLowerCase());
  });
}

export class TriggerEngine {
  private filePath: string;
  private data: TriggersFile = { triggers: [], logs: [] };
  private busy = false;

  constructor(dataDir: string, private host: TriggerHost) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.filePath = join(dataDir, "triggers.json");
    this.load();
  }

  private load() {
    let parsed: any = null;
    if (existsSync(this.filePath)) {
      try {
        parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
        this.data = {
          seedVersion: Number(parsed?.seedVersion) || 1,
          triggers: Array.isArray(parsed?.triggers) ? parsed.triggers : [],
          logs: Array.isArray(parsed?.logs) ? parsed.logs : [],
        };
      } catch {
        this.data = { seedVersion: 0, triggers: [], logs: [] };
      }
    }

    if (!this.data.triggers.length) {
      this.data.triggers = defaultTriggers();
      this.data.logs = demoLogs();
      this.data.seedVersion = TRIGGER_SEED_VERSION;
      this.applyDemoStats();
      this.save();
      return;
    }

    if ((this.data.seedVersion ?? 1) < TRIGGER_SEED_VERSION) {
      const added = this.mergeDefaults();
      if (!this.data.logs.length) {
        this.data.logs = demoLogs();
        this.applyDemoStats();
      }
      this.data.seedVersion = TRIGGER_SEED_VERSION;
      if (added) this.save();
    }
  }

  private mergeDefaults(): number {
    const existing = new Set(this.data.triggers.map((t) => t.id));
    let added = 0;
    for (const def of defaultTriggers()) {
      if (!existing.has(def.id)) {
        this.data.triggers.push({ ...def });
        added++;
      }
    }
    return added;
  }

  private applyDemoStats() {
    const stats = new Map<string, { count: number; last: string; error?: string }>();
    for (const log of this.data.logs) {
      const prev = stats.get(log.triggerId);
      const last = prev && new Date(prev.last) > new Date(log.at) ? prev.last : log.at;
      stats.set(log.triggerId, {
        count: (prev?.count ?? 0) + 1,
        last,
        error: log.ok ? prev?.error : log.detail,
      });
    }
    for (const t of this.data.triggers) {
      const s = stats.get(t.id);
      if (!s) continue;
      t.hitCount = (t.hitCount ?? 0) + s.count;
      t.lastRunAt = s.last;
      if (s.error) t.lastError = s.error;
    }
  }

  private save() {
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(tmp, this.filePath);
  }

  list(): { triggers: TriggerDef[]; logs: TriggerLog[]; seedVersion: number } {
    return { triggers: this.data.triggers, logs: this.data.logs, seedVersion: this.data.seedVersion ?? TRIGGER_SEED_VERSION };
  }

  resetDefaults(): TriggerDef[] {
    this.mergeDefaults();
    this.data.seedVersion = TRIGGER_SEED_VERSION;
    this.save();
    return this.data.triggers;
  }

  create(input: Omit<TriggerDef, "id" | "hitCount" | "lastRunAt" | "lastError">): TriggerDef {
    const item: TriggerDef = {
      ...input,
      id: `trg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      hitCount: 0,
    };
    this.data.triggers.unshift(item);
    this.save();
    return item;
  }

  update(id: string, patch: Partial<TriggerDef>): TriggerDef | undefined {
    const idx = this.data.triggers.findIndex((t) => t.id === id);
    if (idx < 0) return undefined;
    const prev = this.data.triggers[idx];
    this.data.triggers[idx] = {
      ...prev,
      ...patch,
      id: prev.id,
      match: patch.match ? { ...prev.match, ...patch.match } : prev.match,
      action: patch.action ? { ...prev.action, ...patch.action } : prev.action,
    };
    this.save();
    return this.data.triggers[idx];
  }

  replace(id: string, input: Pick<TriggerDef, "name" | "description" | "category" | "enabled" | "event" | "match" | "action">): TriggerDef | undefined {
    const idx = this.data.triggers.findIndex((t) => t.id === id);
    if (idx < 0) return undefined;
    const prev = this.data.triggers[idx];
    this.data.triggers[idx] = {
      id: prev.id,
      builtin: prev.builtin,
      hitCount: prev.hitCount,
      lastRunAt: prev.lastRunAt,
      lastError: prev.lastError,
      ...input,
      description: input.description || prev.description,
    };
    this.save();
    return this.data.triggers[idx];
  }

  remove(id: string): boolean {
    const before = this.data.triggers.length;
    this.data.triggers = this.data.triggers.filter((t) => t.id !== id);
    if (this.data.triggers.length === before) return false;
    this.save();
    return true;
  }

  clearLogs() {
    this.data.logs = [];
    this.save();
  }

  private recordLog(trigger: TriggerDef, ok: boolean, detail: string) {
    trigger.hitCount = (trigger.hitCount ?? 0) + 1;
    trigger.lastRunAt = new Date().toISOString();
    trigger.lastError = ok ? undefined : detail;
    this.data.logs.unshift({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      triggerId: trigger.id,
      triggerName: trigger.name,
      event: trigger.event,
      ok,
      detail: detail.slice(0, 300),
      at: trigger.lastRunAt,
    });
    if (this.data.logs.length > MAX_LOGS) this.data.logs.length = MAX_LOGS;
    this.save();
  }

  async onIncomingMessage(msg: IncomingMessage): Promise<void> {
    if (msg.direction === "out" || this.busy) return;
    const active = this.data.triggers.filter((t) => t.enabled && t.event === "incoming_message");
    if (!active.length) return;

    const text = msg.text ?? "";
    const vars: Record<string, string> = {
      text,
      sender: msg.from?.name || msg.from?.username || msg.chatTitle || msg.chatId,
      username: msg.from?.username || "",
      provider: msg.provider,
      chatId: msg.chatId,
      chatTitle: msg.chatTitle || msg.chatId,
    };

    const matches = (t: TriggerDef) => {
      if (t.match.provider && t.match.provider !== "*" && t.match.provider !== msg.provider) return false;
      if (t.match.chatType && t.match.chatType !== "*" && t.match.chatType !== msg.chatType) return false;
      if (t.match.chatId && t.match.chatId !== msg.chatId) return false;
      if (t.match.contains && !matchPattern(t.match.contains, text)) return false;
      return true;
    };

    // Specific automations win. The default smart assistant is only the fallback.
    let handled = false;
    for (const t of active) {
      if (t.id === "ai-assistant-default") continue;
      if (!matches(t)) continue;
      await this.execute(t, vars, { message: msg });
      handled = true;
    }
    const fallback = active.find((t) => t.id === "ai-assistant-default");
    if (!handled && fallback && matches(fallback)) {
      await this.execute(fallback, vars, { message: msg });
    }
  }

  async onToolEvent(ev: {
    tool: string;
    args: unknown;
    ok: boolean;
    error?: string;
    ms?: number;
    source: string;
  }): Promise<void> {
    if (this.busy || ev.source === "trigger") return;
    const targetEvent: TriggerEvent = ev.ok ? "tool_called" : "tool_error";
    const active = this.data.triggers.filter((t) => t.enabled && t.event === targetEvent);
    if (!active.length) return;

    const vars: Record<string, string> = {
      toolName: ev.tool,
      error: ev.error ?? "",
      args: compactToolResult(ev.args, 400),
      ms: String(ev.ms ?? 0),
    };

    for (const t of active) {
      if (!matchPattern(t.match.toolName, ev.tool)) continue;
      await this.execute(t, vars, { toolCall: ev });
    }
  }

  async testTrigger(id: string): Promise<{ ok: boolean; detail: string }> {
    const t = this.data.triggers.find((x) => x.id === id);
    if (!t) return { ok: false, detail: "تریگر پیدا نشد" };
    const sampleVars: Record<string, string> =
      t.event === "incoming_message"
        ? {
            text: "سلام، این یک پیام آزمایشی برای تست تریگر است.",
            sender: "کاربر تست",
            username: "test_user",
            provider: t.match.provider && t.match.provider !== "*" ? t.match.provider : "bale_client",
            chatId: t.match.chatId || "",
            chatTitle: "چت تست",
          }
        : {
            toolName: "bale_client_send_message",
            error: "خطای آزمایشی برای تست تریگر",
            args: '{"chat_id":"123","text":"test"}',
            ms: "42",
          };
    return this.execute(t, sampleVars, { test: true });
  }

  async runManual(id: string, input: Record<string, string> = {}): Promise<{ ok: boolean; detail: string }> {
    const t = this.data.triggers.find((x) => x.id === id);
    if (!t) return { ok: false, detail: "تریگر پیدا نشد" };
    const vars: Record<string, string> = {
      text: "",
      sender: "اجرای دستی",
      username: "",
      provider: "",
      chatId: "",
      chatTitle: "اجرای دستی",
      toolName: "",
      error: "",
      args: "",
      ms: "0",
      ...input,
    };
    return this.execute(t, vars, { manual: true, vars });
  }

  private async execute(
    t: TriggerDef,
    vars: Record<string, string>,
    rawPayload: Record<string, unknown>,
  ): Promise<{ ok: boolean; detail: string }> {
    this.busy = true;
    try {
      const a = t.action;
      if (a.type === "reply_template") {
        const providerId = vars.provider;
        const chatId = vars.chatId;
        if (!providerId || !chatId) throw new Error("شناسه‌ی چت یا پیام‌رسان برای پاسخ مشخص نیست");
        const reply = interpolate(a.template || "پیام شما دریافت شد.", vars);
        const r = await this.host.callTool(`${providerId}_send_message`, { chat_id: chatId, text: reply }, "dashboard");
        if (!r.ok) throw new Error(r.error || "ارسال پاسخ ناموفق بود");
        const detail = `پاسخ به ${providerId}:${chatId} ارسال شد`;
        this.recordLog(t, true, detail);
        return { ok: true, detail };
      }

      if (a.type === "ai_reply") {
        const providerId = vars.provider;
        const chatId = vars.chatId;
        if (!providerId || !chatId) throw new Error("شناسه‌ی چت یا پیام‌رسان برای پاسخ AI مشخص نیست");
        const dr = this.host.store.dibarouter();
        if (!dr.apiKey) throw new Error("دیبا روتر متصل نیست");
        const out = await dibaRouterChat(
          dr,
          [
            { role: "system", content: a.systemPrompt || "تو دستیار فارسی هستی. کوتاه و مفید پاسخ بده." },
            { role: "user", content: (vars.text || "").slice(0, 1200) },
          ],
          { maxTokens: 400, temperature: 0.35 },
        );
        if (!out.reply) throw new Error("مدل پاسخی برنگرداند");
        const r = await this.host.callTool(`${providerId}_send_message`, { chat_id: chatId, text: out.reply }, "dashboard");
        if (!r.ok) throw new Error(r.error || "ارسال پاسخ AI ناموفق بود");
        const detail = `پاسخ AI به ${providerId}:${chatId} ارسال شد`;
        this.recordLog(t, true, detail);
        return { ok: true, detail };
      }

      if (a.type === "forward") {
        const targetProvider = a.targetProvider || "bale_client";
        const p = this.host.provider(targetProvider);
        if (!p || !this.host.store.isReady(p)) throw new Error(`سرویس مقصد (${targetProvider}) آماده نیست`);
        const resolved = this.host.store.resolve(p);
        const targetChatId = a.targetChatId?.trim() || resolved.values.defaultChatId?.trim();
        if (!targetChatId) throw new Error(`چت پیش‌فرض یا مقصد برای ${targetProvider} تنظیم نشده`);
        const msgText = interpolate(a.template || "{{text}}", vars);
        const r = await this.host.callTool(`${targetProvider}_send_message`, { chat_id: targetChatId, text: msgText }, "dashboard");
        if (!r.ok) throw new Error(r.error || "فوروارد ناموفق بود");
        const detail = `به ${targetProvider}:${targetChatId} ارسال شد`;
        this.recordLog(t, true, detail);
        return { ok: true, detail };
      }

      if (a.type === "call_tool") {
        if (!a.toolName) throw new Error("نام ابزار برای اجرا مشخص نشده");
        let parsedArgs: Record<string, unknown> = {};
        if (a.toolArgs?.trim()) {
          parsedArgs = JSON.parse(interpolate(a.toolArgs, vars));
        }
        const r = await this.host.callTool(a.toolName, parsedArgs, "dashboard");
        if (!r.ok) throw new Error(r.error || "اجرای ابزار ناموفق بود");
        const detail = `ابزار ${a.toolName} اجرا شد`;
        this.recordLog(t, true, detail);
        return { ok: true, detail };
      }

      if (a.type === "webhook") {
        const url = a.webhookUrl?.trim();
        if (!url || !/^https?:\/\//i.test(url)) throw new Error("آدرس Webhook معتبر نیست");
        const res = await netFetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "user-agent": "dibaMCP-Trigger/0.4" },
          body: JSON.stringify({
            event: t.event,
            trigger: { id: t.id, name: t.name },
            vars,
            ...rawPayload,
            timestamp: new Date().toISOString(),
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`Webhook HTTP ${res.status}`);
        const detail = `وبهوک با وضعیت ${res.status} ارسال شد`;
        this.recordLog(t, true, detail);
        return { ok: true, detail };
      }

      throw new Error(`نوع اقدام ناشناخته: ${(a as any).type}`);
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      this.recordLog(t, false, msg);
      return { ok: false, detail: msg };
    } finally {
      this.busy = false;
    }
  }
}
