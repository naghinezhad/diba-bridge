/**
 * تطبیق نام بین فارسی و انگلیسی.
 *
 * مشکل اصلی: کاربر می‌گوید «عماد» ولی مخاطب در لیست چت‌ها «Emad» است (یا برعکس).
 * مقایسه‌ی متنی این دو هیچ‌وقت جواب نمی‌دهد، پس اینجا یک «کلید آوایی» می‌سازیم:
 *   حروف فارسی → لاتین → یکسان‌سازی digraphها → حذف صدادارها و h → فشرده‌سازی
 * در نتیجه «عماد» و «Emad» هر دو «md» می‌شوند و «جان» و «John» هر دو «jn».
 *
 * اسکلت صامت تنها کافی نیست: «عماد» و «Mohammad» هم به «md» می‌رسند. برای همین
 * یک «کلید ساده» (همه‌ی صدادارها = a) هم می‌سازیم و فقط وقتی هر دو نزدیک بودند
 * تطبیق را با اطمینان بالا اعلام می‌کنیم.
 *
 * عمداً بدون مدل/شبکه کار می‌کند تا تشخیص همیشه و سریع انجام شود.
 */

const ZWNJ = /[\u200B-\u200F\u202A-\u202E\uFEFF]/g;
/** اعراب، تشدید، تنوین، علامت‌های قرآنی و کشیده */
const MARKS = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

const LETTERS: Record<string, string> = {
  "ا": "a",
  "آ": "a",
  "أ": "a",
  "إ": "a",
  "ب": "b",
  "پ": "p",
  "ت": "t",
  "ث": "s",
  "ج": "j",
  "چ": "ch",
  "ح": "h",
  "خ": "kh",
  "د": "d",
  "ذ": "z",
  "ر": "r",
  "ز": "z",
  "ژ": "zh",
  "س": "s",
  "ش": "sh",
  "ص": "s",
  "ض": "z",
  "ط": "t",
  "ظ": "z",
  "ع": "a",
  "غ": "gh",
  "ف": "f",
  "ق": "gh",
  "ک": "k",
  "گ": "g",
  "ل": "l",
  "م": "m",
  "ن": "n",
  "و": "v",
  "ه": "h",
  "ی": "i",
  "ء": "",
  "ة": "h",
  "ي": "i",
  "ى": "i",
  "ئ": "i",
  "ؤ": "o",
  "ك": "k",
};

const EN_DIGITS = "0123456789";
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** یکسان‌سازی متن: حروف عربی/فارسی، اعداد، نیم‌فاصله. علائم را نگه می‌دارد. */
export function cleanText(input: unknown): string {
  return String(input ?? "")
    .normalize("NFKC")
    .replace(ZWNJ, "")
    .replace(MARKS, "")
    .replace(/[يئ]/g, "ی")
    .replace(/[ى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[أإآ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/[۰-۹]/g, (d) => EN_DIGITS[FA_DIGITS.indexOf(d)] ?? d)
    .replace(/[٠-٩]/g, (d) => EN_DIGITS[AR_DIGITS.indexOf(d)] ?? d)
    .replace(/[ \t\u00A0]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

/** متن آماده‌ی مقایسه: بدون علائم، حروف کوچک. */
export function foldName(input: unknown): string {
  return cleanText(input)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@._\- ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** حروف فارسی را به لاتین برمی‌گرداند؛ لاتین را دست‌نخورده نگه می‌دارد. */
export function toLatin(input: unknown): string {
  const text = foldName(input);
  let out = "";
  for (const char of text) {
    out += LETTERS[char] ?? char;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** کلید آوایی: «عماد»→md، «Emad»→md، «جان اسمیت»→jn smt، «John Smith»→jn smt. */
export function phoneticKey(input: unknown): string {
  const latin = toLatin(input)
    .toLowerCase()
    .replace(/kh/g, "k")
    .replace(/sh/g, "s")
    .replace(/ch/g, "c")
    .replace(/gh/g, "g")
    .replace(/zh/g, "z")
    .replace(/ph/g, "f")
    .replace(/th/g, "t")
    .replace(/ck/g, "k")
    .replace(/q/g, "k")
    .replace(/x/g, "ks")
    .replace(/w/g, "v")
    .replace(/[^a-z ]/g, "");
  return latin
    .split(" ")
    .map((word) =>
      word
        .replace(/[aeiouy]/g, "")
        .replace(/h/g, "")
        .replace(/(.)\1+/g, "$1"),
    )
    .filter(Boolean)
    .join(" ")
    .trim();
}

/**
 * کلید «ساده» برای جدا کردن نام‌هایی که اسکلت صامت یکسانی دارند:
 * همه‌ی صدادارها به a تبدیل و h حذف می‌شود، پس «عماد/Emad» یکی می‌مانند
 * ولی «Mohammad» جدا می‌شود (amad ≠ mamad).
 */
export function simpleKey(input: unknown): string {
  return toLatin(input)
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .split(" ")
    .map((word) =>
      word
        .replace(/[aeiouy]/g, "a")
        .replace(/h/g, "")
        .replace(/(.)\1+/g, "$1"),
    )
    .filter(Boolean)
    .join(" ")
    .trim();
}

/** فاصله‌ی لِوِنشتاین (برای تشابه تقریبی) */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = row;
  }
  return previous[b.length];
}

export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  const max = Math.max(a.length, b.length);
  if (!max) return 0;
  return 1 - levenshtein(a, b) / max;
}

function digitsOnly(value: string): string {
  return String(value ?? "").replace(/\D/g, "");
}

/** هسته‌ی شماره: حذف ۰۰/۰ ابتدایی و کد کشور ۹۸ تا ۰۹۱۲… و +۹۸۹۱۲… یکی شوند */
function phoneCore(value: string): string {
  let digits = digitsOnly(value);
  digits = digits.replace(/^00/, "").replace(/^98/, "").replace(/^0+/, "");
  return digits;
}

function tokens(value: string): string[] {
  return foldName(value)
    .split(" ")
    .map((token) => token.replace(/^@+/, "").replace(/^[._-]+|[._-]+$/g, ""))
    .filter(Boolean);
}

/**
 * نزدیکی «ساختار صدادار» بین دو نام، توکن‌به‌توکن.
 * «John» با «جان اسمیت» باید ۱ شود، ولی «عماد» با «Mohammad» کمتر از ۰٫۸۵.
 */
function simpleCoverage(queryTokens: string[], fieldTokens: string[]): number {
  if (!queryTokens.length || !fieldTokens.length) return 1;
  const fieldKeys = fieldTokens.map((token) => simpleKey(token).replace(/\s/g, ""));
  let total = 0;
  for (const queryToken of queryTokens) {
    const key = simpleKey(queryToken).replace(/\s/g, "");
    let best = 0;
    for (const fieldKey of fieldKeys) {
      const score = similarity(key, fieldKey);
      if (score > best) best = score;
    }
    total += best;
  }
  return total / queryTokens.length;
}

/** کیفیت تطبیق دو توکن، بین ۰ و ۱ */
function tokenQuality(queryToken: string, queryKey: string, candidateToken: string, candidateKey: string): number {
  if (!queryToken || !candidateToken) return 0;
  if (queryToken === candidateToken) return 1;
  if (queryKey && candidateKey && queryKey === candidateKey) {
    // اسکلت صامت یکی است؛ اگر «کلید ساده» هم نزدیک باشد، همان نام است
    const simpleSim = similarity(
      simpleKey(queryToken).replace(/\s/g, ""),
      simpleKey(candidateToken).replace(/\s/g, ""),
    );
    return simpleSim >= 0.85 ? 0.97 : 0.8;
  }
  if (queryToken.length >= 2 && candidateToken.startsWith(queryToken)) return 0.92;
  if (candidateToken.length >= 2 && queryToken.startsWith(candidateToken)) return 0.9;
  if (queryKey.length >= 2 && candidateKey.length >= 2 && candidateKey.startsWith(queryKey)) return 0.84;
  const keySim = similarity(queryKey, candidateKey);
  if (keySim >= 0.75) return 0.6 + (keySim - 0.75) * 1.2;
  const rawSim = similarity(queryToken, candidateToken);
  if (rawSim >= 0.8) return 0.5 + (rawSim - 0.8);
  return 0;
}

export interface NameMatch {
  score: number;
  field: string;
  reason: string;
}

/**
 * امتیاز تطبیق یک عبارت جستجو با چند فیلد (عنوان، نام کاربری، نام‌های دیگر).
 * ۱۰۰ = یکسان، ۹۰+ = با اطمینان، ۶۰–۸۹ = نزدیک، کمتر = حدس.
 */
export function matchName(query: string, fields: Array<string | undefined>): NameMatch {
  const q = foldName(query).replace(/^@+/, "");
  if (!q) return { score: 0, field: "", reason: "" };
  const qTokens = tokens(query);
  const qKey = phoneticKey(q);
  const qDigits = digitsOnly(query);

  let best: NameMatch = { score: 0, field: "", reason: "" };
  const consider = (score: number, field: string, reason: string) => {
    if (score > best.score) best = { score: Math.round(Math.min(100, score)), field, reason };
  };

  for (const raw of fields) {
    const field = String(raw ?? "").trim();
    if (!field) continue;
    const f = foldName(field).replace(/^@+/, "");
    if (!f) continue;
    const fKey = phoneticKey(f);
    const fTokens = tokens(field);
    const fKeys = fTokens.map((token) => phoneticKey(token));

    // «همان نام» بودن: اسکلت صامت یکی است و ساختار صدادار هم نزدیک است.
    // فقط همین حالت می‌تواند به تطبیق با اطمینان بالا برسد؛ وگرنه حداکثر «نزدیک».
    const sameName = simpleCoverage(qTokens, fTokens) >= 0.85;

    let local = { score: 0, reason: "" };
    const bump = (score: number, reason: string) => {
      if (score > local.score) local = { score, reason };
    };

    if (f === q) bump(100, "یکسان");
    else if (q.length >= 3 && (f.startsWith(q) || q.startsWith(f))) bump(94, "شروع یکسان");
    else if (q.length >= 3 && (f.includes(q) || q.includes(f))) bump(86, "شامل عبارت");

    if (qKey && fKey) {
      if (qKey === fKey) {
        bump(qKey.replace(/\s/g, "").length >= 2 ? 96 : 74, "آوایی یکسان");
      } else if (qKey.replace(/\s/g, "").length >= 2 && (fKey.startsWith(qKey) || qKey.startsWith(fKey))) {
        bump(88, "آوایی نزدیک");
      } else {
        const keySim = similarity(qKey.replace(/\s/g, ""), fKey.replace(/\s/g, ""));
        if (keySim >= 0.72) bump(58 + keySim * 22, "آوایی مشابه");
      }
    }

    // پوشش توکن‌های پرسش: «John» باید «جان اسمیت» را پیدا کند
    if (qTokens.length && fTokens.length) {
      let total = 0;
      for (let i = 0; i < qTokens.length; i++) {
        let localBest = 0;
        for (let j = 0; j < fTokens.length; j++) {
          const quality = tokenQuality(qTokens[i], phoneticKey(qTokens[i]), fTokens[j], fKeys[j]);
          if (quality > localBest) localBest = quality;
        }
        total += localBest;
      }
      const coverage = total / qTokens.length;
      if (coverage >= 0.995) bump(qTokens.length > 1 ? 97 : 93, "همه‌ی توکن‌ها");
      else if (coverage >= 0.7) bump(62 + coverage * 28, "بیشتر توکن‌ها");
      else if (coverage >= 0.45) bump(48 + coverage * 20, "بخشی از توکن‌ها");
      if (qTokens.length === 1 && coverage < 1) {
        const onlyKey = phoneticKey(qTokens[0]);
        if (onlyKey.length === 1) bump(Math.min(local.score, 52), "تطبیق یک‌حرفی");
      }
    }

    if (qDigits.length >= 5) {
      const fieldDigits = digitsOnly(field);
      const qCore = phoneCore(qDigits);
      const fCore = phoneCore(fieldDigits);
      if (
        fieldDigits.includes(qDigits) ||
        qDigits.includes(fieldDigits) ||
        (qCore.length >= 7 && fCore.length >= 7 && (qCore === fCore || qCore.endsWith(fCore) || fCore.endsWith(qCore)))
      ) {
        bump(96, "شماره");
      }
    }

    // نام‌های هم‌اسکلت ولی متفاوت (عماد/Mohammad) هرگز «قطعی» نمی‌شوند
    if (!sameName) local.score = Math.min(local.score, 74);
    consider(local.score, field, local.reason);
  }
  return best;
}

/** آیا این متن شبیه شماره موبایل است؟ */
export function looksLikePhone(value: string): boolean {
  const digits = digitsOnly(value);
  return digits.length >= 8 && /^[+\d\s\-()۰-۹٠-٩]+$/.test(cleanText(value));
}

/** آیا این متن نام کاربری است؟ */
export function looksLikeUsername(value: string): boolean {
  const text = cleanText(value).trim();
  return /^@[A-Za-z0-9_.]{2,32}$/.test(text) || /^[A-Za-z0-9_.]{3,32}$/.test(text);
}

/** نمایش کوتاه و امن یک نام برای پاسخ به مدل/کاربر */
export function shortName(value: string, max = 48): string {
  return cleanText(value).replace(/\s+/g, " ").slice(0, max);
}
