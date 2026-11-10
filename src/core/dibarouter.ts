/**
 * اتصال OpenAI-compatible به DibaRouter (https://dibarouter.ir/docs).
 * همه‌ی درخواست‌ها از سمت سرور انجام می‌شود تا کلید API به مرورگر نرسد.
 */
import { netFetch } from "./net.js";
import { DIBAROUTER_DEFAULT_BASE, DIBAROUTER_DEFAULT_MODEL, type DibaRouterStored } from "./store.js";

export interface DibaRouterConfig extends Required<DibaRouterStored> {
  apiKeyFromEnv?: boolean;
  baseUrlFromEnv?: boolean;
  modelFromEnv?: boolean;
}

export interface DibaRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class DibaRouterError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

function baseOf(config: DibaRouterConfig): string {
  return (config.baseUrl || DIBAROUTER_DEFAULT_BASE).replace(/\/+$/, "");
}

function headers(config: DibaRouterConfig): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    "X-Title": "dibaMCP",
  };
  if (config.apiKey) h.authorization = `Bearer ${config.apiKey}`;
  return h;
}

async function drFetch(config: DibaRouterConfig, path: string, init: any = {}, timeoutMs = 90_000): Promise<any> {
  try {
    return await netFetch(`${baseOf(config)}${path}`, {
      ...init,
      headers: { ...headers(config), ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: any) {
    throw new DibaRouterError(`دسترسی به دیبا روتر برقرار نشد: ${err?.message ?? err}`, 502);
  }
}

async function readError(res: any): Promise<string> {
  const data: any = await res.json().catch(() => ({}));
  return String(data?.error?.message ?? data?.error ?? data?.message ?? `HTTP ${res.status}`);
}

export async function dibaRouterModels(config: DibaRouterConfig): Promise<any[]> {
  const res = await drFetch(config, "/models", { method: "GET" }, 30_000);
  if (!res.ok) throw new DibaRouterError(await readError(res), res.status);
  const data: any = await res.json();
  const list = Array.isArray(data?.data) ? data.data : [];
  return list
    .filter((m: any) => {
      const category = String(m?.category ?? "").toLowerCase();
      return !category || category === "chat" || category === "vision";
    })
    .map((m: any) => ({
      id: String(m.id),
      name: m.name ? String(m.name) : String(m.id),
      category: m.category,
      context_length: m.context_length,
      is_free: Boolean(m.is_free),
      supports_tools: Boolean(m.supports_tools),
    }));
}

export async function dibaRouterChat(
  config: DibaRouterConfig,
  messages: DibaRouterMessage[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<{ reply: string; model: string; routedModel?: string; cost?: number }> {
  if (!config.apiKey) throw new DibaRouterError("کلید API دیبا روتر ثبت نشده است.", 400);
  const res = await drFetch(config, "/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model: config.model || DIBAROUTER_DEFAULT_MODEL,
      messages,
      max_tokens: opts.maxTokens ?? 900,
      temperature: opts.temperature ?? 0.35,
      stream: false,
    }),
  });
  if (!res.ok) throw new DibaRouterError(await readError(res), res.status);
  const data: any = await res.json();
  const reply = data?.choices?.[0]?.message?.content;
  if (typeof reply !== "string" || !reply.trim()) throw new DibaRouterError("پاسخ خالی از دیبا روتر دریافت شد.", 502);
  return {
    reply: reply.trim(),
    model: String(data?.model ?? config.model),
    routedModel: res.headers.get("x-routed-model") ?? undefined,
    cost: typeof data?.usage?.cost === "number" ? data.usage.cost : undefined,
  };
}

export async function dibaRouterTest(config: DibaRouterConfig): Promise<{ reply: string; model: string; routedModel?: string }> {
  const result = await dibaRouterChat(
    config,
    [
      { role: "system", content: "You are a connectivity test. Reply with exactly: OK" },
      { role: "user", content: "ping" },
    ],
    { maxTokens: 8, temperature: 0 },
  );
  return { reply: result.reply, model: result.model, routedModel: result.routedModel };
}
