import {
  IgApiClient,
  IgChallengeWrongCodeError,
  IgCheckpointError,
  IgCookieNotFoundError,
  IgLoginBadPasswordError,
  IgLoginInvalidUserError,
  IgLoginRequiredError,
  IgLoginTwoFactorRequiredError,
  IgNetworkError,
  IgPrivateUserError,
  IgRequestsLimitError,
  IgResponseError,
  IgUserHasLoggedOutError,
} from "instagram-private-api";
import * as InstagrapiPkg from "instagrapi-js";
import { SocksProxyAgent } from "socks-proxy-agent";
import { z } from "zod";
import { cancelAllBrowserLogins, startBrowserLogin, pollBrowserLogin } from "../core/browser-login.js";
import { loadMedia, mediaField } from "../core/media.js";
import { dockerizeLocalProxy } from "../core/store.js";
import { defineTool, ProviderError, type AuthBrowserLogin, type ProviderAuthDef, type ProviderContext, type ProviderDef } from "../core/types.js";

const InstagrapiClient = (InstagrapiPkg as any).InstagrapiClient as new (options?: { proxy?: string }) => any;

interface PendingLogin {
  username: string;
  createdAt: number;
  ig?: IgApiClient;
  twoFactor?: {
    username: string;
    twoFactorIdentifier: string;
    verificationMethod: string;
  };
  checkpoint?: boolean;
}

const pending = new Map<string, PendingLogin>();
let current: { session: string; ig: IgApiClient } | undefined;

/** درخواست‌های ورود نیمه‌کاره بعد از این مدت منقضی می‌شوند */
const PENDING_TTL_MS = 10 * 60_000;

/**
 * کتابخانه‌ی instagram-private-api از سال ۲۰۲۴ به‌روزرسانی نشده و نسخه‌ی
 * کلاینتش (222.0.0.13.114) قدیمی است. این مقادیر از کلاینت به‌روزِ
 * instagrapi (نسخه‌ی ۴۴۹) گرفته شده‌اند تا هدرها و User-Agent به‌روز باشند.
 * توجه: اینستاگرام ممکن است ورود با رمز را مستقل از نسخه با needs_upgrade
 * ببندد؛ در آن حالت از ورود با کوکی استفاده کنید.
 */
const CLIENT_VERSION = {
  appVersion: "449.0.0.52.84",
  appVersionCode: "1079242191",
  bloksVersionId: "799db3e387d7a21a19c72918b8698b6cd28a1516ade363792c100ed45a0f9f0b",
  /** پروفایل دستگاه Pixel 8 Pro / Android 14 مثل instagrapi */
  deviceString: "34/14; 480dpi; 1344x2992; Google/google; Pixel 8 Pro; husky; husky",
} as const;

function applyClientVersion(ig: IgApiClient) {
  const constants = ig.state.constants as unknown as Record<string, unknown>;
  constants.APP_VERSION = CLIENT_VERSION.appVersion;
  constants.APP_VERSION_CODE = CLIENT_VERSION.appVersionCode;
  constants.BLOKS_VERSION_ID = CLIENT_VERSION.bloksVersionId;
}

/** دستگاه تازه با پروفایل به‌روز؛ seed همان نام کاربری است تا هویت دستگاه ثابت بماند. */
function generateDevice(ig: IgApiClient, seed: string) {
  ig.state.generateDevice(seed);
  ig.state.deviceString = CLIENT_VERSION.deviceString;
}

function prunePending(now = Date.now()) {
  for (const [key, value] of pending) if (now - value.createdAt > PENDING_TTL_MS) pending.delete(key);
}

function normalizeUsername(raw: string): string {
  return String(raw ?? "").trim().replace(/^@+/, "");
}

/**
 * پروکسی مؤثر برای اینستاگرام: اول فیلد اختصاصی همین سرویس، بعد پراکسی‌های
 * عمومی برنامه. پراکسی SOCKS5 که در تنظیمات داشبورد ذخیره می‌شود در
 * process.env.SOCKS_PROXY قرار می‌گیرد؛ قبلاً اینجا نادیده گرفته می‌شد.
 */
function currentProxy(ctx: ProviderContext): string {
  const fromField = ctx.config.proxyUrl?.trim();
  if (fromField) return dockerizeLocalProxy(fromField);
  const env = process.env;
  return dockerizeLocalProxy((
    env.SOCKS_PROXY ||
    env.socks_proxy ||
    env.HTTPS_PROXY ||
    env.https_proxy ||
    env.HTTP_PROXY ||
    env.http_proxy ||
    ""
  ).trim());
}

function normalizeProxy(raw: string): string {
  const value = /:\/\//.test(raw) ? raw : `http://${raw}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderError("آدرس پراکسی اینستاگرام معتبر نیست؛ مثل http://127.0.0.1:8080 یا socks5://127.0.0.1:1080 وارد کنید.");
  }
  if (!["http:", "https:", "socks4:", "socks4a:", "socks5:", "socks5h:"].includes(url.protocol)) {
    throw new ProviderError(`پروتکل پراکسی اینستاگرام (${url.protocol}) پشتیبانی نمی‌شود؛ http، https یا socks5 استفاده کنید.`);
  }
  return value;
}

/**
 * کتابخانه‌ی instagram-private-api پراکسی HTTP را با گزینه‌ی proxy درخواست
 * انجام می‌دهد، اما socks را نمی‌شناسد. برای socks یک Agent تزریق می‌کنیم و
 * proxyUrl را خالی می‌گذاریم تا request از Agent استفاده کند.
 */
function applyProxy(ig: IgApiClient, ctx: ProviderContext) {
  const raw = currentProxy(ctx);
  if (!raw) return;
  const proxy = normalizeProxy(raw);
  if (/^socks/i.test(proxy)) {
    ig.request.defaults.agent = new SocksProxyAgent(proxy);
    ig.state.proxyUrl = "";
    return;
  }
  ig.state.proxyUrl = proxy;
}

/** کلاینت تازه با پراکسی و مهلت درخواست؛ تا درخواست‌های بی‌پاسخ بی‌نهایت منتظر نمانند. */
function createClient(ctx: ProviderContext): IgApiClient {
  const proxy = currentProxy(ctx);
  const client = new InstagrapiClient({ proxy: proxy || undefined });
  const ig = client.ig as unknown as IgApiClient;
  ig.request.defaults.timeout = 45_000;
  return ig;
}

function networkReason(err: any): string {
  const code = String(err?.code ?? err?.cause?.code ?? "");
  const text = String(err?.message ?? err);
  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "دامنه پیدا نشد (DNS)";
    case "ECONNREFUSED":
      return "پراکسی یا اینستاگرام اتصال را رد کرد";
    case "ECONNRESET":
      return "اتصال وسط کار قطع شد";
    case "ETIMEDOUT":
    case "ESOCKETTIMEDOUT":
      return "زمان اتصال تمام شد";
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return "مسیر شبکه بسته است";
    case "EPROTO":
      return "خطای امنیتی/TLS در اتصال";
  }
  if (/invalid protocol/i.test(text)) return "پروتکل پراکسی پشتیبانی نمی‌شود";
  if (/socket hang up/i.test(text)) return "اتصال توسط سرور بسته شد";
  if (/timeout/i.test(text)) return "زمان اتصال تمام شد";
  return text || "خطای شبکه";
}

function twoFactorHint(method: string): string {
  if (method === "0") return "کد ۶ رقمی اپلیکیشن احراز هویت (Authenticator) را وارد کنید.";
  if (method === "3") return "کد تأیید واتس‌اپ اینستاگرام را وارد کنید.";
  return "کد تأیید پیامکی اینستاگرام را وارد کنید.";
}

function friendlyError(err: any, prefix: string): ProviderError {
  if (err instanceof ProviderError) return err;
  const status = Number(err?.response?.statusCode ?? 0);
  const message = String(err?.message ?? err);
  const bodyMessage = String(err?.response?.body?.message ?? "");
  const text = `${String(err?.code ?? "")} ${message} ${bodyMessage}`;

  if (err instanceof IgLoginInvalidUserError) {
    return new ProviderError(`${prefix}: نام کاربری اینستاگرام پیدا نشد.`, err);
  }
  if (err instanceof IgLoginBadPasswordError) {
    return new ProviderError(
      `${prefix}: رمز عبور اینستاگرام اشتباه است. اگر مطمئنید رمز درست است، چند دقیقه بعد یا با پراکسی/آی‌پی دیگر دوباره تلاش کنید.`,
      err,
    );
  }
  if (err instanceof IgLoginRequiredError || err instanceof IgUserHasLoggedOutError) {
    current = undefined;
    return new ProviderError(`${prefix}: نشست اینستاگرام منقضی شده است؛ دوباره وارد شوید.`, err);
  }
  if (err instanceof IgCookieNotFoundError) {
    current = undefined;
    return new ProviderError(`${prefix}: نشست اینستاگرام معتبر نیست یا منقضی شده؛ دوباره وارد شوید.`, err);
  }
  if (err instanceof IgPrivateUserError) {
    return new ProviderError(`${prefix}: این حساب اینستاگرام خصوصی است.`, err);
  }
  if (err instanceof IgCheckpointError) {
    current = undefined;
    return new ProviderError(`${prefix}: اینستاگرام تأیید امنیتی (Checkpoint) می‌خواهد؛ دوباره وارد شوید.`, err);
  }
  if (err instanceof IgChallengeWrongCodeError) {
    return new ProviderError(`${prefix}: کد تأیید اشتباه یا منقضی است؛ کد جدید را وارد کنید.`, err);
  }
  if (err instanceof IgRequestsLimitError) {
    return new ProviderError(
      `${prefix}: تعداد درخواست‌ها به اینستاگرام زیاد شده است؛ چند دقیقه صبر کنید یا پراکسی/آی‌پی دیگری تنظیم کنید.`,
      err,
    );
  }
  if (
    err instanceof IgNetworkError ||
    /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|socket hang up|invalid protocol|proxy response/i.test(text)
  ) {
    return new ProviderError(
      `${prefix}: اتصال به اینستاگرام برقرار نشد — ${networkReason(err)}. ` +
        "اگر این سرور در ایران است یا آی‌پی آن توسط اینستاگرام محدود شده، در تنظیمات یا فیلد پراکسی اینستاگرام یک پراکسی http یا socks5 فعال کنید.",
      err,
    );
  }
  if (status === 429 || /rate.?limit|wait a few minutes|too many requests|feedback_required/i.test(text)) {
    return new ProviderError(
      `${prefix}: اینستاگرام درخواست‌ها را موقتاً محدود کرده است (429). ۱۵ تا ۶۰ دقیقه صبر کنید ` +
        "یا از پراکسی/آی‌پی دیگر (ترجیحاً آی‌پی ثابت و غیر دیتاسنتر) استفاده کنید.",
      err,
    );
  }
  if (/challenge_required|checkpoint_required|consent_required/i.test(text)) {
    return new ProviderError(`${prefix}: اینستاگرام تأیید امنیتی (Checkpoint) می‌خواهد؛ دوباره وارد شوید.`, err);
  }
  if (/sentry_block|inactive user/i.test(text)) {
    return new ProviderError(
      `${prefix}: اینستاگرام این دستگاه یا آی‌پی را مشکوک می‌داند؛ با پراکسی/آی‌پی دیگر یا شبکه‌ی دیگری دوباره تلاش کنید.`,
      err,
    );
  }
  if (
    /needs_upgrade|app_out_of_date|version of instagram is out of date/i.test(
      `${text} ${String(err?.response?.body?.message_category ?? "")}`,
    )
  ) {
    return new ProviderError(
      `${prefix}: اینستاگرام ورود مستقیم با رمز را برای این کلاینت/آی‌پی مسدود کرده است (needs_upgrade). ` +
        "از بخش «ورود با کوکی مرورگر» در همان کارت استفاده کنید، یا با پراکسی/آی‌پی دیگر دوباره تلاش کنید.",
      err,
    );
  }
  return new ProviderError(`${prefix}: ${message}`, err);
}

async function serializeSession(ig: IgApiClient): Promise<string> {
  const state = await ig.state.serialize();
  delete state.constants;
  return JSON.stringify(state);
}

function sessionIdFromRaw(raw: string): string | undefined {
  if (!raw.startsWith("{")) return raw || undefined;
  // Session‌های قدیمی به‌صورت JSON ذخیره شده‌اند؛ sessionid داخل cookie jar آن‌هاست.
  const match = raw.match(/"key"\s*:\s*"sessionid"\s*,\s*"value"\s*:\s*"([^"]+)"/);
  if (match?.[1]) return match[1];
  const fallback = raw.match(/sessionid=([^;\s"]+)/);
  return fallback?.[1];
}

async function getClient(ctx: ProviderContext, fresh = false): Promise<IgApiClient> {
  const raw = ctx.config.session?.trim();
  if (!raw) throw new ProviderError("اول با نام کاربری و رمز اینستاگرام وارد شوید.");
  if (!fresh && current && current.session === raw) return current.ig;

  const sessionid = sessionIdFromRaw(raw);
  if (!sessionid) throw new ProviderError("sessionid اینستاگرام در نشست ذخیره‌شده پیدا نشد؛ دوباره وارد شوید.");
  const client = new InstagrapiClient({ proxy: currentProxy(ctx) || undefined });
  try {
    const login = await client.loginBySessionId(sessionid);
    if (!login?.success || !login?.authenticated) {
      throw new ProviderError("نشست اینستاگرام منقضی شده؛ دوباره وارد شوید.");
    }
    const ig = client.ig as unknown as IgApiClient;
    current = { session: raw, ig };
    return ig;
  } catch (err) {
    current = undefined;
    if (err instanceof ProviderError) throw err;
    throw friendlyError(err, "بازیابی نشست اینستاگرام");
  }
}

function userSummary(u: any) {
  return {
    id: String(u?.pk ?? ""),
    username: u?.username,
    full_name: u?.full_name,
    biography: u?.biography,
    external_url: u?.external_url,
    profile_pic_url: u?.profile_pic_url,
    is_private: u?.is_private,
    is_verified: u?.is_verified,
    follower_count: u?.follower_count,
    following_count: u?.following_count,
    media_count: u?.media_count,
  };
}

/** ورودی کوکی را از JSON آرایه/آبجکت، هدر Cookie یا رشته‌ی sessionid تنها می‌خواند. */
function parseCookieInput(raw: string): Record<string, string> {
  const text = String(raw ?? "").trim();
  if (!text) throw new ProviderError("کوکی یا شناسه‌ی نشست (sessionid) را وارد کنید.");
  const out: Record<string, string> = {};
  const add = (key: unknown, value: unknown) => {
    const name = String(key ?? "").trim().replace(/^cookie:\s*/i, "").replace(/^"|"$/g, "");
    const val = String(value ?? "").trim().replace(/^"|"$/g, "");
    if (!/^[A-Za-z0-9_]+$/.test(name) || !val) return;
    out[name] = val;
  };

  if (text.startsWith("{") || text.startsWith("[")) {
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ProviderError("ساختار JSON کوکی معتبر نیست.");
    }
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item === "object") add(item.name ?? item.key ?? item.Name, item.value ?? item.Value);
      }
    } else if (parsed && typeof parsed === "object") {
      const list = Array.isArray(parsed.cookies) ? parsed.cookies : null;
      if (list) for (const item of list) add(item?.name, item?.value);
      else for (const [key, value] of Object.entries(parsed)) if (typeof value === "string") add(key, value);
    }
  } else if (!text.includes("=") && /^[A-Za-z0-9%_.:\-]+$/.test(text)) {
    // فقط مقدار sessionid کپی شده است
    add("sessionid", text);
  } else {
    for (const part of text.replace(/^cookie:\s*/i, "").split(/[;\n]+/)) {
      const index = part.indexOf("=");
      if (index > 0) add(part.slice(0, index), part.slice(index + 1));
    }
  }

  if (!out.sessionid) {
    throw new ProviderError("کوکی sessionid پیدا نشد؛ از مرورگر مقدار sessionid را کپی و همراه نامش وارد کنید.");
  }
  return out;
}

/** کوکی را در jar نشست اینستاگرام می‌گذارد تا درخواست‌های بعدی از آن استفاده کنند. */
async function setCookie(ig: IgApiClient, name: string, value: string): Promise<void> {
  const cookie = `${name}=${value}; Domain=.instagram.com; Path=/; Secure`;
  await new Promise<void>((resolve, reject) => {
    (ig.state.cookieJar as any).setCookie(cookie, "https://i.instagram.com/", (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/** اینستاگرام زمان دایرکت را میکروثانیه می‌دهد؛ به ISO تبدیل می‌کند. */
function epochToIso(value: unknown): string | undefined {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  const ms = numeric > 1e14 ? numeric / 1000 : numeric > 1e11 ? numeric : numeric * 1000;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

/** یک گفتگوی دایرکت را به شکل یکسان با بقیه‌ی سرویس‌ها خلاصه می‌کند. */
function threadSummary(thread: any) {
  const others = (thread?.users ?? []).filter((user: any) => !user?.is_self);
  const name =
    thread?.thread_title ||
    others.map((user: any) => user?.full_name || user?.username).filter(Boolean).join("، ") ||
    "چت اینستاگرام";
  const last = thread?.items?.[0];
  return {
    chat_id: String(thread?.thread_id ?? ""),
    title: name,
    type: thread?.is_group ? "group" : "private",
    username: others[0]?.username ? `@${others[0].username}` : undefined,
    last_message: last?.text ?? (last?.item_type ? `[${String(last.item_type).replace(/_/g, " ")}]` : undefined),
    last_date: epochToIso(thread?.last_activity_at),
  };
}

function mediaSummary(m: any) {  const imageUrl = m?.image_versions2?.candidates?.[0]?.url ?? m?.carousel_media?.[0]?.image_versions2?.candidates?.[0]?.url;
  const videoUrl = m?.video_versions?.[0]?.url;
  return {
    id: String(m?.id ?? m?.pk ?? ""),
    code: m?.code,
    media_type: m?.media_type,
    caption: m?.caption?.text ?? "",
    media_url: videoUrl ?? imageUrl,
    permalink: m?.code ? `https://www.instagram.com/p/${m.code}/` : undefined,
    like_count: m?.like_count,
    comment_count: m?.comment_count,
    taken_at: m?.taken_at ? new Date(m.taken_at * 1000).toISOString() : undefined,
  };
}

const instagramAuth: ProviderAuthDef = {
  title: "ورود با نام کاربری اینستاگرام",
  description:
    "با نام کاربری و رمز عبور اینستاگرام وارد شوید؛ بدون API Key و بدون Meta Developer Portal. از تأیید دو مرحله‌ای (2FA) و چالش امنیتی هم پشتیبانی می‌شود.",
  phoneField: "username",
  sessionField: "session",
  codeInput: true,
  credentials: "username",
  inputLabel: "نام کاربری اینستاگرام",
  inputPlaceholder: "username",
  startLabel: "ادامه",
  passwordHint: "رمز عبور حساب اینستاگرام را وارد کنید.",
  sessionImport: {
    title: "ورود با کوکی مرورگر (جایگزین)",
    hint:
      "اگر ورود با رمز خطای «نسخه قدیمی» یا محدودیت 429 گرفت، در مرورگر وارد instagram.com شوید، " +
      "از DevTools → Application → Cookies مقدارهای sessionid و csrftoken و ds_user_id را کپی کنید و اینجا بچسبانید. " +
      "این کوکی‌ها مثل رمز عبور محرمانه‌اند و فقط روی سرور ذخیره می‌شوند.",
    placeholder: "sessionid=…; csrftoken=…; ds_user_id=…",
    async run(ctx, raw, save) {
      const cookies = parseCookieInput(raw);
      const sessionid = cookies.sessionid;
      if (!sessionid) throw new ProviderError("sessionid در کوکی‌های ورودی پیدا نشد.");
      try {
        const client = new InstagrapiClient({ proxy: currentProxy(ctx) || undefined });
        const login = await client.loginBySessionId(sessionid);
        if (!login?.success || !login?.authenticated) {
          throw new ProviderError("کوکی نشست اینستاگرام معتبر نیست یا منقضی شده؛ یک sessionid تازه بردارید.");
        }
        const user = login.user ?? await client.ig.account.currentUser();
        const ig = client.ig as unknown as IgApiClient;
        const finalUsername = user?.username || normalizeUsername(ctx.config.username || "") || "instagram";
        const session = sessionid;
        current = { session, ig };
        save({ session, username: finalUsername });
        return {
          step: "done",
          hint: `ورود اینستاگرام با نشست انجام شد: @${finalUsername}`,
          user: { id: Number(user?.pk) || 0, name: user?.full_name, username: finalUsername },
        };
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        throw friendlyError(err, "ورود با کوکی اینستاگرام");
      }
    },
  },
  async start(_ctx, rawUsername, save) {
    const username = normalizeUsername(rawUsername);
    // قاعده‌ی اینستاگرام: حداکثر ۳۰ کاراکتر، بدون نقطه در ابتدا/انتها و بدون نقطه‌ی تکراری
    if (!/^(?!\.)(?!.*\.\.)(?!.*\.$)[A-Za-z0-9._]{1,30}$/.test(username)) {
      throw new ProviderError("نام کاربری اینستاگرام معتبر نیست.");
    }
    const now = Date.now();
    prunePending(now);
    const tx = `ig-${now}-${Math.random().toString(36).slice(2, 7)}`;
    pending.set(tx, { username, createdAt: now });
    save({ username });
    return {
      step: "password",
      transactionHash: tx,
      hint: "رمز عبور اینستاگرام را وارد کنید.",
    };
  },
  async verifyPassword(ctx, transactionHash, password, save) {
    prunePending();
    const state = pending.get(transactionHash);
    if (!state) throw new ProviderError("درخواست ورود اینستاگرام منقضی شده؛ دوباره نام کاربری را وارد کنید.");
    if (!String(password ?? "")) throw new ProviderError("رمز عبور اینستاگرام را وارد کنید.");

    const ig = createClient(ctx);
    generateDevice(ig, state.username);

    try {
      await ig.simulate.preLoginFlow().catch(() => {});
      // اگر جریان مقدماتی نیمه‌کاره ماند، کلید رمزنگاری رمز را مستقیم بگیر
      if (!ig.state.passwordEncryptionPubKey) await ig.launcher.preLoginSync().catch(() => {});
      const user = await ig.account.login(state.username, String(password));
      const session = await serializeSession(ig);
      pending.delete(transactionHash);
      current = { session, ig };
      const finalUsername = user.username || state.username;
      save({ session, username: finalUsername });
      return {
        step: "done",
        hint: `ورود اینستاگرام انجام شد: @${finalUsername}`,
        user: { id: Number(user.pk) || 0, name: user.full_name, username: finalUsername },
      };
    } catch (err) {
      if (err instanceof IgLoginTwoFactorRequiredError) {
        const info: any = err.response?.body?.two_factor_info ?? {};
        const twoFactorIdentifier = String(info.two_factor_identifier ?? "");
        if (!twoFactorIdentifier) {
          throw new ProviderError(
            "اینستاگرام تأیید دو مرحله‌ای می‌خواهد اما شناسه‌ی تأیید را برنگرداند؛ از مرحله‌ی نام کاربری دوباره شروع کنید.",
            err,
          );
        }
        // ترتیب: TOTP ← واتس‌اپ ← پیامک
        const verificationMethod = info.totp_two_factor_on ? "0" : info.whatsapp_two_factor_on ? "3" : "1";
        pending.set(transactionHash, {
          username: state.username,
          createdAt: state.createdAt,
          ig,
          twoFactor: {
            username: info.username || state.username,
            twoFactorIdentifier,
            verificationMethod,
          },
        });
        return { step: "code", transactionHash, hint: twoFactorHint(verificationMethod) };
      }
      if (err instanceof IgCheckpointError) {
        try {
          await ig.challenge.auto(true);
        } catch (challengeErr) {
          throw friendlyError(challengeErr, "چالش امنیتی اینستاگرام");
        }
        pending.set(transactionHash, {
          username: state.username,
          createdAt: state.createdAt,
          ig,
          checkpoint: true,
        });
        return {
          step: "code",
          transactionHash,
          hint:
            "اینستاگرام کد امنیتی (Checkpoint) به ایمیل یا شماره‌ی شما فرستاد؛ کد را وارد کنید. " +
            "اگر کدی نیامد، با دکمه‌ی «تغییر نام کاربری» دوباره شروع کنید.",
        };
      }
      throw friendlyError(err, "ورود به اینستاگرام");
    }
  },
  async verifyCode(_ctx, transactionHash, code, save) {
    prunePending();
    const state = pending.get(transactionHash);
    if (!state?.ig) throw new ProviderError("درخواست ورود اینستاگرام منقضی شده؛ دوباره تلاش کنید.");
    const cleanCode = String(code ?? "").trim().replace(/\s+/g, "");
    if (!cleanCode) throw new ProviderError("کد تأیید را وارد کنید.");

    try {
      let user: any;
      if (state.twoFactor) {
        const res: any = await state.ig.account.twoFactorLogin({
          username: state.twoFactor.username,
          verificationCode: cleanCode,
          twoFactorIdentifier: state.twoFactor.twoFactorIdentifier,
          verificationMethod: state.twoFactor.verificationMethod,
          trustThisDevice: "1",
        });
        // twoFactorLogin بدنه‌ی کامل را برمی‌گرداند، نه خود کاربر
        user = res?.logged_in_user ?? res;
      } else if (state.checkpoint) {
        const res: any = await state.ig.challenge.sendSecurityCode(cleanCode);
        user = res?.logged_in_user;
        // بعضی پاسخ‌های checkpoint کاربر را برنمی‌گردانند؛ از خود نشست می‌خوانیم
        if (!user) user = await state.ig.account.currentUser().catch(() => undefined);
      } else {
        throw new ProviderError("مرحله‌ی کد برای این درخواست فعال نیست.");
      }

      const session = await serializeSession(state.ig);
      pending.delete(transactionHash);
      current = { session, ig: state.ig };
      const finalUsername = user?.username || state.username;
      save({ session, username: finalUsername });
      return {
        step: "done",
        hint: `ورود اینستاگرام انجام شد: @${finalUsername}`,
        user: { id: Number(user?.pk) || 0, name: user?.full_name, username: finalUsername },
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if (err instanceof IgChallengeWrongCodeError) {
        // درخواست را نگه می‌داریم تا کاربر بتواند کد تازه را وارد کند
        throw new ProviderError("کد تأیید اشتباه یا منقضی است؛ کد جدید را وارد کنید.", err);
      }
      throw friendlyError(err, "تأیید کد اینستاگرام");
    }
  },
  async logout(_ctx, save) {
    pending.clear();
    cancelAllBrowserLogins();
    current = undefined;
    save({ session: "", username: "" });
    return { step: "done", hint: "از حساب اینستاگرام خارج شدید." };
  },
};

const INSTAGRAM_COOKIE_URLS = ["https://www.instagram.com/", "https://instagram.com/", "https://i.instagram.com/"];

const instagramBrowserLogin: AuthBrowserLogin = {
  title: "ورود با پنجره‌ی مرورگر",
  hint: "یک پنجره‌ی واقعی Chrome برای صفحه‌ی ورود اینستاگرام باز می‌شود. اطلاعات ورود را همان‌جا وارد کنید؛ پس از ورود، کوکی نشست خودکار خوانده و ذخیره می‌شود.",
  async start() {
    cancelAllBrowserLogins();
    const started = await startBrowserLogin({
      url: "https://www.instagram.com/accounts/login/",
      cookieUrls: INSTAGRAM_COOKIE_URLS,
      hint: "در پنجره‌ی Chrome وارد اینستاگرام شوید. پس از تکمیل ورود (و تأیید دو مرحله‌ای)، همین صفحه را بررسی می‌کنیم.",
    });
    return { jobId: started.jobId, hint: started.hint };
  },
  async status(ctx, jobId, save) {
    const result = await pollBrowserLogin(jobId, INSTAGRAM_COOKIE_URLS);
    if (result.pending) {
      return {
        step: "browser",
        pending: true,
        hint: "در پنجره‌ی Chrome وارد اینستاگرام شوید؛ پس از ورود، کوکی به‌صورت خودکار ذخیره می‌شود.",
      };
    }
    const importer = instagramAuth.sessionImport;
    if (!importer) throw new ProviderError("ورود با کوکی برای اینستاگرام فعال نیست.");
    try {
      return await importer.run(ctx, result.cookieString, save);
    } catch (err) {
      throw friendlyError(err, "ورود با کوکی مرورگر اینستاگرام");
    }
  },
};

instagramAuth.browserLogin = instagramBrowserLogin;

export const instagram: ProviderDef = {
  id: "instagram",
  name: "Instagram",
  nameFa: "اینستاگرام",
  category: "messenger",
  region: "international",
  color: "#d62976",
  glyph: "I",
  description: "ورود با نام کاربری و رمز اینستاگرام — پروفایل، مدیا، کامنت و انتشار عکس بدون API Key",
  docsUrl: "https://github.com/dilame/instagram-private-api",
  fields: [
    { key: "username", label: "نام کاربری اینستاگرام", type: "text", placeholder: "بدون @" },
    { key: "session", label: "نشست اینستاگرام (خودکار)", type: "secret", required: true, help: "پس از ورود موفق به شکل خودکار ذخیره می‌شود." },
    { key: "proxyUrl", label: "پراکسی (اختیاری)", type: "url", placeholder: "http://127.0.0.1:8080 یا socks5://127.0.0.1:1080", help: "در صورت خالی بودن از HTTPS_PROXY / HTTP_PROXY / SOCKS_PROXY استفاده می‌شود. برای آی‌پی‌های محدودشده، پراکسی فعال لازم است." },
  ],
  auth: instagramAuth,
  test: async (ctx) => {
    const ig = await getClient(ctx);
    try {
      const user = await ig.account.currentUser();
      return userSummary(user);
    } catch (err) {
      throw friendlyError(err, "تست اتصال اینستاگرام");
    }
  },
  tools: [
    defineTool({
      name: "instagram_get_me",
      title: "پروفایل اینستاگرام",
      description: "Get the logged-in Instagram profile.",
      input: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (_a, ctx) => {
        const ig = await getClient(ctx);
        try {
          const userId = ig.state.cookieUserId;
          const user = userId ? await ig.user.info(userId) : await ig.account.currentUser();
          return userSummary(user);
        } catch (err) {
          throw friendlyError(err, "دریافت پروفایل اینستاگرام");
        }
      },
    }),
    defineTool({
      name: "instagram_get_user",
      title: "پروفایل کاربر اینستاگرام",
      description: "Get an Instagram user's profile by username.",
      input: { username: z.string().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const ig = await getClient(ctx);
        try {
          const pk = await ig.user.getIdByUsername(normalizeUsername(a.username));
          const user = await ig.user.info(pk);
          return userSummary(user);
        } catch (err) {
          throw friendlyError(err, "دریافت پروفایل کاربر اینستاگرام");
        }
      },
    }),
    defineTool({
      name: "instagram_get_media",
      title: "مدیای اینستاگرام",
      description: "List recent Instagram media of the logged-in account (or a target username).",
      input: {
        username: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const ig = await getClient(ctx);
        try {
          const userId = a.username ? await ig.user.getIdByUsername(normalizeUsername(a.username)) : ig.state.cookieUserId;
          if (!userId) throw new ProviderError("شناسه‌ی کاربر اینستاگرام پیدا نشد؛ دوباره وارد شوید.");
          const feed = ig.feed.user(userId);
          const items = await feed.items();
          const limit = a.limit ?? 20;
          return { media: items.slice(0, limit).map(mediaSummary) };
        } catch (err) {
          throw friendlyError(err, "دریافت مدیای اینستاگرام");
        }
      },
    }),
    defineTool({
      name: "instagram_get_comments",
      title: "کامنت‌های اینستاگرام",
      description: "List comments for an Instagram media id.",
      input: { media_id: z.string().min(1), limit: z.number().int().min(1).max(50).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const ig = await getClient(ctx);
        try {
          const feed = ig.feed.mediaComments(a.media_id);
          const items = await feed.items();
          const limit = a.limit ?? 20;
          const comments = items.slice(0, limit).map((c: any) => ({
            id: String(c?.pk ?? ""),
            text: c?.text,
            username: c?.user?.username,
            like_count: c?.comment_like_count,
            created_at: c?.created_at ? new Date(c.created_at * 1000).toISOString() : undefined,
          }));
          return { comments };
        } catch (err) {
          throw friendlyError(err, "دریافت کامنت‌های اینستاگرام");
        }
      },
    }),
    defineTool({
      name: "instagram_list_chats",
      title: "چت‌های اینستاگرام",
      description: "List recent Instagram direct-message threads (read-only): name, last message and time.",
      input: { limit: z.number().int().min(1).max(50).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const ig = await getClient(ctx);
        try {
          const threads: any[] = await ig.feed.directInbox().items();
          const limit = a.limit ?? 20;
          return { chats: threads.slice(0, limit).map(threadSummary) };
        } catch (err) {
          throw friendlyError(err, "دریافت چت‌های اینستاگرام");
        }
      },
    }),
    defineTool({
      name: "instagram_get_messages",
      title: "پیام‌های دایرکت اینستاگرام",
      description: "Read recent messages of an Instagram direct thread (thread_id from instagram_list_chats).",
      input: { thread_id: z.string().min(1), limit: z.number().int().min(1).max(50).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const ig = await getClient(ctx);
        try {
          const items: any[] = await ig.feed.directThread({ thread_id: a.thread_id, oldest_cursor: "" }).items();
          const limit = a.limit ?? 20;
          const selfId = String(ig.state.cookieUserId ?? "");
          return {
            messages: items.slice(0, limit).map((item: any) => ({
              id: item?.item_id ? String(item.item_id) : undefined,
              text: item?.text ?? "",
              out: String(item?.user_id ?? "") === selfId,
              kind: item?.item_type ?? "text",
              date: epochToIso(item?.timestamp),
            })),
          };
        } catch (err) {
          throw friendlyError(err, "خواندن پیام‌های اینستاگرام");
        }
      },
    }),
    defineTool({
      name: "instagram_publish_photo",
      title: "انتشار عکس در اینستاگرام",
      description: "Publish a photo to Instagram from an image URL or data URL.",
      input: {
        image_url: mediaField("image", "Photo"),
        caption: z.string().max(2200).optional(),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const ig = await getClient(ctx);
        const media = await loadMedia(a.image_url, { expect: "image" });
        const file = Buffer.from(await media.blob.arrayBuffer());
        try {
          const res: any = await ig.publish.photo({ file, caption: a.caption });
          return {
            ok: true,
            media_id: res?.media?.id ? String(res.media.id) : res?.media?.pk ? String(res.media.pk) : undefined,
            code: res?.media?.code,
          };
        } catch (err) {
          throw friendlyError(err, "انتشار عکس در اینستاگرام");
        }
      },
    }),
  ],
};
