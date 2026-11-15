import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { z } from "zod";
import { checkMessageQuality, resolveRecipient } from "../../src/core/contacts.ts";
import { DibaMcpEngine } from "../../src/core/engine.ts";
import { defineTool, type ProviderDef } from "../../src/core/types.ts";

function setup(chats: Array<Record<string, unknown>>) {
  let sends = 0;
  const provider: ProviderDef = {
    id: "telegram_client",
    name: "Telegram Client",
    nameFa: "تلگرام (حساب کاربری)",
    category: "messenger",
    color: "#000",
    glyph: "ت",
    description: "",
    fields: [{ key: "session", label: "session", type: "secret", required: true }],
    tools: [
      defineTool({
        name: "telegram_client_get_chats",
        title: "چت‌ها",
        description: "chats",
        input: { limit: z.number().int().min(1).max(100).optional() },
        handler: async () => ({ chats }),
      }),
      defineTool({
        name: "telegram_client_send_message",
        title: "ارسال",
        description: "send",
        input: { chat_id: z.string().min(1), text: z.string().min(1).max(4096) },
        handler: async (a) => {
          sends++;
          return { ok: true, chat_id: a.chat_id, message_id: String(sends) };
        },
      }),
    ],
  };
  const dataDir = mkdtempSync(join(tmpdir(), "diba-send-"));
  const engine = new DibaMcpEngine({ dataDir, providers: [provider], env: {} });
  engine.store.update("telegram_client", { enabled: true, values: { session: "s".repeat(24) } });
  return {
    engine,
    sends: () => sends,
    close: () => {
      engine.inbox.stop();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

const now = new Date().toISOString();

describe("recipient resolution & quality", () => {
  test("کیفیت پیام: خالی، بلند، سلام تنها، لینک ناخواسته و اسپم رد می‌شوند", () => {
    assert.equal(checkMessageQuality("").ok, false);
    assert.equal(checkMessageQuality("سلام").ok, false);
    assert.equal(checkMessageQuality("الف".repeat(1600)).ok, false);
    assert.equal(checkMessageQuality("سلام علی جان، گزارش فردا آماده است. https://example.com").ok, false);
    assert.equal(checkMessageQuality("سلام علی جان، گزارش فردا آماده است. https://example.com", { allowLinks: true }).ok, true);
    assert.equal(checkMessageQuality("جایزه ویژه! کلیک کنید https://spam.example", { allowLinks: true }).ok, false);
    assert.equal(checkMessageQuality("THIS IS A VERY LONG ALL CAPS MESSAGE THAT SHOULD BE REJECTED").ok, false);
  });

  test("مخاطب با نام پیدا می‌شود و فلانی/نامعتبر حدس زده نمی‌شود", async () => {
    const s = setup([
      { chat_id: "42", title: "علی رضایی", type: "private", last_message: "سلام", last_date: now },
      { chat_id: "43", title: "مریم", type: "private", last_message: "خوبی؟", last_date: now },
    ]);
    try {
      const r = await resolveRecipient(s.engine, "علي");
      assert.equal(r.best?.chatId, "42");
      assert.equal(r.ambiguous, false);
      assert.ok(r.confidence >= 85);

      const placeholder = await resolveRecipient(s.engine, "فلانی");
      assert.equal(placeholder.fallback, true);
      assert.ok(placeholder.candidates.length > 0);
      assert.match(placeholder.reason ?? "", /نزدیک‌ترین/);

      const unknown = await resolveRecipient(s.engine, "کسی که وجود ندارد");
      assert.equal(unknown.fallback, true);
      assert.ok(unknown.candidates.length > 0);
    } finally {
      s.close();
    }
  });

  test("ارسال خودکار به مخاطب موجود انجام می‌شود و متن تکراری/سلام تنها رد می‌شود", async () => {
    const s = setup([{ chat_id: "42", title: "علی رضایی", type: "private", last_message: "سلام", last_date: now }]);
    try {
      const dry = await s.engine.sendToRecipient({
        recipient: "علی",
        text: "سلام علی جان، گزارش فردا ساعت ۱۰ آماده است.",
        dryRun: true,
      });
      assert.equal(dry.ok, true);
      assert.equal(s.sends(), 0);

      const first = await s.engine.sendToRecipient({
        recipient: "علی",
        text: "سلام علی جان، گزارش فردا ساعت ۱۰ آماده است.",
      });
      assert.equal(first.ok, true, first.error);
      assert.equal(s.sends(), 1);
      assert.equal(s.engine.memory.recipient("telegram_client", "42")?.sendCount, 1);

      const duplicate = await s.engine.sendToRecipient({
        recipient: "علی",
        text: "سلام علی جان، گزارش فردا ساعت ۱۰ آماده است.",
      });
      assert.equal(duplicate.ok, false);
      assert.match(duplicate.error!, /۲۴ ساعت|تکراری/);
      assert.equal(s.sends(), 1);

      const generic = await s.engine.sendToRecipient({ recipient: "علی", text: "سلام" });
      assert.equal(generic.ok, false);
      assert.match(generic.error!, /کیفیت|سلام/);
    } finally {
      s.close();
    }
  });

  test("نام مبهم، گروه بدون اجازه و سقف نرخ جلوی ارسال را می‌گیرند", async () => {
    const s = setup([
      { chat_id: "42", title: "علی رضایی", type: "private", last_date: now },
      { chat_id: "43", title: "علی محمدی", type: "private", last_date: now },
      { chat_id: "-100", title: "گروه تست", type: "group", last_date: now },
    ]);
    try {
      const ambiguous = await s.engine.sendToRecipient({ recipient: "علی", text: "سلام علی جان، فردا می‌بینمت." });
      assert.equal(ambiguous.ok, false);
      assert.match(ambiguous.error!, /اطمینان|گزینه/);
      assert.equal(s.sends(), 0);

      const group = await s.engine.sendToRecipient({ recipient: "گروه تست", text: "سلام به همه، جلسه فردا ساعت ۱۰ برگزار می‌شود." });
      assert.equal(group.ok, false);
      assert.match(group.error!, /گروه|کانال/);
      assert.equal(s.sends(), 0);

      // با شناسه‌ی گروه و اجازه‌ی صریح
      const groupAllowed = await s.engine.sendToRecipient({
        recipient: "گروه تست",
        text: "سلام به همه، جلسه فردا ساعت ۱۰ برگزار می‌شود.",
        allowGroup: true,
      });
      assert.equal(groupAllowed.ok, true, groupAllowed.error);
      assert.equal(s.sends(), 1);
    } finally {
      s.close();
    }
  });

  test("محدودیت دو پیام در دقیقه برای یک مخاطب", async () => {
    const s = setup([{ chat_id: "42", title: "علی رضایی", type: "private", last_date: now }]);
    try {
      const a = await s.engine.sendToRecipient({ recipient: "علی", text: "سلام علی جان، پیام اول من است." });
      const b = await s.engine.sendToRecipient({ recipient: "علی", text: "سلام علی جان، پیام دوم من است." });
      const c = await s.engine.sendToRecipient({ recipient: "علی", text: "سلام علی جان، پیام سوم من است." });
      assert.equal(a.ok, true, a.error);
      assert.equal(b.ok, true, b.error);
      assert.equal(c.ok, false);
      assert.match(c.error!, /دقیقه|سقف/);
      assert.equal(s.sends(), 2);
    } finally {
      s.close();
    }
  });
});
