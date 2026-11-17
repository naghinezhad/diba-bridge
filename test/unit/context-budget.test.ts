import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { describe, test } from "node:test";
import { ModelLimits, planContext, UNKNOWN_CONTEXT_LENGTH } from "../../src/core/context-budget.ts";
import { estimateRequestTokens, fitContextToBudget } from "../../src/core/context.ts";
import { dibaRouterChat, dibaRouterModels, normalizeBaseUrl } from "../../src/core/dibarouter.ts";
import { configureProxy } from "../../src/core/net.ts";

describe("planContext", () => {
  test("مدل ۸ هزارتایی: ورودی + خروجی + حاشیه در سقف مدل جا می‌شود", () => {
    const plan = planContext(8192);
    assert.equal(plan.contextLength, 8192);
    assert.ok(plan.inputTokens + plan.outputTokens <= 8192 * 0.9, JSON.stringify(plan));
    assert.ok(plan.inputTokens >= 5000, "مدل ۸ هزارتایی باید همچنان فضای کاری کافی داشته باشد");
    assert.ok(plan.maxTools >= 8 && plan.toolTokens > 0, "tool calling باید فعال بماند");
    assert.ok(plan.toolTokens <= plan.inputTokens * 0.4);
    assert.equal(plan.compact, true);
  });

  test("مدل خیلی کوچک ابزار نمی‌گیرد و مدل بزرگ سقف معقول دارد", () => {
    const tiny = planContext(2048);
    assert.equal(tiny.maxTools, 0);
    assert.equal(tiny.toolTokens, 0);
    assert.ok(tiny.inputTokens + tiny.outputTokens < 2048);
    assert.ok(tiny.outputTokens >= 192);

    const big = planContext(1_000_000);
    assert.ok(big.inputTokens <= 24_000);
    assert.equal(big.compact, false);
    assert.equal(big.outputTokens, 1000);
    assert.ok(big.maxTools > planContext(8192).maxTools);
  });

  test("سقف نامعلوم مثل مدل کوچک در نظر گرفته می‌شود", () => {
    assert.equal(planContext(undefined).contextLength, UNKNOWN_CONTEXT_LENGTH);
    assert.equal(planContext(0).contextLength, UNKNOWN_CONTEXT_LENGTH);
    assert.equal(planContext(Number.NaN).contextLength, UNKNOWN_CONTEXT_LENGTH);
  });

  test("با کوچک‌تر شدن کانتکست، همه‌ی سهم‌ها کوچک‌تر می‌شوند", () => {
    const sizes = [4096, 8192, 16_384, 32_768].map((n) => planContext(n));
    for (let i = 1; i < sizes.length; i++) {
      assert.ok(sizes[i].inputTokens > sizes[i - 1].inputTokens);
      assert.ok(sizes[i].historyChars >= sizes[i - 1].historyChars);
      assert.ok(sizes[i].toolResultChars >= sizes[i - 1].toolResultChars);
    }
  });
});

describe("ModelLimits", () => {
  const source = "https://router.example/api/v1";

  test("سقف اعلام‌شده را می‌خواند، کش می‌کند و عدد یادگرفته‌شده را ترجیح می‌دهد", async () => {
    let calls = 0;
    const limits = new ModelLimits(async () => {
      calls++;
      return [
        { id: "small", context_length: 8192 },
        { id: "big", context_length: 128_000 },
      ];
    });
    assert.equal(await limits.limitOf(source, "small"), 8192);
    assert.equal(await limits.limitOf(source, "big"), 128_000);
    assert.equal(await limits.limitOf(source, "missing"), undefined);
    assert.equal(calls, 1, "فهرست مدل‌ها باید کش شود");

    assert.equal(limits.learn(source, "small", 2048), 2048);
    assert.equal(await limits.limitOf(source, "small"), 2048);
    assert.equal(limits.learn(source, "small", 4096), 2048);
    assert.equal(await limits.limitOf("https://other.example/v1", "small"), 8192);
    assert.equal(calls, 2);
  });

  test("خطا یا کندی فهرست مدل‌ها جلوی گفتگو را نمی‌گیرد", async () => {
    const failing = new ModelLimits(async () => {
      throw new Error("offline");
    });
    assert.equal(await failing.limitOf(source, "any"), undefined);

    const slow = new ModelLimits(() => new Promise((resolve) => setTimeout(() => resolve([{ id: "m", context_length: 4096 }]), 300)), {
      waitMs: 30,
    });
    const started = Date.now();
    assert.equal(await slow.limitOf(source, "m"), undefined);
    assert.ok(Date.now() - started < 250, "نباید منتظر فهرست کند بماند");
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(await slow.limitOf(source, "m"), 4096);
  });
});

describe("fitContextToBudget", () => {
  const tool = (name: string) => ({
    type: "function" as const,
    function: { name, description: "Send or read messages. ".repeat(6), parameters: { type: "object", properties: { chat_id: { type: "string" } } } },
  });
  const persian = (n: number) => "این یک پیام نسبتاً بلند فارسی برای پر کردن کانتکست است. ".repeat(n);

  function longConversation() {
    const messages: any[] = [{ role: "system", content: persian(40) }];
    for (let i = 0; i < 8; i++) {
      messages.push({ role: "user", content: `${persian(6)} سؤال ${i}` });
      messages.push({ role: "assistant", content: "", tool_calls: [{ id: `c${i}`, type: "function", function: { name: "list_chats", arguments: "{}" } }] });
      messages.push({ role: "tool", tool_call_id: `c${i}`, name: "list_chats", content: JSON.stringify({ chats: Array.from({ length: 40 }, (_, k) => ({ title: `چت ${k}`, last: persian(1) })) }) });
      messages.push({ role: "assistant", content: persian(3) });
    }
    messages.push({ role: "user", content: "آخرین سؤال کاربر: وضعیت تلگرام چیست؟" });
    return messages;
  }

  for (const contextLength of [8192, 4096, 2048]) {
    test(`گفتگوی طولانی برای مدل ${contextLength} توکنی جا می‌شود و دنباله‌ی پیام‌ها معتبر می‌ماند`, () => {
      const plan = planContext(contextLength);
      const tools = Array.from({ length: 24 }, (_, i) => tool(`telegram_client_tool_${i}`)).slice(0, plan.maxTools);
      const fitted = fitContextToBudget(longConversation(), tools, plan.inputTokens);

      assert.ok(estimateRequestTokens(fitted.messages, fitted.tools) <= plan.inputTokens, "باید زیر بودجه باشد");
      assert.equal(fitted.messages[0].role, "system");
      assert.ok(fitted.messages[0].content.length >= 400, "قواعد اصلی سیستم‌پرامپت نباید حذف شود");
      const last = fitted.messages[fitted.messages.length - 1];
      assert.equal(last.role, "user");
      assert.match(last.content, /وضعیت تلگرام/, "آخرین پیام کاربر باید بماند");

      let open = false;
      for (const message of fitted.messages) {
        if (message.role === "tool") assert.ok(open, "پیام tool بدون والد");
        else open = message.role === "assistant" && Boolean(message.tool_calls);
      }
    });
  }

  test("نتیجه‌ی ابزارِ همین دور (بعد از آخرین پیام کاربر) حذف نمی‌شود، فقط کوتاه می‌شود", () => {
    const messages: any[] = [
      { role: "system", content: persian(10) },
      { role: "user", content: "چت‌های من را بخوان" },
      { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "list_chats", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", name: "list_chats", content: persian(400) },
    ];
    const fitted = fitContextToBudget(messages, [], 1500);
    assert.deepEqual(fitted.messages.map((m) => m.role), ["system", "user", "assistant", "tool"]);
    assert.ok(estimateRequestTokens(fitted.messages, []) <= 1500);
    assert.ok(fitted.messages[3].content.length >= 200);
  });
});

describe("DibaRouter connection", () => {
  async function mockRouter(handler: (path: string) => { status: number; type: string; body: string }) {
    const hits: string[] = [];
    const server: Server = createServer((req, res) => {
      req.on("data", () => undefined);
      req.on("end", () => {
        hits.push(String(req.url));
        const out = handler(String(req.url));
        res.writeHead(out.status, { "content-type": out.type });
        res.end(out.body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as any).port;
    return {
      baseUrl: `http://127.0.0.1:${port}/api/v1`,
      hits,
      close: () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections?.();
        }),
    };
  }
  const models = JSON.stringify({ data: [{ id: "dibachain/diba-mini", category: "chat", context_length: 8192, supported_parameters: ["tools"] }] });
  const config = (baseUrl: string) => ({ baseUrl, apiKey: "test", model: "dibachain/diba-mini" });

  test("نشانی پایه‌ی ناقص یا کامل یکدست می‌شود", () => {
    assert.equal(normalizeBaseUrl(undefined), "https://dibarouter.ir/api/v1");
    assert.equal(normalizeBaseUrl("https://dibarouter.ir"), "https://dibarouter.ir/api/v1");
    assert.equal(normalizeBaseUrl("https://dibarouter.ir/api/"), "https://dibarouter.ir/api/v1");
    assert.equal(normalizeBaseUrl("https://dibarouter.ir/api/v1/chat/completions"), "https://dibarouter.ir/api/v1");
    assert.equal(normalizeBaseUrl(" https://dibarouter.ir/api/v1/models/ "), "https://dibarouter.ir/api/v1");
    assert.equal(normalizeBaseUrl("http://localhost:8080/v1/"), "http://localhost:8080/v1");
  });

  test("وقتی پراکسی برنامه از کار افتاده، دیبا روتر از مسیر مستقیم خوانده می‌شود", async () => {
    const router = await mockRouter(() => ({ status: 200, type: "application/json", body: models }));
    try {
      configureProxy({ HTTPS_PROXY: "http://127.0.0.1:9", HTTP_PROXY: "http://127.0.0.1:9" } as any);
      const list = await dibaRouterModels(config(router.baseUrl));
      assert.equal(list.length, 1);
      assert.equal(list[0].context_length, 8192);
      assert.equal(list[0].supports_tools, true);
      assert.equal((await dibaRouterModels(config(router.baseUrl))).length, 1);
    } finally {
      configureProxy({} as any);
      await router.close();
    }
  });

  test("قطعی کامل، پیام فارسی با علت واقعی می‌دهد نه «fetch failed»", async () => {
    await assert.rejects(
      () => dibaRouterModels(config("http://127.0.0.1:9/api/v1")),
      (err: any) => {
        assert.match(err.message, /دسترسی به دیبا روتر برقرار نشد/);
        assert.doesNotMatch(err.message, /fetch failed/);
        assert.equal(err.status, 502);
        return true;
      },
    );
  });

  test("پاسخ HTML (نشانی اشتباه) خطای قابل‌فهم می‌دهد", async () => {
    const html = await mockRouter((path) =>
      path.endsWith("/models")
        ? { status: 200, type: "text/html", body: "<!DOCTYPE html><html></html>" }
        : { status: 404, type: "text/html", body: "<!DOCTYPE html><html>not found</html>" },
    );
    try {
      await assert.rejects(() => dibaRouterModels(config(html.baseUrl)), /JSON نیست|آدرس پایه/);
      await assert.rejects(
        () => dibaRouterChat(config(html.baseUrl), [{ role: "user", content: "سلام" }]),
        (err: any) => {
          assert.match(err.message, /404/);
          assert.match(err.message, /آدرس پایه/);
          return true;
        },
      );
    } finally {
      await html.close();
    }
  });

  test("پیام خطای ساختاریافته‌ی روتر همان‌طور به کاربر می‌رسد", async () => {
    const router = await mockRouter(() => ({
      status: 400,
      type: "application/json",
      body: JSON.stringify({ error: { message: "the request (9000 tokens) exceeds the available context size (8192 tokens)" } }),
    }));
    try {
      await assert.rejects(
        () => dibaRouterChat(config(router.baseUrl), [{ role: "user", content: "سلام" }]),
        (err: any) => {
          assert.match(err.message, /available context size \(8192 tokens\)/);
          assert.equal(err.status, 400);
          return true;
        },
      );
    } finally {
      await router.close();
    }
  });
});
