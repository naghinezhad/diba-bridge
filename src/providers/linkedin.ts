import { z } from "zod";
import { netFetch } from "../core/net.js";
import { defineTool, ProviderError, type ProviderContext, type ProviderDef } from "../core/types.js";

const DEFAULT_BASE = "https://api.linkedin.com";
const DEFAULT_VERSION = "202506";

function baseOf(ctx: ProviderContext): string {
  return (ctx.config.baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
}

async function linkedin(
  ctx: ProviderContext,
  path: string,
  opts: { method?: string; body?: unknown; query?: Record<string, string>; restli?: boolean } = {},
): Promise<{ data: any; response: Awaited<ReturnType<typeof netFetch>> }> {
  const token = ctx.config.accessToken;
  if (!token) throw new ProviderError("Access Token لینکدین ثبت نشده است.");
  const qs = opts.query ? `?${new URLSearchParams(opts.query).toString()}` : "";
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "LinkedIn-Version": String(ctx.config.apiVersion || DEFAULT_VERSION),
    "X-Restli-Protocol-Version": "2.0.0",
    "content-type": "application/json",
    "user-agent": "dibaMCP/0.4",
  };
  let res: Awaited<ReturnType<typeof netFetch>>;
  try {
    res = await netFetch(`${baseOf(ctx)}${path}${qs}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err: any) {
    throw new ProviderError(`اتصال به لینکدین برقرار نشد: ${err?.message ?? err}`, err);
  }
  const text = await res.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = text; }
  if (!res.ok) {
    const message = data?.message || data?.error_description || data?.error || `HTTP ${res.status}`;
    throw new ProviderError(`LinkedIn: ${message}`, data);
  }
  return { data, response: res };
}

async function me(ctx: ProviderContext): Promise<any> {
  return (await linkedin(ctx, "/v2/userinfo")).data;
}

async function authorUrn(ctx: ProviderContext): Promise<string> {
  const configured = String(ctx.config.authorUrn || "").trim();
  if (configured) return configured.startsWith("urn:li:") ? configured : `urn:li:person:${configured}`;
  const user = await me(ctx);
  const id = user?.sub;
  if (!id) throw new ProviderError("شناسه‌ی کاربر لینکدین پیدا نشد؛ Author URN را در تنظیمات وارد کنید.");
  return `urn:li:person:${id}`;
}

export const linkedinProvider: ProviderDef = {
  id: "linkedin",
  name: "LinkedIn",
  nameFa: "لینکدین",
  category: "messenger",
  color: "#0a66c2",
  glyph: "in",
  description: "اتصال رسمی LinkedIn API — پروفایل، انتشار پست و فهرست پست‌ها",
  docsUrl: "https://learn.microsoft.com/en-us/linkedin/",
  fields: [
    { key: "accessToken", label: "Access Token", type: "secret", required: true, help: "توکن OAuth 2.0 با دسترسی w_member_social (و openid/profile برای پروفایل)" },
    { key: "authorUrn", label: "Author URN", type: "text", placeholder: "urn:li:person:123456789", help: "اختیاری؛ در صورت خالی بودن از پروفایل خوانده می‌شود." },
    { key: "apiVersion", label: "نسخه API", type: "text", default: DEFAULT_VERSION, help: "مثلاً 202506" },
    { key: "baseUrl", label: "آدرس پایه API", type: "url", default: DEFAULT_BASE },
  ],
  test: (ctx) => me(ctx),
  tools: [
    defineTool({
      name: "linkedin_get_me",
      title: "پروفایل لینکدین",
      description: "Get the authenticated LinkedIn profile (OpenID userinfo).",
      input: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (_a, ctx) => me(ctx),
    }),
    defineTool({
      name: "linkedin_get_posts",
      title: "پست‌های لینکدین",
      description: "List recent LinkedIn posts authored by the connected member.",
      input: { limit: z.number().int().min(1).max(50).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (a, ctx) => {
        const author = await authorUrn(ctx);
        const { data } = await linkedin(ctx, "/v2/ugcPosts", {
          query: { q: "authors", authors: `List(${author})`, count: String(a.limit ?? 10) },
        });
        return { author, posts: Array.isArray(data?.elements) ? data.elements : data };
      },
    }),
    defineTool({
      name: "linkedin_create_post",
      title: "انتشار پست لینکدین",
      description: "Publish a text post to LinkedIn (requires w_member_social).",
      input: {
        text: z.string().min(1).max(3000),
        visibility: z.enum(["PUBLIC", "CONNECTIONS"]).optional(),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const author = await authorUrn(ctx);
        const body = {
          author,
          commentary: a.text,
          visibility: a.visibility ?? "PUBLIC",
          distribution: {
            feedDistribution: "MAIN_FEED",
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          lifecycleState: "PUBLISHED",
          isReshareDisabledByAuthor: false,
        };
        const { data, response } = await linkedin(ctx, "/rest/posts", { method: "POST", body });
        return {
          ok: true,
          post_id: response.headers.get("x-restli-id") ?? data?.id,
          author,
        };
      },
    }),
    defineTool({
      name: "linkedin_delete_post",
      title: "حذف پست لینکدین",
      description: "Delete a LinkedIn post by its urn/id.",
      input: { post_id: z.string().min(1) },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const id = a.post_id.startsWith("urn:li:share:") || a.post_id.startsWith("urn:li:ugcPost:")
          ? a.post_id
          : `urn:li:share:${a.post_id}`;
        await linkedin(ctx, `/rest/posts/${encodeURIComponent(id)}`, { method: "DELETE" });
        return { ok: true, post_id: id };
      },
    }),
  ],
};
