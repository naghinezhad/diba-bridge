/**
 * بلوبانک (BluBank) — اتصال به API اپلیکیشن بانکی.
 *
 * نکته‌های مهم درباره‌ی این API (استخراج‌شده از HAR اپلیکیشن):
 *   - آدرس پایه: https://openapi.sdb247.com/openapi/v0
 *   - بیشتر بدنه‌ها protobuf هستند (نه JSON). چون اسکیمای رسمی منتشر نشده،
 *     این provider یک decoder سبک protobuf دارد که فیلدها را می‌خواند و
 *     برای درخواست‌های ناشناخته، بدنه‌ی خام base64 را هم می‌پذیرد.
 *   - جریان ورود: key-exchange → login (شماره) → otp/verify (کد).
 *   - احراز هویت با هدر Authorization انجام می‌شود؛ توکن را از نشست
 *     اپلیکیشن (HAR یا حافظه‌ی دستگاه) استخراج و اینجا ثبت کنید.
 */
import { z } from "zod";
import { netFetch } from "../core/net.js";
import { defineTool, ProviderError, type ProviderContext, type ProviderDef } from "../core/types.js";

const DEFAULT_BASE = "https://openapi.sdb247.com/openapi/v0";

function baseOf(ctx: ProviderContext): string {
  return (ctx.config.baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
}

/** هدرهای احراز هویت؛ توکن Bearer یا کوکی خام. */
function authHeaders(ctx: ProviderContext, requireAuth = true): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "*/*",
    "content-type": "application/x-protobuf",
    "user-agent": String(ctx.config.userAgent || "dibaMCP/blubank"),
  };
  const token = String(ctx.config.accessToken || "").trim();
  const cookie = String(ctx.config.cookie || "").trim();
  if (token) headers.authorization = token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  if (requireAuth && !token && !cookie) {
    throw new ProviderError("برای بلوبانک باید Access Token یا Cookie نشست را در تنظیمات ثبت کنید.");
  }
  return headers;
}

/** یک درخواست به API بلوبانک؛ بدنه و پاسخ protobuf خام. */
async function blubankRequest(
  ctx: ProviderContext,
  path: string,
  opts: { method?: string; bodyBase64?: string; bodyJson?: unknown; query?: Record<string, string>; auth?: boolean } = {},
): Promise<{ status: number; ok: boolean; bodyBase64: string; buf: Buffer; response: Awaited<ReturnType<typeof netFetch>> }> {
  const qs = opts.query ? `?${new URLSearchParams(opts.query).toString()}` : "";
  const headers = authHeaders(ctx, opts.auth !== false);
  let body: Buffer | string | undefined;
  if (opts.bodyJson !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.bodyJson);
  } else if (opts.bodyBase64) {
    body = Buffer.from(opts.bodyBase64, "base64");
  }
  let res: Awaited<ReturnType<typeof netFetch>>;
  try {
    res = await netFetch(`${baseOf(ctx)}${path}${qs}`, {
      method: opts.method ?? "POST",
      headers,
      body,
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err: any) {
    throw new ProviderError(`اتصال به بلوبانک برقرار نشد: ${err?.message ?? err}`, err);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const bodyBase64 = buf.toString("base64");
  if (!res.ok) {
    throw new ProviderError(`بلوبانک: HTTP ${res.status}`, { status: res.status, bodyBase64 });
  }
  return { status: res.status, ok: res.ok, bodyBase64, buf, response: res };
}

/* ------------------------------------------------------------------ */
/* decoder سبک protobuf                                                */
/* ------------------------------------------------------------------ */

export interface ProtoField {
  field: number;
  wire: number;
  value: number | string | Buffer;
}

/** یک پیام protobuf را به فهرست فیلدها تبدیل می‌کند (بدون نیاز به .proto). */
export function decodeProto(buf: Buffer): ProtoField[] {
  const fields: ProtoField[] = [];
  let i = 0;
  /** varint می‌خواند؛ اگر بافر تمام شود یا بیش از ۱۰ بایت شود، undefined برمی‌گرداند. */
  const readVarint = (): number | undefined => {
    let result = 0;
    let shift = 0;
    let bytes = 0;
    while (i < buf.length) {
      const byte = buf[i++];
      result += (byte & 0x7f) * 2 ** shift;
      bytes++;
      if ((byte & 0x80) === 0) return result;
      shift += 7;
      if (bytes >= 10) return undefined; // varint معتبر حداکثر ۱۰ بایت است
    }
    return undefined; // بافر وسط varint تمام شد
  };
  while (i < buf.length) {
    const tag = readVarint();
    if (tag === undefined) break;
    const field = tag >>> 3;
    const wire = tag & 0x07;
    if (field === 0) break; // فیلد ۰ در protobuf معتبر نیست
    if (wire === 0) {
      const value = readVarint();
      if (value === undefined) break;
      fields.push({ field, wire, value });
    } else if (wire === 2) {
      const len = readVarint();
      if (len === undefined || i + len > buf.length) break;
      fields.push({ field, wire, value: buf.subarray(i, i + len) });
      i += len;
    } else if (wire === 5) {
      if (i + 4 > buf.length) break;
      fields.push({ field, wire, value: buf.readUInt32LE(i) });
      i += 4;
    } else if (wire === 1) {
      if (i + 8 > buf.length) break;
      fields.push({ field, wire, value: buf.subarray(i, i + 8) });
      i += 8;
    } else {
      break; // wire ناشناخته؛ ادامه بی‌معناست
    }
  }
  return fields;
}

/** رشته‌های خوانا (فارسی/لاتین) را از یک پیام protobuf بیرون می‌کشد. */
export function extractStrings(buf: Buffer): string[] {
  const out: string[] = [];
  let current: number[] = [];
  const flush = () => {
    if (current.length >= 3) {
      const s = Buffer.from(current).toString("utf8").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
      if (s.length >= 3 && /[\p{L}\p{N}]/u.test(s)) out.push(s);
    }
    current = [];
  };
  for (const byte of buf) {
    if (byte >= 0x20 && byte !== 0x7f) current.push(byte);
    else flush();
  }
  flush();
  return out;
}

/** خلاصه‌ی خوانا از یک پاسخ protobuf برای نمایش به کاربر. */
function summarize(buf: Buffer) {
  const strings = extractStrings(buf);
  const ibans = strings.filter((s) => /^IR\d{24}$/.test(s));
  const cards = strings.filter((s) => /^\d{16}$/.test(s));
  const amounts = strings
    .map((s) => s.match(/^\d+(?:\.\d+)?/)?.[0])
    .filter((s): s is string => !!s)
    .filter((s) => !ibans.includes(s) && !cards.includes(s))
    .filter((s) => !/^\d{16,}$/.test(s)); // شماره کارت/حساب، نه مبلغ
  return {
    bytes: buf.length,
    fields: decodeProto(buf).slice(0, 40).map((f) => ({
      field: f.field,
      wire: f.wire,
      value: Buffer.isBuffer(f.value) ? f.value.toString("utf8").replace(/[^\p{L}\p{N}\s.,:/?=_-]/gu, "") : f.value,
    })),
    strings: strings.slice(0, 60),
    amounts,
    ibans,
    cards,
  };
}

/* ------------------------------------------------------------------ */
/* جریان ورود (key-exchange → login → otp)                             */
/*                                                                     */
/* هشدار مهم: بدنه‌ی این سه اندپوینت در اپلیکیشن بلوبانک رمزنگاری‌شده  */
/* است (بایت‌های تصادفی، نه متن خام). کلید عمومی و الگوریتم رمزنگاری   */
/* منتشر نشده، پس این provider نمی‌تواند خودش شماره/کد را رمز کند.      */
/* این ابزارها بدنه‌ی خام (base64) را می‌پذیرند تا شما بتوانید payload  */
/* واقعی را از HAR یا ابزار خودتان بدهید.                              */
/* ------------------------------------------------------------------ */

/** مرحله‌ی ۱: تبادل کلید نشست. بدنه‌ی خام اختیاری است. */
async function keyExchange(ctx: ProviderContext, bodyBase64?: string) {
  const { buf } = await blubankRequest(ctx, "/session/key-exchange", {
    method: "POST",
    bodyBase64,
    auth: false,
  });
  return { ok: true, bytes: buf.length, session: buf.toString("base64"), strings: extractStrings(buf).slice(0, 20) };
}

/** مرحله‌ی ۲: ورود. بدنه‌ی رمزنگاری‌شده‌ی خام را از HAR بدهید. */
async function login(ctx: ProviderContext, bodyBase64: string) {
  const { buf } = await blubankRequest(ctx, "/session/login", {
    method: "POST",
    bodyBase64,
    auth: false,
  });
  return { ok: true, bytes: buf.length, challenge: buf.toString("base64"), strings: extractStrings(buf).slice(0, 20) };
}

/** مرحله‌ی ۳: تأیید کد پیامک. بدنه‌ی رمزنگاری‌شده‌ی خام را از HAR بدهید. */
async function verifyOtp(ctx: ProviderContext, bodyBase64: string) {
  const { buf } = await blubankRequest(ctx, "/user/otp/verify", {
    method: "POST",
    bodyBase64,
    auth: false,
  });
  return { ok: true, bytes: buf.length, token: buf.toString("base64"), strings: extractStrings(buf).slice(0, 20) };
}

/* ------------------------------------------------------------------ */
/* موجودی و کارت‌ها                                                     */
/* ------------------------------------------------------------------ */

/** فهرست حساب‌های سپرده (موجودی). */
async function deposits(ctx: ProviderContext) {
  const { buf } = await blubankRequest(ctx, "/account/deposit/list/all", { method: "POST" });
  return summarize(buf);
}

/** فهرست پروفایل‌ها/کارت‌ها. */
async function profiles(ctx: ProviderContext) {
  const { buf } = await blubankRequest(ctx, "/account-profile/profile/list", { method: "POST" });
  return summarize(buf);
}

/** پروفایل کاربر. */
async function userProfile(ctx: ProviderContext) {
  const { buf } = await blubankRequest(ctx, "/user/profile/get", { method: "POST" });
  return summarize(buf);
}

/** هویت‌ها (JSON). */
async function identities(ctx: ProviderContext) {
  const { buf } = await blubankRequest(ctx, "/identities/", { method: "POST", bodyJson: {} });
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    return summarize(buf);
  }
}

export const blubank: ProviderDef = {
  id: "blubank",
  name: "BluBank",
  nameFa: "بلوبانک",
  category: "banking",
  region: "iran",
  unofficial: true,
  color: "#0a3d91",
  glyph: "blu",
  description: "اتصال به API اپلیکیشن بلوبانک — ورود با شماره/کد، موجودی، کارت‌ها و تراکنش‌ها",
  docsUrl: "https://blubank.com",
  fields: [
    {
      key: "accessToken",
      label: "Access Token",
      type: "secret",
      help: "توکن نشست اپلیکیشن بلوبانک (هدر Authorization). از HAR یا حافظه‌ی دستگاه استخراج کنید.",
    },
    {
      key: "cookie",
      label: "Cookie نشست",
      type: "secret",
      help: "اختیاری؛ اگر احراز هویت با کوکی انجام می‌شود اینجا وارد کنید.",
    },
    {
      key: "userAgent",
      label: "User-Agent",
      type: "text",
      default: "dibaMCP/blubank",
      help: "اختیاری؛ برای هم‌شکل شدن با اپلیکیشن.",
    },
    { key: "baseUrl", label: "آدرس پایه API", type: "url", default: DEFAULT_BASE },
  ],
  test: (ctx) => deposits(ctx),
  tools: [
    /* ---------- ورود ---------- */
    defineTool({
      name: "blubank_key_exchange",
      title: "تبادل کلید بلوبانک",
      description: "Start a BluBank session key exchange (step 1 of login).",
      input: { body_base64: z.string().optional().describe("بدنه‌ی خام protobuf به‌صورت base64؛ اختیاری.") },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => keyExchange(ctx, a.body_base64),
    }),
    defineTool({
      name: "blubank_login",
      title: "ورود بلوبانک",
      description: "Start BluBank login (step 2). Body is encrypted by the app; pass the raw base64 payload captured from the app/HAR.",
      input: {
        body_base64: z.string().min(1).describe("بدنه‌ی رمزنگاری‌شده‌ی خام (base64) از HAR یا ابزار خودتان."),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => login(ctx, a.body_base64),
    }),
    defineTool({
      name: "blubank_verify_otp",
      title: "تأیید کد پیامک بلوبانک",
      description: "Verify the BluBank OTP (step 3). Body is encrypted by the app; pass the raw base64 payload.",
      input: {
        body_base64: z.string().min(1).describe("بدنه‌ی رمزنگاری‌شده‌ی خام (base64) از HAR یا ابزار خودتان."),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => verifyOtp(ctx, a.body_base64),
    }),

    /* ---------- موجودی ---------- */
    defineTool({
      name: "blubank_get_balance",
      title: "موجودی بلوبانک",
      description: "List BluBank deposit accounts and balances.",
      input: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (_a, ctx) => deposits(ctx),
    }),

    /* ---------- کارت‌ها ---------- */
    defineTool({
      name: "blubank_list_cards",
      title: "کارت‌های بلوبانک",
      description: "List BluBank profiles/cards.",
      input: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (_a, ctx) => profiles(ctx),
    }),
    defineTool({
      name: "blubank_get_user_profile",
      title: "پروفایل کاربر بلوبانک",
      description: "Fetch the BluBank user profile.",
      input: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (_a, ctx) => userProfile(ctx),
    }),
    defineTool({
      name: "blubank_identities",
      title: "هویت‌های بلوبانک",
      description: "Fetch BluBank identities (JSON).",
      input: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (_a, ctx) => identities(ctx),
    }),

    /* ---------- تراکنش‌ها ---------- */
    defineTool({
      name: "blubank_list_transactions",
      title: "تراکنش‌های بلوبانک",
      description: "List BluBank transactions (raw protobuf, decoded).",
      input: {
        body_base64: z.string().optional().describe("بدنه‌ی protobuf خام به‌صورت base64؛ اگر خالی باشد از بدنه‌ی پیش‌فرض استفاده می‌شود."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const { buf } = await blubankRequest(ctx, "/account/transaction/list/all", {
          method: "POST",
          bodyBase64: a.body_base64,
        });
        return summarize(buf);
      },
    }),
    defineTool({
      name: "blubank_list_hashtags",
      title: "برچسب‌های تراکنش بلوبانک",
      description: "List BluBank transaction hashtags (raw protobuf, decoded).",
      input: { body_base64: z.string().optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const { buf } = await blubankRequest(ctx, "/account/transaction/hashtag/list", {
          method: "POST",
          bodyBase64: a.body_base64,
        });
        return summarize(buf);
      },
    }),
    defineTool({
      name: "blubank_list_merchant_categories",
      title: "دسته‌بندی پذیرندگان بلوبانک",
      description: "List BluBank merchant categories (raw protobuf, decoded).",
      input: { body_base64: z.string().optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const { buf } = await blubankRequest(ctx, "/account/transaction/merchant-categories/list", {
          method: "POST",
          bodyBase64: a.body_base64,
        });
        return summarize(buf);
      },
    }),

    /* ---------- عمومی ---------- */
    defineTool({
      name: "blubank_flags",
      title: "پرچم‌های بلوبانک",
      description: "Fetch BluBank feature flags (GET /flags/).",
      input: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (_a, ctx) => {
        const { buf } = await blubankRequest(ctx, "/flags/", { method: "GET", auth: false });
        return summarize(buf);
      },
    }),
    defineTool({
      name: "blubank_raw_request",
      title: "درخواست خام بلوبانک",
      description: "Send a raw request to the BluBank API (protobuf body as base64). For advanced use.",
      input: {
        path: z.string().min(1).describe("مسیر نسبت به آدرس پایه، مثلاً /account/transaction/list/all"),
        method: z.enum(["GET", "POST"]).optional(),
        body_base64: z.string().optional().describe("بدنه‌ی protobuf خام به‌صورت base64."),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const { status, buf } = await blubankRequest(ctx, a.path, {
          method: a.method ?? "POST",
          bodyBase64: a.body_base64,
        });
        return { status, ...summarize(buf) };
      },
    }),
  ],
};
