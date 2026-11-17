import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";
import { dibaRouterChat } from "../../src/core/dibarouter.ts";

describe("dibaRouterChat cancellation", () => {
  test("abort closes the upstream stream and rejects the call", async () => {
    let upstreamClosed = false;
    let deltas = 0;
    const server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const timer = setInterval(() => {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "…" } }] })}\n\n`);
      }, 20);
      req.on("close", () => {
        upstreamClosed = true;
        clearInterval(timer);
      });
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const port = (server.address() as AddressInfo).port;

    try {
      const ac = new AbortController();
      const pending = dibaRouterChat(
        { baseUrl: `http://127.0.0.1:${port}`, apiKey: "test-key", model: "test-model" },
        [{ role: "user", content: "hi" }],
        {
          onDelta: () => {
            deltas++;
            if (deltas === 2) ac.abort();
          },
          signal: ac.signal,
        },
      );

      await assert.rejects(pending, (err: any) => err?.name === "AbortError" || /abort/i.test(String(err?.message)));
      assert.ok(deltas >= 2, "پاسخ باید قبل از توقف شروع شده باشد");
      const end = Date.now() + 1500;
      while (!upstreamClosed && Date.now() < end) await new Promise((r) => setTimeout(r, 15));
      assert.equal(upstreamClosed, true, "اتصال به دیبا روتر باید بسته شود");
    } finally {
      server.close();
    }
  });

  test("abort before the first byte rejects without waiting for the model", async () => {
    const server = createServer(() => {
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const port = (server.address() as AddressInfo).port;
    try {
      const ac = new AbortController();
      setTimeout(() => ac.abort(), 50);
      await assert.rejects(
        dibaRouterChat(
          { baseUrl: `http://127.0.0.1:${port}`, apiKey: "k", model: "m" },
          [{ role: "user", content: "hi" }],
          { onDelta: () => {}, signal: ac.signal },
        ),
        (err: any) => err?.name === "AbortError" || /abort/i.test(String(err?.message)),
      );
    } finally {
      server.close();
    }
  });
});
