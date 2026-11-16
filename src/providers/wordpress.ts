/**
 * وردپرس — مدیریت کامل سایت از طریق REST API.
 *
 * دو روش اتصال (حداقل یکی لازم است):
 *   ۱. Application Password خود وردپرس (HTTP Basic روی /wp-json/wp/v2)
 *   ۲. افزونه‌ی همراه «Diba Bridge Connector» با کلید اختصاصی (هدر X-Diba-Bridge-Key
 *      روی /wp-json/diba-bridge/v1) — برای ابزارهای پیشرفته و ووکامرس لازم است.
 *
 * اگر فقط کلید افزونه ثبت شده باشد، ابزارهای REST هسته از مسیر proxy افزونه رد می‌شوند.
 * مسیرهای افزونه باید دقیقاً با wordpress-plugin/diba-bridge-connector هماهنگ بمانند
 * (جدول کامل در docs/WORDPRESS.md).
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { loadMedia, mediaField } from "../core/media.js";
import { describeNetError, FormData, netFetch } from "../core/net.js";
import { defineTool, ProviderError, type ProviderContext, type ProviderDef } from "../core/types.js";

export const CONNECTOR_NS = "/diba-bridge/v1";
export const CONNECTOR_KEY_HEADER = "X-Diba-Bridge-Key";
const CONNECTOR_MARK_HEADER = "x-diba-bridge-connector";
const TIMEOUT_MS = 45_000;
const UPLOAD_TIMEOUT_MS = 120_000;
const USER_AGENT = "DibaBridge-WordPress/1.0";

const MSG_NO_AUTH =
  "هیچ روش اتصالی برای وردپرس ثبت نشده است؛ «نام کاربری + Application Password» یا «کلید افزونه‌ی Diba Bridge Connector» را در تنظیمات وارد کنید.";
const MSG_NEED_CONNECTOR =
  "این ابزار به افزونه‌ی «Diba Bridge Connector» نیاز دارد. افزونه را روی سایت وردپرس نصب و فعال کنید، در «تنظیمات ← Diba Bridge» یک کلید بسازید و آن را در فیلد «کلید افزونه» ثبت کنید.";
const MSG_CONNECTOR_MISSING =
  "افزونه‌ی «Diba Bridge Connector» روی این سایت پیدا نشد (نصب یا فعال نیست، یا REST API سایت مسدود است).";
const MSG_WC_INACTIVE = "ووکامرس روی این سایت فعال نیست؛ ابزارهای فروشگاهی فقط با ووکامرس فعال کار می‌کنند.";
const MSG_SEO_INACTIVE = "هیچ افزونه‌ی سئوی پشتیبانی‌شده‌ای (Yoast SEO یا Rank Math) روی این سایت فعال نیست.";

/** خطای برگشتی از وردپرس همراه با کد و وضعیت HTTP */
export class WordPressError extends ProviderError {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | undefined,
    /** آیا پاسخ از خود افزونه‌ی اتصال آمده است؟ */
    public readonly fromConnector: boolean,
    details?: unknown,
  ) {
    super(message, details);
    this.name = "WordPressError";
  }
}

type Query = Record<string, unknown>;

interface SendOptions {
  method?: string;
  query?: Query;
  body?: unknown;
  /** بدنه‌ی خام (آپلود فایل) به‌جای JSON */
  raw?: { body: any; headers?: Record<string, string> };
  headers?: Record<string, string>;
  timeoutMs?: number;
}

interface WpResponse {
  data: any;
  status: number;
  total?: number;
  totalPages?: number;
}

// ---------------------------------------------------------------- آدرس و کوئری

/** آدرس سایت را تمیز می‌کند: بدون اسلش انتهایی، بدون /wp-json یا /wp-admin */
export function siteBase(ctx: ProviderContext): string {
  let raw = String(ctx.config.siteUrl || "").trim();
  if (!raw) throw new ProviderError("آدرس سایت وردپرس ثبت نشده است.");
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ProviderError("آدرس سایت وردپرس نامعتبر است.");
  }
  const path = u.pathname
    .replace(/\/(wp-json|wp-admin|wp-login\.php)(\/.*)?$/i, "")
    .replace(/\/+$/, "");
  return `${u.origin}${path}`;
}

/** مقادیر کوئری را به رشته تبدیل می‌کند (آرایه → فهرست با ویرگول، شیء → k[sub]) */
export function flatQuery(query: Query | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!query) return out;
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      if (v.length) out[k] = v.map(String).join(",");
    } else if (typeof v === "object") {
      for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
        if (sv !== undefined && sv !== null) out[`${k}[${sk}]`] = Array.isArray(sv) ? sv.map(String).join(",") : String(sv);
      }
    } else {
      out[k] = String(v);
    }
  }
  return out;
}

/** آدرس نهایی REST؛ mode=query برای سایت‌های بدون پیوند یکتای زیبا (?rest_route=) */
export function buildRestUrl(base: string, route: string, query: Query | undefined, mode: "pretty" | "query"): string {
  const qs = new URLSearchParams(flatQuery(query)).toString();
  if (mode === "pretty") return `${base}/wp-json${route}${qs ? `?${qs}` : ""}`;
  const r = encodeURIComponent(route).replace(/%2F/gi, "/");
  return `${base}/?rest_route=${r}${qs ? `&${qs}` : ""}`;
}

/**
 * مسیر ابزار عمومی را بررسی می‌کند: فقط مسیر نسبی زیر /wp-json،
 * بدون آدرس کامل، میزبان دیگر، «..»، کوئری یا کاراکتر رمزشده.
 */
export function normalizeRestPath(input: string): string {
  let p = String(input ?? "").trim();
  const bad = () => new ProviderError("مسیر نامعتبر است؛ فقط مسیر نسبی زیر /wp-json مجاز است (مثلاً /wp/v2/posts).");
  if (!p || /^[a-z][a-z0-9+.-]*:/i.test(p) || p.startsWith("//") || /[\\?#%\s]/.test(p)) throw bad();
  if (!p.startsWith("/")) p = `/${p}`;
  p = p.replace(/^\/wp-json(?=\/|$)/i, "") || "/";
  if (p.startsWith("//") || !/^\/[A-Za-z0-9_\-./~@:+,()=]*$/.test(p)) throw bad();
  if (p.split("/").some((seg) => seg === ".." || seg === ".")) throw bad();
  return p;
}

// ---------------------------------------------------------------- احراز هویت

function basicHeader(ctx: ProviderContext): string | undefined {
  const user = String(ctx.config.username || "").trim();
  const pass = String(ctx.config.appPassword || "").trim();
  if (!user || !pass) return undefined;
  return `Basic ${Buffer.from(`${user}:${pass}`, "utf8").toString("base64")}`;
}

function connectorKey(ctx: ProviderContext): string | undefined {
  return String(ctx.config.connectorKey || "").trim() || undefined;
}

// ---------------------------------------------------------------- متن

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—", laquo: "«", raquo: "»" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML را به متن ساده تبدیل و در صورت نیاز کوتاه می‌کند */
export function stripHtml(html: unknown, max = 0): string {
  const text = decodeEntities(
    String(html ?? "")
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return max > 0 && text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/** فیلدهای {raw, rendered} وردپرس را به رشته تبدیل می‌کند */
function rendered(v: any): string {
  if (v && typeof v === "object") return String(v.raw ?? v.rendered ?? "");
  return v === undefined || v === null ? "" : String(v);
}

/** کلیدهای خالی را حذف می‌کند تا خروجی جمع‌وجور بماند */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

// ---------------------------------------------------------------- لایه‌ی HTTP

/** برای هر سایت یادمان می‌ماند کدام شکل آدرس جواب می‌دهد */
const restMode = new Map<string, "pretty" | "query">();

const HINTS: Record<string, string> = {
  rest_no_route: "این مسیر در REST API سایت وجود ندارد",
  rest_forbidden: "کاربر متصل دسترسی لازم برای این کار را ندارد",
  rest_forbidden_context: "کاربر متصل اجازه‌ی دیدن این اطلاعات را ندارد",
  rest_not_logged_in: "احراز هویت انجام نشد؛ نام کاربری و Application Password را بررسی کنید (بعضی هاست‌ها هدر Authorization را حذف می‌کنند — در این حالت از افزونه‌ی اتصال استفاده کنید)",
  incorrect_password: "نام کاربری یا Application Password اشتباه است",
  invalid_username: "نام کاربری یا Application Password اشتباه است",
  invalid_email: "نام کاربری یا Application Password اشتباه است",
  application_passwords_disabled: "Application Password روی این سایت غیرفعال است (سایت باید HTTPS داشته باشد)",
  rest_post_invalid_id: "محتوایی با این شناسه پیدا نشد",
  rest_term_invalid: "دسته/برچسبی با این شناسه پیدا نشد",
  rest_user_invalid_id: "کاربری با این شناسه پیدا نشد",
  rest_comment_invalid_id: "دیدگاهی با این شناسه پیدا نشد",
  rest_invalid_param: "ورودی نامعتبر است",
  rest_missing_callback_param: "یک ورودی اجباری فرستاده نشده است",
  rest_trash_not_supported: "این مورد سطل زباله ندارد؛ برای حذف دائمی force=true بدهید",
  rest_already_trashed: "این مورد قبلاً به سطل زباله رفته است",
  term_exists: "دسته/برچسبی با همین نام از قبل وجود دارد",
  existing_user_login: "این نام کاربری قبلاً ثبت شده است",
  existing_user_email: "این ایمیل قبلاً ثبت شده است",
};

function hintFor(code: string | undefined, status: number): string | undefined {
  if (code && HINTS[code]) return HINTS[code];
  if (code && /^rest_cannot_|^rest_user_cannot_|_cannot_/.test(code)) return "کاربر متصل دسترسی لازم برای این کار را ندارد";
  if (status === 401) return "احراز هویت ناموفق بود";
  if (status === 403) return "دسترسی رد شد";
  if (status === 429) return "تعداد درخواست‌ها بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید";
  return undefined;
}

function throwWpError(status: number, data: any, fromConnector: boolean): never {
  const code = typeof data?.code === "string" ? data.code : undefined;
  const message = stripHtml(data?.message ?? "", 300);
  const hint = hintFor(code, status);
  const params = data?.data?.params && typeof data.data.params === "object"
    ? ` (${Object.entries(data.data.params).map(([k, v]) => `${k}: ${stripHtml(v, 120)}`).join("؛ ")})`
    : "";
  const parts = [hint, message && message !== hint ? message : ""].filter(Boolean).join(" — ") || `HTTP ${status}`;
  throw new WordPressError(`وردپرس: ${parts}${params}${code ? ` [${code}]` : ""}`, status, code, fromConnector, {
    status,
    code,
    data: data?.data,
  });
}

interface Attempt {
  res: Awaited<ReturnType<typeof netFetch>>;
  text: string;
  json: any;
  isJson: boolean;
}

async function attempt(base: string, route: string, opts: SendOptions, mode: "pretty" | "query"): Promise<Attempt> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": USER_AGENT,
    ...(opts.headers ?? {}),
    ...(opts.raw?.headers ?? {}),
  };
  let body: any;
  if (opts.raw) body = opts.raw.body;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json; charset=utf-8";
    body = JSON.stringify(opts.body);
  }
  let res: Awaited<ReturnType<typeof netFetch>>;
  try {
    res = await netFetch(buildRestUrl(base, route, opts.query, mode), {
      method: opts.method ?? "GET",
      headers,
      body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (err: any) {
    throw new ProviderError(`اتصال به سایت وردپرس برقرار نشد: ${describeNetError(err)}`, { url: base });
  }
  const text = (await res.text()).replace(/^﻿/, "").trim();
  let json: any;
  let isJson = false;
  if (text) {
    try {
      json = JSON.parse(text);
      isJson = true;
    } catch {
      isJson = false;
    }
  } else if (res.status === 204 || res.ok) {
    // پاسخ خالی موفق (مثلاً 204)
    json = null;
    isJson = (res.headers.get("content-type") ?? "").includes("json") || res.status === 204;
  }
  return { res, text, json, isJson };
}

/** یک درخواست به REST سایت؛ در صورت نیاز خودکار به ?rest_route= برمی‌گردد */
async function send(ctx: ProviderContext, route: string, opts: SendOptions = {}): Promise<WpResponse> {
  const base = siteBase(ctx);
  const known = restMode.get(base);
  let a = await attempt(base, route, opts, known ?? "pretty");
  if (!known) {
    // 404/200 غیر JSON یعنی /wp-json اصلاً به وردپرس نرسیده (پیوند یکتای ساده)؛ درخواست اجرا نشده و تکرارش امن است
    if (!a.isJson && (a.res.status === 404 || a.res.status === 200)) {
      const b = await attempt(base, route, opts, "query");
      if (b.isJson) {
        restMode.set(base, "query");
        a = b;
      }
    } else if (a.isJson) {
      restMode.set(base, "pretty");
    }
  }
  const fromConnector = a.res.headers.has(CONNECTOR_MARK_HEADER);
  if (!a.isJson) {
    const excerpt = stripHtml(a.text, 160);
    throw new WordPressError(
      `وردپرس: پاسخ سایت JSON نبود (HTTP ${a.res.status})${excerpt ? ` — ${excerpt}` : ""}. احتمالاً REST API غیرفعال است یا فایروال/افزونه‌ی امنیتی درخواست را مسدود کرده است.`,
      a.res.status,
      undefined,
      fromConnector,
      { status: a.res.status },
    );
  }
  if (!a.res.ok) throwWpError(a.res.status, a.json, fromConnector);
  const num = (h: string) => {
    const v = a.res.headers.get(h);
    return v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined;
  };
  return { data: a.json, status: a.res.status, total: num("x-wp-total"), totalPages: num("x-wp-totalpages") };
}

function connectorNotFound(path: string, err: WordPressError): ProviderError {
  if (err.fromConnector && path.startsWith("/wc/")) return new ProviderError(MSG_WC_INACTIVE, err.details);
  if (err.fromConnector && path.startsWith("/seo/")) return new ProviderError(MSG_SEO_INACTIVE, err.details);
  if (err.fromConnector) {
    return new ProviderError("این مسیر در افزونه‌ی اتصال وجود ندارد؛ افزونه‌ی Diba Bridge Connector را به‌روزرسانی کنید.", err.details);
  }
  return new ProviderError(MSG_CONNECTOR_MISSING, err.details);
}

/** درخواست به مسیرهای اختصاصی افزونه‌ی اتصال */
async function connector(ctx: ProviderContext, path: string, opts: SendOptions = {}): Promise<WpResponse> {
  const key = connectorKey(ctx);
  if (!key) throw new ProviderError(MSG_NEED_CONNECTOR);
  try {
    return await send(ctx, `${CONNECTOR_NS}${path}`, { ...opts, headers: { ...(opts.headers ?? {}), [CONNECTOR_KEY_HEADER]: key } });
  } catch (err) {
    if (err instanceof WordPressError && err.code === "rest_no_route") throw connectorNotFound(path, err);
    throw err;
  }
}

/**
 * درخواست به REST هسته‌ی وردپرس: با Application Password مستقیم،
 * و اگر فقط کلید افزونه هست از مسیر proxy افزونه.
 */
async function core(ctx: ProviderContext, route: string, opts: SendOptions = {}): Promise<WpResponse> {
  const basic = basicHeader(ctx);
  if (basic) return send(ctx, route, { ...opts, headers: { ...(opts.headers ?? {}), authorization: basic } });
  const key = connectorKey(ctx);
  if (!key) throw new ProviderError(MSG_NO_AUTH);
  if (opts.raw) throw new ProviderError("این درخواست از مسیر افزونه‌ی اتصال قابل ارسال نیست.");
  try {
    return await send(ctx, `${CONNECTOR_NS}/proxy`, {
      method: "POST",
      headers: { [CONNECTOR_KEY_HEADER]: key },
      body: { method: opts.method ?? "GET", path: route, query: flatQuery(opts.query), body: opts.body ?? null },
      timeoutMs: opts.timeoutMs,
    });
  } catch (err) {
    if (err instanceof WordPressError && err.code === "rest_no_route" && !err.fromConnector) {
      throw new ProviderError(MSG_CONNECTOR_MISSING, err.details);
    }
    throw err;
  }
}

function paged(r: WpResponse, items: unknown[], a: { page?: number; per_page?: number }) {
  return compact({
    total: r.total ?? items.length,
    total_pages: r.totalPages ?? 1,
    page: a.page ?? 1,
    per_page: a.per_page,
    count: items.length,
    items,
  }) as Record<string, unknown>;
}

// ---------------------------------------------------------------- نوع محتوا و طبقه‌بندی

const routeCache = new Map<string, string>();

const BUILTIN_TYPES: Record<string, string> = { post: "/wp/v2/posts", posts: "/wp/v2/posts", page: "/wp/v2/pages", pages: "/wp/v2/pages", attachment: "/wp/v2/media" };
const BUILTIN_TAX: Record<string, string> = {
  category: "/wp/v2/categories",
  categories: "/wp/v2/categories",
  post_tag: "/wp/v2/tags",
  tag: "/wp/v2/tags",
  tags: "/wp/v2/tags",
};

async function resolveRoute(ctx: ProviderContext, kind: "types" | "taxonomies", slug: string, builtin: Record<string, string>): Promise<string> {
  const key = slug.trim().toLowerCase();
  if (builtin[key]) return builtin[key];
  const cacheKey = `${siteBase(ctx)}|${kind}|${key}`;
  const hit = routeCache.get(cacheKey);
  if (hit) return hit;
  let data: any;
  try {
    data = (await core(ctx, `/wp/v2/${kind}/${encodeURIComponent(key)}`)).data;
  } catch (err) {
    if (err instanceof WordPressError && err.status === 404) {
      throw new ProviderError(
        kind === "types"
          ? `نوع محتوای «${slug}» در این سایت پیدا نشد یا در REST فعال نیست؛ با wordpress_list_post_types فهرست را ببینید.`
          : `طبقه‌بندی «${slug}» در این سایت پیدا نشد یا در REST فعال نیست؛ با wordpress_list_taxonomies فهرست را ببینید.`,
      );
    }
    throw err;
  }
  const route = `/${String(data?.rest_namespace || "wp/v2").replace(/^\/+|\/+$/g, "")}/${data?.rest_base || key}`;
  routeCache.set(cacheKey, route);
  return route;
}

const typeRoute = (ctx: ProviderContext, type?: string) => resolveRoute(ctx, "types", type || "post", BUILTIN_TYPES);
const taxRoute = (ctx: ProviderContext, taxonomy?: string) => resolveRoute(ctx, "taxonomies", taxonomy || "category", BUILTIN_TAX);

// ---------------------------------------------------------------- شکل‌دهی خروجی

const POST_LIST_FIELDS = "id,date,modified,slug,status,type,link,title,excerpt,author,featured_media,categories,tags,parent,sticky";

function postSummary(p: any) {
  return compact({
    id: p.id,
    type: p.type,
    status: p.status,
    title: stripHtml(rendered(p.title)),
    slug: p.slug,
    link: p.link,
    date: p.date,
    modified: p.modified,
    author: p.author,
    excerpt: stripHtml(rendered(p.excerpt), 240),
    featured_media: p.featured_media || undefined,
    categories: p.categories,
    tags: p.tags,
    parent: p.parent || undefined,
    sticky: p.sticky || undefined,
  });
}

function postFull(p: any, format: "html" | "text") {
  const html = rendered(p.content);
  const meta = p.meta && typeof p.meta === "object" && !Array.isArray(p.meta) && Object.keys(p.meta).length ? p.meta : undefined;
  return compact({
    ...postSummary(p),
    excerpt: stripHtml(rendered(p.excerpt), 600),
    content: format === "text" ? stripHtml(html) : html,
    content_format: format === "text" ? "text" : p.content?.raw !== undefined ? "raw_html" : "rendered_html",
    comment_status: p.comment_status,
    template: p.template,
    meta,
  });
}

function termOut(t: any) {
  return compact({ id: t.id, name: decodeEntities(String(t.name ?? "")), slug: t.slug, taxonomy: t.taxonomy, parent: t.parent || undefined, count: t.count, description: stripHtml(t.description, 200), link: t.link });
}

function mediaOut(m: any) {
  return compact({
    id: m.id,
    title: stripHtml(rendered(m.title)),
    alt_text: m.alt_text,
    caption: stripHtml(rendered(m.caption), 200),
    media_type: m.media_type,
    mime_type: m.mime_type,
    url: m.source_url,
    width: m.media_details?.width,
    height: m.media_details?.height,
    filesize: m.media_details?.filesize,
    post: m.post || undefined,
    date: m.date,
  });
}

function commentOut(c: any, full = false) {
  return compact({
    id: c.id,
    post: c.post,
    parent: c.parent || undefined,
    status: c.status,
    author: c.author || undefined,
    author_name: c.author_name,
    author_email: c.author_email,
    date: c.date,
    content: stripHtml(rendered(c.content), full ? 0 : 300),
    link: c.link,
  });
}

function userOut(u: any) {
  return compact({
    id: u.id,
    username: u.username,
    name: u.name,
    email: u.email,
    roles: u.roles,
    registered_date: u.registered_date,
    url: u.url,
    description: stripHtml(u.description, 200),
    link: u.link,
  });
}

function pluginOut(p: any) {
  return compact({
    plugin: p.plugin,
    name: p.name,
    status: p.status,
    version: p.version,
    author: stripHtml(p.author, 80),
    description: stripHtml(rendered(p.description), 140),
    requires_wp: p.requires_wp,
    requires_php: p.requires_php,
  });
}

function themeOut(t: any) {
  return compact({
    stylesheet: t.stylesheet,
    template: t.template !== t.stylesheet ? t.template : undefined,
    name: stripHtml(rendered(t.name)),
    version: t.version,
    status: t.status,
    author: stripHtml(rendered(t.author), 80),
  });
}

function menuItemOut(i: any) {
  return compact({
    id: i.id,
    title: stripHtml(rendered(i.title)),
    url: i.url,
    type: i.type,
    object: i.object,
    object_id: i.object_id || undefined,
    parent: i.parent || undefined,
    menu_order: i.menu_order,
    status: i.status,
    target: i.target,
  });
}

// ---------------------------------------------------------------- ورودی‌های مشترک

const READ = { readOnlyHint: true, openWorldHint: true } as const;
const WRITE = { openWorldHint: true } as const;
const DESTRUCTIVE = { destructiveHint: true, openWorldHint: true } as const;

const zId = z.number().int().positive();
const zPage = z.number().int().min(1).optional().describe("Page number (default 1)");
const zPerPage = z.number().int().min(1).max(100).optional().describe("Items per page, 1-100 (default 10)");
const zOrder = z.enum(["asc", "desc"]).optional();
const zSlug = z.string().regex(/^[A-Za-z0-9_-]+$/).max(64);
const zType = zSlug.optional().describe("Post type slug: post (default), page, or any custom post type exposed in REST (see wordpress_list_post_types)");
const zTaxonomy = zSlug.optional().describe("Taxonomy slug: category (default), post_tag, or any custom taxonomy exposed in REST");
const zPlugin = z.string().regex(/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)?$/).describe('Plugin identifier as returned by wordpress_list_plugins, e.g. "akismet/akismet"');
const zPrice = z.union([z.string().max(40), z.number()]);

const postWriteShape = {
  title: z.string().max(500).optional(),
  content: z.string().optional().describe("Post content (HTML or block markup)"),
  excerpt: z.string().optional(),
  status: z.enum(["draft", "publish", "pending", "private", "future"]).optional().describe('Use "future" together with `date` to schedule'),
  date: z.string().optional().describe("Publish date in site timezone, ISO 8601 (e.g. 2026-01-31T09:30:00). Required for status=future"),
  slug: z.string().max(200).optional(),
  author: zId.optional().describe("Author user ID"),
  categories: z.array(zId).optional().describe("Category term IDs (posts)"),
  tags: z.array(zId).optional().describe("Tag term IDs (posts)"),
  terms: z.record(z.string(), z.array(zId)).optional().describe("Custom taxonomy terms: { <taxonomy rest_base>: [term IDs] }"),
  featured_media: z.number().int().min(0).optional().describe("Featured image attachment ID (0 removes it)"),
  meta: z.record(z.string(), z.any()).optional().describe("Meta fields registered for REST (show_in_rest)"),
  parent: z.number().int().min(0).optional().describe("Parent ID (hierarchical types such as pages)"),
  template: z.string().max(200).optional(),
  comment_status: z.enum(["open", "closed"]).optional(),
  sticky: z.boolean().optional(),
  password: z.string().max(255).optional().describe("Password-protect the post"),
};

function postBody(a: Record<string, any>): Record<string, unknown> {
  if (a.status === "future" && !a.date) {
    throw new ProviderError("برای زمان‌بندی انتشار (status=future) باید تاریخ انتشار (date) هم داده شود.");
  }
  if (a.date && Number.isNaN(Date.parse(a.date))) throw new ProviderError("تاریخ نامعتبر است؛ قالب ISO 8601 بدهید (مثلاً 2026-01-31T09:30:00).");
  const { terms, ...rest } = a;
  const body: Record<string, unknown> = {};
  for (const k of Object.keys(postWriteShape)) {
    if (k !== "terms" && rest[k] !== undefined) body[k] = rest[k];
  }
  for (const [tax, ids] of Object.entries((terms ?? {}) as Record<string, number[]>)) {
    if (!/^[A-Za-z0-9_-]+$/.test(tax)) throw new ProviderError(`نام طبقه‌بندی نامعتبر است: ${tax}`);
    body[tax] = ids;
  }
  return body;
}

const productWriteShape = {
  name: z.string().min(1).max(300).optional(),
  status: z.enum(["draft", "publish", "pending", "private"]).optional(),
  regular_price: zPrice.optional(),
  sale_price: zPrice.optional().describe("Empty string removes the sale price"),
  description: z.string().optional(),
  short_description: z.string().optional(),
  sku: z.string().max(100).optional(),
  manage_stock: z.boolean().optional(),
  stock_quantity: z.number().int().optional(),
  stock_status: z.enum(["instock", "outofstock", "onbackorder"]).optional(),
  category_ids: z.array(zId).optional(),
  tag_ids: z.array(zId).optional(),
  image_id: z.number().int().min(0).optional().describe("Main image attachment ID"),
  gallery_image_ids: z.array(zId).optional(),
  featured: z.boolean().optional(),
  virtual: z.boolean().optional(),
  weight: zPrice.optional(),
};

/** فقط کلیدهای مقداردار را نگه می‌دارد */
function defined(a: Record<string, unknown>, skip: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) if (v !== undefined && !skip.includes(k)) out[k] = v;
  return out;
}

// ---------------------------------------------------------------- تست و اطلاعات سایت

async function siteIndex(ctx: ProviderContext): Promise<any> {
  return (await core(ctx, "/", { query: { _fields: "name,description,url,home,gmt_offset,timezone_string,namespaces" } })).data ?? {};
}

async function testConnection(ctx: ProviderContext) {
  const basic = basicHeader(ctx);
  const key = connectorKey(ctx);
  if (!basic && !key) throw new ProviderError(MSG_NO_AUTH);
  const out: Record<string, unknown> = { ok: true, site_url: siteBase(ctx), auth: compact({ application_password: !!basic, connector: !!key }) };
  if (basic) {
    const me = (await core(ctx, "/wp/v2/users/me", { query: { context: "edit" } })).data;
    const index = await siteIndex(ctx);
    out.site_name = decodeEntities(String(index.name ?? ""));
    out.user = compact({ id: me.id, username: me.username, name: me.name, roles: me.roles });
    out.connector_installed = Array.isArray(index.namespaces) ? index.namespaces.includes("diba-bridge/v1") : undefined;
  }
  if (key) {
    const ping = (await connector(ctx, "/ping")).data ?? {};
    out.site_name = ping.site_name ?? out.site_name;
    out.wp_version = ping.wp_version;
    out.connector_version = ping.connector_version;
    out.connector_user = ping.user;
    out.user = out.user ?? ping.user;
    out.read_only = ping.read_only;
    out.scopes = ping.scopes;
  }
  return out;
}

async function siteInfo(ctx: ProviderContext) {
  const basic = !!basicHeader(ctx);
  const key = !!connectorKey(ctx);
  if (key) {
    const info = (await connector(ctx, "/site-info")).data ?? {};
    return { ...info, auth: { application_password: basic, connector: true } };
  }
  // بدون افزونه: فقط همان چیزی که REST هسته می‌دهد
  const index = await siteIndex(ctx);
  const namespaces: string[] = Array.isArray(index.namespaces) ? index.namespaces : [];
  const soft = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch {
      return undefined;
    }
  };
  const themes = await soft(async () => (await core(ctx, "/wp/v2/themes", { query: { status: "active" } })).data);
  const plugins = await soft(async () => (await core(ctx, "/wp/v2/plugins", { query: { status: "active", _fields: "plugin" } })).data);
  const active = Array.isArray(themes) ? themes[0] : undefined;
  return compact({
    name: decodeEntities(String(index.name ?? "")),
    description: decodeEntities(String(index.description ?? "")),
    url: index.url,
    home: index.home,
    timezone: index.timezone_string || undefined,
    gmt_offset: index.gmt_offset,
    wp_version: undefined,
    theme: active ? themeOut(active) : undefined,
    active_plugins_count: Array.isArray(plugins) ? plugins.length : undefined,
    woocommerce: { active: namespaces.some((n) => n.startsWith("wc/")) },
    connector: {
      installed: namespaces.includes("diba-bridge/v1"),
      configured: false,
      note: "WordPress version, site health and power tools need the Diba Bridge Connector key.",
    },
    auth: { application_password: basic, connector: false },
  });
}

// ---------------------------------------------------------------- تعریف سرویس

export const wordpress: ProviderDef = {
  id: "wordpress",
  name: "WordPress",
  nameFa: "وردپرس",
  category: "utility",
  region: "international",
  color: "#21759b",
  glyph: "W",
  description: "مدیریت کامل سایت وردپرس — نوشته‌ها، رسانه، دیدگاه‌ها، کاربران، افزونه‌ها، سئو و ووکامرس",
  docsUrl: "https://developer.wordpress.org/rest-api/",
  fields: [
    { key: "siteUrl", label: "آدرس سایت", type: "url", required: true, placeholder: "https://example.com", help: "آدرس اصلی سایت وردپرس (بدون /wp-admin)" },
    { key: "username", label: "نام کاربری وردپرس", type: "text", placeholder: "admin", help: "برای اتصال با Application Password (اختیاری اگر کلید افزونه دارید)" },
    { key: "appPassword", label: "Application Password", type: "secret", placeholder: "xxxx xxxx xxxx xxxx xxxx xxxx", help: "پیشخوان وردپرس ← کاربران ← شناسنامه ← رمزهای عبور برنامه" },
    { key: "connectorKey", label: "کلید افزونه (Diba Bridge Connector)", type: "secret", placeholder: "dbk_...", help: "برای ابزارهای پیشرفته و ووکامرس؛ از «تنظیمات ← Diba Bridge» در پیشخوان وردپرس بسازید" },
  ],
  test: (ctx) => testConnection(ctx),
  tools: [
    // ============================================================ سایت
    defineTool({
      name: "wordpress_get_site_info",
      title: "اطلاعات سایت وردپرس",
      description: "Get WordPress site info: name, URL, WordPress version, active theme, active plugin count, WooCommerce/SEO plugin status and connector status.",
      input: {},
      annotations: READ,
      handler: async (_a, ctx) => siteInfo(ctx),
    }),
    defineTool({
      name: "wordpress_site_health",
      title: "سلامت سایت",
      description: "Site health summary: WordPress/PHP/database versions, memory limits, pending updates, debug flags, HTTPS, object cache, cron. Requires the connector plugin.",
      input: {},
      annotations: READ,
      handler: async (_a, ctx) => (await connector(ctx, "/site-health")).data,
    }),
    defineTool({
      name: "wordpress_get_settings",
      title: "تنظیمات وردپرس",
      description: "Read core site settings (title, tagline, timezone, date format, posts per page, front page, default category, ...).",
      input: {},
      annotations: READ,
      handler: async (_a, ctx) => (await core(ctx, "/wp/v2/settings")).data,
    }),
    defineTool({
      name: "wordpress_update_settings",
      title: "تغییر تنظیمات وردپرس",
      description: "Update core site settings exposed by /wp/v2/settings. Pass only the keys to change, e.g. { title, description, timezone_string, posts_per_page }.",
      input: { settings: z.record(z.string(), z.any()).describe("Setting keys and new values") },
      annotations: WRITE,
      handler: async (a, ctx) => {
        if (!Object.keys(a.settings).length) throw new ProviderError("هیچ تنظیمی برای تغییر داده نشده است.");
        const { data } = await core(ctx, "/wp/v2/settings", { method: "POST", body: a.settings });
        const changed: Record<string, unknown> = {};
        for (const k of Object.keys(a.settings)) changed[k] = data?.[k];
        return { ok: true, settings: changed };
      },
    }),

    // ============================================================ محتوا
    defineTool({
      name: "wordpress_list_post_types",
      title: "انواع محتوا",
      description: "List post types exposed in the REST API (posts, pages, custom post types) with their rest_base and taxonomies.",
      input: {},
      annotations: READ,
      handler: async (_a, ctx) => {
        const { data } = await core(ctx, "/wp/v2/types");
        const items = Object.values(data ?? {}).map((t: any) =>
          compact({ slug: t.slug, name: t.name, rest_base: t.rest_base, rest_namespace: t.rest_namespace, hierarchical: t.hierarchical, taxonomies: t.taxonomies }),
        );
        return { count: items.length, items };
      },
    }),
    defineTool({
      name: "wordpress_list_posts",
      title: "فهرست نوشته‌ها",
      description: "List posts, pages or any custom post type with filters and pagination. Returns compact summaries (title, status, date, text excerpt); use wordpress_get_post for full content.",
      input: {
        type: zType,
        search: z.string().max(200).optional(),
        status: z.string().regex(/^[a-z_,-]+$/).optional().describe('Status filter, comma separated: publish, draft, pending, private, future, trash or "any" (default publish)'),
        author: zId.optional(),
        categories: z.array(zId).optional(),
        tags: z.array(zId).optional(),
        parent: z.number().int().min(0).optional(),
        slug: z.string().max(200).optional(),
        include: z.array(zId).max(100).optional().describe("Only these IDs"),
        after: z.string().optional().describe("Published after this ISO 8601 date"),
        before: z.string().optional().describe("Published before this ISO 8601 date"),
        orderby: z.enum(["date", "modified", "title", "id", "slug", "author", "relevance", "menu_order"]).optional(),
        order: zOrder,
        page: zPage,
        per_page: zPerPage,
      },
      annotations: READ,
      handler: async (a, ctx) => {
        const route = await typeRoute(ctx, a.type);
        const { type: _t, ...filters } = a;
        const r = await core(ctx, route, { query: { ...filters, per_page: a.per_page ?? 10, _fields: POST_LIST_FIELDS } });
        const items = (Array.isArray(r.data) ? r.data : []).map(postSummary);
        return paged(r, items, { page: a.page, per_page: a.per_page ?? 10 });
      },
    }),
    defineTool({
      name: "wordpress_get_post",
      title: "دریافت نوشته",
      description: "Get one post/page/custom post by ID with full content, meta and taxonomy term IDs.",
      input: {
        id: zId,
        type: zType,
        format: z.enum(["html", "text"]).optional().describe("html (default, raw editor content when permitted) or text (HTML stripped)"),
      },
      annotations: READ,
      handler: async (a, ctx) => {
        const route = await typeRoute(ctx, a.type);
        const { data } = await core(ctx, `${route}/${a.id}`, { query: { context: "edit" } });
        return postFull(data, a.format ?? "html");
      },
    }),
    defineTool({
      name: "wordpress_create_post",
      title: "ساخت نوشته",
      description: "Create a post, page or custom post. Defaults to status=draft. Schedule with status=future + date. Supports featured image, categories/tags, custom taxonomy terms and REST-registered meta.",
      input: { type: zType, ...postWriteShape },
      annotations: WRITE,
      handler: async (a, ctx) => {
        if (!a.title && !a.content && !a.excerpt) throw new ProviderError("برای ساخت نوشته حداقل عنوان یا محتوا لازم است.");
        const route = await typeRoute(ctx, a.type);
        const body = postBody(a);
        if (body.status === undefined) body.status = "draft";
        const { data } = await core(ctx, route, { method: "POST", body });
        return { ok: true, post: postSummary(data) };
      },
    }),
    defineTool({
      name: "wordpress_update_post",
      title: "ویرایش نوشته",
      description: "Update fields of an existing post/page/custom post (only the provided fields change). Use status to publish, unpublish, schedule (future + date) or restore from trash (status=draft).",
      input: { id: zId, type: zType, ...postWriteShape },
      annotations: WRITE,
      handler: async (a, ctx) => {
        const route = await typeRoute(ctx, a.type);
        const body = postBody(a);
        if (!Object.keys(body).length) throw new ProviderError("هیچ فیلدی برای ویرایش داده نشده است.");
        const { data } = await core(ctx, `${route}/${a.id}`, { method: "POST", body });
        return { ok: true, post: postSummary(data) };
      },
    }),
    defineTool({
      name: "wordpress_delete_post",
      title: "حذف نوشته",
      description: "Move a post/page/custom post to the trash (default) or delete it permanently with force=true.",
      input: { id: zId, type: zType, force: z.boolean().optional().describe("true = delete permanently, skip trash") },
      annotations: DESTRUCTIVE,
      handler: async (a, ctx) => {
        const route = await typeRoute(ctx, a.type);
        const { data } = await core(ctx, `${route}/${a.id}`, { method: "DELETE", query: { force: a.force ? "true" : undefined } });
        return { ok: true, id: a.id, deleted: !!a.force, trashed: !a.force, status: a.force ? "deleted" : data?.status ?? "trash" };
      },
    }),
    defineTool({
      name: "wordpress_list_revisions",
      title: "بازبینی‌های نوشته",
      description: "List saved revisions of a post or page (id, author, date, title, text excerpt).",
      input: { id: zId, type: zType, page: zPage, per_page: zPerPage },
      annotations: READ,
      handler: async (a, ctx) => {
        const route = await typeRoute(ctx, a.type);
        const r = await core(ctx, `${route}/${a.id}/revisions`, {
          query: { page: a.page, per_page: a.per_page ?? 10, _fields: "id,author,date,modified,parent,title,excerpt" },
        });
        const items = (Array.isArray(r.data) ? r.data : []).map((v: any) =>
          compact({ id: v.id, parent: v.parent, author: v.author, date: v.date, modified: v.modified, title: stripHtml(rendered(v.title)), excerpt: stripHtml(rendered(v.excerpt), 200) }),
        );
        return paged(r, items, { page: a.page, per_page: a.per_page ?? 10 });
      },
    }),
    defineTool({
      name: "wordpress_search",
      title: "جستجو در سایت",
      description: "Search across posts, pages, custom post types and terms. Returns id, title, URL, type and subtype.",
      input: {
        query: z.string().min(1).max(200),
        type: z.enum(["post", "term", "post-format"]).optional().describe("Object kind (default post = all post types)"),
        subtype: z.string().regex(/^[A-Za-z0-9_,-]+$/).optional().describe("Post type or taxonomy slug(s), comma separated"),
        page: zPage,
        per_page: zPerPage,
      },
      annotations: READ,
      handler: async (a, ctx) => {
        const r = await core(ctx, "/wp/v2/search", {
          query: { search: a.query, type: a.type, subtype: a.subtype, page: a.page, per_page: a.per_page ?? 10, _fields: "id,title,url,type,subtype" },
        });
        const items = (Array.isArray(r.data) ? r.data : []).map((s: any) => compact({ id: s.id, title: stripHtml(s.title), url: s.url, type: s.type, subtype: s.subtype }));
        return paged(r, items, { page: a.page, per_page: a.per_page ?? 10 });
      },
    }),

    // ============================================================ طبقه‌بندی‌ها
    defineTool({
      name: "wordpress_list_taxonomies",
      title: "طبقه‌بندی‌ها",
      description: "List taxonomies exposed in the REST API (category, post_tag, custom taxonomies) with their rest_base and post types.",
      input: { type: zSlug.optional().describe("Only taxonomies attached to this post type") },
      annotations: READ,
      handler: async (a, ctx) => {
        const { data } = await core(ctx, "/wp/v2/taxonomies", { query: { type: a.type } });
        const items = Object.values(data ?? {}).map((t: any) => compact({ slug: t.slug, name: t.name, rest_base: t.rest_base, hierarchical: t.hierarchical, types: t.types }));
        return { count: items.length, items };
      },
    }),
    defineTool({
      name: "wordpress_list_terms",
      title: "فهرست دسته‌ها و برچسب‌ها",
      description: "List terms of a taxonomy (categories by default, tags with taxonomy=post_tag, or any custom taxonomy).",
      input: {
        taxonomy: zTaxonomy,
        search: z.string().max(200).optional(),
        parent: z.number().int().min(0).optional(),
        post: zId.optional().describe("Only terms assigned to this post ID"),
        include: z.array(zId).max(100).optional(),
        hide_empty: z.boolean().optional(),
        orderby: z.enum(["name", "count", "id", "slug", "term_group", "description"]).optional(),
        order: zOrder,
        page: zPage,
        per_page: zPerPage,
      },
      annotations: READ,
      handler: async (a, ctx) => {
        const route = await taxRoute(ctx, a.taxonomy);
        const { taxonomy: _t, ...filters } = a;
        const r = await core(ctx, route, { query: { ...filters, per_page: a.per_page ?? 20, _fields: "id,name,slug,taxonomy,parent,count,description,link" } });
        return paged(r, (Array.isArray(r.data) ? r.data : []).map(termOut), { page: a.page, per_page: a.per_page ?? 20 });
      },
    }),
    defineTool({
      name: "wordpress_create_term",
      title: "ساخت دسته یا برچسب",
      description: "Create a term in a taxonomy (category by default, post_tag for tags, or a custom taxonomy).",
      input: {
        taxonomy: zTaxonomy,
        name: z.string().min(1).max(200),
        slug: z.string().max(200).optional(),
        description: z.string().optional(),
        parent: z.number().int().min(0).optional().describe("Parent term ID (hierarchical taxonomies)"),
      },
      annotations: WRITE,
      handler: async (a, ctx) => {
        const route = await taxRoute(ctx, a.taxonomy);
        try {
          const { data } = await core(ctx, route, { method: "POST", body: defined(a, ["taxonomy"]) });
          return { ok: true, term: termOut(data) };
        } catch (err) {
          if (err instanceof WordPressError && err.code === "term_exists") {
            const existing = (err.details as any)?.data?.term_id;
            throw new ProviderError(`دسته/برچسبی با همین نام از قبل وجود دارد${existing ? ` (شناسه ${existing})` : ""}.`, err.details);
          }
          throw err;
        }
      },
    }),
    defineTool({
      name: "wordpress_update_term",
      title: "ویرایش دسته یا برچسب",
      description: "Update a term's name, slug, description or parent.",
      input: {
        id: zId,
        taxonomy: zTaxonomy,
        name: z.string().min(1).max(200).optional(),
        slug: z.string().max(200).optional(),
        description: z.string().optional(),
        parent: z.number().int().min(0).optional(),
      },
      annotations: WRITE,
      handler: async (a, ctx) => {
        const route = await taxRoute(ctx, a.taxonomy);
        const body = defined(a, ["taxonomy", "id"]);
        if (!Object.keys(body).length) throw new ProviderError("هیچ فیلدی برای ویرایش داده نشده است.");
        const { data } = await core(ctx, `${route}/${a.id}`, { method: "POST", body });
        return { ok: true, term: termOut(data) };
      },
    }),
    defineTool({
      name: "wordpress_delete_term",
      title: "حذف دسته یا برچسب",
      description: "Permanently delete a term (terms have no trash). Posts keep existing but lose this term.",
      input: { id: zId, taxonomy: zTaxonomy },
      annotations: DESTRUCTIVE,
      handler: async (a, ctx) => {
        const route = await taxRoute(ctx, a.taxonomy);
        await core(ctx, `${route}/${a.id}`, { method: "DELETE", query: { force: "true" } });
        return { ok: true, id: a.id, deleted: true };
      },
    }),

    // ============================================================ رسانه
    defineTool({
      name: "wordpress_list_media",
      title: "کتابخانه‌ی رسانه",
      description: "List media library items (images, video, audio, documents) with URL, alt text, mime type and dimensions.",
      input: {
        search: z.string().max(200).optional(),
        media_type: z.enum(["image", "video", "audio", "application", "text"]).optional(),
        mime_type: z.string().max(100).optional(),
        parent: z.number().int().min(0).optional().describe("Attached to this post ID"),
        orderby: z.enum(["date", "modified", "title", "id"]).optional(),
        order: zOrder,
        page: zPage,
        per_page: zPerPage,
      },
      annotations: READ,
      handler: async (a, ctx) => {
        const r = await core(ctx, "/wp/v2/media", {
          query: { ...a, per_page: a.per_page ?? 10, _fields: "id,date,title,alt_text,caption,media_type,mime_type,source_url,post,media_details" },
        });
        return paged(r, (Array.isArray(r.data) ? r.data : []).map(mediaOut), { page: a.page, per_page: a.per_page ?? 10 });
      },
    }),
    defineTool({
      name: "wordpress_upload_media",
      title: "آپلود رسانه",
      description: "Upload a file to the media library from a public URL, a data: URL, or raw base64 (with mime_type). Optionally set title, alt text, caption and attach it to a post. Use the returned id as featured_media.",
      input: {
        source: mediaField("file", "File to upload").optional(),
        base64: z.string().min(1).optional().describe("Raw base64 file content (alternative to source); requires mime_type"),
        mime_type: z.string().regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i).optional().describe("Mime type for base64 input, e.g. image/png"),
        filename: z.string().max(120).optional(),
        title: z.string().max(300).optional(),
        alt_text: z.string().max(500).optional(),
        caption: z.string().max(1000).optional(),
        post: zId.optional().describe("Attach to this post ID"),
      },
      annotations: WRITE,
      handler: async (a, ctx) => {
        let source = a.source;
        if (!source && a.base64) {
          if (!a.mime_type) throw new ProviderError("برای آپلود base64 باید mime_type هم داده شود (مثلاً image/png).");
          source = `data:${a.mime_type};base64,${a.base64.replace(/\s+/g, "")}`;
        }
        if (!source) throw new ProviderError("فایلی برای آپلود داده نشده است؛ source (لینک یا data URL) یا base64 بدهید.");
        if (!/^(https?:\/\/|data:)/i.test(source)) {
          throw new ProviderError("منبع فایل باید لینک http(s) یا data URL باشد؛ خواندن مسیر محلی سرور مجاز نیست.");
        }
        const media = await loadMedia(source, { filename: a.filename });
        // نام فایل در هدر باید ASCII باشد
        const ext = (media.filename.match(/\.([A-Za-z0-9]{1,8})$/) ?? [])[1];
        const stem = media.filename
          .replace(/\.[A-Za-z0-9]{1,8}$/, "")
          .replace(/[^A-Za-z0-9._-]+/g, "-")
          .replace(/^[-.]+|[-.]+$/g, "");
        const filename = `${stem || "file"}${ext ? `.${ext}` : ""}`;
        const fields = defined({ title: a.title, alt_text: a.alt_text, caption: a.caption, post: a.post });
        let data: any;
        if (basicHeader(ctx)) {
          const bytes = new Uint8Array(await media.blob.arrayBuffer());
          data = (await core(ctx, "/wp/v2/media", {
            method: "POST",
            query: fields,
            raw: { body: bytes, headers: { "content-type": media.mime, "content-disposition": `attachment; filename="${filename}"` } },
            timeoutMs: UPLOAD_TIMEOUT_MS,
          })).data;
        } else {
          const form = new FormData();
          form.append("file", media.blob, filename);
          for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
          data = (await connector(ctx, "/media", { method: "POST", raw: { body: form }, timeoutMs: UPLOAD_TIMEOUT_MS })).data;
        }
        return { ok: true, media: mediaOut(data) };
      },
    }),
    defineTool({
      name: "wordpress_update_media",
      title: "ویرایش رسانه",
      description: "Update a media item's title, alt text, caption, description or attached post.",
      input: {
        id: zId,
        title: z.string().max(300).optional(),
        alt_text: z.string().max(500).optional(),
        caption: z.string().max(1000).optional(),
        description: z.string().optional(),
        post: z.number().int().min(0).optional(),
      },
      annotations: WRITE,
      handler: async (a, ctx) => {
        const body = defined(a, ["id"]);
        if (!Object.keys(body).length) throw new ProviderError("هیچ فیلدی برای ویرایش داده نشده است.");
        const { data } = await core(ctx, `/wp/v2/media/${a.id}`, { method: "POST", body });
        return { ok: true, media: mediaOut(data) };
      },
    }),
    defineTool({
      name: "wordpress_delete_media",
      title: "حذف رسانه",
      description: "Permanently delete a media library item and its files (media has no trash by default).",
      input: { id: zId },
      annotations: DESTRUCTIVE,
      handler: async (a, ctx) => {
        await core(ctx, `/wp/v2/media/${a.id}`, { method: "DELETE", query: { force: "true" } });
        return { ok: true, id: a.id, deleted: true };
      },
    }),

    // ============================================================ دیدگاه‌ها
    defineTool({
      name: "wordpress_list_comments",
      title: "فهرست دیدگاه‌ها",
      description: "List comments with filters (post, status, search). Status: approve (default), hold (pending), spam, trash or all.",
      input: {
        post: zId.optional(),
        status: z.enum(["approve", "hold", "spam", "trash", "all"]).optional(),
        search: z.string().max(200).optional(),
        author_email: z.string().max(200).optional(),
        parent: z.number().int().min(0).optional(),
        order: zOrder,
        page: zPage,
        per_page: zPerPage,
      },
      annotations: READ,
      handler: async (a, ctx) => {
        const r = await core(ctx, "/wp/v2/comments", {
          query: { ...a, context: "edit", per_page: a.per_page ?? 10, _fields: "id,post,parent,author,author_name,author_email,date,status,content,link" },
        });
        return paged(r, (Array.isArray(r.data) ? r.data : []).map((c: any) => commentOut(c)), { page: a.page, per_page: a.per_page ?? 10 });
      },
    }),
    defineTool({
      name: "wordpress_create_comment",
      title: "ثبت دیدگاه یا پاسخ",
      description: "Post a comment on a post as the connected user, or reply to an existing comment by passing parent.",
      input: {
        post: zId,
        content: z.string().min(1).max(20000),
        parent: zId.optional().describe("Comment ID to reply to"),
        status: z.enum(["approved", "hold"]).optional(),
      },
      annotations: WRITE,
      handler: async (a, ctx) => {
        const { data } = await core(ctx, "/wp/v2/comments", { method: "POST", body: defined(a) });
        return { ok: true, comment: commentOut(data, true) };
      },
    }),
    defineTool({
      name: "wordpress_moderate_comment",
      title: "مدیریت دیدگاه",
      description: "Moderate a comment: approve, hold (unapprove), spam or trash. Optionally edit its content.",
      input: {
        id: zId,
        action: z.enum(["approve", "hold", "spam", "trash"]),
        content: z.string().min(1).max(20000).optional(),
      },
      annotations: WRITE,
      handler: async (a, ctx) => {
        const status = a.action === "approve" ? "approved" : a.action;
        const { data } = await core(ctx, `/wp/v2/comments/${a.id}`, { method: "POST", body: defined({ status, content: a.content }) });
        return { ok: true, comment: commentOut(data) };
      },
    }),
    defineTool({
      name: "wordpress_delete_comment",
      title: "حذف دیدگاه",
      description: "Move a comment to the trash (default) or delete it permanently with force=true.",
      input: { id: zId, force: z.boolean().optional() },
      annotations: DESTRUCTIVE,
      handler: async (a, ctx) => {
        await core(ctx, `/wp/v2/comments/${a.id}`, { method: "DELETE", query: { force: a.force ? "true" : undefined } });
        return { ok: true, id: a.id, deleted: !!a.force, trashed: !a.force };
      },
    }),

    // ============================================================ کاربران
    defineTool({
      name: "wordpress_get_me",
      title: "کاربر متصل",
      description: "Get the WordPress user this connection acts as (id, username, roles, email).",
      input: {},
      annotations: READ,
      handler: async (_a, ctx) => userOut((await core(ctx, "/wp/v2/users/me", { query: { context: "edit" } })).data),
    }),
    defineTool({
      name: "wordpress_list_users",
      title: "فهرست کاربران",
      description: "List site users with optional search and role filter.",
      input: {
        search: z.string().max(200).optional(),
        roles: z.array(zSlug).optional().describe("Role slugs, e.g. administrator, editor, author, subscriber, customer"),
        orderby: z.enum(["name", "id", "registered_date", "email", "slug"]).optional(),
        order: zOrder,
        page: zPage,
        per_page: zPerPage,
      },
      annotations: READ,
      handler: async (a, ctx) => {
        const r = await core(ctx, "/wp/v2/users", {
          query: { ...a, context: "edit", per_page: a.per_page ?? 10, _fields: "id,username,name,email,roles,registered_date,url,link" },
        });
        return paged(r, (Array.isArray(r.data) ? r.data : []).map(userOut), { page: a.page, per_page: a.per_page ?? 10 });
      },
    }),
    defineTool({
      name: "wordpress_get_user",
      title: "دریافت کاربر",
      description: "Get one user by ID (username, name, email, roles, registration date).",
      input: { id: zId },
      annotations: READ,
      handler: async (a, ctx) => userOut((await core(ctx, `/wp/v2/users/${a.id}`, { query: { context: "edit" } })).data),
    }),
    defineTool({
      name: "wordpress_create_user",
      title: "ساخت کاربر",
      description: "Create a user. If password is omitted a strong random one is set (not returned) and the user should use the lost-password flow. Default role is the site's default role.",
      input: {
        username: z.string().min(1).max(60),
        email: z.string().email(),
        password: z.string().min(8).max(200).optional(),
        name: z.string().max(200).optional().describe("Display name"),
        first_name: z.string().max(100).optional(),
        last_name: z.string().max(100).optional(),
        roles: z.array(zSlug).optional(),
        url: z.string().max(300).optional(),
        description: z.string().max(2000).optional(),
      },
      annotations: WRITE,
      handler: async (a, ctx) => {
        const generated = !a.password;
        const password = a.password ?? randomBytes(24).toString("base64url");
        const { data } = await core(ctx, "/wp/v2/users", { method: "POST", body: { ...defined(a), password } });
        return { ok: true, user: userOut(data), password_generated: generated || undefined };
      },
    }),
    defineTool({
      name: "wordpress_update_user",
      title: "ویرایش کاربر",
      description: "Update a user's profile fields, roles or password.",
      input: {
        id: zId,
        email: z.string().email().optional(),
        name: z.string().max(200).optional(),
        first_name: z.string().max(100).optional(),
        last_name: z.string().max(100).optional(),
        nickname: z.string().max(100).optional(),
        roles: z.array(zSlug).optional(),
        password: z.string().min(8).max(200).optional(),
        url: z.string().max(300).optional(),
        description: z.string().max(2000).optional(),
      },
      annotations: WRITE,
      handler: async (a, ctx) => {
        const body = defined(a, ["id"]);
        if (!Object.keys(body).length) throw new ProviderError("هیچ فیلدی برای ویرایش داده نشده است.");
        const { data } = await core(ctx, `/wp/v2/users/${a.id}`, { method: "POST", body });
        return { ok: true, user: userOut(data) };
      },
    }),
    defineTool({
      name: "wordpress_delete_user",
      title: "حذف کاربر",
      description: "Permanently delete a user. Their content must be reassigned to another user ID via `reassign`.",
      input: { id: zId, reassign: zId.describe("User ID that receives the deleted user's content") },
      annotations: DESTRUCTIVE,
      handler: async (a, ctx) => {
        if (a.id === a.reassign) throw new ProviderError("محتوای کاربر را نمی‌توان به خود همان کاربر منتقل کرد.");
        await core(ctx, `/wp/v2/users/${a.id}`, { method: "DELETE", query: { force: "true", reassign: a.reassign } });
        return { ok: true, id: a.id, deleted: true, reassigned_to: a.reassign };
      },
    }),

    // ============================================================ افزونه‌ها و پوسته‌ها
    defineTool({
      name: "wordpress_list_plugins",
      title: "فهرست افزونه‌ها",
      description: "List installed plugins with status (active/inactive) and version.",
      input: { status: z.enum(["active", "inactive"]).optional(), search: z.string().max(100).optional() },
      annotations: READ,
      handler: async (a, ctx) => {
        const { data } = await core(ctx, "/wp/v2/plugins", { query: { status: a.status, search: a.search } });
        const items = (Array.isArray(data) ? data : []).map(pluginOut);
        return { count: items.length, active: items.filter((p) => p.status === "active" || p.status === "network-active").length, items };
      },
    }),
    defineTool({
      name: "wordpress_activate_plugin",
      title: "فعال‌سازی افزونه",
      description: "Activate an installed plugin.",
      input: { plugin: zPlugin },
      annotations: WRITE,
      handler: async (a, ctx) => {
        const { data } = await core(ctx, `/wp/v2/plugins/${a.plugin}`, { method: "POST", body: { status: "active" } });
        return { ok: true, plugin: pluginOut(data) };
      },
    }),
    defineTool({
      name: "wordpress_deactivate_plugin",
      title: "غیرفعال‌سازی افزونه",
      description: "Deactivate an active plugin. Deactivating the connector plugin itself cuts off connector-based tools.",
      input: { plugin: zPlugin },
      annotations: WRITE,
      handler: async (a, ctx) => {
        const { data } = await core(ctx, `/wp/v2/plugins/${a.plugin}`, { method: "POST", body: { status: "inactive" } });
        return { ok: true, plugin: pluginOut(data) };
      },
    }),
    defineTool({
      name: "wordpress_install_plugin",
      title: "نصب افزونه",
      description: "Install a plugin from the WordPress.org directory by its slug (e.g. \"wordpress-seo\"), optionally activating it.",
      input: { slug: z.string().regex(/^[a-z0-9-]+$/).max(100), activate: z.boolean().optional() },
      annotations: WRITE,
      handler: async (a, ctx) => {
        const { data } = await core(ctx, "/wp/v2/plugins", { method: "POST", body: { slug: a.slug, status: a.activate ? "active" : "inactive" }, timeoutMs: UPLOAD_TIMEOUT_MS });
        return { ok: true, plugin: pluginOut(data) };
      },
    }),
    defineTool({
      name: "wordpress_delete_plugin",
      title: "حذف افزونه",
      description: "Delete an installed plugin's files. The plugin must be inactive first.",
      input: { plugin: zPlugin },
      annotations: DESTRUCTIVE,
      handler: async (a, ctx) => {
        await core(ctx, `/wp/v2/plugins/${a.plugin}`, { method: "DELETE" });
        return { ok: true, plugin: a.plugin, deleted: true };
      },
    }),
    defineTool({
      name: "wordpress_list_themes",
      title: "فهرست پوسته‌ها",
      description: "List installed themes and which one is active.",
      input: { status: z.enum(["active", "inactive"]).optional() },
      annotations: READ,
      handler: async (a, ctx) => {
        const { data } = await core(ctx, "/wp/v2/themes", { query: { status: a.status } });
        const items = (Array.isArray(data) ? data : []).map(themeOut);
        return { count: items.length, items };
      },
    }),
    defineTool({
      name: "wordpress_activate_theme",
      title: "فعال‌سازی پوسته",
      description: "Switch the active theme to an installed theme by its stylesheet (directory name). Requires the connector plugin.",
      input: { stylesheet: z.string().regex(/^[A-Za-z0-9._-]+$/).max(100) },
      annotations: WRITE,
      handler: async (a, ctx) => (await connector(ctx, "/themes/activate", { method: "POST", body: { stylesheet: a.stylesheet } })).data,
    }),

    // ============================================================ فهرست‌ها (منو)
    defineTool({
      name: "wordpress_list_menus",
      title: "فهرست‌های سایت",
      description: "List navigation menus and the theme locations they are assigned to.",
      input: {},
      annotations: READ,
      handler: async (_a, ctx) => {
        try {
          const { data } = await core(ctx, "/wp/v2/menus", { query: { per_page: 100, _fields: "id,name,slug,description,locations,count" } });
          const items = (Array.isArray(data) ? data : []).map((m: any) => compact({ id: m.id, name: decodeEntities(String(m.name ?? "")), slug: m.slug, description: m.description, locations: m.locations, count: m.count }));
          return { count: items.length, items };
        } catch (err) {
          // وردپرس قدیمی‌تر مسیر منو ندارد؛ از افزونه بخوان
          if (err instanceof WordPressError && err.code === "rest_no_route" && connectorKey(ctx)) return (await connector(ctx, "/menus")).data;
          throw err;
        }
      },
    }),
    defineTool({
      name: "wordpress_get_menu_items",
      title: "آیتم‌های فهرست",
      description: "List the items of a navigation menu in order (title, URL, type, parent).",
      input: { menu: zId.describe("Menu ID from wordpress_list_menus") },
      annotations: READ,
      handler: async (a, ctx) => {
        try {
          const { data } = await core(ctx, "/wp/v2/menu-items", { query: { menus: a.menu, per_page: 100, orderby: "menu_order", order: "asc" } });
          const items = (Array.isArray(data) ? data : []).map(menuItemOut);
          return { menu: a.menu, count: items.length, items };
        } catch (err) {
          if (err instanceof WordPressError && err.code === "rest_no_route" && connectorKey(ctx)) return (await connector(ctx, `/menus/${a.menu}/items`)).data;
          throw err;
        }
      },
    }),
    defineTool({
      name: "wordpress_create_menu_item",
      title: "افزودن آیتم به فهرست",
      description: "Add an item to a navigation menu: a custom link (type=custom + url), a post/page (type=post_type + object + object_id) or a term (type=taxonomy + object + object_id).",
      input: {
        menu: zId,
        title: z.string().max(300).optional(),
        type: z.enum(["custom", "post_type", "taxonomy", "post_type_archive"]).optional(),
        url: z.string().max(2000).optional(),
        object: zSlug.optional().describe("Post type or taxonomy slug, e.g. page, category"),
        object_id: zId.optional(),
        parent: z.number().int().min(0).optional().describe("Parent menu item ID"),
        menu_order: z.number().int().min(1).optional(),
        target: z.enum(["", "_blank"]).optional(),
      },
      annotations: WRITE,
      handler: async (a, ctx) => {
        const type = a.type ?? (a.object_id ? "post_type" : "custom");
        if (type === "custom" && !a.url) throw new ProviderError("برای پیوند دلخواه باید url داده شود.");
        const { menu, ...rest } = a;
        const { data } = await core(ctx, "/wp/v2/menu-items", { method: "POST", body: { ...defined(rest), type, menus: menu, status: "publish" } });
        return { ok: true, item: menuItemOut(data) };
      },
    }),
    defineTool({
      name: "wordpress_update_menu_item",
      title: "ویرایش آیتم فهرست",
      description: "Update a navigation menu item (title, URL, parent, order, target).",
      input: {
        id: zId,
        title: z.string().max(300).optional(),
        url: z.string().max(2000).optional(),
        parent: z.number().int().min(0).optional(),
        menu_order: z.number().int().min(1).optional(),
        target: z.enum(["", "_blank"]).optional(),
      },
      annotations: WRITE,
      handler: async (a, ctx) => {
        const body = defined(a, ["id"]);
        if (!Object.keys(body).length) throw new ProviderError("هیچ فیلدی برای ویرایش داده نشده است.");
        const { data } = await core(ctx, `/wp/v2/menu-items/${a.id}`, { method: "POST", body });
        return { ok: true, item: menuItemOut(data) };
      },
    }),
    defineTool({
      name: "wordpress_delete_menu_item",
      title: "حذف آیتم فهرست",
      description: "Permanently remove an item from a navigation menu.",
      input: { id: zId },
      annotations: DESTRUCTIVE,
      handler: async (a, ctx) => {
        await core(ctx, `/wp/v2/menu-items/${a.id}`, { method: "DELETE", query: { force: "true" } });
        return { ok: true, id: a.id, deleted: true };
      },
    }),

    // ============================================================ ابزارهای پیشرفته (فقط با افزونه)
    defineTool({
      name: "wordpress_get_options",
      title: "خواندن گزینه‌ها",
      description: "Read allow-listed WordPress options (wp_options) by name. Secrets, salts and internal options are never returned. Requires the connector plugin.",
      input: { names: z.array(z.string().regex(/^[A-Za-z0-9_\-:.]+$/).max(190)).min(1).max(50) },
      annotations: READ,
      handler: async (a, ctx) => (await connector(ctx, "/options", { query: { names: a.names } })).data,
    }),
    defineTool({
      name: "wordpress_update_option",
      title: "تغییر گزینه",
      description: "Update one allow-listed WordPress option (scalar values only). Changing siteurl/home needs confirm=true and can lock you out of the site. Requires the connector plugin.",
      input: {
        name: z.string().regex(/^[A-Za-z0-9_\-:.]+$/).max(190),
        value: z.union([z.string(), z.number(), z.boolean()]),
        confirm: z.boolean().optional().describe("Required for sensitive options (siteurl, home)"),
      },
      annotations: DESTRUCTIVE,
      handler: async (a, ctx) => (await connector(ctx, "/options", { method: "POST", body: defined(a) })).data,
    }),
    defineTool({
      name: "wordpress_flush_cache",
      title: "پاک‌سازی کش",
      description: "Flush the object cache, expired transients and popular page-cache plugins (WP Rocket, LiteSpeed, W3 Total Cache, WP Super Cache, WP Fastest Cache, Autoptimize, ...) and optionally rewrite rules. Requires the connector plugin.",
      input: { rewrite_rules: z.boolean().optional().describe("Also regenerate rewrite rules (permalinks)") },
      annotations: WRITE,
      handler: async (a, ctx) => (await connector(ctx, "/cache/flush", { method: "POST", body: { rewrite_rules: !!a.rewrite_rules } })).data,
    }),
    defineTool({
      name: "wordpress_search_replace_content",
      title: "جستجو و جایگزینی در محتوا",
      description: "Search and replace text in post content/title/excerpt (and optionally custom fields, serialized data handled safely). Dry-run by default: returns what would change. Pass dry_run=false to apply (revisions are kept). Requires the connector plugin.",
      input: {
        search: z.string().min(2).max(500),
        replace: z.string().max(2000),
        dry_run: z.boolean().optional().describe("Default true — preview only"),
        post_types: z.array(zSlug).max(20).optional().describe("Default: post, page"),
        fields: z.array(z.enum(["content", "title", "excerpt"])).optional().describe("Default: content"),
        include_meta: z.boolean().optional().describe("Also replace in public custom fields"),
        case_sensitive: z.boolean().optional().describe("Default true"),
        limit: z.number().int().min(1).max(500).optional().describe("Max posts per call (default 100)"),
        offset: z.number().int().min(0).optional(),
      },
      annotations: DESTRUCTIVE,
      handler: async (a, ctx) =>
        (await connector(ctx, "/search-replace", { method: "POST", body: { ...defined(a), dry_run: a.dry_run !== false }, timeoutMs: UPLOAD_TIMEOUT_MS })).data,
    }),
    defineTool({
      name: "wordpress_bulk_update_posts",
      title: "ویرایش گروهی نوشته‌ها",
      description: "Apply the same change to many posts at once: status (publish/draft/pending/private/trash), author, comment status, add/remove categories and tags. Requires the connector plugin.",
      input: {
        ids: z.array(zId).min(1).max(100),
        status: z.enum(["publish", "draft", "pending", "private", "trash"]).optional(),
        author: zId.optional(),
        comment_status: z.enum(["open", "closed"]).optional(),
        add_categories: z.array(zId).optional(),
        remove_categories: z.array(zId).optional(),
        add_tags: z.array(zId).optional(),
        remove_tags: z.array(zId).optional(),
      },
      annotations: DESTRUCTIVE,
      handler: async (a, ctx) => {
        if (Object.keys(defined(a, ["ids"])).length === 0) throw new ProviderError("هیچ تغییری برای اعمال داده نشده است.");
        return (await connector(ctx, "/posts/bulk", { method: "POST", body: defined(a), timeoutMs: UPLOAD_TIMEOUT_MS })).data;
      },
    }),
    defineTool({
      name: "wordpress_list_cron",
      title: "کارهای زمان‌بندی‌شده",
      description: "List scheduled WP-Cron events (hook, next run, recurrence). Requires the connector plugin.",
      input: {},
      annotations: READ,
      handler: async (_a, ctx) => (await connector(ctx, "/cron")).data,
    }),
    defineTool({
      name: "wordpress_run_cron",
      title: "اجرای کار زمان‌بندی‌شده",
      description: "Run a currently scheduled WP-Cron hook right now (only hooks listed by wordpress_list_cron). Requires the connector plugin.",
      input: { hook: z.string().regex(/^[A-Za-z0-9_\-./:]+$/).max(190) },
      annotations: WRITE,
      handler: async (a, ctx) => (await connector(ctx, "/cron/run", { method: "POST", body: { hook: a.hook }, timeoutMs: UPLOAD_TIMEOUT_MS })).data,
    }),
    defineTool({
      name: "wordpress_get_seo_meta",
      title: "سئوی نوشته",
      description: "Read SEO meta of a post (title, description, focus keyword, canonical, noindex, Open Graph) from Yoast SEO or Rank Math. Requires the connector plugin and one of those SEO plugins.",
      input: { id: zId },
      annotations: READ,
      handler: async (a, ctx) => (await connector(ctx, `/seo/${a.id}`)).data,
    }),
    defineTool({
      name: "wordpress_update_seo_meta",
      title: "ویرایش سئوی نوشته",
      description: "Update SEO meta of a post for Yoast SEO or Rank Math (whichever is active). Empty string clears a field. Requires the connector plugin.",
      input: {
        id: zId,
        title: z.string().max(300).optional(),
        description: z.string().max(500).optional(),
        focus_keyword: z.string().max(200).optional(),
        canonical: z.string().max(2000).optional(),
        noindex: z.boolean().optional(),
        og_title: z.string().max(300).optional(),
        og_description: z.string().max(500).optional(),
      },
      annotations: WRITE,
      handler: async (a, ctx) => {
        const body = defined(a, ["id"]);
        if (!Object.keys(body).length) throw new ProviderError("هیچ فیلدی برای ویرایش داده نشده است.");
        return (await connector(ctx, `/seo/${a.id}`, { method: "POST", body })).data;
      },
    }),
    defineTool({
      name: "wordpress_maintenance_mode",
      title: "حالت تعمیرات",
      description: "Turn maintenance mode on or off (visitors get a 503 page; administrators still see the site). Omit `enabled` to only read the current state. Requires the connector plugin.",
      input: { enabled: z.boolean().optional(), message: z.string().max(500).optional().describe("Message shown to visitors") },
      annotations: WRITE,
      handler: async (a, ctx) => {
        if (a.enabled === undefined) return (await connector(ctx, "/maintenance")).data;
        return (await connector(ctx, "/maintenance", { method: "POST", body: defined(a) })).data;
      },
    }),
    defineTool({
      name: "wordpress_get_stats",
      title: "آمار سایت",
      description: "Content statistics: post counts per post type and status, comments by status, users by role, terms and media counts. Requires the connector plugin.",
      input: {},
      annotations: READ,
      handler: async (_a, ctx) => (await connector(ctx, "/stats")).data,
    }),
    defineTool({
      name: "wordpress_activity_log",
      title: "گزارش فعالیت افزونه",
      description: "Read the connector plugin's audit log: every API call made with the connector key (time, route, method, status, IP).",
      input: {
        status: z.enum(["all", "ok", "error"]).optional(),
        page: zPage,
        per_page: z.number().int().min(1).max(100).optional(),
      },
      annotations: READ,
      handler: async (a, ctx) => (await connector(ctx, "/activity-log", { query: { status: a.status, page: a.page, per_page: a.per_page ?? 20 } })).data,
    }),

    // ============================================================ ووکامرس (فقط با افزونه و ووکامرس فعال)
    defineTool({
      name: "wordpress_wc_list_products",
      title: "محصولات ووکامرس",
      description: "List WooCommerce products with filters (search, status, type, category slug, SKU, stock status).",
      input: {
        search: z.string().max(200).optional(),
        status: z.enum(["publish", "draft", "pending", "private", "any"]).optional(),
        type: z.enum(["simple", "variable", "grouped", "external"]).optional(),
        category: z.string().max(200).optional().describe("Product category slug"),
        sku: z.string().max(100).optional(),
        stock_status: z.enum(["instock", "outofstock", "onbackorder"]).optional(),
        orderby: z.enum(["date", "modified", "title", "id"]).optional(),
        order: zOrder,
        page: zPage,
        per_page: zPerPage,
      },
      annotations: READ,
      handler: async (a, ctx) => (await connector(ctx, "/wc/products", { query: { ...a, per_page: a.per_page ?? 10 } })).data,
    }),
    defineTool({
      name: "wordpress_wc_get_product",
      title: "دریافت محصول",
      description: "Get one WooCommerce product with prices, stock, descriptions, categories, attributes and variation IDs.",
      input: { id: zId },
      annotations: READ,
      handler: async (a, ctx) => (await connector(ctx, `/wc/products/${a.id}`)).data,
    }),
    defineTool({
      name: "wordpress_wc_create_product",
      title: "ساخت محصول",
      description: "Create a WooCommerce product (simple by default). Defaults to status=draft.",
      input: {
        ...productWriteShape,
        name: z.string().min(1).max(300),
        type: z.enum(["simple", "external", "grouped", "variable"]).optional(),
      },
      annotations: WRITE,
      handler: async (a, ctx) => (await connector(ctx, "/wc/products", { method: "POST", body: defined(a) })).data,
    }),
    defineTool({
      name: "wordpress_wc_update_product",
      title: "ویرایش محصول",
      description: "Update a WooCommerce product (price, stock, status, descriptions, categories, images). Only provided fields change.",
      input: { id: zId, ...productWriteShape },
      annotations: WRITE,
      handler: async (a, ctx) => {
        const body = defined(a, ["id"]);
        if (!Object.keys(body).length) throw new ProviderError("هیچ فیلدی برای ویرایش داده نشده است.");
        return (await connector(ctx, `/wc/products/${a.id}`, { method: "POST", body })).data;
      },
    }),
    defineTool({
      name: "wordpress_wc_delete_product",
      title: "حذف محصول",
      description: "Move a WooCommerce product to the trash (default) or delete it permanently with force=true.",
      input: { id: zId, force: z.boolean().optional() },
      annotations: DESTRUCTIVE,
      handler: async (a, ctx) => (await connector(ctx, `/wc/products/${a.id}`, { method: "DELETE", query: { force: a.force ? "true" : undefined } })).data,
    }),
    defineTool({
      name: "wordpress_wc_list_orders",
      title: "سفارش‌های ووکامرس",
      description: "List WooCommerce orders, newest first, with filters (status, customer ID or email, date range).",
      input: {
        status: z.string().regex(/^[a-z0-9_,-]+$/).optional().describe("Order status without wc- prefix, comma separated: pending, processing, on-hold, completed, cancelled, refunded, failed"),
        customer: z.string().max(200).optional().describe("Customer user ID or billing email"),
        after: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Created on/after YYYY-MM-DD"),
        before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Created on/before YYYY-MM-DD"),
        page: zPage,
        per_page: zPerPage,
      },
      annotations: READ,
      handler: async (a, ctx) => (await connector(ctx, "/wc/orders", { query: { ...a, per_page: a.per_page ?? 10 } })).data,
    }),
    defineTool({
      name: "wordpress_wc_get_order",
      title: "دریافت سفارش",
      description: "Get one WooCommerce order with line items, totals, addresses, payment method and recent notes.",
      input: { id: zId },
      annotations: READ,
      handler: async (a, ctx) => (await connector(ctx, `/wc/orders/${a.id}`)).data,
    }),
    defineTool({
      name: "wordpress_wc_update_order",
      title: "ویرایش سفارش",
      description: "Change a WooCommerce order's status and/or add an order note (private, or sent to the customer with customer_note=true).",
      input: {
        id: zId,
        status: z.string().regex(/^[a-z0-9_-]+$/).max(40).optional().describe("New status without wc- prefix, e.g. processing, completed, cancelled"),
        note: z.string().min(1).max(2000).optional(),
        customer_note: z.boolean().optional().describe("true = the note is emailed to the customer"),
      },
      annotations: WRITE,
      handler: async (a, ctx) => {
        if (!a.status && !a.note) throw new ProviderError("وضعیت جدید یا یادداشت سفارش را بدهید.");
        return (await connector(ctx, `/wc/orders/${a.id}`, { method: "POST", body: defined(a, ["id"]) })).data;
      },
    }),
    defineTool({
      name: "wordpress_wc_list_customers",
      title: "مشتریان ووکامرس",
      description: "List WooCommerce customers with order count and total spent.",
      input: { search: z.string().max(200).optional(), page: zPage, per_page: zPerPage },
      annotations: READ,
      handler: async (a, ctx) => (await connector(ctx, "/wc/customers", { query: { ...a, per_page: a.per_page ?? 10 } })).data,
    }),
    defineTool({
      name: "wordpress_wc_list_coupons",
      title: "کدهای تخفیف",
      description: "List WooCommerce coupons with type, amount, usage and expiry.",
      input: { search: z.string().max(200).optional(), page: zPage, per_page: zPerPage },
      annotations: READ,
      handler: async (a, ctx) => (await connector(ctx, "/wc/coupons", { query: { ...a, per_page: a.per_page ?? 10 } })).data,
    }),
    defineTool({
      name: "wordpress_wc_create_coupon",
      title: "ساخت کد تخفیف",
      description: "Create a WooCommerce coupon (percent, fixed_cart or fixed_product) with optional expiry, usage limits and minimum spend.",
      input: {
        code: z.string().min(1).max(100),
        discount_type: z.enum(["percent", "fixed_cart", "fixed_product"]).optional(),
        amount: zPrice,
        description: z.string().max(500).optional(),
        date_expires: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Expiry date YYYY-MM-DD"),
        usage_limit: z.number().int().min(1).optional(),
        usage_limit_per_user: z.number().int().min(1).optional(),
        individual_use: z.boolean().optional(),
        free_shipping: z.boolean().optional(),
        minimum_amount: zPrice.optional(),
        maximum_amount: zPrice.optional(),
        product_ids: z.array(zId).optional(),
        email_restrictions: z.array(z.string().max(200)).optional(),
      },
      annotations: WRITE,
      handler: async (a, ctx) => (await connector(ctx, "/wc/coupons", { method: "POST", body: defined(a) })).data,
    }),
    defineTool({
      name: "wordpress_wc_sales_report",
      title: "گزارش فروش",
      description: "WooCommerce sales summary for a date range (default: last 30 days): order count, gross/net sales, refunds, shipping, tax, discounts, average order value and counts per status.",
      input: {
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Start date YYYY-MM-DD"),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("End date YYYY-MM-DD"),
      },
      annotations: READ,
      handler: async (a, ctx) => (await connector(ctx, "/wc/reports/sales", { query: a, timeoutMs: UPLOAD_TIMEOUT_MS })).data,
    }),

    // ============================================================ درخواست عمومی
    defineTool({
      name: "wordpress_rest_request",
      title: "درخواست REST دلخواه",
      description: "Escape hatch: call any WordPress REST route under /wp-json that the dedicated tools do not cover (e.g. /wp/v2/blocks, /wp/v2/templates, a plugin's namespace). `path` is relative to /wp-json; absolute URLs and other hosts are rejected. Non-GET methods modify the site.",
      input: {
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional().describe("Default GET"),
        path: z.string().min(1).max(500).describe("Route under /wp-json, e.g. /wp/v2/posts/12"),
        query: z.record(z.string(), z.any()).optional(),
        body: z.record(z.string(), z.any()).optional().describe("JSON body for POST/PUT/PATCH"),
      },
      // این ابزار می‌تواند بنویسد و حذف کند؛ پس فقط‌خواندنی علامت نمی‌خورد
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const method = a.method ?? "GET";
        const path = normalizeRestPath(a.path);
        const opts: SendOptions = { method, query: a.query, body: method === "GET" ? undefined : a.body };
        const r = path === CONNECTOR_NS || path.startsWith(`${CONNECTOR_NS}/`)
          ? await connector(ctx, path.slice(CONNECTOR_NS.length) || "/", opts)
          : await core(ctx, path, opts);
        return compact({ status: r.status, total: r.total, total_pages: r.totalPages, data: r.data });
      },
    }),
  ],
};
