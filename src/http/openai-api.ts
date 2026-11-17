/**
 * OpenAI-compatible API for the assistant.
 *
 *   GET  /v1/models
 *   GET  /v1/models/{id}
 *   POST /v1/chat/completions      (JSON or SSE streaming)
 *
 * Any OpenAI SDK works by pointing its base URL here and using the MCP token as the API key.
 * The assistant runs its own tools on the server, so a completion is always a final text answer;
 * `tools` sent by the client are ignored.
 */
import { randomBytes } from "node:crypto";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { AgentError, contentText, runAgent, type AgentRunResult } from "../core/assistant/runner.js";
import { safeEqual, type RateLimiter } from "../core/auth.js";
import type { ModelLimits } from "../core/context-budget.js";
import type { DibaMcpEngine } from "../core/engine.js";

export const AGENT_MODEL = "diba-agent";
/** `diba-agent:<upstream model>` runs the assistant on another DibaRouter model for that request */
const MODEL_OVERRIDE = `${AGENT_MODEL}:`;
const MODEL_CREATED = 1_760_000_000;

type ErrorType = "invalid_request_error" | "authentication_error" | "rate_limit_error" | "api_error";

function sendError(res: Response, status: number, message: string, type: ErrorType, code: string | null = null, param: string | null = null) {
  if (res.headersSent) return;
  res.status(status).json({ error: { message, type, param, code } });
}

function modelObject(id: string) {
  return { id, object: "model", created: MODEL_CREATED, owned_by: "dibachain" };
}

/** Maps the requested model to the upstream model override; null means the model does not exist here */
export function resolveAgentModel(requested: unknown): { id: string; upstream?: string } | null {
  if (requested === undefined || requested === null || requested === "") return { id: AGENT_MODEL };
  if (typeof requested !== "string") return null;
  if (requested === AGENT_MODEL) return { id: AGENT_MODEL };
  if (requested.startsWith(MODEL_OVERRIDE) && requested.length > MODEL_OVERRIDE.length) return { id: requested, upstream: requested.slice(MODEL_OVERRIDE.length) };
  return null;
}

/** A stable conversation key lets the assistant keep memory and a pending confirmation between requests */
export function conversationKey(req: Request): string {
  const raw = req.headers["x-conversation-id"] ?? req.body?.metadata?.conversation_id ?? req.body?.user;
  const value = String(Array.isArray(raw) ? raw[0] : raw ?? "").replace(/[^A-Za-z0-9_.:@-]/g, "").slice(0, 80);
  return value ? `api:${value}` : "api";
}

function usageOf(result: AgentRunResult) {
  const { promptTokens, completionTokens } = result.usage;
  return { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens };
}

/** What the assistant did on the server; a non-standard field that OpenAI clients simply ignore */
function dibaInfo(result: AgentRunResult) {
  return {
    upstream_model: result.routedModel ?? result.model,
    tool_calls: result.toolTrace.map((t) => ({ name: t.name, ok: t.ok, ms: t.ms, error: t.error, cached: t.cached || undefined })),
    awaiting_confirmation: Boolean(result.pending),
    truncated: Boolean(result.truncated),
  };
}

function errorFor(err: any): { status: number; message: string; type: ErrorType; code: string | null } {
  if (err instanceof AgentError) {
    if (err.code === "model_not_configured") {
      return { status: 503, message: "The assistant has no model yet: connect DibaRouter in the dashboard (DibaRouter tab).", type: "api_error", code: err.code };
    }
    return { status: err.status, message: err.message, type: "invalid_request_error", code: err.code };
  }
  const upstream = Number(err?.status) || 0;
  const message = String(err?.message ?? err);
  if (upstream === 429) return { status: 429, message, type: "rate_limit_error", code: "upstream_rate_limit" };
  if (upstream === 400 || upstream === 404 || upstream === 422) return { status: 400, message, type: "invalid_request_error", code: "upstream_rejected" };
  return { status: 502, message, type: "api_error", code: "upstream_error" };
}

export function createOpenAiRouter(engine: DibaMcpEngine, deps: { modelLimits: ModelLimits; limiter: RateLimiter }): Router {
  const router = express.Router();

  router.use((req, res, next) => {
    const key = req.ip ?? "?";
    if (deps.limiter.allow(key)) return next();
    res.set("Retry-After", String(deps.limiter.retryAfter(key)));
    sendError(res, 429, `Rate limit exceeded (${deps.limiter.max} requests per minute).`, "rate_limit_error", "rate_limit_exceeded");
  });

  router.use((req, res, next) => {
    const header = req.headers.authorization ?? "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const extra = req.headers["x-api-key"];
    const token = bearer || (typeof extra === "string" ? extra.trim() : "");
    if (!token) return void sendError(res, 401, "Missing API key. Send the MCP token as `Authorization: Bearer <token>`.", "authentication_error", "missing_api_key");
    if (!safeEqual(token, engine.store.mcpToken)) return void sendError(res, 401, "Incorrect API key provided.", "authentication_error", "invalid_api_key");
    next();
  });

  router.use(express.json({ limit: "4mb" }));

  router.get("/models", (_req, res) => {
    res.json({ object: "list", data: [modelObject(AGENT_MODEL)] });
  });

  router.get(/^\/models\/(.+)$/, (req, res) => {
    const model = resolveAgentModel(decodeURIComponent(String(req.params[0] ?? "")));
    if (!model) return void sendError(res, 404, "The model does not exist.", "invalid_request_error", "model_not_found", "model");
    res.json(modelObject(model.id));
  });

  router.post("/chat/completions", async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) return void sendError(res, 400, "The request body must be a JSON object.", "invalid_request_error");
    if (!Array.isArray(body.messages) || !body.messages.length) {
      return void sendError(res, 400, "`messages` must be a non-empty array.", "invalid_request_error", null, "messages");
    }
    const model = resolveAgentModel(body.model);
    if (!model) {
      return void sendError(res, 404, `The model \`${String(body.model).slice(0, 80)}\` does not exist. Use \`${AGENT_MODEL}\`.`, "invalid_request_error", "model_not_found", "model");
    }
    if (body.n !== undefined && body.n !== null && body.n !== 1) {
      return void sendError(res, 400, "Only `n: 1` is supported.", "invalid_request_error", null, "n");
    }

    const instructions = body.messages
      .filter((m: any) => m?.role === "system" || m?.role === "developer")
      .map((m: any) => contentText(m.content))
      .filter(Boolean)
      .join("\n\n");
    const stream = body.stream === true;
    const includeUsage = body.stream_options?.include_usage === true;
    const id = `chatcmpl-${randomBytes(12).toString("hex")}`;
    const created = Math.floor(Date.now() / 1000);

    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });

    // the stream opens on the first event, so a request that fails up front still gets a normal HTTP error
    let opened = false;
    const open = () => {
      if (opened || !stream || res.writableEnded) return;
      opened = true;
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();
      chunk({ role: "assistant", content: "" }, null);
    };
    const chunk = (delta: Record<string, unknown>, finishReason: string | null, extra: Record<string, unknown> = {}) => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: model.id, choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason }], ...extra })}\n\n`);
    };
    // progress has no place in the OpenAI stream format; SSE comments keep the connection alive and are ignored by clients
    const comment = (text: string) => {
      open();
      if (!res.writableEnded) res.write(`: ${text.replace(/[\r\n]+/g, " ")}\n\n`);
    };

    try {
      const result = await runAgent(engine, deps.modelLimits, {
        messages: body.messages,
        conversationId: conversationKey(req),
        signal: abort.signal,
        model: model.upstream,
        temperature: typeof body.temperature === "number" ? body.temperature : undefined,
        maxTokens: Number(body.max_completion_tokens ?? body.max_tokens) || undefined,
        instructions,
        onStatus: stream ? (text) => comment(`status ${text}`) : undefined,
        onTool: stream ? (item) => comment(`tool ${item.name} ${item.ok ? "ok" : "failed"}`) : undefined,
        onDelta: stream
          ? (delta) => {
              open();
              chunk({ content: delta }, null);
            }
          : undefined,
      });
      if (!result) {
        if (!res.writableEnded) res.end();
        return;
      }

      if (stream) {
        open();
        chunk({}, result.finishReason, { diba: dibaInfo(result) });
        if (includeUsage && !res.writableEnded) {
          res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: model.id, choices: [], usage: usageOf(result) })}\n\n`);
        }
        if (!res.writableEnded) res.write("data: [DONE]\n\n");
        return void res.end();
      }

      res.json({
        id,
        object: "chat.completion",
        created,
        model: model.id,
        choices: [{ index: 0, message: { role: "assistant", content: result.reply, refusal: null }, logprobs: null, finish_reason: result.finishReason }],
        usage: usageOf(result),
        system_fingerprint: null,
        diba: dibaInfo(result),
      });
    } catch (err: any) {
      if (abort.signal.aborted) {
        if (!res.writableEnded) res.end();
        return;
      }
      const e = errorFor(err);
      if (opened) {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ error: { message: e.message, type: e.type, param: null, code: e.code } })}\n\n`);
          res.end();
        }
        return;
      }
      sendError(res, e.status, e.message, e.type, e.code);
    }
  });

  router.use((_req, res) => {
    sendError(res, 404, "Unknown endpoint. Available: GET /v1/models, POST /v1/chat/completions.", "invalid_request_error", "unknown_url");
  });

  router.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) return void sendError(res, 400, "The request body is not valid JSON.", "invalid_request_error");
    if (err?.type === "entity.too.large") return void sendError(res, 413, "The request body is too large.", "invalid_request_error");
    console.error("[diba-mcp] OpenAI API error", err);
    sendError(res, 500, "Internal server error.", "api_error");
  });

  return router;
}
