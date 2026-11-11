import { z } from "zod";
import { netFetch } from "../core/net.js";
import { defineTool, ProviderError, type ProviderContext, type ProviderDef } from "../core/types.js";

const DEFAULT_BASE = "https://graph.facebook.com/v23.0";

function baseOf(ctx: ProviderContext): string {
  return (ctx.config.baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
}

async function graph(
  ctx: ProviderContext,
  path: string,
  opts: { method?: string; params?: Record<string, string> } = {},
): Promise<any> {
  const token = ctx.config.accessToken;
  const igUser = ctx.config.igUserId;
  if (!token) throw new ProviderError("Access Token اینستاگرام ثبت نشده است.");
  if (!igUser) throw new ProviderError("Instagram Business Account ID ثبت نشده است.");
  const method = opts.method ?? "GET";
  const params = new URLSearchParams({ access_token: token, ...(opts.params ?? {}) });
  let url = `${baseOf(ctx)}${path}`;
  const init: any = { method, headers: { "user-agent": "dibaMCP/0.4" }, signal: AbortSignal.timeout(45_000) };
  if (method === "GET") url += `?${params.toString()}`;
  else {
    init.headers["content-type"] = "application/x-www-form-urlencoded";
    init.body = params.toString();
  }
  let res: any;
  try {
    res = await netFetch(url, init);
  } catch (err: any) {
    throw new ProviderError(`اتصال به اینستاگرام برقرار نشد: ${err?.message ?? err}`, err);
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new ProviderError(`Instagram: ${data?.error?.message ?? `HTTP ${res.status}`}`, data);
  return data;
}

export const instagram: ProviderDef = {
  id: "instagram",
  name: "Instagram",
  nameFa: "اینستاگرام",
  category: "messenger",
  color: "#d62976",
  glyph: "I",
  description: "اتصال رسمی Instagram Graph API برای اکانت Business/Creator — پروفایل، مدیا و انتشار عکس",
  docsUrl: "https://developers.facebook.com/docs/instagram-platform",
  fields: [
    { key: "accessToken", label: "Access Token", type: "secret", required: true, help: "توکن Graph API با دسترسی instagram_basic و instagram_content_publish" },
    { key: "igUserId", label: "Instagram Business Account ID", type: "text", required: true, placeholder: "178414..." },
    { key: "baseUrl", label: "آدرس Graph API", type: "url", default: DEFAULT_BASE },
  ],
  test: async (ctx) => {
    const r = await graph(ctx, `/${encodeURIComponent(ctx.config.igUserId)}`, {
      params: { fields: "id,username,name,profile_picture_url,followers_count,media_count" },
    });
    return r;
  },
  tools: [
    defineTool({
      name: "instagram_get_me",
      title: "پروفایل اینستاگرام",
      description: "Get the connected Instagram business/creator profile.",
      input: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (_a, ctx) =>
        graph(ctx, `/${encodeURIComponent(ctx.config.igUserId)}`, {
          params: { fields: "id,username,name,biography,profile_picture_url,followers_count,follows_count,media_count,website" },
        }),
    }),
    defineTool({
      name: "instagram_get_media",
      title: "مدیای اینستاگرام",
      description: "List recent Instagram media of the connected account.",
      input: { limit: z.number().int().min(1).max(50).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const r = await graph(ctx, `/${encodeURIComponent(ctx.config.igUserId)}/media`, {
          params: {
            limit: String(a.limit ?? 20),
            fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count",
          },
        });
        return { media: r.data ?? [], paging: r.paging };
      },
    }),
    defineTool({
      name: "instagram_get_comments",
      title: "کامنت‌های اینستاگرام",
      description: "List comments for an Instagram media id.",
      input: { media_id: z.string().min(1), limit: z.number().int().min(1).max(50).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const r = await graph(ctx, `/${encodeURIComponent(a.media_id)}/comments`, {
          params: { limit: String(a.limit ?? 20), fields: "id,text,username,timestamp,like_count,replies" },
        });
        return { comments: r.data ?? [] };
      },
    }),
    defineTool({
      name: "instagram_publish_photo",
      title: "انتشار عکس در اینستاگرام",
      description: "Publish a photo to Instagram from a public image URL (two-step Graph API publish).",
      input: {
        image_url: z.string().url(),
        caption: z.string().max(2200).optional(),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const created = await graph(ctx, `/${encodeURIComponent(ctx.config.igUserId)}/media`, {
          method: "POST",
          params: { image_url: a.image_url, ...(a.caption ? { caption: a.caption } : {}) },
        });
        if (!created?.id) throw new ProviderError("اینستاگرام شناسه‌ی مدیا را برنگرداند.");
        const published = await graph(ctx, `/${encodeURIComponent(ctx.config.igUserId)}/media_publish`, {
          method: "POST",
          params: { creation_id: String(created.id) },
        });
        return { ok: true, creation_id: String(created.id), media_id: published?.id };
      },
    }),
  ],
};
