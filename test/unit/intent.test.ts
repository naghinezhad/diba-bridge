import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isSmallTalk, parseRequest } from "../../src/core/intent.ts";

const providers = [
  { id: "telegram_client", words: ["تلگرام", "telegram", "tg"] },
  { id: "whatsapp", words: ["واتس‌اپ", "واتساپ", "whatsapp", "wa"] },
  { id: "instagram", words: ["اینستاگرام", "اینستا", "instagram", "ig"] },
];

describe("intent parsing", () => {
  test("ارسال با نام فارسی و سرویس وسط جمله", () => {
    const parsed = parseRequest("به عماد داخل تلگرام پیام بده که فردا جلسه داریم", providers);
    assert.equal(parsed.action, "send");
    assert.deepEqual(parsed.providerHints, ["telegram_client"]);
    assert.equal(parsed.person, "عماد");
    assert.equal(parsed.message, "فردا جلسه داریم");
  });

  test("ارسال با نام انگلیسی", () => {
    const parsed = parseRequest("send John a message that we have a meeting tomorrow", providers);
    assert.equal(parsed.action, "send");
    assert.equal(parsed.person, "John");
    assert.equal(parsed.message, "we have a meeting tomorrow");
  });

  test("ارسال با فعل بعد از نام و ویرگول", () => {
    const parsed = parseRequest("به عماد بگو سلام برسون", providers);
    assert.equal(parsed.action, "send");
    assert.equal(parsed.person, "عماد");
    assert.equal(parsed.message, "سلام برسون");

    const colon = parseRequest("به عماد در واتس‌اپ پیام بده: سلام وقت بخیر", providers);
    assert.equal(colon.action, "send");
    assert.equal(colon.person, "عماد");
    assert.equal(colon.message, "سلام وقت بخیر");
    assert.deepEqual(colon.providerHints, ["whatsapp"]);
  });

  test("فهرست چت‌ها، خواندن، وضعیت و توانایی‌ها", () => {
    assert.equal(parseRequest("چت‌های تلگرام", providers).action, "list_chats");
    assert.equal(parseRequest("لیست چت‌های اینستاگرام", providers).action, "list_chats");

    const read = parseRequest("پیام‌های عماد در تلگرام را بخوان", providers);
    assert.equal(read.action, "read");
    assert.equal(read.person, "عماد");

    assert.equal(parseRequest("وضعیت سرویس‌ها", providers).action, "status");
    assert.equal(parseRequest("چه کارهایی می‌توانی بکنی؟", providers).action, "capabilities");
  });

  test("تأیید، لغو و انتخاب شماره", () => {
    assert.equal(parseRequest("بله", providers).action, "confirm");
    assert.equal(parseRequest("لغو", providers).action, "cancel");
    assert.equal(parseRequest("۱", providers).selection, 0);
    assert.equal(parseRequest("دومی", providers).selection, 1);
  });

  test("سلام و قید الگوهای ارسال", () => {
    assert.equal(isSmallTalk("سلام"), true);
    assert.equal(isSmallTalk("به عماد پیام بده"), false);
    assert.equal(isSmallTalk("hello!"), true);
  });

  test("نام تنهای انگلیسی به جستجوی مخاطب تبدیل می‌شود، نه انتخاب گزینه", () => {
    const parsed = parseRequest("John", providers);
    assert.equal(parsed.action, "find");
    assert.equal(parsed.selection, undefined);
  });
});
