export interface ContextPlan {
  contextLength: number;
  inputTokens: number;
  outputTokens: number;
  toolTokens: number;
  maxTools: number;
  toolResultChars: number;
  historyChars: number;
  messageChars: number;
  summaryChars: number;
  compact: boolean;
}

export const UNKNOWN_CONTEXT_LENGTH = 8192;
const MIN_CONTEXT = 1024;
const MAX_INPUT_TOKENS = 24_000;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function planContext(contextLength?: number, wantOutput = 1000): ContextPlan {
  const known = typeof contextLength === "number" && Number.isFinite(contextLength) && contextLength >= MIN_CONTEXT;
  const ctx = Math.floor(known ? contextLength! : UNKNOWN_CONTEXT_LENGTH);

  const outputTokens = clamp(Math.floor(ctx * 0.2), 192, wantOutput);
  const margin = Math.max(160, Math.floor(ctx * (ctx <= 16_384 ? 0.14 : 0.08)));
  const inputTokens = clamp(ctx - outputTokens - margin, 400, MAX_INPUT_TOKENS);

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
          this.loadedAt = Date.now() - (this.opts.ttlMs ?? 10 * 60_000) + 60_000;
          this.loadedFrom = source;
        })
        .finally(() => {
          this.loading = undefined;
        });
    }
    return this.loading;
  }

  remember(source: string, models: ModelEntry[]): void {
    this.advertised = new Map(
      models.filter((m) => m?.id && m.context_length > 0).map((m) => [this.key(source, m.id), m.context_length]),
    );
    this.loadedAt = Date.now();
    this.loadedFrom = source;
  }

  async limitOf(source: string, model: string): Promise<number | undefined> {
    const learned = this.learned.get(this.key(source, model));
    const stale = this.loadedFrom !== source || Date.now() - this.loadedAt > (this.opts.ttlMs ?? 10 * 60_000);
    if (stale) {
      const pending = this.refresh(source);
      await Promise.race([pending, new Promise<void>((resolve) => setTimeout(resolve, this.opts.waitMs ?? 4000))]);
    }
    const advertised = this.loadedFrom === source ? this.advertised.get(this.key(source, model)) : undefined;
    if (learned && advertised) return Math.min(learned, advertised);
    return learned ?? advertised;
  }

  learn(source: string, model: string, limit: number): number {
    const value = Math.max(MIN_CONTEXT, Math.floor(limit));
    const key = this.key(source, model);
    const previous = this.learned.get(key);
    const next = previous ? Math.min(previous, value) : value;
    this.learned.set(key, next);
    return next;
  }
}
