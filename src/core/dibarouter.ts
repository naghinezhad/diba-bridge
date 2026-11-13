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
  opts: {
    maxTokens?: number;
    temperature?: number;
    tools?: DibaRouterTool[];
    toolChoice?: "auto" | "none";
    onDelta?: (delta: string) => void;
  } = {},
): Promise<{ reply: string; model: string; routedModel?: string; cost?: number; toolCalls?: DibaRouterToolCall[]; finishReason?: string }> {
  if (!config.apiKey) throw new DibaRouterError("کلید API دیبا روتر ثبت نشده است.", 400);
  const wantStream = typeof opts.onDelta === "function";
  const body: Record<string, unknown> = {
    model: config.model || DIBAROUTER_DEFAULT_MODEL,
    messages,
    max_tokens: opts.maxTokens ?? 900,
    temperature: opts.temperature ?? 0.35,
    stream: wantStream,
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

  const contentType = String(res.headers.get("content-type") ?? "").toLowerCase();
  if (wantStream && contentType.includes("text/event-stream") && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let replyAcc = "";
    let model = String(config.model || DIBAROUTER_DEFAULT_MODEL);
    let finishReason: string | undefined;
    let cost: number | undefined;
    const toolMap = new Map<number, { id: string; name: string; arguments: string }>();

    const handleLine = (rawLine: string) => {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") return;
      let chunk: any;
      try {
        chunk = JSON.parse(payload);
      } catch {
        return;
      }
      if (chunk?.model) model = String(chunk.model);
      if (typeof chunk?.usage?.cost === "number") cost = chunk.usage.cost;
      const choice = chunk?.choices?.[0];
      if (!choice) return;
      if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason;
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string" && delta.content) {
        replyAcc += delta.content;
        opts.onDelta!(delta.content);
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = typeof tc.index === "number" ? tc.index : 0;
          const prev = toolMap.get(idx) ?? { id: "", name: "", arguments: "" };
          if (tc.id) prev.id = String(tc.id);
          if (tc.function?.name) prev.name += String(tc.function.name);
          if (typeof tc.function?.arguments === "string") prev.arguments += tc.function.arguments;
          toolMap.set(idx, prev);
        }
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nlIdx = buffer.indexOf("\n");
      while (nlIdx >= 0) {
        handleLine(buffer.slice(0, nlIdx));
        buffer = buffer.slice(nlIdx + 1);
        nlIdx = buffer.indexOf("\n");
      }
    }
    if (buffer.trim()) handleLine(buffer);

    const toolCalls: DibaRouterToolCall[] | undefined = toolMap.size
      ? [...toolMap.entries()]
          .sort((a, b) => a[0] - b[0])
          .filter(([, tc]) => tc.name)
          .map(([idx, tc]) => ({
            id: tc.id || `call_${Date.now()}_${idx}`,
            type: "function" as const,
            function: { name: tc.name, arguments: tc.arguments || "{}" },
          }))
      : undefined;

    return {
      reply: replyAcc.trim(),
      model,
      routedModel: res.headers.get("x-routed-model") ?? undefined,
      cost,
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      finishReason,
    };
  }

  const data: any = await res.json();
  const message = data?.choices?.[0]?.message ?? {};
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
  if (wantStream && reply && !toolCalls?.length) opts.onDelta!(reply);
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
