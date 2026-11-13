import {
  IgApiClient,
  IgCheckpointError,
  IgLoginBadPasswordError,
  IgLoginInvalidUserError,
  IgLoginRequiredError,
  IgLoginTwoFactorRequiredError,
} from "instagram-private-api";
import { z } from "zod";
import { loadMedia, mediaField } from "../core/media.js";
import { defineTool, ProviderError, type ProviderAuthDef, type ProviderContext, type ProviderDef } from "../core/types.js";

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

function normalizeUsername(raw: string): string {
  return String(raw ?? "").trim().replace(/^@+/, "");
}

function applyProxy(ig: IgApiClient, ctx: ProviderContext) {
  const proxy =
    ctx.config.proxyUrl?.trim() ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  if (proxy) ig.state.proxyUrl = proxy;
}

function friendlyError(err: any, prefix: string): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof IgLoginInvalidUserError) {
    return new ProviderError(`${prefix}: نام کاربری اینستاگرام پیدا نشد.`, err);
  }
  if (err instanceof IgLoginBadPasswordError) {
    return new ProviderError(`${prefix}: رمز عبور اینستاگرام اشتباه است.`, err);
  }
  if (err instanceof IgLoginRequiredError) {
    return new ProviderError(`${prefix}: نشست اینستاگرام منقضی شده است؛ دوباره وارد شوید.`, err);
  }
  if (err instanceof IgCheckpointError) {
    return new ProviderError(`${prefix}: اینستاگرام تأیید امنیتی (Checkpoint) می‌خواهد؛ دوباره وارد شوید.`, err);
  }
  const message = String(err?.message ?? err);
  if (/challenge_required|checkpoint_required/i.test(message)) {
    return new ProviderError(`${prefix}: اینستاگرام تأیید امنیتی (Checkpoint) می‌خواهد؛ دوباره وارد شوید.`, err);
  }
  if (/rate.?limit|wait a few minutes|feedback_required/i.test(message)) {
    return new ProviderError(`${prefix}: محدودیت موقت اینستاگرام؛ چند دقیقه بعد دوباره تلاش کنید.`, err);
  }
  return new ProviderError(`${prefix}: ${message}`, err);
}

async function serializeSession(ig: IgApiClient): Promise<string> {
  const state = await ig.state.serialize();
  delete state.constants;
  return JSON.stringify(state);
}

async function getClient(ctx: ProviderContext, fresh = false): Promise<IgApiClient> {
  const raw = ctx.config.session?.trim();
  if (!raw) throw new ProviderError("اول با نام کاربری و رمز اینستاگرام وارد شوید.");
  if (!fresh && current && current.session === raw) return current.ig;

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProviderError("نشست اینستاگرام معتبر نیست؛ دوباره وارد شوید.");
  }

  const ig = new IgApiClient();
  applyProxy(ig, ctx);
  try {
    await ig.state.deserialize(parsed);
  } catch (err) {
    throw friendlyError(err, "بازیابی نشست اینستاگرام");
  }
  current = { session: raw, ig };
  return ig;
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

function mediaSummary(m: any) {
  const imageUrl = m?.image_versions2?.candidates?.[0]?.url ?? m?.carousel_media?.[0]?.image_versions2?.candidates?.[0]?.url;
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
  async start(_ctx, rawUsername, save) {
    const username = normalizeUsername(rawUsername);
    if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) {
      throw new ProviderError("نام کاربری اینستاگرام معتبر نیست.");
    }
    const now = Date.now();
    for (const [key, value] of pending) if (now - value.createdAt > 10 * 60_000) pending.delete(key);
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
    const state = pending.get(transactionHash);
    if (!state) throw new ProviderError("درخواست ورود اینستاگرام منقضی شده؛ دوباره نام کاربری را وارد کنید.");

    const ig = new IgApiClient();
    applyProxy(ig, ctx);
    ig.state.generateDevice(state.username);

    try {
      await ig.simulate.preLoginFlow().catch(() => {});
      const user = await ig.account.login(state.username, String(password ?? ""));
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
        const info = err.response?.body?.two_factor_info;
        const twoFactorIdentifier = String(info?.two_factor_identifier ?? "");
        const verificationMethod = info?.totp_two_factor_on ? "0" : "1";
        if (!twoFactorIdentifier) {
          throw friendlyError(err, "ورود دو مرحله‌ای اینستاگرام");
        }
        pending.set(transactionHash, {
          ...state,
          ig,
          twoFactor: {
            username: info?.username || state.username,
            twoFactorIdentifier,
            verificationMethod,
          },
        });
        return {
          step: "code",
          transactionHash,
          hint:
            verificationMethod === "0"
              ? "کد ۶ رقمی اپلیکیشن احراز هویت (2FA) را وارد کنید."
              : "کد تأیید پیامکی اینستاگرام را وارد کنید.",
        };
      }
      if (err instanceof IgCheckpointError) {
        try {
          await ig.challenge.auto(true);
        } catch (challengeErr) {
          throw friendlyError(challengeErr, "چالش امنیتی اینستاگرام");
        }
        pending.set(transactionHash, { ...state, ig, checkpoint: true });
        return {
          step: "code",
          transactionHash,
          hint: "اینستاگرام کد امنیتی (Checkpoint) به ایمیل یا شماره شما فرستاد؛ کد را وارد کنید.",
        };
      }
      throw friendlyError(err, "ورود به اینستاگرام");
    }
  },
  async verifyCode(_ctx, transactionHash, code, save) {
    const state = pending.get(transactionHash);
    if (!state?.ig) throw new ProviderError("درخواست ورود اینستاگرام منقضی شده؛ دوباره تلاش کنید.");
    const cleanCode = String(code ?? "").trim();
    if (!cleanCode) throw new ProviderError("کد تأیید را وارد کنید.");

    try {
      let user: any;
      if (state.twoFactor) {
        user = await state.ig.account.twoFactorLogin({
          username: state.twoFactor.username,
          verificationCode: cleanCode,
          twoFactorIdentifier: state.twoFactor.twoFactorIdentifier,
          verificationMethod: state.twoFactor.verificationMethod,
          trustThisDevice: "1",
        });
      } else if (state.checkpoint) {
        const res = await state.ig.challenge.sendSecurityCode(cleanCode);
        user = res?.logged_in_user;
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
      throw friendlyError(err, "تأیید کد اینستاگرام");
    }
  },
  async logout(_ctx, save) {
    pending.clear();
    current = undefined;
    save({ session: "", username: "" });
    return { step: "done", hint: "از حساب اینستاگرام خارج شدید." };
  },
};

export const instagram: ProviderDef = {
  id: "instagram",
  name: "Instagram",
  nameFa: "اینستاگرام",
  category: "messenger",
  color: "#d62976",
  glyph: "I",
  description: "ورود با نام کاربری و رمز اینستاگرام — پروفایل، مدیا، کامنت و انتشار عکس بدون API Key",
  docsUrl: "https://github.com/dilame/instagram-private-api",
  fields: [
    { key: "username", label: "نام کاربری اینستاگرام", type: "text", placeholder: "بدون @" },
    { key: "session", label: "نشست اینستاگرام (خودکار)", type: "secret", required: true, help: "پس از ورود موفق به شکل خودکار ذخیره می‌شود." },
    { key: "proxyUrl", label: "پراکسی (اختیاری)", type: "url", placeholder: "http://127.0.0.1:8080", help: "در صورت خالی بودن از HTTPS_PROXY / HTTP_PROXY استفاده می‌شود." },
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
