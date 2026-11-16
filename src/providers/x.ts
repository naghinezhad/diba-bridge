import { Scraper } from "agent-twitter-client";
import { z } from "zod";
import { defineTool, ProviderError, type ProviderAuthDef, type ProviderContext, type ProviderDef } from "../core/types.js";

const pending = new Map<string, { username: string; createdAt: number }>();
let current: { session: string; scraper: Scraper } | undefined;

function normalizeUsername(raw: string): string {
  return String(raw ?? "").trim().replace(/^@+/, "");
}

function friendlyError(err: any, prefix: string): ProviderError {
  if (err instanceof ProviderError) return err;
  const message = String(err?.message ?? err);
  if (/399|suspicious|Could not authenticate|rate.?limit/i.test(message))
    return new ProviderError(`${prefix}: X ورود را رد کرد. ایمیل/رمز/2FA را بررسی کنید یا کمی بعد دوباره تلاش کنید.`, err);
  if (/two.?factor|2fa|verification/i.test(message))
    return new ProviderError(`${prefix}: این حساب 2FA دارد؛ Two-Factor Secret را در تنظیمات وارد کنید.`, err);
  return new ProviderError(`${prefix}: ${message}`, err);
}

async function getClient(ctx: ProviderContext, fresh = false): Promise<Scraper> {
  const raw = ctx.config.session?.trim();
  if (!raw) throw new ProviderError("اول با نام کاربری و رمز X وارد شوید.");
  if (!fresh && current && current.session === raw) return current.scraper;
  let cookies: any;
  try {
    cookies = JSON.parse(raw);
  } catch {
    throw new ProviderError("نشست X معتبر نیست؛ دوباره وارد شوید.");
  }
  const scraper = new Scraper();
  try {
    await scraper.setCookies(cookies);
    if (!(await scraper.isLoggedIn())) throw new ProviderError("نشست X منقضی شده؛ دوباره وارد شوید.");
  } catch (err) {
    throw friendlyError(err, "بازیابی نشست X");
  }
  current = { session: raw, scraper };
  return scraper;
}

async function profileOf(scraper: Scraper, username: string): Promise<any> {
  try {
    return await scraper.getProfile(normalizeUsername(username));
  } catch (err) {
    throw friendlyError(err, "دریافت پروفایل X");
  }
}

function tweetSummary(t: any) {
  return {
    id: t?.id,
    text: t?.text,
    username: t?.username,
    name: t?.name,
    time: t?.timeParsed ? new Date(t.timeParsed).toISOString() : undefined,
    likes: t?.likes,
    retweets: t?.retweets,
    replies: t?.replies,
    views: t?.views,
  };
}

const xAuth: ProviderAuthDef = {
  title: "ورود با نام کاربری X",
  description:
    "با نام کاربری و رمز عبور X وارد شوید؛ بدون API Key و بدون Developer Portal. اگر حساب ایمیل یا 2FA دارد، مقادیرشان را در تنظیمات وارد کنید. نشست به شکل کوکی روی سرور ذخیره می‌شود.",
  phoneField: "username",
  sessionField: "session",
  codeInput: false,
  credentials: "username",
  inputLabel: "نام کاربری X",
  inputPlaceholder: "@username",
  startLabel: "ادامه",
  passwordHint: "رمز عبور X را وارد کنید. در صورت فعال بودن 2FA، Two-Factor Secret را از قبل ذخیره کنید.",
  async start(ctx, rawUsername, save) {
    const username = normalizeUsername(rawUsername);
    if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) throw new ProviderError("نام کاربری X معتبر نیست.");
    const now = Date.now();
    for (const [key, value] of pending) if (now - value.createdAt > 10 * 60_000) pending.delete(key);
    const tx = `x-${now}-${Math.random().toString(36).slice(2, 7)}`;
    pending.set(tx, { username, createdAt: now });
    save({ username });
    return {
      step: "password",
      transactionHash: tx,
      hint: "رمز عبور X را وارد کنید.",
    };
  },
  async verifyCode() {
    throw new ProviderError("ورود X با کد تأیید انجام نمی‌شود؛ رمز عبور را وارد کنید.");
  },
  async verifyPassword(ctx, transactionHash, password, save) {
    const state = pending.get(transactionHash);
    if (!state) throw new ProviderError("درخواست ورود X منقضی شده؛ دوباره نام کاربری را وارد کنید.");
    try {
      const scraper = new Scraper();
      await scraper.login(
        state.username,
        String(password ?? ""),
        ctx.config.email?.trim() || undefined,
        ctx.config.twoFactorSecret?.trim() || undefined,
      );
      if (!(await scraper.isLoggedIn())) throw new ProviderError("X ورود را تأیید نکرد؛ ایمیل/رمز/2FA را بررسی کنید.");
      const cookies = await scraper.getCookies();
      pending.delete(transactionHash);
      current = { session: JSON.stringify(cookies), scraper };
      save({ session: JSON.stringify(cookies), username: state.username });
      return { step: "done", hint: `ورود X انجام شد: @${state.username}`, user: { id: 0, username: state.username } };
    } catch (err) {
      throw friendlyError(err, "ورود به X");
    }
  },
  async logout(_ctx, save) {
    pending.clear();
    current = undefined;
    save({ session: "", username: "" });
    return { step: "done", hint: "از حساب X خارج شدید." };
  },
};

export const x: ProviderDef = {
  id: "x",
  name: "X (Twitter)",
  nameFa: "ایکس (حساب کاربری)",
  category: "messenger",
  region: "international",
  color: "#0f1419",
  glyph: "X",
  description: "ورود با نام کاربری و رمز X — پروفایل، جستجو، تایم‌لاین و انتشار توییت بدون API Key",
  docsUrl: "https://github.com/the-convocation/twitter-scraper",
  fields: [
    { key: "username", label: "نام کاربری X", type: "text", placeholder: "بدون @" },
    { key: "email", label: "ایمیل حساب (اختیاری)", type: "text", help: "اگر X هنگام ورود ایمیل می‌خواهد." },
    { key: "twoFactorSecret", label: "Two-Factor Secret (اختیاری)", type: "secret", help: "کلید TOTP برای ورود خودکار 2FA" },
    { key: "session", label: "نشست X (خودکار)", type: "secret", required: true, help: "پس از ورود موفق ذخیره می‌شود." },
  ],
  auth: xAuth,
  test: async (ctx) => {
    const scraper = await getClient(ctx);
    const username = ctx.config.username?.trim();
    if (!username) return { loggedIn: await scraper.isLoggedIn() };
    return profileOf(scraper, username);
  },
  tools: [
    defineTool({
      name: "x_get_me",
      title: "پروفایل X من",
      description: "Get the logged-in X profile.",
      input: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (_a, ctx) => profileOf(await getClient(ctx), ctx.config.username),
    }),
    defineTool({
      name: "x_get_user",
      title: "پروفایل کاربر X",
      description: "Get an X profile by username.",
      input: { username: z.string().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => profileOf(await getClient(ctx), a.username),
    }),
    defineTool({
      name: "x_search_recent",
      title: "جستجوی توییت‌ها",
      description: "Search recent X posts by query.",
      input: { query: z.string().min(1), limit: z.number().int().min(1).max(50).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const scraper = await getClient(ctx);
        const posts: any[] = [];
        try {
          for await (const t of scraper.searchTweets(a.query, a.limit ?? 10)) {
            posts.push(tweetSummary(t));
            if (posts.length >= (a.limit ?? 10)) break;
          }
        } catch (err) {
          throw friendlyError(err, "جستجوی X");
        }
        return { query: a.query, posts };
      },
    }),
    defineTool({
      name: "x_get_user_posts",
      title: "توییت‌های کاربر",
      description: "Get recent posts of an X user.",
      input: { username: z.string().min(1), limit: z.number().int().min(1).max(50).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const scraper = await getClient(ctx);
        const posts: any[] = [];
        try {
          for await (const t of scraper.getTweets(normalizeUsername(a.username), a.limit ?? 10)) {
            posts.push(tweetSummary(t));
            if (posts.length >= (a.limit ?? 10)) break;
          }
        } catch (err) {
          throw friendlyError(err, "دریافت توییت‌های X");
        }
        return { username: normalizeUsername(a.username), posts };
      },
    }),
    defineTool({
      name: "x_post",
      title: "انتشار توییت",
      description: "Publish a post on X using the logged-in account.",
      input: { text: z.string().min(1).max(280) },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const scraper = await getClient(ctx);
        try {
          const result: any = await scraper.sendTweetV2(a.text);
          return { ok: true, post: tweetSummary(result) };
        } catch (err) {
          throw friendlyError(err, "انتشار توییت");
        }
      },
    }),
  ],
};
