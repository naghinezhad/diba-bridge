import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import express from "express";
import { z } from "zod";
import { parameterHint, similarToolNames, stripThinking, thinkingFilter } from "../../src/core/assistant/runner.ts";
import { DibaMcpEngine } from "../../src/core/engine.ts";
import { configureProxy } from "../../src/core/net.ts";
import { defineTool, type ProviderDef } from "../../src/core/types.ts";
import { resolveAgentModel } from "../../src/http/openai-api.ts";
import { createDibaMcpRouter } from "../../src/http/router.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("assistant helpers", () => {
  test("thinking blocks never reach the answer, even when a tag is split across chunks", () => {
    assert.equal(stripThinking("<think>plan</think>Hello"), "Hello");
    assert.equal(stripThinking("Hi <think>unfinished"), "Hi");
    const out: string[] = [];
    const filter = thinkingFilter((d) => out.push(d));
    for (const part of ["He", "llo <th", "ink>sec", "ret</thi", "nk> wor", "ld <", "b>"]) filter.push(part);
    filter.flush();
    assert.equal(out.join(""), "Hello  world <b>");
  });

  test("a failed call gets the parameter list, a made-up tool gets the closest real names", () => {
    const tool = (name: string, parameters: Record<string, unknown> = { type: "object", properties: {} }) => ({ type: "function" as const, function: { name, description: "", parameters } });
    const ticker = tool("nobitex_get_ticker", { type: "object", properties: { symbol: { type: "string" }, side: { enum: ["buy", "sell"] } }, required: ["symbol"] });
    assert.equal(parameterHint(ticker), "Parameters (* = required): symbol*: string, side: buy|sell");
    assert.equal(parameterHint(tool("list_services")), "This tool takes no parameters.");
    assert.deepEqual(similarToolNames("nobitex_ticker", [ticker, tool("wallex_get_ticker"), tool("bale_send_message")], 2), ["nobitex_get_ticker", "wallex_get_ticker"]);
  });

  test("the model id selects the assistant and optionally another upstream model", () => {
    assert.deepEqual(resolveAgentModel("diba-agent"), { id: "diba-agent" });
    assert.deepEqual(resolveAgentModel(undefined), { id: "diba-agent" });
    assert.deepEqual(resolveAgentModel("diba-agent:openai/gpt-4o-mini"), { id: "diba-agent:openai/gpt-4o-mini", upstream: "openai/gpt-4o-mini" });
    assert.equal(resolveAgentModel("gpt-4o"), null);
    assert.equal(resolveAgentModel("diba-agent:"), null);
  });
});

describe("OpenAI-compatible assistant API", () => {
  let upstream: Server;
  let app: Server;
  let base = "";
  let engine: DibaMcpEngine;
  /** What the fake model answers, one entry per upstream call; the last entry repeats */
  let script: Array<(body: any) => { content?: string; tool_calls?: Array<{ name: string; args: unknown }>; finish_reason?: string }> = [];
  const upstreamCalls: any[] = [];
  let running = 0;
  let maxRunning = 0;
  let sent: string[] = [];

  const demo: ProviderDef = {
    id: "demo",
    name: "Demo",
    nameFa: "دمو",
    category: "utility",
    color: "#000",
    glyph: "D",
    description: "",
    fields: [],
    tools: [
      defineTool({
        name: "demo_get_price",
        title: "price",
        description: "Price of a symbol",
        input: { symbol: z.string().min(1) },
        annotations: { readOnlyHint: true },
        handler: async ({ symbol }) => {
          running++;
          maxRunning = Math.max(maxRunning, running);
          await sleep(40);
          running--;
          return { symbol, last: symbol === "BTC" ? "65000" : "3200" };
        },
      }),
      defineTool({
        name: "demo_send_note",
        title: "send",
        description: "Send a note",
        input: { text: z.string() },
        annotations: { destructiveHint: true },
        handler: async ({ text }) => {
          running++;
          maxRunning = Math.max(maxRunning, running);
          await sleep(20);
          running--;
          sent.push(text);
          return { sent: true };
        },
      }),
    ],
  };

  before(async () => {
    configureProxy({} as NodeJS.ProcessEnv);
    upstream = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        if (req.url?.endsWith("/models")) {
          res.writeHead(200, { "content-type": "application/json" });
          return void res.end(JSON.stringify({ data: [{ id: "test-model", context_length: 128000 }, { id: "other-model", context_length: 128000 }] }));
        }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        upstreamCalls.push(body);
        const step = script[Math.min(upstreamCalls.length - 1, script.length - 1)](body);
        const toolCalls = step.tool_calls?.map((t, i) => ({ id: `call_${upstreamCalls.length}_${i}`, type: "function", function: { name: t.name, arguments: JSON.stringify(t.args) } }));
        const finish = step.finish_reason ?? (toolCalls ? "tool_calls" : "stop");
        if (body.stream) {
          res.writeHead(200, { "content-type": "text/event-stream" });
          const text = step.content ?? "";
          for (let i = 0; i < text.length; i += 7) res.write(`data: ${JSON.stringify({ model: body.model, choices: [{ delta: { content: text.slice(i, i + 7) } }] })}\n\n`);
          if (toolCalls) res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: toolCalls.map((t, index) => ({ index, ...t })) } }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`);
          return void res.end();
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ model: body.model, choices: [{ message: { role: "assistant", content: step.content ?? null, tool_calls: toolCalls }, finish_reason: finish }] }));
      });
    });
    await new Promise<void>((ok) => upstream.listen(0, "127.0.0.1", ok));

    engine = new DibaMcpEngine({ dataDir: mkdtempSync(join(tmpdir(), "diba-agent-api-")), providers: [demo], env: {} });
    engine.updateProvider("demo", { enabled: true });
    const web = express();
    web.use(createDibaMcpRouter(engine, { dashboard: false }));
    app = createServer(web);
    await new Promise<void>((ok) => app.listen(0, "127.0.0.1", ok));
    base = `http://127.0.0.1:${(app.address() as AddressInfo).port}/v1`;
  });

  after(async () => {
    await new Promise<void>((ok) => app.close(() => ok()));
    await new Promise<void>((ok) => upstream.close(() => ok()));
  });

  beforeEach(() => {
    upstreamCalls.length = 0;
    maxRunning = 0;
    sent = [];
    script = [() => ({ content: "ok" })];
    engine.store.updateDibarouter({ baseUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`, apiKey: "up-key", model: "test-model" });
  });

  const call = (path: string, init: { method?: string; body?: unknown; token?: string | null; headers?: Record<string, string> } = {}) =>
    fetch(`${base}${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        ...(init.token === null ? {} : { authorization: `Bearer ${init.token ?? engine.store.mcpToken}` }),
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
    });
  const complete = (body: Record<string, unknown>, headers?: Record<string, string>) => call("/chat/completions", { body: { model: "diba-agent", ...body }, headers });
  const toolMessages = (body: any) => body.messages.filter((m: any) => m.role === "tool");

  test("requests need the MCP token and errors use the OpenAI error shape", async () => {
    const missing = await call("/models", { token: null });
    assert.equal(missing.status, 401);
    assert.equal((await missing.json()).error.code, "missing_api_key");
    const wrong = await call("/models", { token: "nope" });
    assert.deepEqual([wrong.status, (await wrong.json()).error], [401, { message: "Incorrect API key provided.", type: "authentication_error", param: null, code: "invalid_api_key" }]);
    const viaHeader = await fetch(`${base}/models`, { headers: { "x-api-key": engine.store.mcpToken } });
    assert.equal(viaHeader.status, 200);
  });

  test("models are listed the way OpenAI clients expect", async () => {
    const list = await (await call("/models")).json();
    assert.equal(list.object, "list");
    assert.deepEqual(list.data.map((m: any) => [m.id, m.object, m.owned_by]), [["diba-agent", "model", "dibachain"]]);
    assert.equal((await (await call("/models/diba-agent")).json()).id, "diba-agent");
    const unknown = await call("/models/gpt-4o");
    assert.deepEqual([unknown.status, (await unknown.json()).error.code], [404, "model_not_found"]);
    assert.equal((await call("/embeddings", { body: {} })).status, 404);
  });

  test("bad requests are rejected before the model is called", async () => {
    const cases: Array<[unknown, number, string | null]> = [
      [{ model: "diba-agent", messages: [] }, 400, "messages"],
      [{ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }, 404, "model"],
      [{ model: "diba-agent", messages: [{ role: "user", content: "hi" }], n: 2 }, 400, "n"],
      ["{not json", 400, null],
    ];
    for (const [body, status, param] of cases) {
      const res = await call("/chat/completions", { body });
      const json = await res.json();
      assert.deepEqual([res.status, json.error.type, json.error.param], [status, "invalid_request_error", param], JSON.stringify(body));
    }
    assert.equal(upstreamCalls.length, 0);
  });

  test("without a connected model the API answers 503 instead of a broken stream", async () => {
    engine.store.updateDibarouter({ apiKey: "" });
    const res = await complete({ messages: [{ role: "user", content: "hi" }], stream: true });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.code, "model_not_configured");
  });

  test("a completion runs tools on the server and returns a plain OpenAI answer", async () => {
    script = [
      () => ({ tool_calls: [{ name: "demo_get_price", args: { symbol: "BTC" } }, { name: "demo_get_price", args: { symbol: "ETH" } }] }),
      () => ({ content: "<think>compare</think>BTC is 65000 and ETH is 3200." }),
    ];
    const res = await complete({
      messages: [
        { role: "system", content: "Answer in English." },
        { role: "user", content: [{ type: "text", text: "price of BTC and ETH on demo?" }] },
      ],
      temperature: 0,
      max_tokens: 300,
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.match(json.id, /^chatcmpl-[0-9a-f]{24}$/);
    assert.deepEqual([json.object, json.model, json.choices.length], ["chat.completion", "diba-agent", 1]);
    assert.deepEqual(json.choices[0], { index: 0, message: { role: "assistant", content: "BTC is 65000 and ETH is 3200.", refusal: null }, logprobs: null, finish_reason: "stop" });
    assert.ok(json.usage.prompt_tokens > 0 && json.usage.completion_tokens > 0);
    assert.equal(json.usage.total_tokens, json.usage.prompt_tokens + json.usage.completion_tokens);
    assert.deepEqual(json.diba.tool_calls.filter((t: any) => t.name === "demo_get_price").map((t: any) => t.ok), [true, true]);

    assert.equal(maxRunning, 2, "independent read-only tools run side by side");
    assert.equal(upstreamCalls.length, 2);
    assert.deepEqual([upstreamCalls[0].model, upstreamCalls[0].temperature, upstreamCalls[0].max_tokens], ["test-model", 0, 300]);
    assert.match(upstreamCalls[0].messages[0].content, /Answer in English\./, "the client's system message reaches the assistant");
    assert.deepEqual(upstreamCalls[0].messages.at(-1), { role: "user", content: "price of BTC and ETH on demo?" });
    assert.deepEqual(toolMessages(upstreamCalls[1]).map((m: any) => JSON.parse(m.content).last), ["65000", "3200"]);
  });

  test("`diba-agent:<model>` runs the assistant on another upstream model", async () => {
    const res = await complete({ model: "diba-agent:other-model", messages: [{ role: "user", content: "hi there, what can you do?" }] });
    assert.equal((await res.json()).model, "diba-agent:other-model");
    assert.equal(upstreamCalls[0].model, "other-model");
  });

  test("streaming follows the chat.completion.chunk format and ends with [DONE]", async () => {
    script = [
      () => ({ tool_calls: [{ name: "demo_get_price", args: { symbol: "BTC" } }] }),
      () => ({ content: "<think>hidden</think>Bitcoin trades at 65000." }),
    ];
    const res = await complete({ messages: [{ role: "user", content: "BTC price on demo?" }], stream: true, stream_options: { include_usage: true } });
    assert.equal(res.status, 200);
    assert.match(String(res.headers.get("content-type")), /text\/event-stream/);
    const text = await res.text();
    const events = text.split("\n\n").filter(Boolean);
    assert.equal(events.at(-1), "data: [DONE]");
    assert.ok(events.some((e) => e.startsWith(": tool demo_get_price ok")), "progress is sent as SSE comments");
    const chunks = events.filter((e) => e.startsWith("data: {")).map((e) => JSON.parse(e.slice(6)));
    assert.ok(chunks.every((c) => c.object === "chat.completion.chunk" && c.model === "diba-agent" && c.id === chunks[0].id));
    assert.deepEqual(chunks[0].choices[0].delta, { role: "assistant", content: "" });
    const content = chunks.flatMap((c) => c.choices).map((c: any) => c.delta?.content ?? "").join("");
    assert.equal(content, "Bitcoin trades at 65000.");
    const last = chunks.at(-2);
    assert.deepEqual([last.choices[0].delta, last.choices[0].finish_reason], [{}, "stop"]);
    assert.deepEqual(chunks.at(-1).choices, []);
    assert.ok(chunks.at(-1).usage.total_tokens > 0);
  });

  test("a rejected tool call tells the model which parameters the tool takes", async () => {
    script = [
      () => ({ tool_calls: [{ name: "demo_get_price", args: {} }] }),
      () => ({ tool_calls: [{ name: "demo_price", args: { symbol: "BTC" } }] }),
      () => ({ content: "done" }),
    ];
    await complete({ messages: [{ role: "user", content: "BTC price on demo?" }] });
    assert.match(toolMessages(upstreamCalls[1])[0].content, /^ERROR: .*\nParameters \(\* = required\): symbol\*: string$/s);
    assert.match(toolMessages(upstreamCalls[2])[1].content, /No tool is named "demo_price"\. Closest tools: demo_get_price/);
  });

  test("a model that keeps repeating the same call is stopped and asked to answer", async () => {
    script = [(body) => (body.tools?.length ? { tool_calls: [{ name: "demo_get_price", args: { symbol: "BTC" } }] } : { content: "BTC is 65000." })];
    const json = await (await complete({ messages: [{ role: "user", content: "BTC price on demo?" }] })).json();
    assert.equal(json.choices[0].message.content, "BTC is 65000.");
    assert.equal(json.diba.truncated, true);
    assert.equal(upstreamCalls.length, 4, "one real call, two repeats, one forced summary");
    assert.equal(json.diba.tool_calls.filter((t: any) => t.name === "demo_get_price" && !t.cached).length, 1);
  });

  test("tools that write run one at a time, in the order the model asked", async () => {
    script = [
      () => ({ tool_calls: [{ name: "demo_send_note", args: { text: "first" } }, { name: "demo_send_note", args: { text: "second" } }] }),
      () => ({ content: "Both notes were sent." }),
    ];
    await complete({ messages: [{ role: "user", content: "send note first and then note second with demo" }] });
    assert.deepEqual(sent, ["first", "second"]);
    assert.equal(maxRunning, 1);
  });

  test("the conversation id keeps separate memory per API client", async () => {
    await complete({ messages: [{ role: "user", content: "hello from client one" }], user: "client-1" });
    await complete({ messages: [{ role: "user", content: "hello from header" }] }, { "x-conversation-id": "thread 42!" });
    assert.equal(engine.memory.history(10, "api:client-1").filter((t) => t.role === "user")[0]?.content, "hello from client one");
    assert.equal(engine.memory.history(10, "api:thread42").length, 2);
    assert.equal(engine.memory.history(10, "dashboard").length, 0);
  });
});
