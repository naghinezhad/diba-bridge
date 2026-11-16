/**
 * بودجه‌بندی کانتکست بر اساس سقف واقعی هر مدل.
 *
 * مدل‌های دیبا روتر از ۲ هزار تا ۱ میلیون توکن کانتکست دارند. به‌جای یک عدد ثابت،
 * سهم ورودی، خروجی، ابزارها و تاریخچه از سقف همان مدل حساب می‌شود؛ و اگر مدل
 * با خطای «context size» نشان داد سقف واقعی‌اش کمتر از عدد اعلام‌شده است
 * (مثلاً سروری که کانتکست را بین چند اسلات تقسیم کرده)، همان عدد یاد گرفته می‌شود
 * تا درخواست‌های بعدی از اول درست جا شوند.
 */

export interface ContextPlan {
  /** سقف کانتکست مدل (توکن) که این برنامه بر اساس آن ساخته شده */
  contextLength: number;
  /** بیشترین توکن ورودی (پیام‌ها + ابزارها) طبق تخمین خودمان */
  inputTokens: number;
  /** max_tokens پاسخ */
  outputTokens: number;
  /** سهم تعریف ابزارها از ورودی؛ صفر یعنی این مدل برای tool calling جا ندارد */
  toolTokens: number;
  maxTools: number;
  /** سقف کاراکتر خروجی هر ابزار */
  toolResultChars: number;
  /** سقف کاراکتر تاریخچه‌ی گفتگو، هر پیام و خلاصه‌ی پیام‌های قدیمی */
  historyChars: number;
  messageChars: number;
  summaryChars: number;
  /** برای کانتکست کوچک، سیستم‌پرامپت فشرده استفاده می‌شود */
  compact: boolean;
}

/** وقتی سقف مدل معلوم نیست، محتاطانه مثل یک مدل ۸ هزارتایی رفتار می‌کنیم */
export const UNKNOWN_CONTEXT_LENGTH = 8192;
const MIN_CONTEXT = 1024;
/** مدل‌های خیلی بزرگ هم بیش از این ورودی نمی‌گیرند (هزینه و سرعت) */
const MAX_INPUT_TOKENS = 24_000;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function planContext(contextLength?: number, wantOutput = 1000): ContextPlan {
  const known = typeof contextLength === "number" && Number.isFinite(contextLength) && contextLength >= MIN_CONTEXT;
  const ctx = Math.floor(known ? contextLength! : UNKNOWN_CONTEXT_LENGTH);

  const outputTokens = clamp(Math.floor(ctx * 0.2), 192, wantOutput);
  // حاشیه برای خطای تخمین توکن و سربار قالب چت؛ در مدل‌های کوچک سهم بیشتری لازم است
  const margin = Math.max(160, Math.floor(ctx * (ctx <= 16_384 ? 0.14 : 0.08)));
  const inputTokens = clamp(ctx - outputTokens - margin, 400, MAX_INPUT_TOKENS);

  // زیر ~۱۸۰۰ توکن ورودی، تعریف ابزارها جایی برای خود گفتگو نمی‌گذارد
  const toolTokens = inputTokens < 1800 ? 0 : clamp(Math.floor(inputTokens * 0.34), 500, 5000);
  const maxTools = toolTokens ? clamp(Math.floor(toolTokens / 105), 4, 28) : 0;

  const historyChars = clamp(Math.floor(inputTokens * 0.75), 600, 14_000);
  return {
    contextLength: ctx,
    inputTokens,
    outputTokens,
    toolTokens,
    maxTools,
    toolResultChars: clamp(Math.floor(inputTokens * 0.3), 350, 2600),
    historyChars,
    messageChars: clamp(Math.floor(historyChars * 0.36), 280, 3200),
    summaryChars: clamp(Math.floor(historyChars * 0.22), 180, 1600),
    compact: inputTokens < 9000,
  };
}

interface ModelEntry {
  id: string;
  context_length: number;
}

/**
 * سقف کانتکست هر مدل: عدد اعلام‌شده در فهرست مدل‌ها (با کش) و عددی که از خطای خود مدل یاد گرفته‌ایم.
 * خطا یا کندی در خواندن فهرست مدل‌ها هرگز جلوی گفتگو را نمی‌گیرد.
 */
export class ModelLimits {
  private advertised = new Map<string, number>();
  private learned = new Map<string, number>();
  private loadedAt = 0;
  private loadedFrom = "";
  private loading?: Promise<void>;

  constructor(
    private readonly listModels: () => Promise<ModelEntry[]>,
    private readonly opts: { ttlMs?: number; waitMs?: number } = {},
  ) {}

  private key(source: string, model: string): string {
    return `${source}|${model}`;
  }

  private refresh(source: string): Promise<void> {
    if (!this.loading) {
      this.loading = this.listModels()
        .then((models) => {
          this.advertised = new Map(
            models.filter((m) => m?.id && m.context_length > 0).map((m) => [this.key(source, m.id), m.context_length]),
          );
          this.loadedAt = Date.now();
          this.loadedFrom = source;
        })
        .catch(() => {
          // فهرست مدل‌ها در دسترس نبود؛ با سقف پیش‌فرض ادامه می‌دهیم و کمی بعد دوباره امتحان می‌کنیم
          this.loadedAt = Date.now() - (this.opts.ttlMs ?? 10 * 60_000) + 60_000;
          this.loadedFrom = source;
        })
        .finally(() => {
          this.loading = undefined;
        });
    }
    return this.loading;
  }

  /** فهرست مدل‌هایی که همین حالا خوانده شده را ثبت می‌کند (بدون درخواست دوباره) */
  remember(source: string, models: ModelEntry[]): void {
    this.advertised = new Map(
      models.filter((m) => m?.id && m.context_length > 0).map((m) => [this.key(source, m.id), m.context_length]),
    );
    this.loadedAt = Date.now();
    this.loadedFrom = source;
  }

  /**
   * سقف کانتکست مدل؛ undefined یعنی نامعلوم.
   * @param source نشانی پایه‌ی روتر (با تغییر آن، کش قبلی معتبر نیست)
   */
  async limitOf(source: string, model: string): Promise<number | undefined> {
    const learned = this.learned.get(this.key(source, model));
    const stale = this.loadedFrom !== source || Date.now() - this.loadedAt > (this.opts.ttlMs ?? 10 * 60_000);
    if (stale) {
      const pending = this.refresh(source);
      // برای اولین پیام کمی صبر می‌کنیم؛ اگر فهرست دیر رسید، همین درخواست با پیش‌فرض می‌رود
      await Promise.race([pending, new Promise<void>((resolve) => setTimeout(resolve, this.opts.waitMs ?? 4000))]);
    }
    const advertised = this.loadedFrom === source ? this.advertised.get(this.key(source, model)) : undefined;
    if (learned && advertised) return Math.min(learned, advertised);
    return learned ?? advertised;
  }

  /** مدل با خطا نشان داد سقف واقعی‌اش این عدد است */
  learn(source: string, model: string, limit: number): number {
    const value = Math.max(MIN_CONTEXT, Math.floor(limit));
    const key = this.key(source, model);
    const previous = this.learned.get(key);
    const next = previous ? Math.min(previous, value) : value;
    this.learned.set(key, next);
    return next;
  }
}
