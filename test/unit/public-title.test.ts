import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { publicTitle } from "../../src/core/memory.ts";

describe("publicTitle", () => {
  test("عنوان معمولی دست‌نخورده می‌ماند", () => {
    assert.equal(publicTitle("علی رضایی"), "علی رضایی");
    assert.equal(publicTitle("TechyarNet • کافی نت"), "TechyarNet • کافی نت");
  });

  test("اگر نام نباشد ولی نام کاربری باشد، نام کاربری نمایش داده می‌شود", () => {
    assert.equal(publicTitle("768654080|1", "private", "ali"), "@ali");
    assert.equal(publicTitle("", "private", "@sara"), "@sara");
    assert.equal(publicTitle("7939…674@lid", "private", "sara.ahmadi"), "@sara.ahmadi");
  });

  test("شناسه‌های خالی از نام کاربری، با برچسب امن نمایش داده می‌شوند", () => {
    assert.equal(publicTitle("768654080|1", "private"), "مخاطب بدون نام (…0801)");
    assert.equal(publicTitle("989121234567@s.whatsapp.net", "private"), "مخاطب بدون نام (…4567)");
    assert.equal(publicTitle("1203630@g.us", "group"), "گروه بدون نام");
    assert.equal(publicTitle("7939…674@lid", "private", ""), "مخاطب بدون نام (…9674)");
    assert.equal(publicTitle("768654080|1", "private", "989121234567"), "مخاطب بدون نام (…0801)");
  });
});
