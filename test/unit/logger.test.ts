import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { CallLogger } from "../../src/core/logger.ts";

function withTempLogger(fn: (logger: CallLogger, dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "diba-mcp-log-"));
  const logger = new CallLogger({ dir, max: 100 });
  try {
    fn(logger, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function seed(logger: CallLogger, count: number) {
  for (let i = 0; i < count; i++) {
    logger.add({
      tool: `tool_${i}`,
      provider: i % 2 === 0 ? "bale" : "telegram",
      source: "dashboard",
      ok: i % 3 !== 0,
      ms: i,
      args: { i },
    });
  }
}

describe("CallLogger pagination", () => {
  test("list جدیدترین‌ها را با سقف برمی‌گرداند", () => {
    withTempLogger((logger) => {
      seed(logger, 5);
      const rows = logger.list(3);
      assert.equal(rows.length, 3);
      assert.equal(rows[0].tool, "tool_4");
      assert.equal(rows[2].tool, "tool_2");
    });
  });

  test("page پیش‌فرض ۲۰ ردیف، شمارش و تعداد صفحه‌ها را درست می‌دهد", () => {
    withTempLogger((logger) => {
      seed(logger, 45);
      const first = logger.page();
      assert.equal(first.page, 1);
      assert.equal(first.pageSize, 20);
      assert.equal(first.total, 45);
      assert.equal(first.totalPages, 3);
      assert.equal(first.items.length, 20);
      assert.equal(first.items[0].tool, "tool_44");

      const last = logger.page({ page: 3, pageSize: 20 });
      assert.equal(last.page, 3);
      assert.equal(last.items.length, 5);
      assert.equal(last.items[4].tool, "tool_0");
    });
  });

  test("صفحه و اندازه‌ی صفحه‌ی نامعتبر اصلاح می‌شوند", () => {
    withTempLogger((logger) => {
      seed(logger, 12);
      const clamped = logger.page({ page: 99, pageSize: 5 });
      assert.equal(clamped.page, 3);
      assert.equal(clamped.pageSize, 5);
      assert.equal(logger.page({ page: 0, pageSize: 500 }).pageSize, 100);
      assert.equal(logger.page({ page: -3 }).page, 1);
    });
  });

  test("فیلتر وضعیت و سرویس قبل از صفحه‌بندی اعمال می‌شود", () => {
    withTempLogger((logger) => {
      seed(logger, 30);
      const failed = logger.page({ ok: "fail", pageSize: 10 });
      assert.equal(failed.total, 10); // i % 3 === 0 → 0,3,...,27
      assert.ok(failed.items.every((x) => !x.ok));

      const bale = logger.page({ provider: "bale", pageSize: 10 });
      assert.equal(bale.total, 15);
      assert.ok(bale.items.every((x) => x.provider === "bale"));

      const both = logger.page({ ok: "ok", provider: "telegram" });
      assert.ok(both.total > 0);
      assert.ok(both.items.every((x) => x.ok && x.provider === "telegram"));
    });
  });

  test("clear همه‌ی ردیف‌ها و فایل‌های لاگ را پاک می‌کند", () => {
    withTempLogger((logger) => {
      seed(logger, 4);
      assert.equal(logger.page().total, 4);
      logger.clear();
      assert.equal(logger.page().total, 0);
      assert.equal(logger.list(10).length, 0);
    });
  });
});
