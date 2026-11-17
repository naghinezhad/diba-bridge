import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, test } from "node:test";
import { z } from "zod";
import { configureProxy } from "../../src/core/net.ts";
import { ProviderError, type ProviderContext } from "../../src/core/types.ts";
import { buildRestUrl, flatQuery, normalizeRestPath, stripHtml, wordpress, WordPressError } from "../../src/providers/wordpress.ts";

interface Recorded {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  body: Buffer;
  json: any;
}

type Reply = { status?: number; headers?: Record<string, string>; json?: unknown; text?: string };
type Handler = (req: Recorded) => Reply | undefined;

class MockSite {
  server!: Server;
  base = "";
  requests: Recorded[] = [];
  handler: Handler = () => undefined;

  async start() {
    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const url = new URL(req.url ?? "/", "http://mock");
        const body = Buffer.concat(chunks);
        let json: any;
        try {
          json = body.length ? JSON.parse(body.toString("utf8")) : undefined;
        } catch {
          json = undefined;
        }
        const rec: Recorded = { method: req.method ?? "GET", path: url.pathname, query: url.searchParams, headers: req.headers, body, json };
        this.requests.push(rec);
        const reply = this.handler(rec) ?? { status: 404, json: { code: "rest_no_route", message: "No route was found matching the URL and request method.", data: { status: 404 } } };
        const headers: Record<string, string> = { ...(reply.headers ?? {}) };
        if (reply.json !== undefined) {
          headers["content-type"] = "application/json; charset=UTF-8";
          res.writeHead(reply.status ?? 200, headers);
          res.end(JSON.stringify(reply.json));
        } else {
          headers["content-type"] = headers["content-type"] ?? "text/html; charset=UTF-8";
          res.writeHead(reply.status ?? 200, headers);
          res.end(reply.text ?? "");
        }
      });
    });
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  reset(handler: Handler) {
    this.requests = [];
    this.handler = handler;
  }

  async stop() {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

const tool = (name: string) => {
  const t = wordpress.tools.find((x) => x.name === name);
  assert.ok(t, `tool ${name} exists`);
  return t!;
};

async function call(name: string, args: Record<string, unknown>, config: Record<string, string>): Promise<any> {
  const t = tool(name);
  const parsed = z.object(t.input).parse(args);
  return t.handler(parsed, { config } as ProviderContext);
}

const BASIC = { username: "admin", appPassword: "abcd efgh ijkl" };
const KEY = { connectorKey: "dbk_test_key" };

describe("wordpress provider — تعریف", () => {
  test("ثبت شده و فیلدها و نام ابزارها درست است", () => {
    const index = readFileSync(new URL("../../src/providers/index.ts", import.meta.url), "utf8");
    assert.ok(index.includes('import { wordpress } from "./wordpress.js";'));
    assert.match(index.slice(index.indexOf("builtinProviders")), /^\s*wordpress,\r?$/m);
    assert.ok(index.split("\n").some((line) => line.startsWith("export {") && line.includes(" wordpress,")));
    assert.equal(wordpress.id, "wordpress");
    assert.equal(wordpress.name, "WordPress");
    assert.equal(wordpress.nameFa, "وردپرس");
    assert.equal(wordpress.category, "utility");
    assert.deepEqual(wordpress.fields.map((f) => f.key), ["siteUrl", "username", "appPassword", "connectorKey"]);
    assert.deepEqual(wordpress.fields.filter((f) => f.required).map((f) => f.key), ["siteUrl"]);
    assert.deepEqual(wordpress.fields.filter((f) => f.type === "secret").map((f) => f.key), ["appPassword", "connectorKey"]);

    const names = wordpress.tools.map((t) => t.name);
    assert.equal(new Set(names).size, names.length, "tool names are unique");
    for (const t of wordpress.tools) {
      assert.match(t.name, /^wordpress_[a-z_]+$/);
      assert.ok(t.title.length > 0 && t.description.length > 0);
      assert.doesNotThrow(() => z.toJSONSchema(z.object(t.input)), `${t.name} schema`);
    }
    for (const required of [
      "wordpress_get_site_info", "wordpress_site_health", "wordpress_get_settings", "wordpress_update_settings",
      "wordpress_list_posts", "wordpress_get_post", "wordpress_create_post", "wordpress_update_post", "wordpress_delete_post",
      "wordpress_list_post_types", "wordpress_search", "wordpress_list_revisions",
      "wordpress_list_terms", "wordpress_create_term", "wordpress_update_term", "wordpress_delete_term",
      "wordpress_list_media", "wordpress_upload_media", "wordpress_update_media", "wordpress_delete_media",
      "wordpress_list_comments", "wordpress_create_comment", "wordpress_moderate_comment", "wordpress_delete_comment",
      "wordpress_list_users", "wordpress_get_user", "wordpress_create_user", "wordpress_update_user", "wordpress_delete_user", "wordpress_get_me",
      "wordpress_list_plugins", "wordpress_activate_plugin", "wordpress_deactivate_plugin", "wordpress_install_plugin", "wordpress_delete_plugin",
      "wordpress_list_themes", "wordpress_activate_theme", "wordpress_list_menus", "wordpress_get_menu_items",
      "wordpress_get_options", "wordpress_update_option", "wordpress_flush_cache", "wordpress_search_replace_content",
      "wordpress_bulk_update_posts", "wordpress_list_cron", "wordpress_run_cron", "wordpress_get_seo_meta", "wordpress_update_seo_meta",
      "wordpress_maintenance_mode", "wordpress_get_stats", "wordpress_activity_log",
      "wordpress_wc_list_products", "wordpress_wc_get_product", "wordpress_wc_create_product", "wordpress_wc_update_product", "wordpress_wc_delete_product",
      "wordpress_wc_list_orders", "wordpress_wc_get_order", "wordpress_wc_update_order", "wordpress_wc_list_customers",
      "wordpress_wc_list_coupons", "wordpress_wc_create_coupon", "wordpress_wc_sales_report", "wordpress_rest_request",
    ]) {
      assert.ok(names.includes(required), `${required} is defined`);
    }
  });

  test("برچسب فقط‌خواندنی و مخرب درست است", () => {
    const ro = (n: string) => tool(n).annotations?.readOnlyHint === true;
    const destructive = (n: string) => tool(n).annotations?.destructiveHint === true;
    for (const n of ["wordpress_list_posts", "wordpress_get_post", "wordpress_get_site_info", "wordpress_list_users", "wordpress_wc_list_orders", "wordpress_activity_log"]) {
      assert.ok(ro(n), `${n} is read-only`);
    }
    for (const n of ["wordpress_create_post", "wordpress_update_post", "wordpress_upload_media", "wordpress_flush_cache", "wordpress_maintenance_mode", "wordpress_wc_update_order"]) {
      assert.ok(!ro(n), `${n} is not read-only`);
    }
    for (const t of wordpress.tools.filter((x) => /_delete_/.test(x.name))) {
      assert.ok(t.annotations?.destructiveHint, `${t.name} is destructive`);
      assert.ok(!t.annotations?.readOnlyHint);
    }
    assert.ok(destructive("wordpress_search_replace_content"));
    assert.equal(tool("wordpress_rest_request").annotations?.readOnlyHint, false);
    assert.ok(destructive("wordpress_rest_request"));
  });
});

describe("wordpress provider — کمک‌تابع‌ها", () => {
  test("ساخت آدرس در هر دو حالت", () => {
    assert.equal(buildRestUrl("https://a.ir", "/wp/v2/posts", { per_page: 5, include: [1, 2], x: undefined }, "pretty"), "https://a.ir/wp-json/wp/v2/posts?per_page=5&include=1%2C2");
    assert.equal(buildRestUrl("https://a.ir/blog", "/wp/v2/posts", { search: "سلام" }, "query"), `https://a.ir/blog/?rest_route=/wp/v2/posts&search=${encodeURIComponent("سلام")}`);
    assert.equal(buildRestUrl("https://a.ir", "/", undefined, "pretty"), "https://a.ir/wp-json/");
    assert.deepEqual(flatQuery({ a: [1, 2], b: true, c: "", d: null, e: { k: "v" } }), { a: "1,2", b: "true", "e[k]": "v" });
  });

  test("مسیر ابزار عمومی فقط زیر /wp-json می‌ماند", () => {
    assert.equal(normalizeRestPath("/wp/v2/posts"), "/wp/v2/posts");
    assert.equal(normalizeRestPath("wp/v2/posts/12"), "/wp/v2/posts/12");
    assert.equal(normalizeRestPath("/wp-json/wp/v2/plugins/akismet/akismet"), "/wp/v2/plugins/akismet/akismet");
    assert.equal(normalizeRestPath("/wp-json"), "/");
    for (const bad of [
      "https://evil.example/wp-json/wp/v2/posts",
      "http:evil.example",
      "//evil.example/wp/v2/posts",
      "/wp-json//evil.example",
      "/wp/v2/../../wp-admin/admin-ajax.php",
      "/wp/v2/./posts",
      "/wp/v2/posts?status=any",
      "/wp/v2/posts#x",
      "\\\\evil.example\\share",
      "/wp/v2/%2e%2e/secret",
      "/wp/v2/posts 1",
      "javascript:alert(1)",
      "",
    ]) {
      assert.throws(() => normalizeRestPath(bad), ProviderError, `rejects ${JSON.stringify(bad)}`);
    }
  });

  test("تبدیل HTML به متن", () => {
    assert.equal(stripHtml("<p>سلام&nbsp;<b>دنیا</b> &amp; &#8211; ok</p><script>x()</script>"), "سلام دنیا & – ok");
    assert.equal(stripHtml("abcdefghij", 5), "abcde…");
  });
});

describe("wordpress provider — درخواست‌ها", () => {
  const site = new MockSite();
  let cfg: Record<string, string>;

  before(async () => {
    configureProxy({});
    await site.start();
  });
  after(async () => {
    await site.stop();
  });
  beforeEach(() => {
    cfg = { siteUrl: site.base, ...BASIC };
  });

  test("هدر Basic، آدرس، صفحه‌بندی و خروجی جمع‌وجور", async () => {
    site.reset((r) => {
      if (r.path === "/wp-json/wp/v2/posts") {
        return {
          headers: { "X-WP-Total": "42", "X-WP-TotalPages": "5" },
          json: [{ id: 7, type: "post", status: "publish", title: { rendered: "عنوان &amp; تست" }, excerpt: { rendered: "<p>خلاصه‌ی <b>نوشته</b></p>" }, link: "https://x/7", date: "2026-01-01T10:00:00", author: 1, categories: [3], tags: [], featured_media: 0, content: { rendered: "<p>LONG</p>" } }],
        };
      }
    });
    const out = await call("wordpress_list_posts", { search: "تست", page: 2, categories: [3, 4] }, { ...cfg, siteUrl: `${site.base}/wp-admin/` });
    assert.equal(site.requests.length, 1);
    const req = site.requests[0];
    assert.equal(req.method, "GET");
    assert.equal(req.path, "/wp-json/wp/v2/posts");
    assert.equal(req.headers.authorization, `Basic ${Buffer.from("admin:abcd efgh ijkl").toString("base64")}`);
    assert.equal(req.headers["x-diba-bridge-key"], undefined);
    assert.equal(req.query.get("search"), "تست");
    assert.equal(req.query.get("page"), "2");
    assert.equal(req.query.get("per_page"), "10");
    assert.equal(req.query.get("categories"), "3,4");
    assert.ok(req.query.get("_fields")?.includes("title"));

    assert.equal(out.total, 42);
    assert.equal(out.total_pages, 5);
    assert.equal(out.page, 2);
    assert.equal(out.per_page, 10);
    assert.equal(out.count, 1);
    assert.deepEqual(out.items[0], { id: 7, type: "post", status: "publish", title: "عنوان & تست", link: "https://x/7", date: "2026-01-01T10:00:00", author: 1, excerpt: "خلاصه‌ی نوشته", categories: [3] });
  });

  test("سایت بدون پیوند یکتای زیبا: برگشت به ?rest_route= و به‌خاطر سپردن آن", async () => {
    const plain = new MockSite();
    await plain.start();
    try {
      plain.reset((r) => {
        if (r.path.startsWith("/wp-json")) return { status: 404, text: "<html><body>Not Found</body></html>" };
        if (r.path === "/" && r.query.get("rest_route") === "/wp/v2/users/me") return { json: { id: 1, username: "admin", name: "مدیر", roles: ["administrator"] } };
      });
      const config = { siteUrl: `${plain.base}/`, ...BASIC };
      const me = await call("wordpress_get_me", {}, config);
      assert.equal(me.username, "admin");
      assert.equal(plain.requests.length, 2);
      assert.equal(plain.requests[0].path, "/wp-json/wp/v2/users/me");
      assert.equal(plain.requests[1].path, "/");
      assert.equal(plain.requests[1].query.get("rest_route"), "/wp/v2/users/me");
      assert.equal(plain.requests[1].query.get("context"), "edit");
      assert.ok(plain.requests[1].headers.authorization?.startsWith("Basic "));

      await call("wordpress_get_me", {}, config);
      assert.equal(plain.requests.length, 3);
      assert.equal(plain.requests[2].query.get("rest_route"), "/wp/v2/users/me");
    } finally {
      await plain.stop();
    }
  });

  test("خطاهای وردپرس به پیام فارسی با کد تبدیل می‌شوند", async () => {
    site.reset((r) => {
      if (r.path.endsWith("/posts/1")) return { status: 403, json: { code: "rest_forbidden", message: "Sorry, you are not allowed to do that.", data: { status: 403 } } };
      if (r.path.endsWith("/posts/2")) return { status: 401, json: { code: "incorrect_password", message: "The provided password is an invalid application password.", data: { status: 401 } } };
      if (r.path.endsWith("/posts/3")) return { status: 400, json: { code: "rest_invalid_param", message: "Invalid parameter(s): status", data: { status: 400, params: { status: "status is not one of publish, draft." } } } };
      if (r.path.endsWith("/posts/4")) return { status: 503, text: "<html><h1>Service Unavailable</h1><p>Blocked by firewall</p></html>" };
    });
    await assert.rejects(call("wordpress_get_post", { id: 1 }, cfg), (e: any) => {
      assert.ok(e instanceof WordPressError && e instanceof ProviderError);
      assert.equal(e.status, 403);
      assert.equal(e.code, "rest_forbidden");
      assert.match(e.message, /دسترسی لازم/);
      assert.match(e.message, /\[rest_forbidden\]/);
      return true;
    });
    await assert.rejects(call("wordpress_get_post", { id: 2 }, cfg), /Application Password اشتباه است/);
    await assert.rejects(call("wordpress_get_post", { id: 3 }, cfg), /ورودی نامعتبر است.*status: status is not one of/);
    await assert.rejects(call("wordpress_get_post", { id: 4 }, cfg), (e: any) => {
      assert.match(e.message, /JSON نبود \(HTTP 503\)/);
      assert.match(e.message, /Blocked by firewall/);
      return true;
    });
  });

  test("خطای شبکه پیام فارسی می‌دهد", async () => {
    const dead = new MockSite();
    await dead.start();
    const base = dead.base;
    await dead.stop();
    await assert.rejects(call("wordpress_get_me", {}, { siteUrl: base, ...BASIC }), /اتصال به سایت وردپرس برقرار نشد/);
  });

  test("بدون هیچ روش اتصال، خطای روشن می‌دهد", async () => {
    site.reset(() => undefined);
    await assert.rejects(call("wordpress_list_posts", {}, { siteUrl: site.base }), /هیچ روش اتصالی/);
    await assert.rejects(call("wordpress_list_posts", {}, { siteUrl: "", ...BASIC }), /آدرس سایت وردپرس ثبت نشده/);
    await assert.rejects(wordpress.test!({ config: { siteUrl: site.base } }), /هیچ روش اتصالی/);
    assert.equal(site.requests.length, 0);
  });

  test("ابزارهای افزونه بدون کلید یا بدون افزونه خطای فارسی می‌دهند", async () => {
    site.reset(() => undefined);
    await assert.rejects(call("wordpress_flush_cache", {}, cfg), /Diba Bridge Connector.*نیاز دارد/s);
    await assert.rejects(call("wordpress_wc_list_products", {}, cfg), /Diba Bridge Connector/);
    assert.equal(site.requests.length, 0, "no request without a connector key");

    await assert.rejects(call("wordpress_flush_cache", {}, { ...cfg, ...KEY }), /روی این سایت پیدا نشد/);
    assert.equal(site.requests[0].path, "/wp-json/diba-bridge/v1/cache/flush");
    assert.equal(site.requests[0].headers["x-diba-bridge-key"], "dbk_test_key");
    assert.equal(site.requests[0].headers.authorization, undefined, "basic credentials are not sent to connector routes");

    site.reset(() => ({ status: 404, headers: { "X-Diba-Bridge-Connector": "1.0.0" }, json: { code: "rest_no_route", message: "No route", data: { status: 404 } } }));
    await assert.rejects(call("wordpress_wc_list_products", {}, { ...cfg, ...KEY }), /ووکامرس روی این سایت فعال نیست/);
    await assert.rejects(call("wordpress_get_seo_meta", { id: 5 }, { ...cfg, ...KEY }), /Yoast SEO یا Rank Math/);

    site.reset(() => ({ status: 403, headers: { "X-Diba-Bridge-Connector": "1.0.0" }, json: { code: "diba_bridge_scope_disabled", message: "دسترسی «tools» در تنظیمات افزونه‌ی Diba Bridge غیرفعال است.", data: { status: 403 } } }));
    await assert.rejects(call("wordpress_list_cron", {}, { ...cfg, ...KEY }), /غیرفعال است.*\[diba_bridge_scope_disabled\]/);
  });

  test("فقط با کلید افزونه، REST هسته از مسیر proxy می‌رود", async () => {
    site.reset((r) => {
      if (r.path === "/wp-json/diba-bridge/v1/proxy") {
        return { headers: { "X-WP-Total": "1", "X-WP-TotalPages": "1", "X-Diba-Bridge-Connector": "1.0.0" }, json: [{ id: 3, name: "اخبار", slug: "news", taxonomy: "category", count: 4 }] };
      }
    });
    const out = await call("wordpress_list_terms", { search: "اخ", include: [3, 9] }, { siteUrl: site.base, ...KEY });
    const req = site.requests[0];
    assert.equal(req.method, "POST");
    assert.equal(req.headers["x-diba-bridge-key"], "dbk_test_key");
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.json.method, "GET");
    assert.equal(req.json.path, "/wp/v2/categories");
    assert.equal(req.json.query.search, "اخ");
    assert.equal(req.json.query.include, "3,9");
    assert.equal(req.json.query.per_page, "20");
    assert.equal(req.json.body, null);
    assert.equal(out.total, 1);
    assert.deepEqual(out.items[0], { id: 3, name: "اخبار", slug: "news", taxonomy: "category", count: 4 });

    site.reset(() => ({ status: 404, headers: { "X-Diba-Bridge-Connector": "1.0.0" }, json: { code: "rest_no_route", message: "No route", data: { status: 404 } } }));
    await assert.rejects(call("wordpress_get_settings", {}, { siteUrl: site.base, ...KEY }), (e: any) => e instanceof WordPressError && e.code === "rest_no_route");
    site.reset(() => undefined);
    await assert.rejects(call("wordpress_get_settings", {}, { siteUrl: site.base, ...KEY }), /روی این سایت پیدا نشد/);
  });

  test("چرخه‌ی ساخت، ویرایش، زمان‌بندی و حذف نوشته", async () => {
    const posts = new Map<number, any>();
    let nextId = 100;
    const view = (p: any) => ({ id: p.id, type: "post", status: p.status, title: { raw: p.title, rendered: p.title }, content: { raw: p.content ?? "", rendered: `<p>${p.content ?? ""}</p>` }, excerpt: { rendered: "" }, date: p.date ?? "2026-01-01T00:00:00", featured_media: p.featured_media ?? 0, categories: p.categories ?? [], meta: p.meta ?? {} });
    site.reset((r) => {
      const m = r.path.match(/^\/wp-json\/wp\/v2\/posts(?:\/(\d+))?$/);
      if (!m) return undefined;
      if (!m[1] && r.method === "POST") {
        const p = { id: nextId++, ...r.json };
        posts.set(p.id, p);
        return { status: 201, json: view(p) };
      }
      const p = posts.get(Number(m[1]));
      if (!p) return { status: 404, json: { code: "rest_post_invalid_id", message: "Invalid post ID.", data: { status: 404 } } };
      if (r.method === "POST") {
        Object.assign(p, r.json);
        return { json: view(p) };
      }
      if (r.method === "DELETE") {
        if (r.query.get("force") === "true") {
          posts.delete(p.id);
          return { json: { deleted: true, previous: view(p) } };
        }
        p.status = "trash";
        return { json: view(p) };
      }
      return { json: view(p) };
    });

    const created = await call("wordpress_create_post", { title: "سلام", content: "<b>متن</b>", categories: [2], featured_media: 55, meta: { subtitle: "x" }, terms: { genres: [8] } }, cfg);
    assert.equal(created.ok, true);
    assert.equal(created.post.id, 100);
    assert.equal(created.post.status, "draft", "default status is draft");
    assert.deepEqual(site.requests[0].json, { title: "سلام", content: "<b>متن</b>", categories: [2], featured_media: 55, meta: { subtitle: "x" }, genres: [8], status: "draft" });
    assert.match(String(site.requests[0].headers["content-type"]), /application\/json/);

    const before = site.requests.length;
    await assert.rejects(call("wordpress_update_post", { id: 100, status: "future" }, cfg), /تاریخ انتشار/);
    await assert.rejects(call("wordpress_update_post", { id: 100 }, cfg), /هیچ فیلدی/);
    assert.equal(site.requests.length, before);

    const scheduled = await call("wordpress_update_post", { id: 100, status: "future", date: "2030-05-01T08:00:00" }, cfg);
    assert.equal(scheduled.post.status, "future");
    const upd = site.requests.at(-1)!;
    assert.equal(upd.method, "POST");
    assert.equal(upd.path, "/wp-json/wp/v2/posts/100");
    assert.deepEqual(upd.json, { status: "future", date: "2030-05-01T08:00:00" });

    const full = await call("wordpress_get_post", { id: 100, format: "text" }, cfg);
    assert.equal(site.requests.at(-1)!.query.get("context"), "edit");
    assert.equal(full.content, "متن");
    assert.equal(full.content_format, "text");
    assert.deepEqual(full.meta, { subtitle: "x" });
    assert.equal(full.featured_media, 55);
    const html = await call("wordpress_get_post", { id: 100 }, cfg);
    assert.equal(html.content, "<b>متن</b>");
    assert.equal(html.content_format, "raw_html");

    const trashed = await call("wordpress_delete_post", { id: 100 }, cfg);
    assert.deepEqual(trashed, { ok: true, id: 100, deleted: false, trashed: true, status: "trash" });
    assert.equal(site.requests.at(-1)!.method, "DELETE");
    assert.equal(site.requests.at(-1)!.query.get("force"), null);

    const removed = await call("wordpress_delete_post", { id: 100, force: true }, cfg);
    assert.equal(removed.deleted, true);
    assert.equal(site.requests.at(-1)!.query.get("force"), "true");
    assert.equal(posts.size, 0);

    await assert.rejects(call("wordpress_get_post", { id: 100 }, cfg), /محتوایی با این شناسه پیدا نشد/);
  });

  test("تشخیص rest_base برای نوع محتوا و طبقه‌بندی سفارشی", async () => {
    site.reset((r) => {
      if (r.path === "/wp-json/wp/v2/types/book") return { json: { slug: "book", rest_base: "books", rest_namespace: "wp/v2" } };
      if (r.path === "/wp-json/wp/v2/types/product") return { json: { slug: "product", rest_base: "product", rest_namespace: "custom/v1" } };
      if (r.path === "/wp-json/wp/v2/types/nope") return { status: 404, json: { code: "rest_type_invalid", message: "Invalid post type.", data: { status: 404 } } };
      if (r.path === "/wp-json/wp/v2/taxonomies/genre") return { json: { slug: "genre", rest_base: "genres" } };
      if (["/wp-json/wp/v2/books", "/wp-json/custom/v1/product", "/wp-json/wp/v2/pages", "/wp-json/wp/v2/tags"].includes(r.path)) return { json: [] };
      if (r.path === "/wp-json/wp/v2/genres" && r.method === "POST") return { status: 201, json: { id: 12, name: r.json.name, slug: "sci-fi", taxonomy: "genre" } };
      if (r.path === "/wp-json/wp/v2/genres/12" && r.method === "DELETE") return { json: { deleted: true } };
    });

    await call("wordpress_list_posts", { type: "book" }, cfg);
    assert.deepEqual(site.requests.map((r) => r.path), ["/wp-json/wp/v2/types/book", "/wp-json/wp/v2/books"]);
    await call("wordpress_list_posts", { type: "book" }, cfg);
    assert.equal(site.requests.length, 3);
    assert.equal(site.requests[2].path, "/wp-json/wp/v2/books");

    await call("wordpress_list_posts", { type: "product" }, cfg);
    assert.equal(site.requests.at(-1)!.path, "/wp-json/custom/v1/product");

    const n = site.requests.length;
    await call("wordpress_list_posts", { type: "page" }, cfg);
    await call("wordpress_list_terms", { taxonomy: "post_tag" }, cfg);
    assert.deepEqual(site.requests.slice(n).map((r) => r.path), ["/wp-json/wp/v2/pages", "/wp-json/wp/v2/tags"]);

    await assert.rejects(call("wordpress_list_posts", { type: "nope" }, cfg), /نوع محتوای «nope».*wordpress_list_post_types/);
    assert.throws(() => z.object(tool("wordpress_list_posts").input).parse({ type: "../users" }));

    const term = await call("wordpress_create_term", { taxonomy: "genre", name: "علمی‌تخیلی" }, cfg);
    assert.equal(term.term.id, 12);
    assert.deepEqual(site.requests.at(-1)!.json, { name: "علمی‌تخیلی" });
    assert.equal(site.requests.at(-1)!.path, "/wp-json/wp/v2/genres");

    const del = await call("wordpress_delete_term", { taxonomy: "genre", id: 12 }, cfg);
    assert.equal(del.deleted, true);
    assert.equal(site.requests.at(-1)!.query.get("force"), "true");
  });

  test("آپلود رسانه: مستقیم با Basic و چندبخشی با افزونه", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const media = { id: 9, title: { rendered: "لوگو" }, alt_text: "alt", media_type: "image", mime_type: "image/png", source_url: "https://x/logo.png", media_details: { width: 1, height: 1, sizes: { big: {} } } };
    site.reset((r) => (r.path === "/wp-json/wp/v2/media" || r.path === "/wp-json/diba-bridge/v1/media" ? { status: 201, json: media } : undefined));

    const out = await call("wordpress_upload_media", { base64: png.toString("base64"), mime_type: "image/png", filename: "لوگو سایت.png", title: "لوگو", alt_text: "alt" }, cfg);
    let req = site.requests[0];
    assert.equal(req.method, "POST");
    assert.equal(req.path, "/wp-json/wp/v2/media");
    assert.equal(req.headers["content-type"], "image/png");
    assert.match(String(req.headers["content-disposition"]), /^attachment; filename="[A-Za-z0-9._-]+\.png"$/);
    assert.equal(req.query.get("title"), "لوگو");
    assert.equal(req.query.get("alt_text"), "alt");
    assert.ok(req.body.equals(png), "raw bytes are sent");
    assert.deepEqual(out.media, { id: 9, title: "لوگو", alt_text: "alt", media_type: "image", mime_type: "image/png", url: "https://x/logo.png", width: 1, height: 1 });

    site.requests = [];
    await call("wordpress_upload_media", { source: `data:image/png;name=a.png;base64,${png.toString("base64")}`, post: 4 }, { siteUrl: site.base, ...KEY });
    req = site.requests[0];
    assert.equal(req.path, "/wp-json/diba-bridge/v1/media");
    assert.equal(req.headers["x-diba-bridge-key"], "dbk_test_key");
    assert.match(String(req.headers["content-type"]), /^multipart\/form-data; boundary=/);
    assert.ok(req.body.includes(png), "file bytes are in the multipart body");
    assert.ok(req.body.toString("latin1").includes('name="post"'));

    await assert.rejects(call("wordpress_upload_media", { source: "C:\\secret\\file.txt" }, cfg), /مسیر محلی سرور مجاز نیست/);
    await assert.rejects(call("wordpress_upload_media", { source: "/etc/passwd" }, cfg), /مسیر محلی سرور مجاز نیست/);
    await assert.rejects(call("wordpress_upload_media", {}, cfg), /فایلی برای آپلود داده نشده/);
  });

  test("ابزار عمومی: مسیر امن، روش‌ها و مسیر افزونه", async () => {
    site.reset((r) => {
      if (r.path === "/wp-json/wp/v2/blocks") return { headers: { "X-WP-Total": "3", "X-WP-TotalPages": "1" }, json: [{ id: 1 }] };
      if (r.path === "/wp-json/wp/v2/blocks/1" && r.method === "PUT") return { json: { id: 1, ...r.json } };
      if (r.path === "/wp-json/diba-bridge/v1/stats") return { json: { ok: true } };
    });

    const list = await call("wordpress_rest_request", { path: "/wp-json/wp/v2/blocks", query: { per_page: 5 } }, cfg);
    assert.deepEqual(list, { status: 200, total: 3, total_pages: 1, data: [{ id: 1 }] });
    assert.equal(site.requests[0].method, "GET");
    assert.equal(site.requests[0].query.get("per_page"), "5");

    const put = await call("wordpress_rest_request", { method: "PUT", path: "wp/v2/blocks/1", body: { title: "t" } }, cfg);
    assert.deepEqual(put.data, { id: 1, title: "t" });
    assert.deepEqual(site.requests[1].json, { title: "t" });

    await call("wordpress_rest_request", { path: "/diba-bridge/v1/stats" }, { ...cfg, ...KEY });
    assert.equal(site.requests[2].headers["x-diba-bridge-key"], "dbk_test_key");
    assert.equal(site.requests[2].headers.authorization, undefined);

    const count = site.requests.length;
    for (const bad of ["https://evil.example/wp-json/wp/v2/users", "//evil.example/x", "/wp/v2/../../wp-login.php", "/wp/v2/users?context=edit", "/wp/v2/%2e%2e/x", "\\\\evil\\x"]) {
      await assert.rejects(call("wordpress_rest_request", { method: "DELETE", path: bad }, cfg), /مسیر نامعتبر است/, `rejects ${bad}`);
    }
    assert.equal(site.requests.length, count, "unsafe paths never reach the network");
    assert.ok(site.requests.every((r) => r.headers.host === new URL(site.base).host));
  });

  test("ابزارهای افزونه مسیر و بدنه‌ی درست می‌فرستند", async () => {
    site.reset((r) => (r.path.startsWith("/wp-json/diba-bridge/v1/") ? { headers: { "X-Diba-Bridge-Connector": "1.0.0" }, json: { ok: true, echo: r.json ?? null } } : undefined));
    const k = { siteUrl: site.base, ...KEY };

    await call("wordpress_search_replace_content", { search: "http://old.ir", replace: "https://new.ir" }, k);
    assert.equal(site.requests[0].path, "/wp-json/diba-bridge/v1/search-replace");
    assert.equal(site.requests[0].json.dry_run, true, "dry-run by default");
    await call("wordpress_search_replace_content", { search: "aa", replace: "bb", dry_run: false }, k);
    assert.equal(site.requests[1].json.dry_run, false);

    await call("wordpress_get_options", { names: ["blogname", "timezone_string"] }, k);
    assert.equal(site.requests[2].method, "GET");
    assert.equal(site.requests[2].query.get("names"), "blogname,timezone_string");

    await call("wordpress_maintenance_mode", {}, k);
    assert.equal(site.requests[3].method, "GET");
    await call("wordpress_maintenance_mode", { enabled: true, message: "برمی‌گردیم" }, k);
    assert.equal(site.requests[4].method, "POST");
    assert.deepEqual(site.requests[4].json, { enabled: true, message: "برمی‌گردیم" });

    await call("wordpress_wc_update_order", { id: 31, status: "completed", note: "ارسال شد", customer_note: true }, k);
    assert.equal(site.requests[5].path, "/wp-json/diba-bridge/v1/wc/orders/31");
    assert.deepEqual(site.requests[5].json, { status: "completed", note: "ارسال شد", customer_note: true });

    await call("wordpress_wc_delete_product", { id: 8, force: true }, k);
    assert.equal(site.requests[6].method, "DELETE");
    assert.equal(site.requests[6].path, "/wp-json/diba-bridge/v1/wc/products/8");
    assert.equal(site.requests[6].query.get("force"), "true");

    await call("wordpress_activate_theme", { stylesheet: "twentytwentyfive" }, k);
    assert.equal(site.requests[7].path, "/wp-json/diba-bridge/v1/themes/activate");

    const n = site.requests.length;
    await assert.rejects(call("wordpress_wc_update_order", { id: 31 }, k), /وضعیت جدید یا یادداشت/);
    await assert.rejects(call("wordpress_bulk_update_posts", { ids: [1, 2] }, k), /هیچ تغییری/);
    assert.equal(site.requests.length, n);
    assert.throws(() => z.object(tool("wordpress_delete_user").input).parse({ id: 5 }), "reassign is required");
  });

  test("تست اتصال نام سایت، نسخه و کاربر را برمی‌گرداند", async () => {
    site.reset((r) => {
      if (r.path === "/wp-json/wp/v2/users/me") return { json: { id: 1, username: "admin", name: "مدیر", roles: ["administrator"], email: "a@b.c" } };
      if (r.path === "/wp-json/") return { json: { name: "فروشگاه &amp; وبلاگ", url: site.base, namespaces: ["wp/v2", "diba-bridge/v1", "wc/v3"] } };
      if (r.path === "/wp-json/diba-bridge/v1/ping") return { headers: { "X-Diba-Bridge-Connector": "1.0.0" }, json: { ok: true, site_name: "فروشگاه & وبلاگ", wp_version: "6.8.1", connector_version: "1.0.0", user: { id: 2, username: "bridge", roles: ["editor"] }, read_only: false, scopes: ["content", "media"] } };
      if (r.path === "/wp-json/wp/v2/themes") return { json: [{ stylesheet: "twentytwentyfive", template: "twentytwentyfive", name: { rendered: "Twenty Twenty-Five" }, version: "1.2", status: "active" }] };
      if (r.path === "/wp-json/wp/v2/plugins") return { json: [{ plugin: "a/a" }, { plugin: "b/b" }] };
    });

    const both = (await wordpress.test!({ config: { ...cfg, ...KEY } })) as any;
    assert.equal(both.ok, true);
    assert.equal(both.site_name, "فروشگاه & وبلاگ");
    assert.equal(both.wp_version, "6.8.1");
    assert.equal(both.user.username, "admin");
    assert.equal(both.connector_user.username, "bridge");
    assert.equal(both.connector_installed, true);
    assert.deepEqual(both.auth, { application_password: true, connector: true });

    const basicOnly = (await wordpress.test!({ config: cfg })) as any;
    assert.equal(basicOnly.site_name, "فروشگاه & وبلاگ");
    assert.equal(basicOnly.user.username, "admin");
    assert.equal(basicOnly.wp_version, undefined);

    const info = await call("wordpress_get_site_info", {}, cfg);
    assert.equal(info.name, "فروشگاه & وبلاگ");
    assert.equal(info.theme.stylesheet, "twentytwentyfive");
    assert.equal(info.active_plugins_count, 2);
    assert.equal(info.woocommerce.active, true);
    assert.equal(info.connector.installed, true);
    assert.equal(info.connector.configured, false);
  });
});
