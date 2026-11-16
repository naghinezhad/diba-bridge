import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { looksLikePhone, matchName, phoneticKey } from "../../src/core/assistant/name-match.ts";

describe("name matching", () => {
  test("کلید آوایی فارسی و انگلیسی یکی می‌شود", () => {
    const pairs: Array<[string, string]> = [
      ["عماد", "Emad"],
      ["جان اسمیت", "John Smith"],
      ["علی رضایی", "Ali Rezaei"],
      ["محمد", "Mohammad"],
      ["حسین", "Hossein"],
      ["مریم", "Maryam"],
      ["نازنین", "Nazanin"],
      ["رضا", "Reza"],
      ["خان", "Khan"],
      ["جمال", "Jamal"],
      ["سارا", "Sara"],
      ["امیر", "Amir"],
    ];
    for (const [fa, en] of pairs) {
      assert.equal(phoneticKey(fa), phoneticKey(en), `${fa} ↔ ${en}`);
    }
  });

  test("نام فارسی و لاتین با امتیاز بالا تطبیق داده می‌شود", () => {
    for (const [fa, en] of [
      ["عماد", "Emad"],
      ["John", "جان"],
      ["علی", "Ali"],
    ]) {
      const forward = matchName(fa, [en]);
      const backward = matchName(en, [fa]);
      assert.ok(forward.score >= 88, `${fa} → ${en}: ${forward.score}`);
      assert.ok(backward.score >= 88, `${en} → ${fa}: ${backward.score}`);
    }
    // نام کوچک در برابر نام کامل هم پیدا می‌شود
    assert.ok(matchName("John", ["جان اسمیت"]).score >= 88);
  });

  test("نام‌های بی‌ربط امتیاز بالا نمی‌گیرند", () => {
    assert.ok(matchName("علی", ["مریم"]).score < 45);
    assert.ok(matchName("Sara", ["Reza"]).score < 60);
    assert.ok(matchName("محمد", ["سارا"]).score < 45);
  });

  test("نام‌های هم‌اسکلت ولی متفاوت با اطمینان بالا تطبیق نمی‌شوند", () => {
    // «عماد» و «Mohammad» هر دو اسکلت md دارند، ولی نام یکسانی نیستند
    assert.ok(matchName("عماد", ["Mohammad"]).score < 88, String(matchName("عماد", ["Mohammad"]).score));
    assert.ok(matchName("Emad", ["Mohammad"]).score < 88);
    // «محمد» هم پیدا می‌شود، ولی برای ارسال خودکار به تأیید نیاز دارد
    assert.ok(matchName("محمد", ["Mohammad"]).score >= 60);
    assert.ok(matchName("محمد", ["Mohammad"]).score < 88);
    assert.ok(matchName("عماد", ["Emad"]).score >= 88);
    assert.ok(matchName("عماد", ["Emmad"]).score >= 88);
  });

  test("نام کاربری و شماره هم تطبیق داده می‌شوند", () => {
    assert.ok(matchName("@emadd", ["@emadd"]).score >= 96);
    assert.ok(matchName("09121234567", ["+989121234567"]).score >= 90);
    assert.ok(looksLikePhone("+98 912 123 4567"));
    assert.ok(!looksLikePhone("عماد"));
  });

  test("عنوان بلندتر با نام کوچک‌تر پیدا می‌شود", () => {
    assert.ok(matchName("عماد", ["عماد احمدی"]).score >= 88);
    assert.ok(matchName("رضا", ["علی رضایی"]).score >= 80);
  });
});
