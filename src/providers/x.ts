import { z } from "zod";
import { netFetch } from "../core/net.js";
import { defineTool, ProviderError, type ProviderContext, type ProviderDef } from "../core/types.js";

const DEFAULT_BASE = "https://api.x.com/2";

function baseOf(ctx: ProviderContext): string {
  return (ctx.config.baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
}

async function xCall(
  ctx: ProviderContext,
  path: string,
  opts: { method?: string; body?: unknown; user?: boolean; query?: Record<string, string> } = {},
): Promise<any> {
  const { bearerToken, userAccessToken } = ctx.config;
  const token = opts.user ? userAccessToken : bearerToken;
  if (!token) throw new ProviderError(opts.user ? "برای این عملیات، User Access Token ایکس لازم است." : "Bearer Token ایکس ثبت نشده است.");
  const qs = opts.query ? `?${new URLSearchParams(opts.query).toString()}` : "";
  let res: any;
  try {
    res = await netFetch(`${baseOf(ctx)}${path}${qs}`, {
      method: opts.method ?? "GET",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "dibaMCP/0.4",
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: any) {
    throw new ProviderError(`اتصال به X برقرار نشد: ${err?.message ?? err}`, err);
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.detail || data?.title || data?.errors?.[0]?.message || `HTTP ${res.status}`;
    throw new ProviderError(`X: ${detail}`, data);
  }
  return data;
}

export const x: ProviderDef = {
  id: "x",
  name: "X (Twitter)",
  nameFa: "ایکس (توییتر)",
  category: "messenger",
  color: "#0f1419",
  glyph: "X",
  description: "اتصال به API رسمی X — خواندن تایم‌لاین، جستجو و انتشار توییت با توکن کاربر",
  docsUrl: "https://docs.x.com/x-api",
  fields: [
    { key: "bearerToken", label: "Bearer Token", type: "secret", required: true, help: "از Developer Portal ایکس (App-only)" },
    { key: "userAccessToken", label: "User Access Token", type: "secret", help: "برای انتشار توییت و خواندن پروفایل خودتان" },
    { key: "defaultUsername", label: "یوزرنیم پیش‌فرض", type: "text", placeholder: "بدون @" },
    { key: "baseUrl", label: "آدرس پایه API", type: "url", default: DEFAULT_BASE },
  ],
  test: async (ctx) => {
    if (ctx.config.userAccessToken) {
      const me = await xCall(ctx, "/users/me", { user: true, query: { "user.fields": "id,name,username,profile_image_url" } });
      return me.data;
    }
    const username = ctx.config.defaultUsername?.trim();
    if (!username) throw new ProviderError("برای تست، User Access Token یا یوزرنیم پیش‌فرض لازم است.");
    const user = await xCall(ctx, `/users/by/username/${encodeURIComponent(username)}`, { query: { "user.fields": "id,name,username" } });
    return user.data;
  },
  tools: [
    defineTool({
      name: "x_get_me",
      title: "پروفایل ایکس من",
      description: "Get the authenticated X user profile (requires a user access token).",
      input: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (_a, ctx) => {
        const r = await xCall(ctx, "/users/me", { user: true, query: { "user.fields": "id,name,username,description,public_metrics,profile_image_url,verified" } });
        return r.data;
      },
    }),
    defineTool({
      name: "x_get_user",
      title: "پروفایل کاربر ایکس",
      description: "Get an X user by username.",
      input: { username: z.string().min(1).describe("Username without @") },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const r = await xCall(ctx, `/users/by/username/${encodeURIComponent(a.username.replace(/^@/, ""))}`, {
          query: { "user.fields": "id,name,username,description,public_metrics,profile_image_url,verified" },
        });
        return r.data;
      },
    }),
    defineTool({
      name: "x_search_recent",
      title: "جستجوی توییت‌ها",
      description: "Search recent X posts (last 7 days).",
      input: {
        query: z.string().min(1).describe("Search query, e.g. from:user or دیبا"),
        limit: z.number().int().min(10).max(100).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const r = await xCall(ctx, "/tweets/search/recent", {
          query: {
            query: a.query,
            max_results: String(a.limit ?? 10),
            "tweet.fields": "id,text,created_at,public_metrics,author_id,lang",
          },
        });
        return { posts: r.data ?? [], meta: r.meta };
      },
    }),
    defineTool({
      name: "x_get_user_posts",
      title: "توییت‌های کاربر",
      description: "Get recent posts of an X user by numeric user id.",
      input: {
        user_id: z.string().min(1),
        limit: z.number().int().min(5).max(100).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const r = await xCall(ctx, `/users/${encodeURIComponent(a.user_id)}/tweets`, {
          query: { max_results: String(a.limit ?? 10), "tweet.fields": "id,text,created_at,public_metrics,lang" },
        });
        return { posts: r.data ?? [], meta: r.meta };
      },
    }),
    defineTool({
      name: "x_post",
      title: "انتشار توییت",
      description: "Publish a post on X (requires a user access token with write permission).",
      input: { text: z.string().min(1).max(280) },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const r = await xCall(ctx, "/tweets", { method: "POST", body: { text: a.text }, user: true });
        return { ok: true, post: r.data };
      },
    }),
  ],
};
