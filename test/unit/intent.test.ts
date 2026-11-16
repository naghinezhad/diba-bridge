import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseRequest } from "../../src/core/assistant/intent.ts";
import { isSmallTalk } from "../../src/core/assistant/text.ts";

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

  test("نام شخصی که با نام یک سرویس یکی است، مخاطب حساب می‌شود نه سرویس", () => {
    const withSoroush = [...providers, { id: "soroush_client", words: ["سروش", "سروش پلاس", "soroush"] }];
    const parsed = parseRequest("به سروش پیام بده که فردا می‌بینمت", withSoroush);
    assert.equal(parsed.action, "send");
    assert.equal(parsed.person, "سروش");
    assert.deepEqual(parsed.providerHints, []);
    // املای کاربر (نیم‌فاصله) در متن پیام حفظ می‌شود
  assert.equal(parsed.message, "فردا می‌بینمت");
  assert.equal(parseRequest("به عماد پیام بده که ساعت ۵ می‌آیم.", providers).message, "ساعت ۵ می‌آیم");

    const onTelegram = parseRequest("به سروش در تلگرام پیام بده که سلام رفیق", withSoroush);
    assert.equal(onTelegram.person, "سروش");
    assert.deepEqual(onTelegram.providerHints, ["telegram_client"]);
  });

  test("واژه‌ی کوتاه سرویس با ابتدای کلمه‌های دیگر اشتباه گرفته نمی‌شود", () => {
    const parsed = parseRequest("send John a message that wait for me, ignore the rest", providers);
    assert.equal(parsed.action, "send");
    assert.deepEqual(parsed.providerHints, []);
    // پسوند کوتاه فارسی همچنان پذیرفته می‌شود
    assert.deepEqual(parseRequest("به عماد توی تلگرامش پیام بده که سلام", providers).providerHints, ["telegram_client"]);
  });
});
