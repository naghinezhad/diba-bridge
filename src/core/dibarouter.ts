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

export interface DibaRouterToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface DibaRouterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: DibaRouterToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface DibaRouterTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
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
  opts: { maxTokens?: number; temperature?: number; tools?: DibaRouterTool[]; toolChoice?: "auto" | "none" } = {},
): Promise<{ reply: string; model: string; routedModel?: string; cost?: number; toolCalls?: DibaRouterToolCall[]; finishReason?: string }> {
  if (!config.apiKey) throw new DibaRouterError("کلید API دیبا روتر ثبت نشده است.", 400);
  const body: Record<string, unknown> = {
    model: config.model || DIBAROUTER_DEFAULT_MODEL,
    messages,
    max_tokens: opts.maxTokens ?? 900,
    temperature: opts.temperature ?? 0.35,
    stream: false,
  };
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = opts.toolChoice ?? "auto";
  }
  const res = await drFetch(config, "/chat/completions", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new DibaRouterError(await readError(res), res.status);
  const data: any = await res.json();
  const message = data?.choices?.[0]?.message ?? {};
  // Some OpenAI-compatible routers put the answer in `text` or use a
  // multimodal content array. Accept all of them so an otherwise valid reply
  // is not reported as empty.
  const content = message.content;
  const reply = typeof content === "string"
    ? content.trim()
    : Array.isArray(content)
      ? content.map((part: any) => (typeof part === "string" ? part : part?.text?.value ?? part?.text ?? "")).join("").trim()
      : typeof data?.choices?.[0]?.text === "string"
        ? data.choices[0].text.trim()
        : "";
  const finishReason = typeof data?.choices?.[0]?.finish_reason === "string" ? data.choices[0].finish_reason : undefined;
  let toolCalls: DibaRouterToolCall[] | undefined = Array.isArray(message.tool_calls)
    ? message.tool_calls
        .filter((call: any) => call?.function?.name)
        .map((call: any, i: number) => ({
          id: String(call.id ?? `call_${Date.now()}_${i}`),
          type: "function" as const,
          function: {
            name: String(call.function.name),
            arguments: typeof call.function.arguments === "string" ? call.function.arguments : JSON.stringify(call.function.arguments ?? {}),
          },
        }))
    : undefined;
  // Older OpenAI-compatible servers return the legacy single function_call shape.
  if (!toolCalls?.length && message.function_call?.name) {
    toolCalls = [{
      id: `call_${Date.now()}`,
      type: "function",
      function: {
        name: String(message.function_call.name),
        arguments: typeof message.function_call.arguments === "string" ? message.function_call.arguments : JSON.stringify(message.function_call.arguments ?? {}),
      },
    }];
  }
  return {
    reply,
    model: String(data?.model ?? config.model),
    routedModel: res.headers.get("x-routed-model") ?? undefined,
    cost: typeof data?.usage?.cost === "number" ? data.usage.cost : undefined,
    toolCalls,
    finishReason,
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
