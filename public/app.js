// Diba Bridge (دیبا پل) — داشبورد مدیریت پیام‌رسان‌های هوشمند | دیباچین
// استانداردهای سیستم طراحی دیباچین (dibachain-design-system.md)

const $app = document.getElementById("app");
const state = {
  providers: [],
  overview: null,
  logs: [],
  logFilter: { ok: "all", provider: "" },
  openPlatform: null,
  activeTab: {}, // platformKey -> 'client' | 'bot'
  timer: null,
  authTx: {},
  agent: { open: true, busy: false, messages: [], config: null, unread: 0 },
};

// ---------------------------------------------------------------- utils
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fa = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("fa-IR"));
const rtf = new Intl.RelativeTimeFormat("fa", { numeric: "auto" });

function ago(iso) {
  const s = Math.round((new Date(iso) - Date.now()) / 1000);
  if (Math.abs(s) < 60) return rtf.format(s, "second");
  if (Math.abs(s) < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (Math.abs(s) < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}

function jsonHtml(v) {
  const s = esc(JSON.stringify(v, null, 2) ?? "null");
  return s.replace(/(&quot;(?:\\.|[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g, (m, str, colon, lit) => {
    if (str) return colon ? `<span class="k">${str}</span>${colon}` : `<span class="s">${str}</span>`;
    if (lit) return `<span class="b">${m}</span>`;
    return `<span class="n">${m}</span>`;
  });
}

function toast(msg, isErr = false) {
  const el = document.createElement("div");
  el.className = "toast" + (isErr ? " err" : "");
  el.textContent = msg;
  document.getElementById("toasts").append(el);
  setTimeout(() => el.remove(), isErr ? 6000 : 3200);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = Object.assign(document.createElement("textarea"), { value: text });
    document.body.append(t); t.select(); document.execCommand("copy"); t.remove();
  }
  toast("در کلیپ‌بورد کپی شد");
}

async function busy(btn, fn) {
  btn?.classList.add("loading"); if (btn) btn.disabled = true;
  try { return await fn(); } finally { btn?.classList.remove("loading"); if (btn) btn.disabled = false; }
}

class AuthError extends Error { }
async function api(path, opts = {}) {
  const res = await fetch("api/" + path, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: opts.body ? { "Content-Type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith("auth/")) { boot(); throw new AuthError(); }
  if (!res.ok) throw new Error(data.error || `خطای ${res.status}`);
  return data;
}

const icons = {
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><circle cx="4.5" cy="6" r="1.8"/><circle cx="19.5" cy="6" r="1.8"/><circle cx="4.5" cy="18" r="1.8"/><circle cx="19.5" cy="18" r="1.8"/><path d="M6 7l3.5 3M18 7l-3.5 3M6 17l3.5-3M18 17l-3.5-3"/></svg>',
  providers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 8h10M7 12h6M7 16h4"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 2h6l1-2h5"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M7 12h10"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 4L3 11l7 2 2 7z"/><path d="M10 13l10-9"/></svg>',
  playground: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/></svg>',
  logs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h16M4 12h10M4 18h13"/></svg>',
  connect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 15l6-6M10 6l1-1a4.2 4.2 0 0 1 6 6l-1 1M14 18l-1 1a4.2 4.2 0 0 1-6-6l1-1"/></svg>',
  router: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 16.5h.01M10 16.5h.01M7 9h10M12 2v7M9 5l3-3 3 3"/></svg>',
  theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="7" r="4"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/></svg>',
  bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="11" width="18" height="10" rx="3"/><circle cx="8.5" cy="16" r="1.5" fill="currentColor"/><circle cx="15.5" cy="16" r="1.5" fill="currentColor"/><path d="M12 2v4M8 6h8M2 15h1M21 15h1"/></svg>',
  external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>',
  sparkles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8zM19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9zM5 16l.9 2.1L8 19l-2.1.9L5 22l-.9-2.1L2 19l2.1-.9z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
};
// کلید منو با شناسه‌ی صفحه یکی است
icons.dibarouter = icons.router;

const pages = [
  { id: "overview", title: "نمای کلی" },
  { id: "providers", title: "پیام‌رسان‌ها" },
  { id: "inbox", title: "پیام‌های دریافتی" },
  { id: "playground", title: "آزمایش ابزارها" },
  { id: "logs", title: "گزارش فراخوانی‌ها" },
  { id: "dibarouter", title: "دیبا روتر" },
  { id: "connect", title: "اتصال به هوش مصنوعی" },
];

function route() {
  const [path, qs] = location.hash.replace(/^#\/?/, "").split("?");
  return { page: pages.some((p) => p.id === path) ? path : "overview", q: new URLSearchParams(qs) };
}

function status(p) {
  if (!p) return '<span class="pill pill-off">ناموجود</span>';
  if (p.ready) return '<span class="pill pill-ok">آماده</span>';
  if (p.enabled) return '<span class="pill pill-warn">نیاز به تنظیم</span>';
  return '<span class="pill pill-off">خاموش</span>';
}

function head(title, desc, eyebrow = "", actions = "") {
  return `<header class="page-head">
    <div>
      ${eyebrow ? `<span class="eyebrow">${eyebrow}</span>` : ""}
      <h1>${title}</h1>
      ${desc ? `<p>${desc}</p>` : ""}
    </div>
    ${actions ? `<div class="page-head-actions">${actions}</div>` : ""}
  </header>`;
}

// ---------------------------------------------------------------- Provider Grouping (Platforms)
const platformMeta = {
  bale: {
    key: "bale",
    nameFa: "بله",
    nameEn: "Bale",
    glyph: '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 10.5C7 9.12 8.12 8 9.5 8h5c1.38 0 2.5 1.12 2.5 2.5v2c0 1.38-1.12 2.5-2.5 2.5h-2.5l-3 2v-2.5H9.5C8.12 14.5 7 13.38 7 12v-1.5z" fill="white"/></svg>',
    color: "#1fb486",
    description: "پیام‌رسان بانکی و ارتباطی بله — اتصال حساب کاربری و ربات رسمی Bot API",
    docsUrl: "https://docs.bale.ai/",
  },
  eitaa: {
    key: "eitaa",
    nameFa: "ایتا",
    nameEn: "Eitaa",
    glyph: '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 8.5c0-.83.67-1.5 1.5-1.5h9c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5h-9c-.83 0-1.5-.67-1.5-1.5v-7zm1.5 0L12 12l4.5-3.5" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    color: "#f08a24",
    description: "پیام‌رسان ابری ایتا — پشتیبانی از حساب کاربری و ارسال با ایتایار",
    docsUrl: "https://eitaayar.ir/",
  },
  rubika: {
    key: "rubika",
    nameFa: "روبیکا",
    nameEn: "Rubika",
    glyph: '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9.5 7.5l7 4.5-7 4.5v-9z" fill="white"/>',
    color: "#8b5cf6",
    description: "سوپراپلیکیشن روبیکا — اتصال حساب کاربری برای گروه‌ها و ربات رسمی",
    docsUrl: "https://rubika.ir/",
  },
  soroush: {
    key: "soroush",
    nameFa: "سروش‌پلاس",
    nameEn: "Soroush+",
    glyph: '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 9.5A2.5 2.5 0 019.5 7h5A2.5 2.5 0 0117 9.5v2a2.5 2.5 0 01-2.5 2.5H13l-2.5 2v-2H9.5A2.5 2.5 0 017 11.5v-2z" fill="white"/><circle cx="10" cy="11" r=".8" fill="#2563eb"/><circle cx="12" cy="11" r=".8" fill="#2563eb"/><circle cx="14" cy="11" r=".8" fill="#2563eb"/></svg>',
    color: "#2563eb",
    description: "پیام‌رسان سروش‌پلاس — بات‌های تعاملی رسمی و مدیریت حساب کاربری",
    docsUrl: "https://soroush-app.ir/",
  },
};

function parseProvider(p) {
  const isClient = p.id.endsWith("_client") || Boolean(p.auth);
  const platformKey = p.id.replace(/_client$/, "");
  return { isClient, platformKey };
}

function groupProviders(providers) {
  const map = new Map();
  for (const p of providers) {
    const { isClient, platformKey } = parseProvider(p);
    if (!map.has(platformKey)) {
      const meta = platformMeta[platformKey] || {
        key: platformKey,
        nameFa: p.nameFa.replace(/\s*\(حساب کاربری\)/g, ""),
        nameEn: p.name.replace(/_client/g, ""),
        glyph: p.glyph,
        color: p.color,
        description: p.description,
        docsUrl: p.docsUrl,
      };
      map.set(platformKey, {
        ...meta,
        client: null,
        bot: null,
      });
    }
    const item = map.get(platformKey);
    if (isClient) item.client = p;
    else item.bot = p;
  }
  return Array.from(map.values());
}

// ---------------------------------------------------------------- auth
function switchboardArt() {
  const nodes = [["#1fb486", 110, 90], ["#f08a24", 410, 80], ["#8b5cf6", 430, 290], ["#2563eb", 100, 280]];
  return `<svg viewBox="0 0 540 380" aria-hidden="true">
    ${nodes.map(([c, x, y]) => `<path class="wire live" d="M270 190 Q ${(270 + x) / 2} ${y}, ${x} ${y}"/>`).join("")}
    <circle cx="270" cy="190" r="58" fill="#0f2260"/>
    <circle cx="270" cy="190" r="46" fill="#1e3a8a"/>
    <circle cx="270" cy="190" r="20" fill="#2563eb"/>
    ${nodes.map(([c, x, y]) => `<circle cx="${x}" cy="${y}" r="24" fill="${c}"/>`).join("")}
  </svg>`;
}

function renderAuth(needsSetup) {
  $app.innerHTML = `
  <div class="auth">
    <div class="auth-art">
      <div class="auth-art-glow"></div>
      ${switchboardArt()}
    </div>
    <div class="auth-form">
      <div class="brand" style="padding:0">
        <img src="assets/logo-sm.png" alt="دیباپل" class="brand-logo">
        <div class="brand-text">
          <span class="brand-title">دیباپل</span>
          <span class="brand-sub">DibaBridge · MCP</span>
        </div>
      </div>
      ${needsSetup ? `
        <h1>راه‌اندازی اولیه</h1>
        <p>کد شش‌حرفی چاپ‌شده در کنسول سرور را وارد کرده و یک رمز عبور امن برای دسترسی به داشبورد بسازید.</p>
        <form id="f">
          <div class="field"><label for="code">کد راه‌اندازی سرور</label><input id="code" class="input ltr-input" autocomplete="off" required maxlength="6" placeholder="A1B2C3"></div>
          <div class="field"><label for="pw">رمز عبور داشبورد</label><input id="pw" type="password" class="input" autocomplete="new-password" minlength="8" required><span class="hint">حداقل ۸ کاراکتر</span></div>
          <div class="field"><label for="pw2">تکرار رمز عبور</label><input id="pw2" type="password" class="input" autocomplete="new-password" required></div>
          <div class="form-err" id="err"></div>
          <button class="btn btn-primary" type="submit">ساخت رمز و ورود به داشبورد</button>
        </form>` : `
        <h1>ورود به داشبورد</h1>
        <p>برای مدیریت سرویس‌ها، بررسی پیام‌ها و کلیدهای ارتباطی وارد شوید.</p>
        <form id="f">
          <div class="field"><label for="pw">رمز عبور داشبورد</label><input id="pw" type="password" class="input" autocomplete="current-password" required autofocus></div>
          <div class="form-err" id="err"></div>
          <button class="btn btn-primary" type="submit">ورود به سیستم</button>
        </form>`}
    </div>
  </div>`;
  const f = document.getElementById("f");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = document.getElementById("err");
    err.textContent = "";
    const pw = f.querySelector("#pw").value;
    try {
      if (needsSetup) {
        if (pw !== f.querySelector("#pw2").value) { err.textContent = "رمز و تکرارش یکی نیستند"; return; }
        await busy(f.querySelector("button"), () => api("auth/setup", { body: { code: f.querySelector("#code").value, password: pw } }));
      } else {
        await busy(f.querySelector("button"), () => api("auth/login", { body: { password: pw } }));
      }
      boot();
    } catch (ex) { err.textContent = ex.message; }
  });
}

// ---------------------------------------------------------------- agent dock
function agentDockHtml() {
  const a = state.agent;
  return `<div class="agent-dock${a.open ? " open" : ""}" id="agent-dock">
    <button class="agent-fab" id="agent-toggle" type="button" aria-expanded="${a.open}" aria-controls="agent-panel">
      <span class="agent-fab-icon">${icons.sparkles}</span>
      <span class="agent-fab-text">دستیار دیبا</span>
      <span class="agent-fab-dot" aria-hidden="true"></span>
    </button>
    <section class="agent-panel" id="agent-panel" ${a.open ? "" : "hidden"} aria-label="دستیار دیبا">
      <header class="agent-head">
        <span class="agent-avatar">${icons.sparkles}</span>
        <div class="agent-head-text">
          <b>دستیار دیبا</b>
          <small id="agent-status">در حال بررسی اتصال…</small>
        </div>
        <button class="btn btn-icon btn-quiet" id="agent-close" type="button" aria-label="بستن دستیار">${icons.cross}</button>
      </header>
      <div class="agent-messages" id="agent-messages" aria-live="polite"></div>
      <form class="agent-form" id="agent-form">
        <textarea id="agent-input" rows="2" placeholder="درباره‌ی سیستم بپرس…" aria-label="سؤال از دستیار"></textarea>
        <button class="btn btn-primary btn-icon" id="agent-send" type="submit" aria-label="ارسال">${icons.send}</button>
      </form>
      <div class="agent-foot">
        <a href="#/dibarouter">تنظیم دیبا روتر</a>
        <span>پاسخ‌ها با هوش مصنوعی دیبا روتر</span>
      </div>
    </section>
  </div>`;
}

function renderAgentMessages() {
  const box = document.getElementById("agent-messages");
  if (!box) return;
  box.innerHTML =
    state.agent.messages
      .map((m) => `<div class="agent-msg ${m.role === "user" ? "is-user" : "is-bot"}"><div class="agent-bubble">${esc(m.content).replace(/\n/g, "<br>")}</div></div>`)
      .join("") +
    (state.agent.messages.length <= 1 && !state.agent.busy
      ? `<div class="agent-suggestions">
          ${["کدام سرویس‌ها آماده‌اند؟", "چرا یک سرویس آماده نیست؟", "چطور ایتا را وصل کنم؟", "اتصال MCP چطور کار می‌کند؟"]
            .map((q) => `<button type="button" data-agent-suggest="${esc(q)}">${esc(q)}</button>`)
            .join("")}
        </div>`
      : "") +
    (state.agent.busy ? `<div class="agent-msg is-bot"><div class="agent-bubble agent-typing"><i></i><i></i><i></i></div></div>` : "");
  box.scrollTop = box.scrollHeight;
}

async function refreshAgentConfig() {
  try {
    const c = await api("dibarouter");
    state.agent.config = c;
    const el = document.getElementById("agent-status");
    if (el) {
      el.textContent = c.configured ? `متصل · ${c.model}` : "دیبا روتر وصل نیست";
      el.classList.toggle("is-off", !c.configured);
    }
  } catch {
    // وضعیت اتصال اختیاری است
  }
}

function initAgent() {
  if (!state.agent.messages.length) {
    state.agent.messages.push({
      role: "assistant",
      content: "سلام! من دستیار دیبا هستم. درباره‌ی وضعیت پیام‌رسان‌ها، دلیل آماده نبودن یک سرویس، دریافت پیام‌ها، ابزارها یا اتصال MCP بپرسید.",
    });
  }
  renderAgentMessages();
  refreshAgentConfig();

  const dock = document.getElementById("agent-dock");
  const panel = document.getElementById("agent-panel");
  const toggle = document.getElementById("agent-toggle");
  const close = document.getElementById("agent-close");
  const input = document.getElementById("agent-input");
  const form = document.getElementById("agent-form");
  if (!dock || !panel || !form) return;

  const setOpen = (open) => {
    state.agent.open = open;
    panel.hidden = !open;
    dock.classList.toggle("open", open);
    document.querySelector(".shell")?.classList.toggle("with-agent", open);
    toggle.setAttribute("aria-expanded", String(open));
    if (open) setTimeout(() => input?.focus(), 50);
  };
  toggle.onclick = () => setOpen(!state.agent.open);
  close.onclick = () => setOpen(false);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.agent.open) setOpen(false);
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || state.agent.busy) return;
    input.value = "";
    state.agent.messages.push({ role: "user", content: text });
    state.agent.busy = true;
    renderAgentMessages();
    try {
      const r = await api("agent/chat", { body: { messages: state.agent.messages.slice(-20) } });
      state.agent.messages.push({ role: "assistant", content: r.reply || "پاسخی دریافت نشد." });
    } catch (err) {
      const hint = /دیبا روتر|کلید/.test(err.message) ? "\n\nاز تب «دیبا روتر» اتصال را تنظیم کنید." : "";
      state.agent.messages.push({ role: "assistant", content: `⚠️ ${err.message}${hint}` });
    } finally {
      state.agent.busy = false;
      renderAgentMessages();
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  document.getElementById("agent-messages").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-agent-suggest]");
    if (!chip) return;
    input.value = chip.dataset.agentSuggest;
    form.requestSubmit();
  });

  window.addEventListener("dibarouter-config", refreshAgentConfig);
}

// ---------------------------------------------------------------- shell
function renderShell() {
  $app.innerHTML = `
  <div class="shell${state.agent.open ? " with-agent" : ""}">
    <aside class="side">
      <div class="brand">
        <img src="assets/logo-sm.png" alt="دیباپل" class="brand-logo">
        <div class="brand-text">
          <div class="brand-title-row">
            <span class="brand-title">دیباپل</span>
          </div>
          <span class="brand-sub">DibaBridge · MCP</span>
        </div>
      </div>
      <nav class="nav" aria-label="بخش‌ها">
        ${pages.map((p) => `<a href="#/${p.id}" data-page="${p.id}">${icons[p.id]}<span>${p.title}</span></a>`).join("")}
      </nav>
      <div class="side-foot">
        <button class="btn btn-icon btn-quiet" id="theme" title="تغییر تم (روشن / تاریک)" aria-label="تغییر تم">${icons.theme}</button>
            <span class="ver-badge" id="ver"></span>
        <button class="btn btn-icon btn-quiet" id="logout" title="خروج از حساب" aria-label="خروج">${icons.logout}</button>
      </div>
    </aside>
    <main class="main" id="main"></main>
    ${agentDockHtml()}
  </div>`;
  document.getElementById("theme").onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    const next = cur === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("dmcp-theme", next); } catch { }
  };
  document.getElementById("logout").onclick = async () => { await api("auth/logout", { body: {} }); boot(); };
  initAgent();
}

async function render() {
  clearInterval(state.timer);
  const { page, q } = route();
  document.querySelectorAll(".nav a").forEach((a) => (a.dataset.page === page ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  document.title = `${pages.find((p) => p.id === page).title} — Diba Bridge (دیبا پل) | دیباچین`;
  const main = document.getElementById("main");
  try {
    await ({ overview: pageOverview, providers: pageProviders, playground: pagePlayground, inbox: pageInbox, logs: pageLogs, dibarouter: pageDibaRouter, connect: pageConnect })[page](main, q);
  } catch (e) {
    if (!(e instanceof AuthError)) main.innerHTML = `<div class="err-box">${esc(e.message)}</div>`;
  }
  main.focus?.();
}

// ---------------------------------------------------------------- overview
function callRow(l, expandable = false) {
  return `<div class="call${l.ok ? "" : " fail"}" ${expandable ? `role="button" tabindex="0" data-log="${l.id}"` : ""}>
    <span class="dot" aria-label="${l.ok ? "موفق" : "ناموفق"}"></span>
    <span class="tool">${esc(l.tool)}</span>
    ${l.ok ? `<span class="src">${l.source === "mcp" ? "از طرف مدل" : "از داشبورد"}</span>` : `<span class="err" title="${esc(l.error)}">${esc(l.error)}</span>`}
    <span class="meta">${fa(l.ms)} میلی‌ثانیه</span>
    <span class="meta">${ago(l.time)}</span>
  </div>`;
}

async function pageOverview(main) {
  const o = await api("overview");
  const verEl = document.getElementById("ver");
  if (verEl) verEl.textContent = `نسخه ${o.version}`;
  const ready = o.providers.filter((p) => p.ready).length;
  main.innerHTML = `
    ${head("نمای کلی", "وضعیت اتصال، مصرف امروز و آخرین فراخوانی‌ها در یک نگاه.", "داشبورد دیباچین")}
    <section class="ov-grid">
      <div class="ov-status">
        <div class="ov-status-head">
          <div>
            <span class="eyebrow">وضعیت زنده</span>
            <h2>سرویس‌ها</h2>
          </div>
          <span class="pill ${ready === o.providers.length ? "pill-ok" : ready ? "pill-warn" : "pill-off"}">
            ${fa(ready)} از ${fa(o.providers.length)} آماده
          </span>
        </div>
        <div class="ov-provider-list">
          ${o.providers.map((p) => `
            <a class="ov-prov ${p.ready ? "is-ready" : p.enabled ? "is-warn" : "is-off"}" href="#/providers?open=${p.id}">
              <span class="ov-prov-glyph" style="background:${p.color}">${p.glyph}</span>
              <span class="ov-prov-text">
                <b>${esc(p.nameFa)}</b>
                <small>${p.ready ? `${fa(p.toolCount)} ابزار` : p.enabled ? "نیاز به تنظیم" : "خاموش"}</small>
              </span>
              <span class="ov-dot" aria-hidden="true"></span>
            </a>`).join("")}
        </div>
        <div class="ov-status-foot">
          <button class="btn btn-ghost btn-sm" id="netcheck">بررسی دسترسی شبکه</button>
          <a class="link-arrow" href="#/providers">مدیریت سرویس‌ها</a>
        </div>
        <div class="calls ov-net-out" id="net-out" hidden aria-live="polite"></div>
      </div>

      <aside class="ov-insight">
        <div class="ov-metric-grid">
          <div class="ov-metric"><b>${fa(ready)}<small>/${fa(o.providers.length)}</small></b><span>سرویس آماده</span></div>
          <div class="ov-metric"><b>${fa(o.stats.today)}</b><span>فراخوانی امروز</span></div>
          <div class="ov-metric"><b>${o.stats.successRate === null ? "—" : fa(o.stats.successRate) + "٪"}</b><span>نرخ موفقیت</span></div>
          <div class="ov-metric"><b>${o.stats.avgMs === null ? "—" : fa(o.stats.avgMs)}<small>${o.stats.avgMs === null ? "" : "ms"}</small></b><span>میانگین پاسخ</span></div>
        </div>
        <div class="ov-next">
          <span class="ov-kicker">قدم بعدی</span>
          <b>${ready === 0 ? "اولین سرویس را وصل کنید" : "ابزارها را به مدل وصل کنید"}</b>
          <p>${ready === 0 ? "یک پیام‌رسان را روشن کنید تا ابزارهایش در دسترس هوش مصنوعی قرار بگیرد." : "آدرس MCP و توکن اتصال را بردارید و در Claude یا کلاینت MCP ثبت کنید."}</p>
          <div class="ov-next-actions">
            ${ready === 0
      ? `<a class="btn btn-primary" href="#/providers">اتصال سرویس</a><a class="btn btn-ghost" href="#/connect">راهنمای اتصال</a>`
      : `<a class="btn btn-primary" href="#/connect">اتصال به مدل</a><a class="btn btn-ghost" href="#/inbox">${icons.inbox} پیام‌ها</a>`}
          </div>
        </div>
      </aside>
    </section>

    <div class="section-title ov-recent-title">
      <h2>آخرین فراخوانی‌ها</h2>
      <a class="link-arrow" href="#/logs">مشاهده همه گزارش‌ها</a>
    </div>
    <div class="calls">
      ${o.recent.length ? o.recent.slice(0, 5).map((l) => callRow(l)).join("") : `<div class="empty"><b>هنوز ابزاری فراخوانی نشده است</b>از بخش «آزمایش ابزارها» اولین پیام را ارسال کنید.</div>`}
    </div>`;

  document.getElementById("netcheck").onclick = async (e) => {
    const out = document.getElementById("net-out");
    out.hidden = false;
    const r = await busy(e.currentTarget, () => api("netcheck"));
    const via = r.proxy.type === "direct" ? "مستقیم" : `از طریق پراکسی ${r.proxy.type}`;
    out.innerHTML =
      `<div class="call"><span class="dot" style="background:var(--warning)"></span><span>IP خروجی: ${r.egressIp ? `<span class="ltr mono">${esc(r.egressIp)}</span>` : "نامعلوم"}</span><span class="src">${esc(via)}</span><span></span><span></span></div>` +
      r.results.map((x) => `<div class="call${x.reachable ? "" : " fail"}">
        <span class="dot"></span>
        <span><b>${esc(x.name)}</b> <span class="ltr mono" style="color:var(--muted-2);font-size:12px">${esc(x.url)}</span></span>
        ${x.reachable ? `<span class="src">در دسترس (HTTP ${fa(x.status)})</span>` : `<span class="err" title="${esc(x.error)}">${esc(x.error)}</span>`}
        <span class="meta">${fa(x.ms)} میلی‌ثانیه</span><span></span>
      </div>`).join("");
  };
}

// ---------------------------------------------------------------- providers (Accordions with Client & Bot Tabs)
function fieldHtml(p, f) {
  const id = `${p.id}-${f.key}`;
  const locked = f.fromEnv;
  const label = `<label for="${id}">${esc(f.label)}${f.required ? '<span class="req" aria-label="الزامی">*</span>' : ""}${locked ? `<span class="env-badge" title="${esc(f.envName)}">از env</span>` : ""}</label>`;
  const hint = locked ? `<span class="hint">مقدار از متغیر <code class="ltr">${esc(f.envName)}</code> خوانده می‌شود.</span>` : f.help ? `<span class="hint">${esc(f.help)}</span>` : "";
  if (f.type === "boolean") {
    const checked = String(f.value) === "true" ? "checked" : "";
    return `<div class="field"><span class="field-label">${label}</span><div class="check"><label class="switch"><input id="${id}" name="${f.key}" type="checkbox" ${checked} ${locked ? "disabled" : ""}><span></span></label></div>${hint}</div>`;
  }
  if (f.type === "secret") {
    const ph = f.masked || f.placeholder || "";
    const savedHint = f.masked && !locked ? `<span class="hint">توکن ذخیره شده است. برای تغییر، مقدار جدید را وارد کنید.</span>` : hint;
    return `<div class="field">${label}<div class="input-wrap">
      <input id="${id}" name="${f.key}" type="password" class="input ltr-input" placeholder="${esc(ph)}" autocomplete="off" ${locked ? "disabled" : ""}>
      <button type="button" class="btn btn-icon btn-quiet" data-reveal="${id}" aria-label="نمایش توکن">${icons.eye}</button></div>${savedHint}</div>`;
  }
  const pick = f.key === "defaultChatId" && p.receive?.supported && !locked ? `<span class="hint"><a href="#/inbox?p=${p.id}">انتخاب از پیام‌های دریافتی</a></span>` : "";
  return `<div class="field">${label}<input id="${id}" name="${f.key}" class="input ${f.type === "url" || /id$/i.test(f.key) ? "ltr-input" : ""}" value="${esc(f.value)}" placeholder="${esc(f.placeholder || f.default || "")}" ${locked ? "disabled" : ""}>${hint}${pick}</div>`;
}

function authHtml(p) {
  const a = p.auth;
  const phone = p.fields.find((f) => f.key === a.phoneField)?.value || "";
  const logged = a.loggedIn;
  return `<div class="client-auth" data-auth data-id="${p.id}">
    <div class="client-auth-head">
      <div class="client-auth-title">
        <span class="client-auth-icon">${icons.shield}</span>
        <div>
          <b>${esc(a.title)}</b>
          <p class="hint">${esc(a.description)}</p>
        </div>
      </div>
      <span class="pill ${logged ? "pill-ok" : "pill-off"}">${logged ? "وارد شده" : "وارد نشده"}</span>
    </div>
    <div class="auth-step" data-auth-step="phone" ${logged ? "hidden" : ""}>
      <div class="auth-row">
        <input class="input ltr-input" data-auth-phone placeholder="09121234567" value="${esc(phone)}" inputmode="tel" aria-label="شماره تلفن">
        <button class="btn btn-primary" type="button" data-auth-start>ارسال کد ورود</button>
      </div>
      <span class="hint">شماره را به همراه ۰۹ یا +۹۸ وارد کنید. کد تأیید از پیامک یا پیام‌رسان ارسال خواهد شد.</span>
    </div>
    <div class="auth-step" data-auth-step="code" hidden>
      <div class="auth-row">
        <input class="input ltr-input" data-auth-code placeholder="کد تأیید ورود" inputmode="numeric" autocomplete="one-time-code" aria-label="کد ورود">
        <button class="btn btn-primary" type="button" data-auth-verify-code>تأیید کد</button>
        <button class="btn btn-ghost" type="button" data-auth-back>تغییر شماره</button>
      </div>
      <span class="hint" data-auth-code-hint>کد فرستاده شد.</span>
    </div>
    <div class="auth-step" data-auth-step="password" hidden>
      <div class="auth-row">
        <input class="input ltr-input" type="password" data-auth-password placeholder="رمز دومرحله‌ای حساب" autocomplete="current-password" aria-label="رمز دومرحله‌ای">
        <button class="btn btn-primary" type="button" data-auth-verify-password>تأیید رمز</button>
      </div>
      <span class="hint">این حساب دارای تأیید دو مرحله‌ای است. رمز را وارد کنید.</span>
    </div>
    ${logged ? `<div class="prov-actions" style="margin-top:10px"><button class="btn btn-ghost btn-danger" type="button" data-auth-logout>خروج از حساب کاربری</button></div>` : ""}
    <div class="test-out" data-auth-out></div>
  </div>`;
}

function selfTestHtml(r) {
  const icon = { ok: icons.check, fail: icons.cross, skip: icons.dash };
  const label = { ok: "موفق", fail: "ناموفق", skip: "رد شد" };
  const failed = r.steps.filter((x) => x.status === "fail").length;
  return `<div class="st-summary ${r.ok ? "is-ok" : "is-fail"}">
      <b>${r.ok ? "تمامی مراحل با موفقیت سپری شد" : `${fa(failed)} مرحله ناموفق بود`}</b>
      <span>شبکه: ${esc(r.proxy)}</span>
      <button class="btn btn-ghost btn-sm" type="button" data-st-copy>کپی گزارش</button>
    </div>
    <ol class="st-steps">
      ${r.steps.map((x) => `<li class="st-${x.status}">
        <span class="st-icon" role="img" aria-label="${label[x.status]}">${icon[x.status]}</span>
        <div class="st-body">
          <div class="st-title"><b>${esc(x.title)}</b>${x.ms ? `<span class="meta">${fa(x.ms)} میلی‌ثانیه</span>` : ""}</div>
          ${x.detail ? `<div class="st-detail" dir="auto">${esc(x.detail)}</div>` : ""}
          ${x.hint ? `<div class="st-hint">${esc(x.hint)}</div>` : ""}
        </div>
      </li>`).join("")}
    </ol>`;
}

function renderProviderMode(p, role, plat) {
  if (!p) {
    return `<div class="empty"><b>این پیام‌رسان فاقد حالت ${role === "client" ? "حساب کاربری" : "ربات رسمی"} است.</b></div>`;
  }
  const fields = p.auth ? p.fields.filter((f) => f.key !== p.auth.sessionField) : p.fields;
  const isClient = role === "client";
  return `
    <div class="prov-mode-container" data-id="${p.id}">
      <div class="prov-mode-banner">
        <div class="prov-mode-meta">
          <span class="mode-tag ${isClient ? "mode-tag-client" : "mode-tag-bot"}">
            ${isClient ? icons.user : icons.bot}
            ${isClient ? "حساب کاربری (کلاینت)" : "ربات رسمی (Bot API)"}
          </span>
          <p class="prov-mode-desc">
            ${isClient
      ? "اتصال از طریق پروتکل وب؛ ارسال و دریافت دوطرفه پیام‌ها به عنوان کاربر واقعی با دسترسی به مخاطبان و گروه‌ها."
      : "اتصال با توکن اختصاصی BotFather؛ ارسال پیام، محتوای چندرسانه‌ای و دکمه‌های شیشه‌ای برای کسب‌وکار."}
          </p>
        </div>
        <div class="prov-mode-controls">
          ${status(p)}
          <label class="switch" title="${p.enabledFromEnv ? "از env کنترل می‌شود" : "روشن/خاموش کردن این بخش"}">
            <input type="checkbox" data-toggle data-id="${p.id}" ${p.enabled ? "checked" : ""} ${p.enabledFromEnv ? "disabled" : ""} aria-label="روشن کردن ${esc(p.nameFa)}">
            <span></span>
          </label>
        </div>
      </div>

      <div class="prov-inner">
        <div class="prov-left-col">
          ${p.auth ? authHtml(p) : ""}
          <form class="prov-form" data-form data-id="${p.id}">
            ${fields.map((f) => fieldHtml(p, f)).join("")}
            <div class="prov-actions">
              <button class="btn btn-primary" type="submit">ذخیره تنظیمات</button>
              ${p.hasTest ? `<button class="btn btn-ghost" type="button" data-test data-id="${p.id}">تست اتصال</button>` : ""}
              ${p.hasTest ? `<button class="btn btn-ghost" type="button" data-selftest data-id="${p.id}">تست کامل</button>` : ""}
              ${!p.auth && p.fields.some((f) => f.type === "secret" && f.hasValue && !f.fromEnv) ? `<button class="btn btn-quiet btn-danger" type="button" data-clear data-id="${p.id}">حذف توکن</button>` : ""}
            </div>
            <div class="test-out" data-out></div>
          </form>
        </div>

        <div class="prov-tools-col">
          <div class="prov-tools-card">
            <h3>
              <span class="icon-inline">${icons.sparkles}</span>
              ${fa(p.tools.length)} ابزار هوش مصنوعی در اختیار مدل
            </h3>
            <div class="tool-list-compact">
              ${p.tools.map((t) => `<div class="tool-line"><a href="#/playground?tool=${t.name}">${esc(t.title)}</a><code>${esc(t.name)}</code></div>`).join("")}
            </div>
            ${p.docsUrl ? `<div class="prov-docs-link"><a href="${esc(p.docsUrl)}" target="_blank" rel="noopener">${icons.external} مستندات رسمی ${esc(p.nameFa)}</a></div>` : ""}
          </div>
        </div>
      </div>
    </div>`;
}

function platformAccordionHtml(plat) {
  const isOpen = state.openPlatform === plat.key;
  // Default open tab is ALWAYS 'client'
  const activeTab = state.activeTab[plat.key] || "client";
  const hasBoth = Boolean(plat.client && plat.bot);
  const isReady = (plat.client && plat.client.ready) || (plat.bot && plat.bot.ready);

  return `
  <article class="prov-card ${isOpen ? "open" : ""} ${isReady ? "is-ready" : ""}" data-plat="${plat.key}">
    <div class="prov-card-header" data-plat-header="${plat.key}">
      <div class="disc" style="background:${plat.color}">${plat.glyph}</div>
      <div class="prov-info">
        <div class="prov-info-top">
          <b class="prov-name">${esc(plat.nameFa)}</b>
          <span class="en-tag">${esc(plat.nameEn)}</span>
        </div>
        <p class="prov-desc">${esc(plat.description)}</p>
      </div>

      <div class="prov-summary-badges">
        ${plat.client ? `<span class="mode-badge ${plat.client.ready ? "ready" : ""}">کلاینت: ${status(plat.client)}</span>` : ""}
        ${plat.bot ? `<span class="mode-badge ${plat.bot.ready ? "ready" : ""}">ربات: ${status(plat.bot)}</span>` : ""}
      </div>

      <button type="button" class="btn btn-icon btn-quiet prov-toggle-btn" data-plat-expand="${plat.key}" aria-expanded="${isOpen}" aria-label="تنظیمات ${esc(plat.nameFa)}">
        ${icons.chevron}
      </button>
    </div>

    <div class="prov-card-body">
      <div class="prov-card-content">
        ${hasBoth ? `
          <div class="plat-tabs-bar" role="tablist">
            <button type="button" class="plat-tab ${activeTab === "client" ? "active" : ""}" data-plat-tab="client" data-plat="${plat.key}" role="tab" aria-selected="${activeTab === "client"}">
              <span class="plat-tab-icon">${icons.user}</span>
              <span class="plat-tab-title">حساب کاربری (کلاینت)</span>
              ${status(plat.client)}
            </button>
            <button type="button" class="plat-tab ${activeTab === "bot" ? "active" : ""}" data-plat-tab="bot" data-plat="${plat.key}" role="tab" aria-selected="${activeTab === "bot"}">
              <span class="plat-tab-icon">${icons.bot}</span>
              <span class="plat-tab-title">ربات رسمی (Bot API)</span>
              ${status(plat.bot)}
            </button>
          </div>
        ` : ""}

        <div class="plat-panels">
          ${plat.client ? `
            <div class="plat-panel ${activeTab === "client" ? "active" : ""}" data-plat-panel="client" data-plat="${plat.key}">
              ${renderProviderMode(plat.client, "client", plat)}
            </div>
          ` : ""}
          ${plat.bot ? `
            <div class="plat-panel ${activeTab === "bot" ? "active" : ""}" data-plat-panel="bot" data-plat="${plat.key}">
              ${renderProviderMode(plat.bot, "bot", plat)}
            </div>
          ` : ""}
        </div>
      </div>
    </div>
  </article>`;
}

async function pageProviders(main, q) {
  state.providers = await api("providers");
  const platforms = groupProviders(state.providers);

  if (q.get("open")) {
    const target = q.get("open");
    const { platformKey, isClient } = parseProvider({ id: target, auth: target.endsWith("_client") });
    state.openPlatform = platformKey;
    state.activeTab[platformKey] = isClient ? "client" : "bot";
  }

  main.innerHTML = `
    ${head("پیام‌رسان‌ها", "مدیریت حساب‌های کاربری و ربات‌های رسمی پیام‌رسان‌ها در یک آکاردئون یکپارچه. تب کلاینت به‌صورت پیش‌فرض فعال است.", "مدیریت سرویس‌ها")}
    <div class="providers-accordion-list" id="provs">
      ${platforms.map(platformAccordionHtml).join("")}
    </div>`;

  const list = document.getElementById("provs");

  const replace = (p) => {
    state.providers = state.providers.map((x) => (x.id === p.id ? p : x));
    const { platformKey } = parseProvider(p);
    const plat = groupProviders(state.providers).find((x) => x.key === platformKey);
    const oldCard = list.querySelector(`[data-plat="${platformKey}"]`);
    if (oldCard && plat) {
      oldCard.outerHTML = platformAccordionHtml(plat);
    }
  };

  list.addEventListener("click", async (e) => {
    // 1. Accordion Header Click or Chevron
    const header = e.target.closest("[data-plat-header]");
    if (header && !e.target.closest("input, button.plat-tab, a, .switch")) {
      const platKey = header.dataset.platHeader;
      state.openPlatform = state.openPlatform === platKey ? null : platKey;
      list.querySelectorAll(".prov-card").forEach((card) => {
        const isOpen = card.dataset.plat === state.openPlatform;
        card.classList.toggle("open", isOpen);
        const btn = card.querySelector(".prov-toggle-btn");
        if (btn) btn.setAttribute("aria-expanded", isOpen);
      });
      return;
    }

    // 2. Tab switching inside platform accordion (Client vs Bot)
    const tabBtn = e.target.closest("[data-plat-tab]");
    if (tabBtn) {
      const platKey = tabBtn.dataset.plat;
      const tabName = tabBtn.dataset.platTab;
      state.activeTab[platKey] = tabName;
      const card = list.querySelector(`[data-plat="${platKey}"]`);
      if (card) {
        card.querySelectorAll("[data-plat-tab]").forEach((btn) => {
          const isActive = btn.dataset.platTab === tabName;
          btn.classList.toggle("active", isActive);
          btn.setAttribute("aria-selected", isActive);
        });
        card.querySelectorAll("[data-plat-panel]").forEach((panel) => {
          panel.classList.toggle("active", panel.dataset.platPanel === tabName);
        });
      }
      return;
    }

    // 3. Eye reveal for secrets
    const reveal = e.target.closest("[data-reveal]");
    if (reveal) {
      const inp = document.getElementById(reveal.dataset.reveal);
      if (inp) inp.type = inp.type === "password" ? "text" : "password";
      return;
    }

    // 4. Test connection
    const testBtn = e.target.closest("[data-test]");
    if (testBtn) {
      const id = testBtn.dataset.id;
      const container = testBtn.closest(".prov-mode-container");
      const out = container.querySelector("[data-out]");
      const r = await busy(testBtn, () => api(`providers/${id}/test`, { body: {} }));
      out.innerHTML = r.ok
        ? `<div class="result-head"><span class="pill pill-ok">اتصال برقرار است</span><span class="meta">${fa(r.ms)} میلی‌ثانیه</span></div><pre class="json">${jsonHtml(r.result)}</pre>`
        : `<div class="err-box">${esc(r.error)}</div>`;
      return;
    }

    // 5. Self-test init
    const selftestBtn = e.target.closest("[data-selftest]");
    if (selftestBtn) {
      const id = selftestBtn.dataset.id;
      const p = state.providers.find((x) => x.id === id);
      const container = selftestBtn.closest(".prov-mode-container");
      const out = container.querySelector("[data-out]");
      const def = p.fields.find((f) => f.key === "defaultChatId")?.value || "";
      out.innerHTML = `<div class="selftest">
        <div class="st-head"><b>تست کامل ${esc(p.nameFa)}</b><span class="hint">بررسی سلامت شبکه، توکن، چت، ارسال و دریافت به صورت گام‌به‌گام.</span></div>
        <div class="st-opts">
          <label class="st-send"><span class="switch"><input type="checkbox" data-st-send><span></span></span>ارسال پیام و تصویر آزمایشی</label>
          <input class="input ltr-input" data-st-chat placeholder="${esc(def ? `${def} (پیش‌فرض)` : "chat_id مقصد")}" aria-label="چت مقصد">
          <button class="btn btn-primary" type="button" data-st-run data-id="${id}">اجرای تست جامع</button>
        </div>
        <div data-st-out></div>
      </div>`;
      out.querySelector("[data-st-run]").focus();
      return;
    }

    // 6. Run self-test
    const runBtn = e.target.closest("[data-st-run]");
    if (runBtn) {
      const id = runBtn.dataset.id;
      const box = runBtn.closest(".selftest");
      const stOut = box.querySelector("[data-st-out]");
      const send = box.querySelector("[data-st-send]").checked;
      const chatId = box.querySelector("[data-st-chat]").value.trim();
      stOut.innerHTML = `<div class="st-running"><span class="boot-dot"></span>در حال اجرای بررسی‌ها… این فرایند ممکن است تا یک دقیقه زمان ببرد.</div>`;
      try {
        const r = await busy(runBtn, () => api(`providers/${id}/selftest`, { body: { send, chatId: chatId || undefined } }));
        stOut.innerHTML = selfTestHtml(r);
        stOut.querySelector("[data-st-copy]").onclick = () => copy(r.text);
      } catch (ex) {
        stOut.innerHTML = `<div class="err-box">${esc(ex.message)}</div>`;
      }
      return;
    }

    // 7. Clear token
    const clearBtn = e.target.closest("[data-clear]");
    if (clearBtn) {
      const id = clearBtn.dataset.id;
      const p = state.providers.find((x) => x.id === id);
      if (confirm(`آیا توکن ذخیره‌شده برای ${p.nameFa} حذف شود؟ ارتباط هوش مصنوعی با این بخش قطع خواهد شد.`)) {
        const keys = p.fields.filter((f) => f.type === "secret").map((f) => f.key);
        replace(await api(`providers/${id}`, { method: "PUT", body: { values: { __clear: keys } } }));
        toast("توکن با موفقیت حذف شد");
      }
      return;
    }

    // 8. Auth flow for unofficial clients
    const authBox = e.target.closest("[data-auth]");
    if (!authBox) return;
    const authId = authBox.dataset.id;
    const p = state.providers.find((x) => x.id === authId);
    const authOut = authBox.querySelector("[data-auth-out]");
    const showStep = (step) => {
      authBox.querySelectorAll("[data-auth-step]").forEach((el) => (el.hidden = el.dataset.authStep !== step));
    };
    const authFail = (msg) => {
      authOut.innerHTML = `<div class="err-box">${esc(msg)}</div>`;
    };
    const refreshAuth = async () => {
      state.providers = await api("providers");
      const updated = state.providers.find((x) => x.id === authId);
      if (updated) replace(updated);
    };

    if (e.target.closest("[data-auth-start]")) {
      const phone = authBox.querySelector("[data-auth-phone]").value.trim();
      authOut.innerHTML = "";
      try {
        const r = await busy(e.target.closest("[data-auth-start]"), () => api(`providers/${authId}/auth/start`, { body: { phone } }));
        if (!r.ok) return authFail(r.error);
        state.authTx[authId] = r.result.transactionHash;
        if (r.result.step === "password") {
          showStep("password");
          authBox.querySelector("[data-auth-password]").focus();
          return;
        }
        showStep("code");
        authBox.querySelector("[data-auth-code-hint]").textContent = r.result.hint || "کد فرستاده شد.";
        authBox.querySelector("[data-auth-code]").focus();
      } catch (ex) {
        authFail(ex.message);
      }
    }

    if (e.target.closest("[data-auth-back]")) {
      delete state.authTx[authId];
      authOut.innerHTML = "";
      showStep("phone");
    }

    if (e.target.closest("[data-auth-verify-code]")) {
      const code = authBox.querySelector("[data-auth-code]").value.trim();
      authOut.innerHTML = "";
      try {
        const r = await busy(e.target.closest("[data-auth-verify-code]"), () =>
          api(`providers/${authId}/auth/code`, { body: { transactionHash: state.authTx[authId], code } }),
        );
        if (!r.ok) return authFail(r.error);
        if (r.result.step === "password") {
          showStep("password");
          authBox.querySelector("[data-auth-password]").focus();
          return;
        }
        delete state.authTx[authId];
        await refreshAuth();
        toast(`ورود به حساب ${p.nameFa} با موفقیت انجام شد`);
      } catch (ex) {
        authFail(ex.message);
      }
    }

    if (e.target.closest("[data-auth-verify-password]")) {
      const password = authBox.querySelector("[data-auth-password]").value;
      authOut.innerHTML = "";
      try {
        const r = await busy(e.target.closest("[data-auth-verify-password]"), () =>
          api(`providers/${authId}/auth/password`, { body: { transactionHash: state.authTx[authId], password } }),
        );
        if (!r.ok) return authFail(r.error);
        if (r.result.step === "code") {
          state.authTx[authId] = r.result.transactionHash || state.authTx[authId];
          showStep("code");
          authBox.querySelector("[data-auth-code-hint]").textContent = r.result.hint || "کد فرستاده شد.";
          authBox.querySelector("[data-auth-code]").focus();
          return;
        }
        delete state.authTx[authId];
        await refreshAuth();
        toast(`ورود به حساب ${p.nameFa} با موفقیت انجام شد`);
      } catch (ex) {
        authFail(ex.message);
      }
    }

    if (e.target.closest("[data-auth-logout]") && confirm(`آیا از حساب کاربری ${p.nameFa} خارج می‌شوید؟ ابزارهای این بخش تا ورود مجدد غیرفعال خواهند شد.`)) {
      try {
        const r = await api(`providers/${authId}/auth/logout`, { body: {} });
        if (!r.ok) return authFail(r.error);
        await refreshAuth();
        toast(`از حساب ${p.nameFa} خارج شدید`);
      } catch (ex) {
        authFail(ex.message);
      }
    }
  });

  list.addEventListener("change", async (e) => {
    if (!e.target.matches("[data-toggle]")) return;
    const input = e.target;
    const id = input.dataset.id;
    if (input.dataset.busy === "1") return;
    input.dataset.busy = "1";
    input.disabled = true;
    try {
      const p = await api(`providers/${id}`, { method: "PUT", body: { enabled: input.checked } });
      replace(p);
      toast(p.enabled ? (p.ready ? `${p.nameFa} روشن شد و آماده کار است` : `${p.nameFa} روشن شد؛ تنظیمات را تکمیل کنید`) : `${p.nameFa} خاموش شد`);
    } catch (ex) {
      input.checked = !input.checked;
      toast(ex.message, true);
    } finally {
      delete input.dataset.busy;
      input.disabled = false;
    }
  });

  list.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target.closest("[data-form]");
    if (!form) return;
    const id = form.dataset.id;
    const values = {};
    form.querySelectorAll("input[name]:not(:disabled)").forEach((i) => {
      values[i.name] = i.type === "checkbox" ? (i.checked ? "true" : "false") : i.value.trim();
    });
    try {
      const p = await busy(form.querySelector("[type=submit]"), () => api(`providers/${id}`, { method: "PUT", body: { values } }));
      replace(p);
      toast(p.ready ? `تنظیمات ${p.nameFa} ذخیره شد و آماده استفاده است` : p.enabled ? `تنظیمات ذخیره شد اما هنوز کامل نیست` : `تنظیمات ذخیره شد؛ برای استفاده روشنش کنید`);
    } catch (ex) {
      toast(ex.message, true);
    }
  });
}

// ---------------------------------------------------------------- playground
function inputFor(name, prop, required, p) {
  const id = `arg-${name}`;
  const desc = prop.description ? `<span class="hint ltr" style="display:block;text-align:right">${esc(prop.description)}</span>` : "";
  const label = `<label for="${id}"><span class="ltr mono">${esc(name)}</span>${required ? '<span class="req">*</span>' : ""}</label>`;
  const type = prop.type || prop.anyOf?.[0]?.type;
  if (prop["x-media"]) return mediaInput(id, name, label, prop["x-media"], prop.description);
  if (type === "boolean")
    return `<div class="field"><span class="field-label">${label}</span><div class="check"><label class="switch"><input type="checkbox" id="${id}" data-arg="${name}" data-type="boolean" ${prop.default === true ? "checked" : ""}><span></span></label></div>${desc}</div>`;
  if (type === "number" || type === "integer")
    return `<div class="field">${label}<input id="${id}" class="input ltr-input" type="number" step="${type === "integer" ? 1 : "any"}" data-arg="${name}" data-type="number" ${prop.minimum !== undefined ? `min="${prop.minimum}"` : ""} ${prop.maximum !== undefined ? `max="${prop.maximum}"` : ""}>${desc}</div>`;
  const long = ["text", "caption"].includes(name);
  const defChat = name === "chat_id" ? p.fields.find((f) => f.key === "defaultChatId")?.value : "";
  const ph = defChat ? `${defChat} (پیش‌فرض)` : "";
  return long
    ? `<div class="field wide">${label}<textarea id="${id}" class="textarea" data-arg="${name}" dir="auto"></textarea>${desc}</div>`
    : `<div class="field">${label}<input id="${id}" class="input${/(_id|url|photo)$/.test(name) ? " ltr-input" : ""}" dir="auto" data-arg="${name}" placeholder="${esc(ph)}">${desc}</div>`;
}

const MAX_UPLOAD = 20 * 1024 * 1024;
const humanSize = (n) => (n < 1024 * 1024 ? `${fa(Math.max(1, Math.round(n / 1024)))} کیلوبایت` : `${fa((n / 1048576).toFixed(1))} مگابایت`);

function mediaInput(id, name, label, kind, description) {
  const isImage = kind === "image";
  return `<div class="field wide">${label}
    <div class="media-box" data-media="${kind}">
      <div class="media-preview" aria-hidden="true">${isImage ? icons.image : icons.file}</div>
      <div class="media-body">
        <div class="media-row">
          <input id="${id}" class="input ltr-input" data-arg="${name}" data-type="media" placeholder="https://…  یا  شناسه فایل" autocomplete="off">
          <button type="button" class="btn btn-ghost" data-pick>${isImage ? "انتخاب عکس" : "انتخاب فایل"}</button>
          <button type="button" class="btn btn-icon btn-quiet" data-clear-media hidden aria-label="حذف فایل">✕</button>
        </div>
        <span class="hint">آدرس اینترنتی وارد کنید یا فایل را بکشید و در صفحه رها کنید${isImage ? " (پشتیبانی از Ctrl+V)" : ""}. حداکثر ۲۰ مگابایت.</span>
      </div>
      <input type="file" hidden data-file ${isImage ? 'accept="image/*"' : ""}>
    </div>
  </div>`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:([^;,]*)/, (m, mime) => `data:${mime || "application/octet-stream"};name=${encodeURIComponent(file.name)}`));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function bindMediaFields(root) {
  root.querySelectorAll(".media-box").forEach((box) => {
    const input = box.querySelector("[data-arg]");
    const picker = box.querySelector("[data-file]");
    const preview = box.querySelector(".media-preview");
    const clearBtn = box.querySelector("[data-clear-media]");
    const isImage = box.dataset.media === "image";
    let objectUrl = null;

    const showIcon = () => { preview.innerHTML = isImage ? icons.image : icons.file; preview.classList.remove("has-img"); };
    const showImg = (src) => {
      const img = new Image();
      img.alt = "";
      img.onload = () => { preview.replaceChildren(img); preview.classList.add("has-img"); };
      img.onerror = showIcon;
      img.src = src;
    };
    const reset = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
      delete input.dataset.dataUrl;
      input.readOnly = false;
      input.value = "";
      input.classList.add("ltr-input");
      clearBtn.hidden = true;
      showIcon();
    };
    const useFile = async (file) => {
      if (!file) return;
      if (file.size > MAX_UPLOAD) return toast(`حجم «${file.name}» بیشتر از ۲۰ مگابایت است`, true);
      if (isImage && !file.type.startsWith("image/")) return toast("این فایل تصویر معتبر نیست", true);
      reset();
      input.dataset.dataUrl = await fileToDataUrl(file);
      input.value = `${file.name} — ${humanSize(file.size)}`;
      input.readOnly = true;
      input.classList.remove("ltr-input");
      clearBtn.hidden = false;
      if (file.type.startsWith("image/")) showImg((objectUrl = URL.createObjectURL(file)));
      else showIcon();
    };

    box.querySelector("[data-pick]").onclick = () => picker.click();
    picker.onchange = () => { useFile(picker.files[0]); picker.value = ""; };
    clearBtn.onclick = () => { reset(); input.focus(); };
    input.addEventListener("input", () => {
      const v = input.value.trim();
      if (isImage && /^https?:\/\/\S+$/i.test(v)) showImg(v);
      else showIcon();
    });
    box._useFile = useFile;
    box._useUrl = (url) => { reset(); input.value = url.trim(); input.dispatchEvent(new Event("input")); };
  });
}

const draggingFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
let dragDepth = 0;
const endDrag = () => { dragDepth = 0; document.body.classList.remove("file-drag"); };
window.addEventListener("dragenter", (e) => {
  if (!draggingFiles(e)) return;
  dragDepth++;
  document.body.classList.add("file-drag");
});
window.addEventListener("dragleave", (e) => {
  if (!draggingFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) endDrag();
});
window.addEventListener("dragover", (e) => {
  if (draggingFiles(e) || e.target.closest?.(".media-box")) {
    e.preventDefault();
    e.dataTransfer.dropEffect = document.querySelector(".media-box") ? "copy" : "none";
  }
});
window.addEventListener("drop", (e) => {
  endDrag();
  const box = e.target.closest?.(".media-box") ?? document.querySelector(".media-box");
  const file = e.dataTransfer?.files?.[0];
  if (file) {
    e.preventDefault();
    if (box?._useFile) box._useFile(file);
    else toast("برای ارسال فایل ابتدا در بخش «آزمایش ابزارها» یک ابزار ارسال فایل یا عکس را باز کنید", true);
    return;
  }
  if (e.target.closest?.(".media-box") && box?._useUrl) {
    const url = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (url && /^https?:\/\//i.test(url.trim())) { e.preventDefault(); box._useUrl(url); }
  }
});
document.addEventListener("dragend", endDrag);

document.addEventListener("paste", (e) => {
  const box = document.querySelector('.media-box[data-media="image"]') ?? document.querySelector(".media-box");
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === "file");
  if (!box?._useFile || !item) return;
  if (box.dataset.media === "image" && !item.type.startsWith("image/")) return;
  e.preventDefault();
  const f = item.getAsFile();
  const generic = !f.name || /^image\.\w+$/.test(f.name);
  box._useFile(generic ? new File([f], `clipboard-${Date.now()}.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: f.type }) : f);
});

function shortenDataUrls(args) {
  return Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === "string" && v.startsWith("data:") ? `${v.slice(0, v.indexOf(","))},… (${humanSize(v.length * 0.75)})` : v]));
}

async function pagePlayground(main, q) {
  state.providers = await api("providers");
  const all = state.providers.flatMap((p) => p.tools.map((t) => ({ ...t, p })));
  const selected = all.find((t) => t.name === q.get("tool")) ?? all.find((t) => t.p.ready) ?? all[0];
  main.innerHTML = `${head("آزمایش ابزارها", "اجرای مستقیم ابزارهای MCP توسط مدل‌های هوش مصنوعی با بازخورد و پاسخ زنده سرور.", "محیط آزمایش")}
    <div class="play">
      <nav class="tool-list" aria-label="فهرست ابزارها">
        ${state.providers.map((p) => `
          <div class="tool-group"><i style="background:${p.color}"></i>${esc(p.nameFa)}${status(p)}</div>
          ${p.tools.map((t) => `<button class="tool-btn" data-tool="${t.name}" aria-pressed="${t.name === selected?.name}">${esc(t.title)}<small>${esc(t.name)}</small></button>`).join("")}`).join("")}
      </nav>
      <div id="tool-pane"></div>
    </div>`;

  main.querySelector(".tool-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tool]");
    if (b) history.replaceState(null, "", `#/playground?tool=${b.dataset.tool}`), pagePlayground(main, new URLSearchParams(`tool=${b.dataset.tool}`));
  });
  if (!selected) return;

  const t = selected, p = t.p;
  const props = t.schema.properties || {};
  const req = t.schema.required || [];
  const pane = document.getElementById("tool-pane");
  pane.innerHTML = `
    <section class="panel">
      <div class="result-head"><h2>${esc(t.title)}</h2>${t.annotations.readOnlyHint ? '<span class="pill pill-off">فقط خواندنی</span>' : '<span class="pill pill-warn">ارسال واقعی</span>'}</div>
      <p class="desc">${esc(t.description)}</p>
      ${p.ready ? "" : `<div class="err-box" style="margin-bottom:18px">${esc(p.nameFa)} هنوز آماده نیست. <a href="#/providers?open=${p.id}">توکن را ثبت و روشنش کنید</a>.</div>`}
      <form id="tool-form">
        <div class="tool-form">${Object.keys(props).length ? Object.entries(props).map(([k, v]) => inputFor(k, v, req.includes(k), p)).join("") : '<p class="hint wide">این ابزار پارامتر ورودی ندارد.</p>'}</div>
        <div class="prov-actions" style="margin-top:20px">
          <button class="btn btn-primary" type="submit" ${p.ready ? "" : "disabled"}>اجرای ابزار</button>
          <button class="btn btn-ghost" type="button" id="show-args">مشاهده ساختار JSON</button>
        </div>
      </form>
    </section>
    <section class="panel" id="result" hidden></section>`;

  const collect = () => {
    const args = {};
    pane.querySelectorAll("[data-arg]").forEach((el) => {
      const k = el.dataset.arg;
      if (el.dataset.type === "boolean") { args[k] = Boolean(el.checked); return; }
      if (el.dataset.type === "media" && el.dataset.dataUrl) { args[k] = el.dataset.dataUrl; return; }
      const v = el.value.trim();
      if (v === "") return;
      args[k] = el.dataset.type === "number" ? Number(v) : v;
    });
    return args;
  };
  const result = document.getElementById("result");
  document.getElementById("show-args").onclick = () => {
    result.hidden = false;
    result.innerHTML = `<div class="result-head"><h2>ورودی ارسال‌شده به ابزار</h2></div><pre class="json">${jsonHtml(shortenDataUrls(collect()))}</pre>`;
  };
  bindMediaFields(pane);
  document.getElementById("tool-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("[type=submit]");
    if (!t.annotations.readOnlyHint && !confirm(`این ابزار پیام واقعی به حساب ${p.nameFa} ارسال خواهد کرد. آیا مایل به ادامه هستید؟`)) return;
    const r = await busy(btn, () => api(`tools/${t.name}/call`, { body: { args: collect() } }));
    result.hidden = false;
    result.innerHTML = `<div class="result-head"><h2>نتیجه بازگشتی از سرویس</h2>${r.ok ? '<span class="pill pill-ok">موفق</span>' : '<span class="pill pill-err">ناموفق</span>'}<span class="meta">${fa(r.ms)} میلی‌ثانیه</span></div>
      ${r.ok ? `<pre class="json">${jsonHtml(r.result)}</pre>` : `<div class="err-box">${esc(r.error)}</div>`}`;
    result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

// ---------------------------------------------------------------- inbox
const chatTypeFa = { private: "خصوصی", group: "گروه", channel: "کانال", unknown: "" };
const kindFa = { photo: "تصویر", file: "فایل", video: "ویدیو", voice: "صدا", location: "موقعیت", button: "کلیک دکمه", other: "" };

function receiverHtml(p, st) {
  if (!p) return "";
  if (!st.supported)
    return `<div class="rcv off"><div class="disc sm" style="background:${p.color}">${p.glyph}</div><div class="rcv-body"><b>${esc(p.nameFa)}</b><span class="hint">ایتایار فقط ارسال پیام دارد؛ دریافت در نسخه کلاینت پشتیبانی می‌شود.</span></div></div>`;
  const ready = p.ready;
  let pill, info = "";
  if (!ready) { pill = `<span class="pill pill-off">${p.auth ? "وارد نشده" : "توکن ثبت نشده"}</span>`; info = `<a href="#/providers?open=${p.id}">${p.auth ? "ورود به حساب" : "ثبت توکن"}</a>`; }
  else if (st.lastError) { pill = '<span class="pill pill-err">خطا در دریافت</span>'; info = `<span class="err" title="${esc(st.lastError)}">${esc(st.lastError)}</span>`; }
  else if (st.running) { pill = '<span class="pill pill-ok">در حال دریافت</span>'; info = st.lastPollAt ? `آخرین بررسی ${ago(st.lastPollAt)}` : "در حال اتصال به سرور…"; }
  else pill = '<span class="pill pill-off">خاموش</span>';
  const webhook = /webhook/i.test(st.lastError || "");
  return `<div class="rcv${st.lastError ? " has-err" : ""}" data-rcv="${p.id}">
    <div class="disc sm" style="background:${p.color}">${p.glyph}</div>
    <div class="rcv-body">
      <div class="rcv-top"><b>${esc(p.nameFa)}</b>${pill}</div>
      <span class="hint">${info}</span>
      ${st.hint ? `<span class="st-hint">${esc(st.hint)}</span>` : ""}
    </div>
    <div class="rcv-actions">
      ${webhook ? `<button class="btn btn-ghost btn-danger btn-sm" data-action="deleteWebhook">حذف وبهوک</button>` : ""}
      <button class="btn btn-ghost btn-sm" data-fetch ${ready ? "" : "disabled"}>بررسی الان</button>
      <label class="switch" title="دریافت خودکار پیام‌ها"><input type="checkbox" data-receive ${st.enabled ? "checked" : ""} ${ready && !p.receive.fromEnv ? "" : "disabled"} aria-label="دریافت خودکار ${esc(p.nameFa)}"><span></span></label>
    </div>
  </div>`;
}

async function pageInbox(main, q) {
  state.providers = await api("providers");
  const sel = { p: q.get("p") || "", c: q.get("c") || "" };
  let data = { statuses: [], chats: [], messages: [] };
  let lastSig = "";

  main.innerHTML = `${head("پیام‌های دریافتی", "گفتگوهای زنده ربات‌ها و حساب‌های کاربری متصل به هوش مصنوعی. شناسایی شناسه چت و ارسال پاسخ مستقیم.", "صندوق پیام‌ها")}
    <section class="receivers" id="rcv"></section>
    <p class="note rcv-note">«دریافت خودکار» به طور مداوم پیام‌ها را همگام می‌کند تا ابزار get_updates در دسترس مدل قرار گیرد.</p>
    <section class="inbox">
      <nav class="chat-list" id="chats" aria-label="چت‌ها"></nav>
      <div class="convo" id="convo"></div>
    </section>`;

  const provOf = (id) => state.providers.find((x) => x.id === id);
  const defaultChat = (id) => provOf(id)?.fields.find((f) => f.key === "defaultChatId")?.value || "";

  const drawReceivers = () => {
    document.getElementById("rcv").innerHTML = data.statuses.map((st) => receiverHtml(provOf(st.provider), st)).join("");
  };

  const drawChats = () => {
    const el = document.getElementById("chats");
    if (!data.chats.length) {
      el.innerHTML = `<div class="empty"><b>پیامی دریافت نشده است</b>دریافت خودکار را روشن کنید یا «بررسی الان» را انتخاب نمایید.</div>`;
      return;
    }
    el.innerHTML = data.chats.map((c) => {
      const p = provOf(c.provider);
      const active = c.provider === sel.p && c.chatId === sel.c;
      const isDef = defaultChat(c.provider) === c.chatId;
      return `<button class="chat-item" data-p="${c.provider}" data-c="${esc(c.chatId)}" aria-current="${active}">
        <span class="disc xs" style="background:${p?.color || "var(--brand)"}">${p?.glyph || "•"}</span>
        <span class="ci-body">
          <span class="ci-top"><b dir="auto">${esc(c.title || c.chatId)}</b><span class="meta">${ago(c.lastDate)}</span></span>
          <span class="ci-sub">${c.lastDirection === "out" ? '<span class="ci-you">شما: </span>' : ""}<span dir="auto">${esc(kindFa[c.lastText] ?? c.lastText ?? "—")}</span></span>
          <span class="ci-tags">${chatTypeFa[c.type] ? `<i>${chatTypeFa[c.type]}</i>` : ""}${isDef ? "<i class='def'>پیش‌فرض</i>" : ""}<i>${fa(c.count)} پیام</i></span>
        </span>
      </button>`;
    }).join("");
  };

  const drawConvo = () => {
    const el = document.getElementById("convo");
    const chat = data.chats.find((c) => c.provider === sel.p && c.chatId === sel.c);
    if (!chat) {
      el.innerHTML = `<div class="empty convo-empty">${icons.inbox}<b>یک گفتگو را انتخاب کنید</b>پیام‌های دریافتی، شناسه چت و ارسال پاسخ مستقیم در این بخش نمایش داده می‌شوند.</div>`;
      return;
    }
    const p = provOf(chat.provider);
    const isDef = defaultChat(chat.provider) === chat.chatId;
    const keepDraft = el.querySelector("[data-draft]")?.value ?? "";
    el.innerHTML = `
      <header class="convo-head">
        <div><b dir="auto">${esc(chat.title || chat.chatId)}</b>
          <div class="convo-id"><span class="meta">${esc(p?.nameFa || "")}${chatTypeFa[chat.type] ? ` · ${chatTypeFa[chat.type]}` : ""} · شناسه چت:</span>
          <code class="ltr">${esc(chat.chatId)}</code><button class="btn btn-quiet btn-sm" data-copy-id>کپی</button></div>
        </div>
        ${isDef ? `<span class="pill pill-ok">چت پیش‌فرض ${esc(p?.nameFa || "")}</span>` : `<button class="btn btn-ghost btn-sm" data-set-default>تنظیم به عنوان چت پیش‌فرض</button>`}
      </header>
      <ol class="msgs" id="msgs">
        ${data.messages.slice().reverse().map((m) => {
      const out = m.direction === "out";
      const time = new Date(m.date).toLocaleString("fa-IR", { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" });
      const who = out
        ? m.source === "account"
          ? `<b>شما</b><span>از طریق حساب کاربر</span>`
          : `<b>ربات</b><span>${m.source === "mcp" ? "از طرف هوش مصنوعی" : "از داشبورد"}</span>`
        : `${m.from?.name ? `<b dir="auto">${esc(m.from.name)}</b>` : ""}${m.from?.username ? `<span class="ltr">@${esc(m.from.username)}</span>` : ""}`;
      const img = out && m.kind === "photo" && m.mediaUrl ? `<img class="msg-img" src="${esc(m.mediaUrl)}" alt="" loading="lazy" onerror="this.remove()">` : "";
      return `<li class="msg${out ? " out" : ""}">
            <div class="msg-meta">${who}<span>${time}</span></div>
            ${img}
            ${kindFa[m.kind] ? `<span class="msg-kind">${kindFa[m.kind]}${m.buttonId ? `: <code class="ltr">${esc(m.buttonId)}</code>` : ""}</span>` : ""}
            ${m.text ? `<p dir="auto">${esc(m.text)}</p>` : ""}
          </li>`;
    }).join("")}
      </ol>
      <form class="composer" data-reply>
        <textarea class="textarea" data-draft rows="2" dir="auto" placeholder="پاسخ مستقیم به ${esc(chat.title || chat.chatId)}…" aria-label="متن جواب"></textarea>
        <button class="btn btn-primary" type="submit" ${p?.ready ? "" : "disabled"}>${icons.send}ارسال پیام</button>
      </form>`;
    el.querySelector("[data-draft]").value = keepDraft;
    const list = document.getElementById("msgs");
    list.scrollTop = list.scrollHeight;
  };

  const load = async (force = false) => {
    const qs = sel.p && sel.c ? `?provider=${encodeURIComponent(sel.p)}&chat=${encodeURIComponent(sel.c)}` : "";
    data = await api(`inbox${qs}`);
    const sig = JSON.stringify([data.statuses.map((s) => [s.enabled, s.running, s.lastError, s.received, s.lastPollAt && ago(s.lastPollAt)]), data.chats.map((c) => c.lastDate + c.count), data.messages.length, data.messages[0]?.key, sel]);
    if (force || sig !== lastSig) {
      // اگر کاربر روی یک سوییچ فوکوس دارد، بازسازی DOM کلیکش را از بین می‌برد؛
      // ولی بعد از یک تغییر عمدی (force) باید وضعیت تازه کشیده شود.
      if (force || !document.activeElement?.closest?.("[data-receive]")) drawReceivers();
      drawChats();
      drawConvo();
    }
    lastSig = sig;
  };
  await load(true);
  state.timer = setInterval(() => { if (!document.hidden) load().catch(() => { }); }, 4000);

  main.addEventListener("click", async (e) => {
    const item = e.target.closest(".chat-item");
    if (item) {
      sel.p = item.dataset.p; sel.c = item.dataset.c;
      history.replaceState(null, "", `#/inbox?p=${sel.p}&c=${encodeURIComponent(sel.c)}`);
      await load(true);
      return;
    }
    const rcv = e.target.closest("[data-rcv]");
    if (rcv && e.target.closest("[data-fetch]")) {
      const r = await busy(e.target.closest("[data-fetch]"), () => api(`inbox/${rcv.dataset.rcv}/fetch`, { body: {} }));
      r.ok ? toast(r.added ? `${fa(r.added)} پیام جدید دریافت شد` : "پیام جدیدی وجود نداشت") : toast(r.error, true);
      return load(true);
    }
    const act = e.target.closest("[data-action]");
    if (rcv && act) {
      const r = await busy(act, () => api(`providers/${rcv.dataset.rcv}/actions/${act.dataset.action}`, { body: {} }));
      r.ok ? toast("وبهوک حذف شد؛ دریافت پیام مجدداً بررسی می‌شود") : toast(r.error, true);
      return load(true);
    }
    if (e.target.closest("[data-copy-id]")) return copy(sel.c);
    if (e.target.closest("[data-set-default]")) {
      const updated = await api(`providers/${sel.p}`, { method: "PUT", body: { values: { defaultChatId: sel.c } } });
      state.providers = state.providers.map((x) => (x.id === updated.id ? updated : x));
      toast(`چت پیش‌فرض ${updated.nameFa} با موفقیت تنظیم شد`);
      return load(true);
    }
  });

  main.addEventListener("change", async (e) => {
    const sw = e.target.closest("[data-receive]");
    if (!sw) return;
    const id = sw.closest("[data-rcv]").dataset.rcv;
    if (sw.dataset.busy === "1") return;
    sw.dataset.busy = "1";
    sw.disabled = true;
    try {
      await api(`inbox/${id}/receive`, { body: { enabled: sw.checked } });
      toast(sw.checked ? `دریافت خودکار ${provOf(id)?.nameFa} فعال شد` : `دریافت خودکار ${provOf(id)?.nameFa} غیرفعال شد`);
    } catch (ex) {
      sw.checked = !sw.checked;
      sw.disabled = false;
      delete sw.dataset.busy;
      toast(ex.message, true);
      return;
    }
    setTimeout(() => load(true).catch(() => {
      sw.disabled = false;
      delete sw.dataset.busy;
    }), 600);
  });

  main.addEventListener("submit", async (e) => {
    const form = e.target.closest("[data-reply]");
    if (!form) return;
    e.preventDefault();
    const draft = form.querySelector("[data-draft]");
    const text = draft.value.trim();
    if (!text) return draft.focus();
    const r = await busy(form.querySelector("[type=submit]"), () => api(`tools/${sel.p}_send_message/call`, { body: { args: { chat_id: sel.c, text } } }));
    if (r.ok) { draft.value = ""; await load(true); } else toast(r.error, true);
  });
  main.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.target.matches("[data-draft]")) e.target.closest("form").requestSubmit();
  });
}

// ---------------------------------------------------------------- logs
async function pageLogs(main) {
  if (!state.providers.length) state.providers = await api("providers");
  main.innerHTML = `${head("گزارش فراخوانی‌ها", "گزارش کامل ۳۰۰ فراخوانی اخیر مدل‌های هوش مصنوعی و داشبورد به تفکیک پیام‌رسان و وضعیت.", "رویدادها و لاگ‌ها",
    `<div class="toolbar" style="margin:0">
      <button class="btn btn-icon btn-ghost" id="reload" aria-label="به‌روزرسانی">${icons.refresh}</button>
      <button class="btn btn-ghost btn-danger btn-sm" id="clear">پاک کردن گزارش‌ها</button>
    </div>`)}
    <div class="toolbar">
      <div class="seg" role="group" aria-label="فیلتر وضعیت">
        ${[["all", "همه"], ["ok", "موفق"], ["fail", "ناموفق"]].map(([v, l]) => `<button data-ok="${v}" aria-pressed="${state.logFilter.ok === v}">${l}</button>`).join("")}
      </div>
      <select class="select" id="pf" aria-label="فیلتر پیام‌رسان">
        <option value="">همه‌ی پیام‌رسان‌ها</option>
        ${state.providers.map((p) => `<option value="${p.id}" ${state.logFilter.provider === p.id ? "selected" : ""}>${esc(p.nameFa)}</option>`).join("")}
      </select>
    </div>
    <div class="calls" id="log-list"></div>`;

  const list = document.getElementById("log-list");
  let openId = null;
  const draw = () => {
    const f = state.logFilter;
    const rows = state.logs.filter((l) => (f.ok === "all" || (f.ok === "ok") === l.ok) && (!f.provider || l.provider === f.provider));
    list.innerHTML = rows.length
      ? rows.map((l) => callRow(l, true) + (l.id === openId ? `<div class="call-detail"><div class="tool-form" style="padding-top:14px">
          <div><div class="hint">آرگومان‌های ورودی به مدل</div><pre class="json">${jsonHtml(l.args)}</pre></div>
          <div><div class="hint">${l.ok ? "خروجی موفق" : "پیام خطا"}</div>${l.ok ? `<pre class="json">${l.result ? jsonHtml(JSON.parse(l.result)) : ""}</pre>` : `<div class="err-box">${esc(l.error)}</div>`}</div>
        </div></div>` : "")).join("")
      : `<div class="empty"><b>گزارشی با این مشخصات یافت نشد</b>فیلترها را تغییر داده یا ابزاری را فراخوانی کنید.</div>`;
  };
  const load = async () => { state.logs = await api("logs?limit=300"); draw(); };
  await load();
  state.timer = setInterval(() => { if (!openId) load().catch(() => { }); }, 5000);

  list.addEventListener("click", (e) => {
    const r = e.target.closest("[data-log]");
    if (r) { openId = openId === r.dataset.log ? null : r.dataset.log; draw(); }
  });
  list.addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.closest("[data-log]")?.click(); });
  main.querySelector(".seg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ok]");
    if (!b) return;
    state.logFilter.ok = b.dataset.ok;
    main.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    draw();
  });
  document.getElementById("pf").onchange = (e) => { state.logFilter.provider = e.target.value; draw(); };
  document.getElementById("reload").onclick = (e) => busy(e.currentTarget, load);
  document.getElementById("clear").onclick = async () => {
    if (!confirm("آیا تمامی گزارش‌ها و فایل‌های لاگ پاک شوند؟")) return;
    await api("logs", { method: "DELETE" });
    await load();
    toast("تمام گزارش‌ها پاک شدند");
  };
}

// ---------------------------------------------------------------- diba router
async function pageDibaRouter(main) {
  const d = await api("dibarouter");
  main.innerHTML = `${head(
    "دیبا روتر",
    "دستیار دیبا و ابزارهای هوش مصنوعی داشبورد از این اتصال استفاده می‌کنند. DibaRouter یک API سازگار با OpenAI است.",
    "اتصال مدل",
    `<a class="btn btn-ghost btn-sm" href="https://dibarouter.ir/docs" target="_blank" rel="noopener">${icons.external} مستندات</a>`,
  )}
  <section class="dr-grid">
    <div class="dr-connector">
      <div class="dr-head">
        <div class="dr-title">
          <span class="dr-logo">${icons.router}</span>
          <div><b>اتصال DibaRouter</b><p class="hint">یک API برای همه‌ی مدل‌ها؛ سازگار با OpenAI SDK.</p></div>
        </div>
        <span class="pill ${d.configured ? "pill-ok" : "pill-off"}" id="dr-pill">${d.configured ? "متصل" : "تنظیم نشده"}</span>
      </div>

      <form class="prov-form dr-form" id="dr-form">
        <div class="field">
          <label for="dr-base">آدرس پایه API ${d.baseUrlFromEnv ? '<span class="env-badge">از env</span>' : ""}</label>
          <input class="input ltr-input" id="dr-base" value="${esc(d.baseUrl)}" ${d.baseUrlFromEnv ? "disabled" : ""} placeholder="https://dibarouter.ir/api/v1">
          <span class="hint">آدرس رسمی: <code class="ltr">https://dibarouter.ir/api/v1</code></span>
        </div>
        <div class="field">
          <label for="dr-key">کلید API ${d.apiKeyFromEnv ? '<span class="env-badge">از env</span>' : ""}</label>
          <div class="input-wrap">
            <input class="input ltr-input" id="dr-key" type="password" autocomplete="off" ${d.apiKeyFromEnv ? "disabled" : ""} placeholder="${d.hasApiKey ? esc(d.apiKeyMasked) : "sk-dc-v1-…"}">
            <button class="btn btn-icon btn-quiet" type="button" data-dr-reveal aria-label="نمایش کلید">${icons.eye}</button>
          </div>
          <span class="hint">${d.hasApiKey ? "کلید ذخیره شده است؛ برای تغییر مقدار جدید را وارد کنید." : `کلید را از <a href="${esc(d.keysUrl)}" target="_blank" rel="noopener">پنل دیبا روتر</a> بسازید.`}</span>
        </div>
        <div class="field">
          <label for="dr-model">مدل ${d.modelFromEnv ? '<span class="env-badge">از env</span>' : ""}</label>
          <input class="input ltr-input" id="dr-model" value="${esc(d.model)}" list="dr-models" ${d.modelFromEnv ? "disabled" : ""} placeholder="dibachain/diba-router-free">
          <datalist id="dr-models"></datalist>
          <span class="hint">پیش‌فرض <code class="ltr">dibachain/diba-router-free</code> رایگان و خودکار است. با «دریافت مدل‌ها» فهرست را ببینید.</span>
        </div>
        <div class="prov-actions">
          <button class="btn btn-primary" type="submit">ذخیره اتصال</button>
          <button class="btn btn-ghost" type="button" id="dr-test">تست اتصال</button>
          <button class="btn btn-ghost" type="button" id="dr-models-btn">دریافت مدل‌ها</button>
        </div>
        <div class="test-out" id="dr-out"></div>
      </form>
    </div>

    <aside class="dr-guide">
      <div class="dr-guide-card">
        <span class="eyebrow">سازگار با OpenAI</span>
        <h3>اتصال در چند خط</h3>
        <p class="hint">همان کلید و مدلی که اینجا ذخیره می‌کنید، در SDKهای OpenAI، LangChain و Vercel AI هم قابل استفاده است.</p>
        <pre class="json ltr">${esc(`base_url = "${d.defaultBase}"\napi_key  = "sk-dc-v1-..."\nmodel    = "${d.defaultModel}"`)}</pre>
        <div class="dr-links">
          <a href="${esc(d.keysUrl)}" target="_blank" rel="noopener">ساخت کلید API</a>
          <a href="https://dibarouter.ir/docs" target="_blank" rel="noopener">مستندات API</a>
          <a href="https://dibarouter.ir/docs/sdks" target="_blank" rel="noopener">SDKها و Connectorها</a>
        </div>
      </div>
      <div class="dr-guide-card dr-agent-card">
        <span class="dr-agent-icon">${icons.sparkles}</span>
        <div>
          <b>دستیار دیبا</b>
          <p class="hint">درباره‌ی سیستم، سرویس‌ها و اتصال‌ها از دستیار چت بپرسید. دستیار از همین اتصال استفاده می‌کند.</p>
          <button class="btn btn-ghost btn-sm" type="button" id="dr-open-agent">باز کردن دستیار</button>
        </div>
      </div>
    </aside>
  </section>`;

  const form = document.getElementById("dr-form");
  const out = document.getElementById("dr-out");
  const key = document.getElementById("dr-key");
  const base = document.getElementById("dr-base");
  const model = document.getElementById("dr-model");

  document.querySelector("[data-dr-reveal]").onclick = () => {
    key.type = key.type === "password" ? "text" : "password";
  };
  document.getElementById("dr-open-agent").onclick = () => document.getElementById("agent-toggle")?.click();

  const show = (html, ok = true) => {
    out.innerHTML = ok ? `<div class="ok-box">${html}</div>` : `<div class="err-box">${html}</div>`;
  };
  const refreshPill = (configured) => {
    const pill = document.getElementById("dr-pill");
    if (!pill) return;
    pill.className = `pill ${configured ? "pill-ok" : "pill-off"}`;
    pill.textContent = configured ? "متصل" : "تنظیم نشده";
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = { baseUrl: base.value.trim(), model: model.value.trim() };
    if (key.value.trim()) body.apiKey = key.value.trim();
    try {
      const r = await busy(form.querySelector("[type=submit]"), () => api("dibarouter", { method: "PUT", body }));
      key.value = "";
      key.placeholder = r.apiKeyMasked || "sk-dc-v1-…";
      refreshPill(r.configured);
      window.dispatchEvent(new Event("dibarouter-config"));
      toast(r.configured ? "اتصال دیبا روتر ذخیره شد" : "تنظیمات ذخیره شد؛ کلید API را وارد کنید");
      show(`اتصال ذخیره شد. مدل: <code class="ltr">${esc(r.model)}</code>`);
    } catch (ex) {
      show(esc(ex.message), false);
    }
  };

  document.getElementById("dr-test").onclick = async (e) => {
    try {
      const r = await busy(e.currentTarget, () => api("dibarouter/test", { body: {} }));
      show(`اتصال موفق بود. پاسخ مدل: <b>${esc(r.reply)}</b> · مدل: <code class="ltr">${esc(r.routedModel || r.model)}</code>`);
    } catch (ex) {
      show(esc(ex.message), false);
    }
  };

  document.getElementById("dr-models-btn").onclick = async (e) => {
    try {
      const r = await busy(e.currentTarget, () => api("dibarouter/models"));
      const list = document.getElementById("dr-models");
      list.innerHTML = r.models.map((m) => `<option value="${esc(m.id)}">${esc(m.name || m.id)}</option>`).join("");
      const free = r.models.filter((m) => m.is_free).length;
      show(`${fa(r.count)} مدل چت/بینایی دریافت شد${free ? ` · ${fa(free)} مدل رایگان` : ""}`);
    } catch (ex) {
      show(esc(ex.message), false);
    }
  };
}

// ---------------------------------------------------------------- connect
async function pageConnect(main) {
  const c = await api("connection");
  const base = location.origin + location.pathname.replace(/[^/]*$/, "");
  const url = base + "mcp";
  const snippets = {
    "Claude Code": { lang: "bash", code: `claude mcp add --transport http diba-mcp ${url} \\\n  --header "Authorization: Bearer ${c.token}"` },
    "Cursor / کلاینت‌های JSON": { lang: "json", code: JSON.stringify({ mcpServers: { "diba-mcp": { url, headers: { Authorization: `Bearer ${c.token}` } } } }, null, 2) },
    "Claude Desktop (stdio)": {
      lang: "json",
      code: JSON.stringify({ mcpServers: { "diba-mcp": { command: "npx", args: ["-y", "diba-mcp", "stdio"] } } }, null, 2),
      note: "در حالت stdio سرور روی سیستم شما اجرا شده و تنظیمات را مستقیماً از پوشه ~/.diba-mcp می‌خواند؛ نیازی به توکن نیست.",
    },
    "اسکریپت Express / Node.js": {
      lang: "js",
      code: `import express from "express";\nimport { createDibaMcp } from "diba-mcp";\n\nconst app = express();\nconst dibaMcp = createDibaMcp({ dataDir: "./data/diba-mcp" });\n\n// اتصال داشبورد و اندپوینت MCP به پروژه اکسپرس شما\napp.use("/diba-mcp", dibaMcp.router());\n\n// یا فراخوانی مستقیم بدون هوش مصنوعی:\nawait dibaMcp.engine.callTool("bale_send_message", { text: "سفارش جدید ثبت شد" }, "dashboard");`,
    },
    "تست دستی با curl": {
      lang: "bash",
      code: `curl -s ${url} \\\n  -H "Authorization: Bearer ${c.token}" \\\n  -H "Content-Type: application/json" \\\n  -H "Accept: application/json, text/event-stream" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
    },
  };
  let tab = Object.keys(snippets)[0];

  main.innerHTML = `${head("اتصال به هوش مصنوعی", "این آدرس و توکن را به Claude Code، Cursor یا هر کلاینت سازگار با پروتکل MCP متصل نمایید.", "راهنمای اتصال")}
    <div class="conn-grid">
      <section class="panel">
        <div class="field"><label for="ep">آدرس اندپوینت Streamable HTTP</label>
          <div class="endpoint"><input id="ep" class="input ltr-input" readonly value="${esc(url)}"><button class="btn btn-ghost" data-copy="${esc(url)}">کپی آدرس</button></div>
          <span class="hint">پروتکل انتقال: HTTP POST بدون نشست با پشتیبانی از SSE.</span></div>
        <div class="field" style="margin-top:18px"><label for="tk">توکن دسترسی Bearer Token${c.fromEnv ? '<span class="env-badge">از env</span>' : ""}</label>
          <div class="endpoint">
            <div class="input-wrap"><input id="tk" type="password" class="input ltr-input" readonly value="${esc(c.token)}"><button class="btn btn-icon btn-quiet" data-reveal="tk" aria-label="نمایش توکن">${icons.eye}</button></div>
            <button class="btn btn-ghost" data-copy="${esc(c.token)}">کپی توکن</button>
          </div>
          <span class="hint">این توکن در هدر <code class="ltr">Authorization: Bearer …</code> ارسال می‌شود و ابزارهای پیام‌رسان‌ها را در دسترس قرار می‌دهد.</span>
        </div>
        ${c.fromEnv ? "" : `<div class="prov-actions" style="margin-top:16px"><button class="btn btn-ghost btn-danger btn-sm" id="rotate">ساخت توکن جدید (ابطال توکن قبلی)</button></div>`}
      </section>
      <section class="panel">
        <div class="tabs" role="tablist">${Object.keys(snippets).map((k) => `<button role="tab" data-tab="${esc(k)}" aria-selected="${k === tab}">${esc(k)}</button>`).join("")}</div>
        <div id="snip"></div>
      </section>
    </div>`;

  const drawSnip = () => {
    const s = snippets[tab];
    document.getElementById("snip").innerHTML = `<div class="snippet"><pre class="json">${esc(s.code)}</pre><button class="btn btn-ghost btn-sm" data-copy-snip>کپی قطعه‌کد</button></div>${s.note ? `<p class="note">${esc(s.note)}</p>` : ""}`;
  };
  drawSnip();
  main.querySelector(".conn-grid").addEventListener("click", async (e) => {
    const cp = e.target.closest("[data-copy]");
    if (cp) copy(cp.dataset.copy);
    if (e.target.closest("[data-copy-snip]")) copy(snippets[tab].code);
    const rv = e.target.closest("[data-reveal]");
    if (rv) { const i = document.getElementById(rv.dataset.reveal); i.type = i.type === "password" ? "text" : "password"; }
    const tb = e.target.closest("[data-tab]");
    if (tb) { tab = tb.dataset.tab; main.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", b === tb)); drawSnip(); }
    if (e.target.closest("#rotate") && confirm("آیا توکن دسترسی کنونی باطل شود؟ تمام کلاینت‌های متصل باید با توکن جدید تنظیم شوند.")) {
      await api("connection/rotate", { body: {} });
      toast("توکن جدید ساخته شد");
      pageConnect(main);
    }
  });
}

// ---------------------------------------------------------------- boot
async function boot() {
  clearInterval(state.timer);
  let s;
  try { s = await api("auth/status"); }
  catch { $app.innerHTML = `<div class="boot"><div class="err-box">امکان اتصال به سرور diba-mcp وجود ندارد. از روشن بودن سرور اطمینان حاصل کرده و صفحه را تازه کنید.</div></div>`; return; }
  if (!s.authenticated) return renderAuth(s.needsSetup);
  renderShell();
  const verEl = document.getElementById("ver");
  if (verEl) verEl.textContent = `نسخه ${s.version}`;
  render();
}

window.addEventListener("hashchange", () => { if (document.getElementById("main")) render(); });
boot();
