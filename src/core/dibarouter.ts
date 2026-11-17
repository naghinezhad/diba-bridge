import { describeNetError, netFetch, netFetchDirect, proxyMode } from "./net.js";
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

export type DibaRouterToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

export class DibaRouterError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

export function normalizeBaseUrl(raw: string | undefined): string {
  let value = String(raw || DIBAROUTER_DEFAULT_BASE).trim().replace(/\/+$/, "");
  value = value.replace(/\/(?:chat\/completions|completions|models)$/i, "").replace(/\/+$/, "");
  try {
    const url = new URL(value);
    if (/(^|\.)dibarouter\.ir$/i.test(url.hostname) && /^(?:|\/|\/api|\/v1|\/api\/?)$/i.test(url.pathname)) {
      url.pathname = "/api/v1";
      value = url.toString().replace(/\/+$/, "");
    }
  } catch {
  }
  return value;
}

function baseOf(config: DibaRouterConfig): string {
  return normalizeBaseUrl(config.baseUrl);
}

function headers(config: DibaRouterConfig): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    "X-Title": "dibaMCP",
  };
  if (config.apiKey) h.authorization = `Bearer ${config.apiKey}`;
  return h;
}

type Route = "proxy" | "direct";
const workingRoute = new Map<string, { route: Route; at: number }>();
const ROUTE_MEMORY_MS = 5 * 60_000;

function routesFor(origin: string): Route[] {
  if (proxyMode().type === "direct") return ["direct"];
  const forced = String(process.env.DIBAROUTER_ROUTE ?? "").toLowerCase();
  if (forced === "direct" || forced === "proxy") return [forced];
  const remembered = workingRoute.get(origin);
  const first: Route = remembered && Date.now() - remembered.at < ROUTE_MEMORY_MS ? remembered.route : "proxy";
  return first === "proxy" ? ["proxy", "direct"] : ["direct", "proxy"];
}

async function drFetch(config: DibaRouterConfig, path: string, init: any = {}, timeoutMs = 90_000): Promise<any> {
  const url = `${baseOf(config)}${path}`;
  let origin = url;
  try {
    origin = new URL(url).origin;
  } catch {
    throw new DibaRouterError("آدرس پایه‌ی دیبا روتر معتبر نیست. نشانی رسمی: https://dibarouter.ir/api/v1", 400);
  }
  const routes = routesFor(origin);
  const method = String(init.method ?? "GET").toUpperCase();
  const attempts: Route[] = method === "GET" && routes.length === 1 ? [routes[0], routes[0]] : routes;

  let lastError: any;
  for (const route of attempts) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([timeout, init.signal as AbortSignal]) : timeout;
    try {
      const res = await (route === "direct" ? netFetchDirect : netFetch)(url, {
        ...init,
        headers: { ...headers(config), ...(init.headers as Record<string, string> | undefined) },
        signal,
      });
      workingRoute.set(origin, { route, at: Date.now() });
      return res;
    } catch (err: any) {
      if (init.signal?.aborted) throw err;
      lastError = err;
    }
  }
  const tried = routes.length > 1 ? " (هم از مسیر پراکسی و هم مستقیم امتحان شد)" : proxyMode().type === "direct" ? "" : " (از مسیر پراکسی)";
  throw new DibaRouterError(`دسترسی به دیبا روتر برقرار نشد: ${describeNetError(lastError)}${tried}`, 502);
}

async function readJson(res: any): Promise<any> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new DibaRouterError(
      "پاسخ دیبا روتر قابل خواندن نبود (JSON نیست). آدرس پایه را بررسی کنید؛ نشانی رسمی: https://dibarouter.ir/api/v1",
      502,
    );
  }
}

async function readError(res: any): Promise<string> {
  const text = await res.text().catch(() => "");
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    if (res.status === 404) return "این مسیر در دیبا روتر پیدا نشد (HTTP 404). آدرس پایه را بررسی کنید؛ نشانی رسمی: https://dibarouter.ir/api/v1";
    return `HTTP ${res.status}`;
  }
  const error = data?.error;
  const message = (typeof error === "object" ? error?.message : error) ?? data?.message ?? data?.detail;
  return String(message || `HTTP ${res.status}`);
}

export interface DibaRouterModelInfo {
  id: string;
  name: string;
  category: string;
  context_length: number;
  is_free: boolean;
  supports_tools: boolean;
  description: string;
}

export async function dibaRouterModels(config: DibaRouterConfig): Promise<DibaRouterModelInfo[]> {
  const res = await drFetch(config, "/models", { method: "GET" }, 30_000);
  if (!res.ok) throw new DibaRouterError(await readError(res), res.status);
  const data: any = await readJson(res);
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : Array.isArray(data?.models) ? data.models : [];
  return list
    .filter((m: any) => {
      if (!m?.id) return false;
      if (m.available === false) return false;
      const category = String(m?.category ?? "").toLowerCase();
      return !category || category === "chat" || category === "vision";
    })
    .map((m: any) => ({
      id: String(m.id),
      name: m.name ? String(m.name) : String(m.id),
      category: String(m.category ?? "chat"),
      context_length: Number(m.context_length ?? m.top_provider?.context_length ?? m.context_window) || 0,
      is_free: Boolean(m.is_free),
      supports_tools: Array.isArray(m.supported_parameters)
        ? m.supported_parameters.includes("tools")
        : Boolean(m.supports_tools),
      description: typeof m.description === "string" ? m.description.replace(/\s+/g, " ").trim().slice(0, 240) : "",
    }));
}

export async function dibaRouterChat(
  config: DibaRouterConfig,
  messages: DibaRouterMessage[],
  opts: {
    maxTokens?: number;
    temperature?: number;
    tools?: DibaRouterTool[];
    toolChoice?: DibaRouterToolChoice;
    onDelta?: (delta: string) => void;
    signal?: AbortSignal;
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
    signal: opts.signal,
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
      if (opts.signal?.aborted) return;
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

  const data: any = await readJson(res);
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
