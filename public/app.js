// Diba Bridge (دیبا پل) — داشبورد مدیریت پیام‌رسان‌های هوشمند | دیباچین
// استانداردهای سیستم طراحی دیباچین (dibachain-design-system.md)

const $app = document.getElementById("app");
const state = {
  providers: [],
  profile: null,
  overview: null,
  logs: [],
  logFilter: { ok: "all", provider: "" },
  logPage: 1,
  logPageSize: 20,
  logTotal: 0,
  logTotalPages: 1,
  openPlatform: null,
  timer: null,
  authTx: {},
  openToolProvider: null,
  agent: { open: true, busy: false, messages: [], config: null, unread: 0, full: false, abort: null },
};
const AGENT_HISTORY_KEY = "diba.agent.history.v1";
const AGENT_PREFS_KEY = "diba.agent.prefs.v1";
const AGENT_GREETING = "سلام! من دستیار دیبا هستم. درباره‌ی وضعیت پیام‌رسان‌ها، دلیل آماده نبودن یک سرویس، دریافت پیام‌ها، ابزارها یا اتصال MCP بپرسید.";
function loadAgentHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(AGENT_HISTORY_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && !m.streaming).slice(-60);
  } catch { return []; }
}
function saveAgentHistory() {
  try {
    const clean = state.agent.messages
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && !m.streaming)
      .slice(-60)
      .map((m) => ({ role: m.role, content: m.content, toolTrace: Array.isArray(m.toolTrace) ? m.toolTrace : undefined }));
    localStorage.setItem(AGENT_HISTORY_KEY, JSON.stringify(clean));
  } catch { /* storage may be unavailable */ }
}
function saveAgentPrefs() {
  try { localStorage.setItem(AGENT_PREFS_KEY, JSON.stringify({ open: state.agent.open, full: state.agent.full })); } catch { /* ignore */ }
}
try {
  const prefs = JSON.parse(localStorage.getItem(AGENT_PREFS_KEY) || "{}");
  if (typeof prefs.open === "boolean") state.agent.open = prefs.open;
  if (typeof prefs.full === "boolean") state.agent.full = prefs.full;
  state.agent.messages = loadAgentHistory();
} catch { /* ignore */ }
// در صفحه‌ی باریک پنل دستیار شناور است و روی محتوا می‌افتد؛ آنجا بسته شروع می‌شود و با دکمه‌اش باز می‌شود
if (window.matchMedia("(max-width: 1200px)").matches) {
  state.agent.open = false;
  state.agent.full = false;
}
let authQrTimer = null;
function stopAuthQrPolling() {
  if (authQrTimer) clearInterval(authQrTimer);
  authQrTimer = null;
}

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

/** مودال محلی داشبورد؛ به‌جای confirm/alert مرورگر. */
function openModal({
  title = "تأیید عملیات",
  message = "",
  confirmText = "تأیید",
  cancelText = "انصراف",
  tone = "primary",
  details = "",
} = {}) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `
      <section class="modal ${tone === "danger" ? "modal-danger" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header class="modal-head">
          <span class="modal-icon">${tone === "danger" ? icons.alert : icons.shield}</span>
          <div>
            <h2 id="modal-title">${esc(title)}</h2>
            ${message ? `<p>${esc(message)}</p>` : ""}
          </div>
        </header>
        ${details ? `<div class="modal-details">${esc(details)}</div>` : ""}
        <footer class="modal-actions">
          <button class="btn btn-ghost" type="button" data-modal-cancel>${esc(cancelText)}</button>
          <button class="btn ${tone === "danger" ? "btn-danger-solid" : "btn-primary"}" type="button" data-modal-confirm>${esc(confirmText)}</button>
        </footer>
      </section>`;
    const close = (answer) => {
      document.removeEventListener("keydown", onKey);
      wrap.classList.remove("open");
      setTimeout(() => wrap.remove(), 160);
      if (previous && previous.focus) previous.focus();
      resolve(answer);
    };
    const onKey = (e) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Tab") {
        const items = [...wrap.querySelectorAll("button")];
        if (!items.length) return;
        const i = items.indexOf(document.activeElement);
        e.preventDefault();
        items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
      }
    };
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(false); });
    wrap.querySelector("[data-modal-cancel]").addEventListener("click", () => close(false));
    wrap.querySelector("[data-modal-confirm]").addEventListener("click", () => close(true));
    document.body.append(wrap);
    requestAnimationFrame(() => wrap.classList.add("open"));
    document.addEventListener("keydown", onKey);
    wrap.querySelector("[data-modal-confirm]").focus();
  });
}

function openPromptModal({
  title = "ورودی اجرا",
  message = "",
  label = "JSON",
  value = "{}",
  confirmText = "اجرا",
} = {}) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `
      <section class="modal modal-prompt" role="dialog" aria-modal="true" aria-labelledby="prompt-title">
        <header class="modal-head">
          <span class="modal-icon">${icons.sparkles}</span>
          <div><h2 id="prompt-title">${esc(title)}</h2>${message ? `<p>${esc(message)}</p>` : ""}</div>
        </header>
        <div class="modal-field">
          <label for="prompt-input">${esc(label)}</label>
          <textarea id="prompt-input" class="textarea ltr-input" rows="8" spellcheck="false">${esc(value)}</textarea>
        </div>
        <footer class="modal-actions">
          <button class="btn btn-ghost" type="button" data-modal-cancel>انصراف</button>
          <button class="btn btn-primary" type="button" data-modal-confirm>${esc(confirmText)}</button>
        </footer>
      </section>`;
    const close = (answer) => {
      document.removeEventListener("keydown", onKey);
      wrap.classList.remove("open");
      setTimeout(() => wrap.remove(), 160);
      previous?.focus?.();
      resolve(answer);
    };
    const onKey = (e) => {
      if (e.key === "Escape") close(null);
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) close(wrap.querySelector("#prompt-input").value);
    };
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(null); });
    wrap.querySelector("[data-modal-cancel]").addEventListener("click", () => close(null));
    wrap.querySelector("[data-modal-confirm]").addEventListener("click", () => close(wrap.querySelector("#prompt-input").value));
    document.body.append(wrap);
    requestAnimationFrame(() => wrap.classList.add("open"));
    document.addEventListener("keydown", onKey);
    wrap.querySelector("#prompt-input").focus();
  });
}

async function openToolPicker() {
  if (!state.providers.length) {
    try { state.providers = await api("providers"); } catch { /* keep the picker usable with an empty list */ }
  }
  return new Promise((resolve) => {
    const tools = [];
    for (const p of state.providers || []) {
      for (const t of p.tools || []) tools.push({ name: t.name, title: t.title || t.name, provider: p.nameFa || p.id, ready: p.ready });
    }
    const previous = document.activeElement;
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `
      <section class="modal modal-tool-picker" role="dialog" aria-modal="true">
        <header class="modal-head"><span class="modal-icon">${icons.sparkles}</span><div><h2>انتخاب ابزار از سرویس‌ها</h2><p>${fa(tools.length)} ابزار از ${fa((state.providers || []).length)} سرویس</p></div></header>
        <div class="modal-field"><input class="input tool-picker-search" type="search" placeholder="جستجوی نام سرویس یا ابزار…" aria-label="جستجوی ابزار"></div>
        <div class="modal-tool-list" data-tool-picker-list></div>
        <footer class="modal-actions"><button class="btn btn-ghost" type="button" data-modal-cancel>انصراف</button></footer>
      </section>`;
    const close = (answer) => {
      document.removeEventListener("keydown", onKey);
      wrap.classList.remove("open");
      setTimeout(() => wrap.remove(), 160);
      previous?.focus?.();
      resolve(answer);
    };
    const onKey = (e) => { if (e.key === "Escape") close(null); };
    const draw = (query = "") => {
      const q = query.trim().toLowerCase();
      const list = wrap.querySelector("[data-tool-picker-list]");
      const rows = tools.filter((t) => !q || `${t.name} ${t.title} ${t.provider}`.toLowerCase().includes(q));
      list.innerHTML = rows.length
        ? rows.map((t) => `<button class="tool-picker-row" type="button" data-tool-name="${esc(t.name)}">
            <span class="tool-picker-body"><b>${esc(t.title)}</b><small>${esc(t.provider)} · <span class="ltr">${esc(t.name)}</span></small></span>
            <span class="pill ${t.ready ? "pill-ok" : "pill-off"}">${t.ready ? "آماده" : "خاموش"}</span>
          </button>`).join("")
        : `<div class="hint" style="padding:18px">ابزاری با این نام پیدا نشد.</div>`;
      list.querySelectorAll("[data-tool-name]").forEach((b) => b.addEventListener("click", () => close(b.dataset.toolName)));
    };
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(null); });
    wrap.querySelector("[data-modal-cancel]").addEventListener("click", () => close(null));
    wrap.querySelector(".tool-picker-search").addEventListener("input", (e) => draw(e.target.value));
    document.body.append(wrap);
    draw();
    requestAnimationFrame(() => wrap.classList.add("open"));
    document.addEventListener("keydown", onKey);
    wrap.querySelector(".tool-picker-search").focus();
  });
}

function selectControl(name, options, value, id = "", ariaLabel = "") {  const selected = options.find(([v]) => v === value) ?? options[0];
  return `<div class="ui-select native-select" data-native-select data-name="${esc(name)}">
    <input type="hidden" name="${esc(name)}" ${id ? `id="${esc(id)}"` : ""} value="${esc(selected?.[0] ?? "")}">
    <button class="ui-select-trigger" type="button" data-select-trigger aria-haspopup="listbox" aria-expanded="false" aria-label="${esc(ariaLabel || name)}">
      <span data-select-label>${esc(selected?.[1] ?? "")}</span>
      <span class="ui-select-chevron">${icons.chevron}</span>
    </button>
    <div class="ui-select-menu" role="listbox" hidden>
      ${options.map(([v, l]) => `<button type="button" class="ui-select-option ${v === selected?.[0] ? "active" : ""}" role="option" aria-selected="${v === selected?.[0]}" data-select-value="${esc(v)}">${esc(l)}</button>`).join("")}
    </div>
  </div>`;
}

function closeNativeSelects(except) {
  document.querySelectorAll("[data-native-select].open").forEach((el) => {
    if (el === except) return;
    el.classList.remove("open");
    el.querySelector(".ui-select-menu").hidden = true;
    el.querySelector("[data-select-trigger]").setAttribute("aria-expanded", "false");
  });
}

document.addEventListener("click", (e) => {
  const box = e.target.closest("[data-native-select]");
  if (!box) { closeNativeSelects(); return; }
  const trigger = e.target.closest("[data-select-trigger]");
  if (trigger) {
    const menu = box.querySelector(".ui-select-menu");
    const open = menu.hidden;
    closeNativeSelects(box);
    menu.hidden = !open;
    box.classList.toggle("open", open);
    trigger.setAttribute("aria-expanded", String(open));
    return;
  }
  const option = e.target.closest("[data-select-value]");
  if (option) {
    const input = box.querySelector('input[type="hidden"]');
    const label = box.querySelector("[data-select-label]");
    input.value = option.dataset.selectValue;
    label.textContent = option.textContent;
    box.querySelectorAll("[data-select-value]").forEach((x) => {
      const active = x === option;
      x.classList.toggle("active", active);
      x.setAttribute("aria-selected", String(active));
    });
    closeNativeSelects();
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
});

document.addEventListener("keydown", (e) => {
  const box = e.target.closest("[data-native-select]");
  if (!box) return;
  if (e.key === "Escape") { closeNativeSelects(); box.querySelector("[data-select-trigger]").focus(); }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const menu = box.querySelector(".ui-select-menu");
    if (menu.hidden) {
      closeNativeSelects(box);
      menu.hidden = false;
      box.classList.add("open");
      box.querySelector("[data-select-trigger]").setAttribute("aria-expanded", "true");
    }
    const opts = [...box.querySelectorAll("[data-select-value]")];
    const i = opts.indexOf(document.activeElement);
    opts[Math.max(0, Math.min(opts.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))].focus();
  }
});

async function copy(text) {  try { await navigator.clipboard.writeText(text); }
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
  if (!res.ok) {
    const err = new Error(data.error || `خطای ${res.status}`);
    // سرور نام فیلد ایرادناک را می‌فرستد تا فرم آن را علامت بزند
    if (data.field) err.field = data.field;
    err.status = res.status;
    throw err;
  }
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
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="6.5" width="11" height="11" rx="2.2"/></svg>',
  playground: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/></svg>',
  logs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h16M4 12h10M4 18h13"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/></svg>',
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
  external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>',
  sparkles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8zM19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9zM5 16l.9 2.1L8 19l-2.1.9L5 22l-.9-2.1L2 19l2.1-.9z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  maximize: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
  minimize: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 3v3a2 2 0 0 1-2 2H3M16 3v3a2 2 0 0 0 2 2h3M8 21v-3a2 2 0 0 0-2-2H3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3L2.8 20h18.4L12 3z"/><path d="M12 9v5"/><circle cx="12" cy="17.4" r=".8" fill="currentColor" stroke="none"/></svg>',
  tools: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
};
// کلید منو با شناسه‌ی صفحه یکی است
icons.triggers = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>';
icons.settings = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.17.37.38.7.6 1 .3.3.7.4 1.1.4H21v4h-.09a1.7 1.7 0 0 0-1.51.6z"/></svg>';
icons.dibarouter = icons.router;
icons.install = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v11M7.5 10l4.5 4.5 4.5-4.5M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17"/></svg>';
icons.banking = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 9.5L12 4l9 5.5M4.5 9.5h15M6 10v7M10 10v7M14 10v7M18 10v7M3.5 20h17M5 17h14"/></svg>';
icons.services = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><path d="M17 14v6M14 17h6"/></svg>';
icons.posts = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/><path d="M10 14l4-4"/></svg>';

const pages = [
  { id: "overview", title: "نمای کلی" },
  // سه دسته‌ی سرویس: شبکه‌های اجتماعی، سرویس‌های مالی و ابزارها
  { id: "providers", title: "شبکه‌های اجتماعی", submenu: true },
  { id: "banking", title: "سرویس‌های مالی", submenu: true },
  { id: "services", title: "ابزارها" },
  { id: "posts", title: "ارسال پست" },
  { id: "triggers", title: "تریگرها و اتوماسیون" },
  { id: "playground", title: "آزمایش ابزارها" },
  { id: "logs", title: "گزارش فراخوانی‌ها" },
  { id: "dibarouter", title: "دیبا روتر" },
  { id: "connect", title: "اتصال به هوش مصنوعی" },
  { id: "install", title: "نصب و مشخصات" },
  { id: "settings", title: "تنظیمات" },
];

// دسته و منطقه‌ی هر سرویس از سرور می‌آید (category و region در تعریف provider)
// اگر سرور هنوز نسخه‌ی قدیمی باشد و region را نفرستد، همین فهرست‌ها ملاک است تا دسته‌بندی به‌هم نریزد
const legacyIranianPlatforms = new Set(["bale", "eitaa", "rubika", "soroush", "blubank"]);
const legacyBankingProviders = new Set(["blubank"]);
// وردپرس و ابزارهای مدیریت محتوا هرگز نباید در دسته‌ی شبکه‌های اجتماعی بیفتند؛
// حتی اگر سرور قدیمی category را نفرستد.
const legacyToolProviders = new Set(["wordpress"]);
const isBankingProvider = (p) => p?.category === "banking" || (!p?.region && legacyBankingProviders.has(p?.id));
const isIranianProvider = (p) =>
  p?.region ? p.region === "iran" : legacyIranianPlatforms.has(String(p?.id ?? "").replace(/_client$/, ""));
// بانک، صرافی و درگاه پرداخت همه «مالی» هستند
const isFinanceProvider = (p) => isBankingProvider(p) || p?.category === "payment";
// پیام‌رسان‌ها و شبکه‌های اجتماعی؛ سرور قدیمی که category نمی‌فرستد هم همین‌جا می‌افتد
const isSocialProvider = (p) => !isFinanceProvider(p) && !legacyToolProviders.has(p?.id) && (!p?.category || p.category === "messenger");
/** صفحه‌ای که هر سرویس در آن مدیریت می‌شود: شبکه‌های اجتماعی، سرویس‌های مالی یا ابزارها */
const providerSection = (p) => (isFinanceProvider(p) ? "banking" : isSocialProvider(p) ? "providers" : "services");
const providerHref = (p) => `#/${providerSection(p)}?open=${encodeURIComponent(p.id)}`;

/**
 * راهنمای اتصال هر سرویس با حساب کاربری.
 */
const providerTutorials = {
  bale: {
    client: [
      "شماره موبایل حساب بله را در فرم «ورود با حساب بله» وارد کنید.",
      "کد پیامکی و در صورت نیاز رمز دومرحله‌ای را تکمیل کنید.",
      "پس از اتصال، فهرست گفتگوها و ابزارهای حساب کاربری فعال می‌شوند.",
    ],
  },
  eitaa: {
    client: [
      "پل EitaaBun را روی سرور اجرا کنید (پورت پیش‌فرض ۱۲۳۴).",
      "آدرس پل را در فیلد «آدرس پل» وارد و ذخیره کنید.",
      "با شماره ایتا وارد شوید و کد پیامکی را تأیید کنید.",
    ],
  },
  rubika: {
    client: [
      "شماره حساب روبیکا را در فرم ورود وارد کنید.",
      "کد ارسال‌شده در روبیکا را تأیید و در صورت نیاز رمز دومرحله‌ای را وارد کنید.",
      "پس از اتصال، گفتگوها و ابزارهای مدیریت گروه/کانال در دسترس هستند.",
    ],
  },
  soroush: {
    client: [
      "شماره حساب سروش‌پلاس را در فرم ورود وارد کنید.",
      "کد پیامکی و رمز دومرحله‌ای را در صورت فعال بودن تکمیل کنید.",
      "نشست در سرور ذخیره می‌شود و ابزارهای حساب کاربری فعال می‌شوند.",
    ],
  },
  telegram: {
    client: [
      "شماره حساب تلگرام را در فرم «ورود با حساب تلگرام» وارد کنید.",
      "کد ارسال‌شده در خود تلگرام و در صورت نیاز رمز دومرحله‌ای را وارد کنید.",
      "API ID و API Hash پیش‌فرض برای شروع کافی است؛ در صورت نیاز از my.telegram.org مقدار اختصاصی بگیرید.",
      "پس از اتصال، گفتگوها، گروه‌ها و کانال‌ها در دسترس هستند.",
    ],
  },
  instagram: {
    client: [
      "نام کاربری اینستاگرام را بدون @ وارد کنید و «ادامه» را بزنید.",
      "رمز عبور حساب را وارد کنید؛ اگر 2FA فعال است کد Authenticator، واتس‌اپ یا پیامک را وارد کنید.",
      "اگر اینستاگرام تأیید امنیتی (Checkpoint) خواست، کد ارسال‌شده به ایمیل/شماره را وارد کنید.",
      "نشست روی سرور ذخیره می‌شود و ابزارهای پروفایل، مدیا، کامنت و انتشار عکس فعال می‌شوند؛ نیازی به API Key یا Meta Developer Portal نیست.",
      "اگر خطای «نسخه قدیمی» یا 429/Timeout گرفتید، اول پراکسی http یا socks5 فعال کنید؛ اگر باز هم نشد از «ورود با کوکی مرورگر» استفاده کنید (sessionid و csrftoken و ds_user_id از DevTools).",
    ],
  },
  whatsapp: {
    client: [
      "در داشبورد روی «نمایش QR ورود» بزنید.",
      "در گوشی، WhatsApp → Linked devices → Link a device را باز کنید.",
      "کد QR نمایش‌داده‌شده را با دوربین گوشی اسکن کنید.",
      "بعد از اتصال در گوشی، در داشبورد «بررسی اتصال» را بزنید.",
      "نشست روی همین سرور ذخیره می‌شود؛ نیازی به API Token یا OpenWA نیست.",
    ],
  },
  x: {
    client: [
      "نام کاربری X (بدون @) را در فرم ورود وارد کنید و «ادامه» را بزنید.",
      "رمز عبور حساب را وارد کنید؛ در صورت نیاز ایمیل و Two-Factor Secret را از قبل در تنظیمات ذخیره کنید.",
      "پس از ورود، پروفایل، جستجو، تایم‌لاین و انتشار توییت در دسترس هستند.",
      "این روش از حساب واقعی و کوکی نشست استفاده می‌کند و به API Key نیاز ندارد.",
      "اگر X خطای 399 یا تأیید suspicious داد، ایمیل/2FA یا اتصال شبکه را بررسی کنید.",
    ],
  },
  linkedin: {
    appUrl: "https://www.linkedin.com/developers/apps/new",
    client: [
      "در LinkedIn Developer Portal یک App بسازید و آن را به یک LinkedIn Page معتبر متصل کنید.",
      "در بخش Products، «Share on LinkedIn» و در صورت نیاز «Sign In with LinkedIn using OpenID Connect» را فعال کنید.",
      "در Auth، یک Redirect URL ثبت کنید (مثلاً https://your-domain/callback) و OAuth 2.0 را با scopes «openid profile w_member_social» اجرا کنید.",
      "کد Authorization را با Client ID و Client Secret به Access Token تبدیل کنید (توکن معمولاً حدود ۶۰ روز اعتبار دارد).",
      "Access Token را در فیلد «Access Token» وارد و ذخیره کنید.",
      "Author URN اختیاری است؛ اگر خالی بماند از پروفایل همان توکن خوانده می‌شود (urn:li:person:...).",
      "نسخه API را مطابق اپ خود تنظیم کنید (پیش‌فرض 202506) و «تست اتصال» را بزنید.",
      "برای انتشار پست، اپ باید تأییدیهی دسترسی w_member_social را داشته باشد؛ در غیر این صورت LinkedIn خطای دسترسی برمی‌گرداند.",
    ],
  },
  blubank: {
    client: [
      "شماره موبایل حساب بلوبانک را در فیلد «شماره موبایل» وارد کنید و «شروع ورود» را بزنید.",
      "رمز عبور حساب بلوبانک را در قدم بعدی وارد کنید؛ سپس کدی که پیامک می‌شود را بزنید.",
      "پس از تأیید کد، نشست به‌صورت خودکار ذخیره می‌شود و تا زمانی که معتبر باشد نیازی به ورود دوباره نیست.",
      "اگر نشست منقضی شد، ابزارها خطای احراز هویت می‌دهند؛ کافی است دوباره «شروع ورود» را بزنید.",
      "«تست اتصال» را بزنید؛ در صورت معتبر بودن نشست، فهرست سپرده‌ها خوانده می‌شود.",
      "پاسخ‌های بلوبانک بدون اسکیمای منتشرشده‌اند؛ مبلغ‌ها، شماره شباها و کارت‌ها از متن پاسخ استخراج می‌شوند، پس پیش از تصمیم مالی عددها را با اپلیکیشن تطبیق دهید.",
      "نشست دسترسی کامل به حساب بانکی می‌دهد؛ آن را فقط روی سرور خودتان نگه دارید.",
    ],
  },
  wordpress: {
    client: [
      "آدرس سایت وردپرس را وارد کنید (مثلاً https://example.com).",
      "روش ۱ — Application Password: در پیشخوان وردپرس ← کاربران ← شناسنامه ← «رمزهای عبور برنامه» یک رمز بسازید و همراه نام کاربری اینجا وارد کنید.",
      "روش ۲ — افزونه‌ی اتصال: پوشه‌ی wordpress-plugin/diba-bridge-connector را zip و در وردپرس نصب و فعال کنید؛ سپس در «تنظیمات ← Diba Bridge» کلید بسازید و در فیلد «کلید افزونه» وارد کنید.",
      "برای ابزارهای پیشرفته (ووکامرس، سئو، کش، جستجو و جایگزینی، حالت تعمیرات و ...) روش ۲ لازم است؛ هر دو روش را می‌شود هم‌زمان داشت.",
      "«تست اتصال» را بزنید؛ نام سایت، نسخه‌ی وردپرس و کاربر متصل نمایش داده می‌شود.",
      "راهنمای کامل: docs/WORDPRESS.md",
    ],
  },
};

// راهنمای اتصال صرافی‌ها یک شکل است؛ فقط نام و محل ساخت کلید فرق می‌کند
for (const [key, name, where, passphrase] of [
  ["binance", "بایننس", "Binance ← Account ← API Management", false],
  ["bybit", "بای‌بیت", "Bybit ← Account ← API", false],
  ["okx", "او‌کی‌ایکس", "OKX ← Profile ← API", true],
  ["kucoin", "کوکوین", "KuCoin ← Profile ← API Management", true],
  ["kraken", "کراکن", "Kraken ← Settings ← API", false],
]) {
  providerTutorials[key] = {
    client: [
      `قیمت، دفتر سفارش و کندل‌های ${name} بدون کلید هم کار می‌کند؛ کافی است سرویس را روشن کنید.`,
      `برای موجودی و سفارش‌ها، از مسیر «${where}» یک کلید API بسازید و فقط دسترسی خواندن (Read) بدهید.`,
      `API Key و API Secret${passphrase ? " و Passphrase" : ""} را در همین فرم وارد و ذخیره کنید، سپس «تست اتصال» را بزنید.`,
      "دسترسی برداشت (Withdraw) را هرگز برای این کلید روشن نکنید و در صورت امکان آن را به IP همین سرور محدود کنید.",
      "معامله به‌طور پیش‌فرض خاموش است. فقط اگر واقعاً می‌خواهید مدل سفارش ثبت یا لغو کند، دسترسی Trade را به کلید بدهید و «اجازه‌ی معامله» را روشن کنید.",
      "هر سفارش با پول واقعی شما ثبت می‌شود؛ ابزار ثبت سفارش بدون تأیید صریح فقط پیش‌نمایش برمی‌گرداند.",
    ],
  };
}

// صرافی‌های ایرانی: هر کدام کلید و داده‌ی عمومی خودش را دارد
for (const [key, name, market, credentials, unit] of [
  ["nobitex", "نوبیتکس", "قیمت، دفتر سفارش و کندل‌های", "توکن API را در فیلد اول بگذارید. اگر «کلید API» جدید نوبیتکس را ساخته‌اید، کلید عمومی را در فیلد اول و کلید خصوصی را در فیلد دوم وارد کنید", "قیمت بازارهای تومانی نوبیتکس به ریال است، نه تومان؛ قیمت سفارش را هم به ریال بدهید."],
  ["wallex", "والکس", "قیمت، دفتر سفارش و کندل‌های", "کلید API را در همین فرم وارد کنید", "قیمت بازارهای تومانی والکس به تومان است."],
  ["bitpin", "بیت‌پین", "قیمت و دفتر سفارش", "API Key و Secret Key را در همین فرم وارد کنید", "قیمت بازارهای تومانی بیت‌پین به تومان است."],
  ["tabdeal", "تبدیل", "قیمت و دفتر سفارش", "API Key و API Secret را در همین فرم وارد کنید", "قیمت بازارهای تومانی تبدیل به تومان است."],
  ["abantether", "آبان‌تتر", "قیمت خرید و فروش", "Api-Key را از صفحه‌ی حساب کاربری بردارید و در همین فرم وارد کنید", "آبان‌تتر بازار خرید و فروش مستقیم است: مقدار سفارش خرید به تومان یا تتر و مقدار سفارش فروش به واحد خودِ رمزارز است."],
]) {
  providerTutorials[key] = {
    client: [
      `${market} ${name} بدون کلید هم کار می‌کند؛ کافی است سرویس را روشن کنید.`,
      `برای موجودی و سفارش‌ها، در پنل ${name} یک کلید API بسازید و تا جای ممکن فقط دسترسی خواندن بدهید.`,
      `${credentials} و ذخیره کنید، سپس «تست اتصال» را بزنید.`,
      unit,
      "دسترسی برداشت را هرگز برای این کلید روشن نکنید و در صورت امکان آن را به IP همین سرور محدود کنید.",
      "معامله به‌طور پیش‌فرض خاموش است. فقط اگر واقعاً می‌خواهید مدل سفارش ثبت یا لغو کند، «اجازه‌ی معامله» را روشن کنید.",
      "هر سفارش با پول واقعی شما ثبت می‌شود؛ ابزار ثبت سفارش بدون تأیید صریح فقط پیش‌نمایش برمی‌گرداند.",
    ],
  };
}

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
    logo: "assets/bale.png",
    glyph: '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 10.5C7 9.12 8.12 8 9.5 8h5c1.38 0 2.5 1.12 2.5 2.5v2c0 1.38-1.12 2.5-2.5 2.5h-2.5l-3 2v-2.5H9.5C8.12 14.5 7 13.38 7 12v-1.5z" fill="white"/></svg>',
    color: "#1fb486",
    description: "پیام‌رسان بانکی و ارتباطی بله — اتصال با حساب کاربری",
    docsUrl: "https://docs.bale.ai/",
  },
  eitaa: {
    key: "eitaa",
    nameFa: "ایتا",
    nameEn: "Eitaa",
    logo: "assets/eitaa.png",
    glyph: '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 8.5c0-.83.67-1.5 1.5-1.5h9c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5h-9c-.83 0-1.5-.67-1.5-1.5v-7zm1.5 0L12 12l4.5-3.5" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    color: "#f08a24",
    description: "پیام‌رسان ابری ایتا — اتصال با حساب کاربری",
    docsUrl: "https://eitaayar.ir/",
  },
  rubika: {
    key: "rubika",
    nameFa: "روبیکا",
    nameEn: "Rubika",
    logo: "assets/rubika.png",
    glyph: '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9.5 7.5l7 4.5-7 4.5v-9z" fill="white"/>',
    color: "#8b5cf6",
    description: "سوپراپلیکیشن روبیکا — اتصال با حساب کاربری برای گروه‌ها و کانال‌ها",
    docsUrl: "https://rubika.ir/",
  },
  soroush: {
    key: "soroush",
    nameFa: "سروش‌پلاس",
    nameEn: "Soroush+",
    logo: "assets/soroush.png",
    glyph: '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 9.5A2.5 2.5 0 019.5 7h5A2.5 2.5 0 0117 9.5v2a2.5 2.5 0 01-2.5 2.5H13l-2.5 2v-2H9.5A2.5 2.5 0 017 11.5v-2z" fill="white"/><circle cx="10" cy="11" r=".8" fill="#2563eb"/><circle cx="12" cy="11" r=".8" fill="#2563eb"/><circle cx="14" cy="11" r=".8" fill="#2563eb"/></svg>',
    color: "#2563eb",
    description: "پیام‌رسان سروش‌پلاس — اتصال با حساب کاربری",
    docsUrl: "https://soroush-app.ir/",
  },
  telegram: {
    key: "telegram",
    nameFa: "تلگرام",
    nameEn: "Telegram",
    logo: "assets/telegram.svg",
    color: "#229ED9",
    description: "تلگرام با حساب کاربری — گفتگوها، گروه‌ها، کانال‌ها و دریافت پیام",
    docsUrl: "https://core.telegram.org/api",
  },
  instagram: {
    key: "instagram",
    nameFa: "اینستاگرام",
    nameEn: "Instagram",
    logo: "assets/instagram.svg",
    color: "#d62976",
    description: "ورود با نام کاربری و رمز اینستاگرام — پروفایل، مدیا، کامنت و انتشار عکس بدون API Key",
    docsUrl: "https://github.com/dilame/instagram-private-api",
  },
  whatsapp: {
    key: "whatsapp",
    nameFa: "واتس‌اپ",
    nameEn: "WhatsApp",
    logo: "assets/whatsapp.svg?v=2",
    color: "#25D366",
    description: "ورود با QR واتس‌اپ — ارسال پیام، عکس و فایل بدون API Token",
    docsUrl: "https://github.com/WhiskeySockets/Baileys",
  },
  x: {
    key: "x",
    nameFa: "ایکس",
    nameEn: "X",
    logo: "assets/x.svg",
    color: "#0f1419",
    description: "ورود با نام کاربری و رمز X — پروفایل، جستجو، تایم‌لاین و انتشار توییت بدون API Key",
    docsUrl: "https://x.com/",
  },
  linkedin: {
    key: "linkedin",
    nameFa: "لینکدین",
    nameEn: "LinkedIn",
    logo: "assets/linkedin.svg",
    color: "#0A66C2",
    description: "اتصال رسمی LinkedIn API — پروفایل، انتشار پست و فهرست پست‌ها",
    docsUrl: "https://learn.microsoft.com/en-us/linkedin/",
  },
  wordpress: {
    key: "wordpress",
    nameFa: "وردپرس",
    nameEn: "WordPress",
    logo: "assets/wordpress.svg",
    color: "#21759b",
    description: "مدیریت کامل سایت وردپرس — نوشته‌ها، رسانه، دیدگاه‌ها، کاربران، افزونه‌ها، سئو و ووکامرس",
    docsUrl: "https://developer.wordpress.org/rest-api/",
  },
};

function parseProvider(p) {
  const platformKey = p.id.replace(/_client$/, "");
  return { platformKey };
}

/** لوگوی رسمی پلتفرم به‌جای حرف/گلیف */
function providerLogo(p) {
  const key = p?.key || (p?.id ? parseProvider(p).platformKey : "");
  const meta = platformMeta[key];
  if (meta?.logo) return `<img class="prov-logo" src="${meta.logo}" alt="${esc(meta.nameFa || "")}" loading="lazy">`;
  return p?.glyph || "•";
}

function groupProviders(providers) {
  const map = new Map();
  for (const p of providers) {
    const { platformKey } = parseProvider(p);
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
        provider: null,
      });
    }
    const item = map.get(platformKey);
    // هر پلتفرم فقط یک اتصال دارد: حساب کاربری (یا API رسمی، مثل لینکدین)
    if (!item.provider) item.provider = p;
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

function renderAuth() {
  $app.innerHTML = `
  <div class="auth-page">
    <main class="auth-shell">
      <section class="auth-brand-panel">
        <div class="auth-brand-lockup">
          <img src="assets/logo-sm.png" alt="دیباپل" class="brand-logo">
          <div class="auth-brand-name">
            <b>دیباپل</b>
            <span>DibaBridge · MCP</span>
          </div>
        </div>
        <div class="auth-brand-copy">
          <span class="eyebrow">زیرساخت ارتباط یکپارچه</span>
          <h1>همه‌ی پیام‌رسان‌ها، یک داشبورد.</h1>
          <p>حساب‌های کاربری پیام‌رسان‌ها و ابزارهای هوش مصنوعی را از یک نقطه مدیریت کنید.</p>
        </div>
        <ul class="auth-points">
          <li><span class="auth-check">${icons.check}</span><div><b>پیام‌رسان‌های ایرانی و خارجی</b><small>بله، ایتا، روبیکا، سروش، تلگرام، واتس‌اپ و بیشتر</small></div></li>
          <li><span class="auth-check">${icons.check}</span><div><b>ابزارهای MCP و دستیار هوشمند</b><small>اجرای مستقیم ابزارها با پاسخ زنده و گزارش کامل</small></div></li>
          <li><span class="auth-check">${icons.check}</span><div><b>امنیت در سمت سرور</b><small>توکن‌ها و نشست‌ها هرگز به مرورگر ارسال نمی‌شوند</small></div></li>
        </ul>
        <div class="auth-brand-foot"><span class="auth-live-dot"></span> نسخه‌ی سازمانی · دیباچین</div>
      </section>
      <section class="auth-card">
        <div class="auth-card-head">
          <span class="auth-kicker">ورود امن</span>
          <h2>ورود به داشبورد</h2>
          <p>برای مدیریت سرویس‌ها، بررسی پیام‌ها و کلیدهای ارتباطی وارد شوید.</p>
        </div>
        <form id="f">
          <div class="field"><label for="pw">رمز عبور داشبورد</label><input id="pw" type="password" class="input" autocomplete="current-password" required autofocus></div>
          <div class="form-err" id="err"></div>
          <button class="btn btn-primary" type="submit">ورود به سیستم</button>
        </form>
        <div class="auth-note">${icons.shield}<span>نشست شما به‌صورت امن در سرور نگهداری می‌شود.</span></div>
        <div class="auth-card-foot">DibaBridge · MCP <span>0.4.1</span></div>
      </section>
    </main>
  </div>`;
  const f = document.getElementById("f");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = document.getElementById("err");
    err.textContent = "";
    const pw = f.querySelector("#pw").value;
    try {
      await busy(f.querySelector("button"), () => api("auth/login", { body: { password: pw } }));
      boot();
    } catch (ex) { err.textContent = ex.message; }
  });
}

// ---------------------------------------------------------------- installer (نصب اولیه و مشخصات)
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const LOGO_MAX_BYTES = 300 * 1024;
const LOGO_MAX_SIDE = 512;
const logoPlaceholder = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M4 17l5-4 3.5 2.5L16 12l4 4"/></svg>';
const dataUrlBytes = (url) => Math.floor(((url.split(",")[1] || "").replace(/=+$/, "").length * 3) / 4);

/** فایل لوگو را می‌خواند و اگر بزرگ باشد در مرورگر کوچک می‌کند؛ سرور دوباره همه‌چیز را بررسی می‌کند */
async function readLogoFile(file) {
  if (!LOGO_TYPES.includes(file.type)) throw new Error("قالب لوگو باید PNG، JPG، WebP یا GIF باشد");
  if (file.size > 8 * 1024 * 1024) throw new Error("فایل لوگو خیلی بزرگ است (حداکثر ۸ مگابایت)");
  const original = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("فایل لوگو خوانده نشد"));
    r.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("این فایل یک تصویر معتبر نیست"));
    i.src = original;
  });
  const side = Math.max(img.naturalWidth, img.naturalHeight);
  if (file.size <= LOGO_MAX_BYTES && side <= LOGO_MAX_SIDE) return original;
  const scale = Math.min(1, LOGO_MAX_SIDE / side);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  for (const [type, quality] of [["image/png"], ["image/webp", 0.9], ["image/jpeg", 0.85]]) {
    const out = canvas.toDataURL(type, quality);
    if (out.startsWith(`data:${type}`) && dataUrlBytes(out) <= LOGO_MAX_BYTES) return out;
  }
  throw new Error("لوگو پس از کوچک‌سازی هم بزرگ است؛ تصویر ساده‌تری انتخاب کنید");
}

function profileFieldsHtml(p, idp = "pf") {
  return `
    <div class="pf-logo">
      <div class="pf-logo-preview" data-logo-preview>${p.logo ? `<img src="${esc(p.logo)}" alt="لوگوی فعلی">` : logoPlaceholder}</div>
      <div class="pf-logo-body">
        <span class="field-label">لوگو <small>(اختیاری)</small></span>
        <div class="pf-logo-actions">
          <label class="btn btn-ghost btn-sm pf-logo-pick">انتخاب تصویر<input type="file" accept="${LOGO_TYPES.join(",")}" data-logo-input hidden></label>
          <button class="btn btn-quiet btn-sm btn-danger" type="button" data-logo-remove ${p.logo ? "" : "hidden"}>حذف لوگو</button>
        </div>
        <span class="hint">PNG، JPG، WebP یا GIF؛ تصویر بزرگ خودکار کوچک می‌شود.</span>
      </div>
    </div>
    <div class="pf-grid">
      <div class="field"><label for="${idp}-org">نام شرکت یا پروژه<span class="req" aria-label="الزامی">*</span></label><input id="${idp}-org" name="orgName" class="input" maxlength="80" required autocomplete="organization" value="${esc(p.orgName)}" placeholder="مثلاً فروشگاه آسمان"></div>
      <div class="field"><label for="${idp}-owner">نام و نام خانوادگی شما</label><input id="${idp}-owner" name="ownerName" class="input" maxlength="80" autocomplete="name" value="${esc(p.ownerName)}" placeholder="مسئول این داشبورد"></div>
      <div class="field pf-wide"><label for="${idp}-site">آدرس سایت <small>(در صورت نیاز)</small></label><input id="${idp}-site" name="website" class="input ltr-input" maxlength="200" inputmode="url" autocomplete="url" value="${esc(p.website)}" placeholder="https://example.com"></div>
      <div class="field pf-wide"><label for="${idp}-desc">توضیح کوتاه <small>(اختیاری)</small></label><textarea id="${idp}-desc" name="description" class="textarea" rows="2" maxlength="300" placeholder="این داشبورد برای چه کاری استفاده می‌شود؟">${esc(p.description)}</textarea></div>
    </div>`;
}

/** model.logo همیشه لوگوی فعلی فرم است (رشته‌ی خالی = بدون لوگو) */
function bindProfileFields(root, model, onError) {
  const preview = root.querySelector("[data-logo-preview]");
  const removeBtn = root.querySelector("[data-logo-remove]");
  const input = root.querySelector("[data-logo-input]");
  const draw = () => {
    preview.innerHTML = model.logo ? `<img src="${esc(model.logo)}" alt="پیش‌نمایش لوگو">` : logoPlaceholder;
    removeBtn.hidden = !model.logo;
  };
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      model.logo = await readLogoFile(file);
      onError("");
      draw();
    } catch (ex) {
      onError(ex.message);
    }
  });
  removeBtn.addEventListener("click", () => { model.logo = ""; draw(); });
}

function collectProfile(root, model) {
  const val = (name) => String(root.querySelector(`[name="${name}"]`)?.value ?? "").trim();
  return { orgName: val("orgName"), ownerName: val("ownerName"), website: val("website"), description: val("description"), logo: model.logo || "" };
}

const serviceLabel = (s) => platformMeta[parseProvider(s).platformKey]?.nameFa || s.nameFa.replace(/\s*\(حساب کاربری\)/g, "");

function serviceGroups(services) {
  const groups = [
    { key: "social-ir", title: "شبکه‌های اجتماعی ایرانی", items: [] },
    { key: "social-intl", title: "شبکه‌های اجتماعی خارجی", items: [] },
    { key: "finance-ir", title: "سرویس‌های مالی ایرانی", items: [] },
    { key: "finance-intl", title: "سرویس‌های مالی خارجی", items: [] },
    { key: "other", title: "ابزارها", items: [] },
  ];
  for (const s of services) {
    const section = providerSection(s);
    const key = section === "services" ? "other" : `${section === "banking" ? "finance" : "social"}-${isIranianProvider(s) ? "ir" : "intl"}`;
    groups.find((g) => g.key === key).items.push(s);
  }
  return groups.filter((g) => g.items.length);
}

function servicePickerHtml(services, selected) {
  return `
    <div class="svc-toolbar">
      <span class="svc-count" data-svc-count></span>
      <div class="svc-toolbar-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-svc-all>انتخاب همه</button>
        <button class="btn btn-quiet btn-sm" type="button" data-svc-none>هیچ‌کدام</button>
      </div>
    </div>
    ${serviceGroups(services).map((g) => `
      <fieldset class="svc-group" data-svc-group="${g.key}">
        <legend>
          <span>${g.title}</span>
          <button class="svc-group-all" type="button" data-svc-group-all="${g.key}">انتخاب همه‌ی این گروه</button>
        </legend>
        <div class="svc-list">
          ${g.items.map((s) => `
            <label class="svc-item${s.enabledFromEnv ? " is-locked" : ""}">
              <input type="checkbox" data-svc="${esc(s.id)}" ${selected.has(s.id) ? "checked" : ""} ${s.enabledFromEnv ? "disabled" : ""}>
              <span class="svc-logo" style="background:${esc(s.color)}">${providerLogo(s)}</span>
              <span class="svc-text">
                <b>${esc(serviceLabel(s))}</b>
                <small>${s.enabledFromEnv ? "از فایل env کنترل می‌شود" : `${fa(s.toolCount)} ابزار${s.ready ? " · متصل" : ""}`}</small>
              </span>
              <span class="svc-tick" aria-hidden="true">${icons.check}</span>
            </label>`).join("")}
        </div>
      </fieldset>`).join("")}`;
}

/** selected یک Set است که با تغییر تیک‌ها به‌روز می‌شود */
function bindServicePicker(root, services, selected, onChange = () => {}) {
  const boxes = () => [...root.querySelectorAll("[data-svc]")];
  const sync = () => {
    for (const b of boxes()) {
      if (b.disabled) continue;
      if (b.checked) selected.add(b.dataset.svc);
      else selected.delete(b.dataset.svc);
    }
    const count = root.querySelector("[data-svc-count]");
    if (count) count.textContent = `${fa(selected.size)} از ${fa(services.length)} سرویس انتخاب شده`;
    root.querySelectorAll("[data-svc-group]").forEach((g) => {
      const free = [...g.querySelectorAll("[data-svc]:not(:disabled)")];
      const btn = g.querySelector("[data-svc-group-all]");
      const all = free.length > 0 && free.every((b) => b.checked);
      btn.textContent = all ? "برداشتن انتخاب این گروه" : "انتخاب همه‌ی این گروه";
      btn.hidden = !free.length;
    });
    onChange();
  };
  const setAll = (list, on) => { for (const b of list) if (!b.disabled) b.checked = on; sync(); };
  root.addEventListener("change", (e) => { if (e.target.matches("[data-svc]")) sync(); });
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-svc-all]")) return setAll(boxes(), true);
    if (e.target.closest("[data-svc-none]")) return setAll(boxes(), false);
    const groupBtn = e.target.closest("[data-svc-group-all]");
    if (groupBtn) {
      const list = [...groupBtn.closest("[data-svc-group]").querySelectorAll("[data-svc]")];
      setAll(list, !list.filter((b) => !b.disabled).every((b) => b.checked));
    }
  });
  sync();
}

/**
 * نصب‌کننده‌ی تمام‌صفحه: خوش‌آمد ← مشخصات ← سرویس‌ها ← (رمز عبور) ← مرور و پایان.
 *   setup=true    اولین اجرا؛ هنوز رمز ادمین ساخته نشده و رمز در همین نصب انتخاب می‌شود.
 *   firstRun=true رمز از قبل هست (مثلاً از ADMIN_PASSWORD) ولی نصب اولیه کامل نشده است.
 *   هر دو false   از داخل داشبورد دوباره باز شده و می‌شود آن را بست.
 */
async function renderInstaller({ firstRun = true, setup = false } = {}) {
  clearInterval(state.timer);
  let data;
  try { data = await api(setup ? "auth/setup-info" : "install"); }
  catch (e) {
    if (e instanceof AuthError) return;
    // راه‌اندازی در همین فاصله در جای دیگری انجام شده است
    if (setup) return renderAuth();
    $app.innerHTML = `<div class="boot"><div class="err-box">${esc(e.message || "بارگذاری نصب‌کننده ناموفق بود")}</div></div>`;
    return;
  }
  const mandatory = setup || firstRun;
  const steps = [
    { key: "welcome", title: "خوش‌آمد" },
    { key: "profile", title: "مشخصات" },
    { key: "services", title: "سرویس‌ها" },
    ...(setup ? [{ key: "password", title: "رمز عبور" }] : []),
    { key: "review", title: "پایان" },
  ];
  const model = {
    step: 0,
    profile: { ...data.profile },
    logo: data.profile.logo || "",
    selected: new Set(data.services.filter((s) => s.enabled).map((s) => s.id)),
    // فقط در حافظه‌ی همین صفحه می‌ماند و جایی ذخیره نمی‌شود
    password: "",
    password2: "",
  };
  const stepIndex = (key) => steps.findIndex((s) => s.key === key);

  const planItems = [
    ["مشخصات شما", "نام شرکت یا پروژه، آدرس سایت و لوگو"],
    ["انتخاب سرویس‌ها", "شبکه‌های اجتماعی، سرویس‌های مالی و ابزارهایی که لازم دارید"],
    ...(setup ? [["رمز عبور داشبورد", "رمز ورود خود به داشبورد را انتخاب می‌کنید"]] : []),
    ["ورود به داشبورد", "اتصال حساب هر سرویس از صفحه‌ی خودش انجام می‌شود"],
  ];

  const bodyHtml = (key) => {
    if (key === "welcome") return `
      <div class="inst-welcome">
        <img src="assets/logo-sm.png" alt="" class="inst-welcome-logo">
        <h1>${mandatory ? "به دیباپل خوش آمدید" : "راهنمای نصب دیباپل"}</h1>
        <p>${mandatory ? "قبل از ورود به داشبورد، چند مشخصه‌ی کوتاه را تنظیم می‌کنیم. این کار حدود یک دقیقه طول می‌کشد." : "مشخصات و سرویس‌های فعال را دوباره مرور کنید. تا پیش از تأیید نهایی هیچ چیزی تغییر نمی‌کند."}</p>
        <ol class="inst-plan">
          ${planItems.map(([title, sub], i) => `<li><i aria-hidden="true">${fa(i + 1)}</i><div><b>${title}</b><span>${sub}</span></div></li>`).join("")}
        </ol>
      </div>`;
    if (key === "profile") return `
      <div class="inst-section-head"><h2>مشخصات شرکت یا پروژه</h2><p>این مشخصات در بالای داشبورد نمایش داده می‌شود و هر زمان قابل تغییر است.</p></div>
      <div data-profile-form>${profileFieldsHtml({ ...model.profile, logo: model.logo }, "inst")}</div>`;
    if (key === "services") return `
      <div class="inst-section-head"><h2>کدام سرویس‌ها فعال شوند؟</h2><p>فعال کردن یعنی سرویس در داشبورد آماده‌ی اتصال می‌شود؛ ورود به حساب هر سرویس را بعداً انجام می‌دهید.</p></div>
      <div data-service-picker>${servicePickerHtml(data.services, model.selected)}</div>`;
    if (key === "password") return `
      <div class="inst-section-head"><h2>رمز عبور داشبورد</h2><p>یک رمز عبور برای ورود به داشبورد انتخاب کنید. از این پس با همین رمز وارد می‌شوید.</p></div>
      <div class="pf-grid">
        <div class="field"><label for="inst-pw">رمز عبور<span class="req" aria-label="الزامی">*</span></label><input id="inst-pw" name="password" type="password" class="input ltr-input" autocomplete="new-password" minlength="8" value="${esc(model.password)}"><span class="hint">حداقل ۸ کاراکتر</span></div>
        <div class="field"><label for="inst-pw2">تکرار رمز عبور<span class="req" aria-label="الزامی">*</span></label><input id="inst-pw2" name="password2" type="password" class="input ltr-input" autocomplete="new-password" value="${esc(model.password2)}"></div>
      </div>
      <div class="inst-safe">${icons.shield}<span>رمز عبور به‌صورت هش‌شده روی همین سرور نگه‌داری می‌شود و متن آن هیچ‌جا ذخیره نمی‌شود.</span></div>`;
    const chosen = data.services.filter((s) => model.selected.has(s.id));
    return `
      <div class="inst-section-head"><h2>مرور و تأیید</h2><p>اگر همه‌چیز درست است نصب را کامل کنید.</p></div>
      <div class="inst-review">
        <div class="inst-review-id">
          <div class="pf-logo-preview">${model.logo ? `<img src="${esc(model.logo)}" alt="">` : logoPlaceholder}</div>
          <div>
            <b>${esc(model.profile.orgName)}</b>
            ${model.profile.ownerName ? `<span>${esc(model.profile.ownerName)}</span>` : ""}
            ${model.profile.website ? `<span class="ltr">${esc(model.profile.website)}</span>` : ""}
          </div>
        </div>
        ${model.profile.description ? `<p class="inst-review-desc">${esc(model.profile.description)}</p>` : ""}
        <div class="inst-review-svc">
          <span class="field-label">${fa(chosen.length)} سرویس فعال می‌شود</span>
          ${chosen.length
            ? `<div class="inst-chips">${chosen.map((s) => `<span class="inst-chip"><i style="background:${esc(s.color)}"></i>${esc(serviceLabel(s))}</span>`).join("")}</div>`
            : `<p class="hint">سرویسی انتخاب نشده است. بعداً می‌توانید از بخش «نصب و مشخصات» سرویس اضافه کنید.</p>`}
        </div>
        ${setup ? `<div class="inst-review-row"><span>رمز عبور داشبورد</span><b>تنظیم می‌شود</b></div>` : ""}
        <div class="inst-safe">${icons.shield}<span>مشخصات و لوگو فقط روی همین سرور و در فایل تنظیمات با دسترسی محدود ذخیره می‌شوند.</span></div>
      </div>`;
  };

  const draw = (message = "") => {
    const key = steps[model.step].key;
    const last = model.step === steps.length - 1;
    $app.innerHTML = `
    <div class="inst-page">
      <main class="inst-card">
        <header class="inst-head">
          <div class="inst-brand"><img src="assets/logo-sm.png" alt="" class="brand-logo"><div><b>دیباپل</b><span>نصب و راه‌اندازی</span></div></div>
          ${mandatory ? "" : `<button class="btn btn-quiet btn-sm" type="button" data-inst-close>بستن</button>`}
        </header>
        <ol class="inst-steps" aria-label="مراحل نصب">
          ${steps.map((s, i) => `<li class="${i < model.step ? "is-done" : i === model.step ? "is-current" : ""}" ${i === model.step ? 'aria-current="step"' : ""}><i>${i < model.step ? icons.check : fa(i + 1)}</i><span>${s.title}</span></li>`).join("")}
        </ol>
        <form class="inst-body" data-inst-form novalidate>${bodyHtml(key)}</form>
        <footer class="inst-foot">
          <div class="form-err" data-inst-err role="alert">${esc(message)}</div>
          <div class="inst-foot-actions">
            <button class="btn btn-ghost" type="button" data-inst-back ${model.step === 0 ? "hidden" : ""}>مرحله‌ی قبل</button>
            <button class="btn btn-primary" type="button" data-inst-next>${model.step === 0 ? "شروع" : last ? (mandatory ? "تکمیل نصب و ورود به داشبورد" : "ذخیره و بازگشت به داشبورد") : "مرحله‌ی بعد"}</button>
          </div>
        </footer>
      </main>
    </div>`;
    const err = $app.querySelector("[data-inst-err]");
    const setErr = (m) => { err.textContent = m || ""; };
    const field = (name) => $app.querySelector(`[name="${name}"]`);
    if (key === "profile") bindProfileFields($app.querySelector("[data-profile-form]"), model, setErr);
    if (key === "services") bindServicePicker($app.querySelector("[data-service-picker]"), data.services, model.selected);

    /** مقادیر مرحله‌ی فعلی را در model نگه می‌دارد تا با رفت‌وبرگشت بین مراحل از دست نروند */
    const capture = () => {
      if (key === "profile") model.profile = { ...model.profile, ...collectProfile($app.querySelector("[data-profile-form]"), model) };
      if (key === "password") {
        model.password = field("password").value;
        model.password2 = field("password2").value;
      }
    };
    /** پیام خطای مرحله‌ی فعلی، یا رشته‌ی خالی اگر همه‌چیز درست است */
    const problem = () => {
      if (key === "profile" && model.profile.orgName.length < 2) { field("orgName").focus(); return "نام شرکت یا پروژه را وارد کنید"; }
      if (key === "password") {
        if (model.password.length < 8) { field("password").focus(); return "رمز عبور باید حداقل ۸ کاراکتر باشد"; }
        if (model.password !== model.password2) { field("password2").focus(); return "رمز عبور و تکرارش یکی نیستند"; }
      }
      return "";
    };
    const go = (index, msg = "") => { model.step = index; draw(msg); $app.querySelector(".inst-card").scrollIntoView({ block: "start" }); };

    $app.querySelector("[data-inst-close]")?.addEventListener("click", () => boot());
    $app.querySelector("[data-inst-back]").addEventListener("click", () => { capture(); go(model.step - 1); });
    $app.querySelector("[data-inst-form]").addEventListener("submit", (e) => { e.preventDefault(); $app.querySelector("[data-inst-next]").click(); });
    $app.querySelector("[data-inst-next]").addEventListener("click", async (e) => {
      setErr("");
      capture();
      const msg = problem();
      if (msg) return setErr(msg);
      if (!last) return go(model.step + 1);
      const install = { profile: { ...model.profile, logo: model.logo }, services: [...model.selected] };
      try {
        const r = await busy(e.currentTarget, () => (setup
          ? api("auth/setup", { body: { password: model.password, install } })
          : api("install", { body: install })));
        model.password = model.password2 = "";
        state.profile = r.profile;
        state.providers = [];
        if (r.failed?.length) toast(`نصب کامل شد، ولی این سرویس‌ها روشن نشدند: ${r.failed.join("، ")}`, true);
        else toast(mandatory ? "نصب کامل شد" : "تغییرات ذخیره شد");
        boot();
      } catch (ex) {
        if (ex instanceof AuthError) return;
        // خطای کد یا رمز به مرحله‌ی رمز عبور برمی‌گردد، خطای مشخصات به مرحله‌ی مشخصات
        const target = /رمز/.test(ex.message) && setup ? "password" : /سایت|لوگو|نام|توضیح/.test(ex.message) ? "profile" : "";
        if (target) go(stepIndex(target), ex.message);
        else setErr(ex.message);
      }
    });
  };
  draw();
}

/** صفحه‌ی «نصب و مشخصات» داخل داشبورد: ویرایش مشخصات و افزودن/حذف سرویس‌ها پس از نصب */
async function pageInstall(main) {
  const data = await api("install");
  const model = { logo: data.profile.logo || "" };
  const selected = new Set(data.services.filter((s) => s.enabled).map((s) => s.id));
  const installed = data.profile.installedAt ? new Date(data.profile.installedAt).toLocaleDateString("fa-IR", { year: "numeric", month: "long", day: "numeric" }) : "";
  main.innerHTML = `${head("نصب و مشخصات", "مشخصات شرکت یا پروژه را ویرایش کنید و هر زمان سرویس تازه‌ای لازم شد همین‌جا فعالش کنید.", "حالت نصب",
    `<button class="btn btn-ghost btn-sm" type="button" id="rerun-installer">اجرای دوباره‌ی راهنمای نصب</button>`)}
    <div class="install-grid">
      <section class="panel">
        <h2>مشخصات شرکت یا پروژه</h2>
        <p class="desc">${installed ? `نصب اولیه در ${installed} کامل شده است.` : "نصب اولیه هنوز کامل نشده است."}</p>
        <form id="profile-form" novalidate>
          ${profileFieldsHtml(data.profile, "pg")}
          <div class="form-err" id="profile-err" role="alert"></div>
          <div class="settings-actions"><button class="btn btn-primary" type="submit">ذخیره مشخصات</button></div>
        </form>
      </section>
      <section class="panel">
        <h2>سرویس‌های فعال</h2>
        <p class="desc">سرویس تیک‌خورده در داشبورد و برای مدل در دسترس است. با برداشتن تیک، سرویس خاموش می‌شود ولی نشست ذخیره‌شده‌اش می‌ماند.</p>
        <div id="svc-picker">${servicePickerHtml(data.services, selected)}</div>
        <div class="form-err" id="svc-err" role="alert"></div>
        <div class="settings-actions"><button class="btn btn-primary" type="button" id="save-services" disabled>اعمال انتخاب‌ها</button><span class="hint" id="svc-status"></span></div>
      </section>
    </div>`;

  document.getElementById("rerun-installer").addEventListener("click", () => renderInstaller({ firstRun: false, setup: false }));

  const profileForm = document.getElementById("profile-form");
  const profileErr = document.getElementById("profile-err");
  bindProfileFields(profileForm, model, (m) => { profileErr.textContent = m; });
  profileForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    profileErr.textContent = "";
    const body = collectProfile(profileForm, model);
    if (body.orgName.length < 2) { profileErr.textContent = "نام شرکت یا پروژه را وارد کنید"; return; }
    try {
      const r = await busy(profileForm.querySelector("[type=submit]"), () => api("profile", { method: "PUT", body }));
      state.profile = r.profile;
      applyBrand();
      toast("مشخصات ذخیره شد");
    } catch (ex) {
      if (!(ex instanceof AuthError)) profileErr.textContent = ex.message;
    }
  });

  let current = data.services;
  const saveBtn = document.getElementById("save-services");
  const svcStatus = document.getElementById("svc-status");
  const changes = () => {
    const on = current.filter((s) => !s.enabledFromEnv && !s.enabled && selected.has(s.id));
    const off = current.filter((s) => !s.enabledFromEnv && s.enabled && !selected.has(s.id));
    return { on, off };
  };
  bindServicePicker(document.getElementById("svc-picker"), data.services, selected, () => {
    const { on, off } = changes();
    saveBtn.disabled = !on.length && !off.length;
    svcStatus.textContent = on.length || off.length ? `${fa(on.length)} سرویس روشن و ${fa(off.length)} سرویس خاموش می‌شود.` : "";
  });
  saveBtn.addEventListener("click", async () => {
    const svcErr = document.getElementById("svc-err");
    svcErr.textContent = "";
    const { off } = changes();
    if (off.length && !(await openModal({
      title: "خاموش کردن سرویس",
      message: `${off.map(serviceLabel).join("، ")} خاموش می‌شود و ابزارهایش از دسترس مدل خارج می‌شود. نشست ذخیره‌شده باقی می‌ماند.`,
      confirmText: "خاموش کن",
      tone: "danger",
    }))) return;
    try {
      const r = await busy(saveBtn, () => api("install/services", { method: "PUT", body: { services: [...selected] } }));
      current = r.services;
      state.providers = [];
      saveBtn.disabled = true;
      svcStatus.textContent = "ذخیره شد.";
      toast("سرویس‌های فعال به‌روز شد");
    } catch (ex) {
      if (!(ex instanceof AuthError)) svcErr.textContent = ex.message;
    }
  });
}

/** نام و لوگوی سازمان را در سربرگ کناری می‌نشاند؛ بدون مشخصات، برند دیباپل می‌ماند */
function applyBrand() {
  const p = state.profile || {};
  const logo = document.querySelector(".side .brand-logo");
  const title = document.querySelector(".side .brand-title");
  if (logo) logo.src = p.logo || "assets/logo-sm.png";
  if (title) { title.textContent = p.orgName || "دیباپل"; title.title = p.orgName || ""; }
}

// ---------------------------------------------------------------- agent dock
function agentDockHtml() {
  const a = state.agent;
  return `<div class="agent-dock${a.open ? " open" : ""}${a.full ? " full" : ""}" id="agent-dock">
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
        <div class="agent-head-actions">
          <button class="btn btn-icon btn-quiet" id="agent-clear" type="button" aria-label="پاک کردن گفتگو" title="پاک کردن گفتگو" disabled>${icons.trash}</button>
          <button class="btn btn-icon btn-quiet" id="agent-full" type="button" aria-label="${a.full ? "خروج از تمام‌صفحه" : "تمام‌صفحه"}">${a.full ? icons.minimize : icons.maximize}</button>
          <button class="btn btn-icon btn-quiet" id="agent-close" type="button" aria-label="بستن دستیار">${icons.cross}</button>
        </div>
      </header>
      <div class="agent-messages" id="agent-messages" aria-live="polite"></div>
      <form class="agent-form" id="agent-form">
        <textarea id="agent-input" rows="1" placeholder="درباره‌ی سیستم بپرس…" aria-label="سؤال از دستیار"></textarea>
        <button class="btn btn-ghost btn-icon agent-stop" id="agent-stop" type="button" aria-label="توقف پاسخ" title="توقف پاسخ (Esc)" hidden>${icons.stop}</button>
        <button class="btn btn-primary btn-icon" id="agent-send" type="submit" aria-label="ارسال">${icons.send}</button>
      </form>
      <div class="agent-foot">
        <a href="#/dibarouter">تنظیم دیبا روتر</a>
        <span>پاسخ‌ها با هوش مصنوعی دیبا روتر</span>
      </div>
    </section>
  </div>`;
}

function formatAgentText(text) {
  let html = esc(String(text ?? ""));
  const codeBlocks = [];
  html = html.replace(/```([\s\S]*?)```/g, (_m, code) => {
    const token = `\u0000CODE${codeBlocks.length}\u0000`;
    codeBlocks.push(`<pre class="agent-code"><code>${code.trim()}</code></pre>`);
    return token;
  });
  html = html.replace(/`([^`\n]+)`/g, '<code class="agent-inline-code">$1</code>');
  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/==([^=\n]+)==/g, "<mark>$1</mark>");
  html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  html = html.replace(/\n/g, "<br>");
  codeBlocks.forEach((block, i) => { html = html.replace(`\u0000CODE${i}\u0000`, block); });
  return html;
}

function renderAgentMessages() {
  const box = document.getElementById("agent-messages");
  if (!box) return;
  const hasStreaming = state.agent.messages.some((m) => m.streaming);
  box.innerHTML =
    state.agent.messages
      .map((m) => {
        const body = m.content
          ? (m.role === "assistant" ? formatAgentText(m.content) : esc(m.content).replace(/\n/g, "<br>")) + (m.streaming ? '<span class="agent-cursor" aria-hidden="true"></span>' : "")
          : m.streaming
            ? `<span class="agent-stream-status">${esc(m.status || "در حال فکر کردن…")}</span>`
            : "";
        const statusLine = m.streaming && m.content && m.status ? `<div class="agent-stream-status">${esc(m.status)}</div>` : "";
        const stopped = m.stopped ? `<div class="agent-stopped">${icons.stop}<span>پاسخ متوقف شد</span></div>` : "";
        const trace = Array.isArray(m.toolTrace) && m.toolTrace.length
          ? `<div class="agent-tool-trace">${m.toolTrace.map((t) => `<span class="${t.ok ? "ok" : "fail"}">${t.ok ? icons.check : "!"} ${esc(t.name)}</span>`).join("")}</div>`
          : "";
        const actions = !m.streaming && Array.isArray(m.actions) && m.actions.length
          ? `<div class="agent-actions">${m.actions.map((a) => `<button type="button" data-agent-action="${esc(a.value)}">${esc(a.label)}</button>`).join("")}</div>`
          : "";
        return `<div class="agent-msg ${m.role === "user" ? "is-user" : "is-bot"}"><div class="agent-bubble">${body}${statusLine}${stopped}${trace}${actions}</div></div>`;
      })
      .join("") +
    (state.agent.messages.length <= 1 && !state.agent.busy
      ? `<div class="agent-suggestions">
          ${["کدام سرویس‌ها آماده‌اند؟", "چرا یک سرویس آماده نیست؟", "چطور ایتا را وصل کنم؟", "از ابزارهای MCP استفاده کن و وضعیت را بررسی کن."]
            .map((q) => `<button type="button" data-agent-suggest="${esc(q)}">${esc(q)}</button>`)
            .join("")}
        </div>`
      : "") +
    (state.agent.busy && !hasStreaming ? `<div class="agent-msg is-bot"><div class="agent-bubble agent-typing"><i></i><i></i><i></i></div></div>` : "");
  box.scrollTop = box.scrollHeight;
  const clearBtn = document.getElementById("agent-clear");
  if (clearBtn) {
    const hasConversation = state.agent.messages.some((m) => m.role === "user") || state.agent.messages.length > 1;
    clearBtn.disabled = state.agent.busy || !hasConversation;
    clearBtn.title = state.agent.busy ? "تا پایان پاسخ صبر کنید" : hasConversation ? "پاک کردن گفتگو" : "گفتگویی برای پاک کردن نیست";
  }
  const sendBtn = document.getElementById("agent-send");
  if (sendBtn) {
    sendBtn.hidden = state.agent.busy;
    sendBtn.disabled = state.agent.busy;
  }
  const stopBtn = document.getElementById("agent-stop");
  if (stopBtn) {
    stopBtn.hidden = !state.agent.busy;
    stopBtn.disabled = !state.agent.busy;
  }
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
    state.agent.messages.push({ role: "assistant", content: AGENT_GREETING });
  }
  renderAgentMessages();
  refreshAgentConfig();
  // اگر حافظه‌ی محلی خالی است، تاریخچه‌ی سرور را برای همین دستگاه بارگذاری کن
  if (state.agent.messages.length <= 1) {
    api("agent/history?limit=40&conversationId=dashboard")
      .then((r) => {
        if (!Array.isArray(r.messages) || !r.messages.length) return;
        if (state.agent.busy || state.agent.messages.some((m) => m.role === "user")) return;
        state.agent.messages = r.messages.map((m) => ({ role: m.role, content: m.content }));
        saveAgentHistory();
        renderAgentMessages();
      })
      .catch(() => {});
  }

  const dock = document.getElementById("agent-dock");
  const panel = document.getElementById("agent-panel");
  const toggle = document.getElementById("agent-toggle");
  const close = document.getElementById("agent-close");
  const fullBtn = document.getElementById("agent-full");
  const clearBtn = document.getElementById("agent-clear");
  const input = document.getElementById("agent-input");
  const form = document.getElementById("agent-form");
  const stopBtn = document.getElementById("agent-stop");
  if (!dock || !panel || !form) return;

  /** توقف پاسخ در جریان: هم درخواست مرورگر و هم کار سرور لغو می‌شود */
  const stopRun = () => {
    if (!state.agent.busy) return;
    state.agent.abort?.abort();
  };
  if (stopBtn) stopBtn.onclick = stopRun;

  const applyLayout = () => {
    dock.classList.toggle("full", state.agent.full);
    document.querySelector(".shell")?.classList.toggle("with-agent", state.agent.open && !state.agent.full);
    document.body.classList.toggle("agent-fullscreen", state.agent.open && state.agent.full);
    if (fullBtn) {
      fullBtn.innerHTML = state.agent.full ? icons.minimize : icons.maximize;
      fullBtn.setAttribute("aria-label", state.agent.full ? "خروج از تمام‌صفحه" : "تمام‌صفحه");
    }
  };
  const setOpen = (open) => {
    state.agent.open = open;
    panel.hidden = !open;
    dock.classList.toggle("open", open);
    applyLayout();
    saveAgentPrefs();
    toggle.setAttribute("aria-expanded", String(open));
    if (open) setTimeout(() => input?.focus(), 50);
  };
  const setFull = (full) => {
    state.agent.full = full;
    applyLayout();
    saveAgentPrefs();
  };
  toggle.onclick = () => setOpen(!state.agent.open);
  close.onclick = () => setOpen(false);
  if (fullBtn) fullBtn.onclick = () => setFull(!state.agent.full);
  if (clearBtn) {
    clearBtn.onclick = async () => {
      if (state.agent.busy) return;
      const confirmed = await openModal({
        title: "پاک کردن گفتگو",
        message: "همه‌ی پیام‌های این گفتگو پاک می‌شود و دستیار از نو شروع می‌کند.",
        confirmText: "پاک کن",
        tone: "danger",
      });
      if (!confirmed) return;
      await api("agent/history", { method: "DELETE", body: { conversationId: "dashboard" } }).catch(() => {});
      state.agent.messages = [{ role: "assistant", content: AGENT_GREETING }];
      if (input) {
        input.value = "";
        input.style.height = "40px";
      }
      saveAgentHistory();
      renderAgentMessages();
      input?.focus();
      toast("گفتگو پاک شد");
    };
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.agent.open) {
      if (state.agent.busy) stopRun();
      else if (state.agent.full) setFull(false);
      else setOpen(false);
    }
  });
  applyLayout();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || state.agent.busy) return;
    input.value = "";
    input.style.height = "40px";
    state.agent.messages.push({ role: "user", content: text });
    for (const m of state.agent.messages) if (m.role === "assistant") m.actions = undefined;
    saveAgentHistory();
    const historyToSend = state.agent.messages.slice(-20);
    const botMsg = { role: "assistant", content: "", streaming: true, status: "در حال اتصال…", toolTrace: [] };
    state.agent.messages.push(botMsg);
    state.agent.busy = true;
    const controller = new AbortController();
    state.agent.abort = controller;
    let finished = false;
    renderAgentMessages();
    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ messages: historyToSend, stream: true, conversationId: "dashboard" }),
      });
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error || `HTTP ${res.status}`);
      }
      if (!ct.includes("text/event-stream") || !res.body) {
        const r = await res.json();
        botMsg.streaming = false;
        botMsg.content = r.reply || "پاسخی دریافت نشد.";
        botMsg.toolTrace = r.toolTrace || [];
        botMsg.actions = Array.isArray(r.actions) ? r.actions : [];
      } else {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        const handleEvent = (rawBlock) => {
          let ev = "message";
          let dataLines = [];
          for (const line of rawBlock.split(/\r?\n/)) {
            if (line.startsWith("event:")) ev = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
          }
          if (!dataLines.length) return;
          let payload;
          try { payload = JSON.parse(dataLines.join("\n")); } catch { return; }
          if (ev === "status") {
            botMsg.status = payload.text || "";
          } else if (ev === "delta") {
            botMsg.status = "";
            botMsg.content += payload.delta || "";
          } else if (ev === "tool") {
            botMsg.toolTrace.push(payload);
          } else if (ev === "done") {
            finished = true;
            botMsg.streaming = false;
            botMsg.status = "";
            if (payload.reply) botMsg.content = payload.reply;
            if (Array.isArray(payload.toolTrace)) botMsg.toolTrace = payload.toolTrace;
            botMsg.actions = Array.isArray(payload.actions) ? payload.actions : [];
            if (!botMsg.content) botMsg.content = "پاسخی دریافت نشد.";
          } else if (ev === "error") {
            throw new Error(payload.error || "خطا در دریافت پاسخ");
          }
          renderAgentMessages();
        };
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let sep = buf.indexOf("\n\n");
          while (sep >= 0) {
            handleEvent(buf.slice(0, sep));
            buf = buf.slice(sep + 2);
            sep = buf.indexOf("\n\n");
          }
        }
        if (buf.trim()) handleEvent(buf);
        botMsg.streaming = false;
        botMsg.status = "";
        if (!botMsg.content) botMsg.content = "پاسخی دریافت نشد.";
      }
    } catch (err) {
      botMsg.streaming = false;
      botMsg.status = "";
      if (controller.signal.aborted && !finished) {
        botMsg.stopped = true;
        if (!botMsg.content) botMsg.content = "پاسخ پیش از کامل شدن متوقف شد.";
      } else {
        const hint = /دیبا روتر|کلید/.test(err.message) ? "\n\nاز تب «دیبا روتر» اتصال را تنظیم کنید." : "";
        botMsg.content = `⚠️ ${err.message}${hint}`;
      }
    } finally {
      state.agent.busy = false;
      if (state.agent.abort === controller) state.agent.abort = null;
      renderAgentMessages();
      saveAgentHistory();
    }
  };
    input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(92, input.scrollHeight)}px`;
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  document.getElementById("agent-messages").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-agent-suggest]");
    if (chip) {
      input.value = chip.dataset.agentSuggest;
      form.requestSubmit();
      return;
    }
    const action = e.target.closest("[data-agent-action]");
    if (!action || state.agent.busy) return;
    input.value = action.dataset.agentAction;
    form.requestSubmit();
  });

  window.addEventListener("dibarouter-config", refreshAgentConfig);
}

// ---------------------------------------------------------------- shell
function renderShell() {
  $app.innerHTML = `
  <div class="shell${state.agent.open && !state.agent.full ? " with-agent" : ""}">
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
        ${pages.map((p) => {
          if (!p.submenu) {
            return `<a href="#/${p.id}" data-page="${p.id}">${icons[p.id]}<span>${p.title}</span></a>`;
          }
          // هر گروه فقط دو دسته دارد: ایرانی و خارجی
          return `<div class="nav-group" data-group="${p.id}">
            <a href="#/${p.id}" data-page="${p.id}" class="nav-parent" title="${p.title}">${icons[p.id]}<span>${p.title}</span>${icons.chevron}</a>
            <div class="nav-sub">
              <a href="#/${p.id}?region=iran" data-page="${p.id}" data-region="iran">${icons[p.id]}<span>ایرانی</span></a>
              <a href="#/${p.id}?region=other" data-page="${p.id}" data-region="other">${icons[p.id]}<span>خارجی</span></a>
            </div>
          </div>`;
        }).join("")}
      </nav>
      <div class="side-foot">
            <span class="ver-badge" id="ver"></span>
        <button class="btn btn-icon btn-quiet" id="logout" title="خروج از حساب" aria-label="خروج">${icons.logout}</button>
      </div>
    </aside>
    <main class="main" id="main"></main>
    ${agentDockHtml()}
  </div>`;
  applyBrand();
  document.getElementById("logout").onclick = async () => { await api("auth/logout", { body: {} }); boot(); };
  // باز و بسته کردن زیرمنوها؛ در نمای موبایل زیرمنو پنهان است و لینک مستقیم به صفحه می‌رود
  document.querySelectorAll(".nav-parent").forEach((navParent) => {
    navParent.addEventListener("click", (e) => {
      if (window.matchMedia("(max-width: 768px)").matches) return;
      e.preventDefault();
      navParent.closest(".nav-group")?.classList.toggle("open");
    });
  });
  initAgent();
}

// شنونده‌های صفحه‌ای که به #main وصل شده‌اند با هر بار رندر آزاد می‌شوند
let pageDispose = null;
function disposePage() {
  if (!pageDispose) return;
  try { pageDispose(); } catch { /* نادیده */ }
  pageDispose = null;
}

async function render() {
  clearInterval(state.timer);
  disposePage();
  const { page, q } = route();
  if (/^#\/inbox(?:\?|$)/.test(location.hash)) history.replaceState(null, "", "#/overview");
  // Update nav active state
  document.querySelectorAll(".nav a").forEach((a) => {
    let active = a.dataset.page === page;
    if (active && a.dataset.region) active = q.get("region") === a.dataset.region;
    if (active && a.classList.contains("nav-parent")) active = !q.get("region");
    if (active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  // زیرمنوی همان گروهی باز می‌ماند که صفحه‌اش باز است
  document.querySelectorAll(".nav-group").forEach((group) => {
    group.classList.toggle("open", group.dataset.group === page);
  });
  document.title = `${pages.find((p) => p.id === page).title} — Diba Bridge (دیبا پل) | دیباچین`;
  const main = document.getElementById("main");
  try {
    await ({ overview: pageOverview, providers: pageProviders, banking: (m, query) => pageProviders(m, query, "banking"), services: (m, query) => pageProviders(m, query, "services"), posts: pagePosts, playground: pagePlayground, triggers: pageTriggers, logs: pageLogs, dibarouter: pageDibaRouter, connect: pageConnect, install: pageInstall, settings: pageSettings })[page](main, q);
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
    <span class="meta call-dur">${fa(l.ms)} میلی‌ثانیه</span>
    <span class="meta call-ago">${ago(l.time)}</span>
  </div>`;
}

async function pageOverview(main) {
  const o = await api("overview");
  const verEl = document.getElementById("ver");
  if (verEl) verEl.textContent = `نسخه ${o.version}`;
  // فقط سرویس‌هایی که کاربر روشن کرده شمرده و نمایش داده می‌شوند؛ بقیه یک خط خلاصه دارند
  const active = o.providers.filter((p) => p.enabled);
  const inactive = o.providers.length - active.length;
  const ready = active.filter((p) => p.ready).length;
  const readinessPct = active.length ? Math.round((ready / active.length) * 100) : 0;
  const notReady = active.length - ready;
  // آماده‌ها بالا می‌آیند؛ بیشتر از این تعداد پشت «نمایش همه» می‌ماند
  const OV_VISIBLE = 8;
  const sorted = [...active].sort((a, b) => Number(b.ready) - Number(a.ready));
  const provCard = (p, hidden) => `
            <a class="ov-prov ${p.ready ? "is-ready" : "is-warn"}" href="${providerHref(p)}" ${hidden ? "hidden data-ov-more" : ""}>
              <span class="ov-prov-glyph" style="background:${p.color}">${providerLogo(p)}</span>
              <span class="ov-prov-text">
                <b>${esc(serviceLabel(p))}</b>
                <small>${p.ready ? `${fa(p.toolCount)} ابزار` : "نیاز به تنظیم"}</small>
              </span>
              <span class="ov-dot" aria-hidden="true"></span>
            </a>`;
  main.innerHTML = `
    ${head("نمای کلی", "وضعیت اتصال، مصرف امروز و آخرین فراخوانی‌ها در یک نگاه.", "داشبورد دیباچین")}
    <section class="ov-grid">
      <div class="ov-status">
        <div class="ov-status-head">
          <div>
            <span class="eyebrow">وضعیت زنده</span>
            <h2>سرویس‌ها</h2>
          </div>
          <span class="pill ${active.length && ready === active.length ? "pill-ok" : ready ? "pill-warn" : "pill-off"}">
            ${active.length ? `${fa(ready)} از ${fa(active.length)} آماده` : "سرویسی فعال نیست"}
          </span>
        </div>
        ${active.length ? `
        <div class="ov-provider-list">
          ${sorted.map((p, i) => provCard(p, i >= OV_VISIBLE)).join("")}
        </div>
        ${sorted.length > OV_VISIBLE ? `<button class="ov-more" type="button" id="ov-more" aria-expanded="false">نمایش ${fa(sorted.length - OV_VISIBLE)} سرویس دیگر</button>` : ""}` : `
        <div class="empty ov-empty"><b>هنوز سرویسی فعال نکرده‌اید</b>از بخش «نصب و مشخصات» سرویس‌هایی که لازم دارید را روشن کنید.</div>`}
        ${inactive ? `<p class="ov-inactive">${fa(inactive)} سرویس دیگر خاموش است و اینجا نمایش داده نمی‌شود. <a href="#/install">فعال کردن سرویس</a></p>` : ""}
        <div class="ov-status-foot">
          <button class="btn btn-ghost btn-sm" id="netcheck">بررسی دسترسی شبکه</button>
          <a class="link-arrow" href="#/install">مدیریت سرویس‌ها</a>
        </div>
        <div class="calls ov-net-out" id="net-out" hidden aria-live="polite"></div>
      </div>

      <aside class="ov-insight">
        <div class="ov-health">
          <div class="ov-health-head">
            <span>آمادگی سرویس‌ها</span>
            <b>${fa(ready)}<small>/${fa(active.length)}</small></b>
          </div>
          <div class="ov-meter" role="img" aria-label="${fa(ready)} از ${fa(active.length)} سرویس فعال آماده">
            <i style="width:${readinessPct}%"></i>
          </div>
          <small class="ov-health-note">${!active.length ? "سرویسی فعال نیست" : notReady ? `${fa(notReady)} سرویس فعال هنوز به تنظیم نیاز دارد` : "همه‌ی سرویس‌های فعال آماده‌اند"}</small>
        </div>
        <div class="ov-metric-list">
          <div><span>فراخوانی امروز</span><b>${fa(o.stats.today)}</b></div>
          <div><span>نرخ موفقیت امروز</span><b>${o.stats.successRate === null ? "—" : fa(o.stats.successRate) + "٪"}</b></div>
          <div><span>میانگین پاسخ امروز</span><b>${o.stats.avgMs === null ? "—" : `${fa(o.stats.avgMs)} <small>ms</small>`}</b></div>
        </div>
        <div class="ov-next">
          <span class="ov-kicker">قدم بعدی</span>
          <b>${ready === 0 ? "اولین سرویس را وصل کنید" : "ابزارها را به مدل وصل کنید"}</b>
          <p>${ready === 0 ? "یک سرویس را روشن و حسابش را وصل کنید تا ابزارهایش در دسترس هوش مصنوعی قرار بگیرد." : "آدرس MCP و توکن اتصال را بردارید و در Claude یا کلاینت MCP ثبت کنید."}</p>
          <div class="ov-next-actions">
            ${ready === 0
      ? `<a class="btn btn-primary" href="${active[0] ? providerHref(active[0]) : "#/install"}">اتصال سرویس</a><a class="btn btn-ghost" href="#/connect">راهنمای اتصال</a>`
      : `<a class="btn btn-primary" href="#/connect">اتصال به مدل</a><a class="btn btn-ghost" href="#/logs">${icons.logs} گزارش‌ها</a>`}
          </div>
        </div>
      </aside>
    </section>

    <div class="section-title ov-recent-title">
      <h2>آخرین فراخوانی‌ها</h2>
      <a class="link-arrow" href="#/logs">مشاهده همه گزارش‌ها</a>
    </div>
    <div class="calls">
      <div class="call call-head" aria-hidden="true">
        <span></span><span class="col-label">ابزار</span><span class="src">منبع</span><span class="meta call-dur">مدت</span><span class="meta call-ago">زمان</span>
      </div>
      ${o.recent.length ? o.recent.slice(0, 5).map((l) => callRow(l)).join("") : `<div class="empty"><b>هنوز ابزاری فراخوانی نشده است</b>از بخش «آزمایش ابزارها» اولین پیام را ارسال کنید.</div>`}
    </div>`;

  document.getElementById("ov-more")?.addEventListener("click", (e) => {
    main.querySelectorAll("[data-ov-more]").forEach((el) => { el.hidden = false; });
    e.currentTarget.remove();
  });
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
  const pick = "";
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
      ${a.qr ? `
        <div class="auth-row">
          <button class="btn btn-primary" type="button" data-auth-start>نمایش QR ورود</button>
        </div>
        <span class="hint">QR را با WhatsApp → Linked devices → Link a device اسکن کنید.</span>
      ` : `
        <div class="auth-row">
          <input class="input ltr-input" data-auth-phone placeholder="${esc(a.inputPlaceholder || "09121234567")}" value="${esc(phone)}" inputmode="text" aria-label="${esc(a.inputLabel || "شماره تلفن")}">
          <button class="btn btn-primary" type="button" data-auth-start>${esc(a.startLabel || "ارسال کد ورود")}</button>
        </div>
        <span class="hint">${a.credentials === "username" ? "نام کاربری را بدون @ وارد کنید؛ سپس رمز عبور را در مرحله بعد وارد کنید." : /واتس/.test(a.title) ? "کد لینک را در گوشی (Linked devices) وارد کنید؛ سپس همین‌جا «تأیید کد» را بزنید." : "شماره را به همراه ۰۹ یا +۹۸ وارد کنید. کد تأیید از پیامک یا پیام‌رسان ارسال خواهد شد."}</span>
      `}
    </div>
    <div class="auth-step" data-auth-step="qr" hidden>
      <div class="auth-qr-wrap">
        <img data-auth-qr alt="کد QR ورود واتس‌اپ" width="240" height="240">
      </div>
      <div class="auth-row">
        <button class="btn btn-primary" type="button" data-auth-verify-code>بررسی اتصال</button>
        <button class="btn btn-ghost" type="button" data-auth-resend>QR جدید</button>
      </div>
      <span class="hint" data-auth-qr-hint>QR را اسکن کنید؛ سپس «بررسی اتصال» را بزنید.</span>
    </div>
    <div class="auth-step" data-auth-step="code" hidden>
      <div class="auth-row">
        ${a.codeInput === false ? "" : `<input class="input ltr-input" data-auth-code placeholder="کد تأیید ورود" inputmode="numeric" autocomplete="one-time-code" aria-label="کد ورود">`}
        <button class="btn btn-primary" type="button" data-auth-verify-code>${a.codeInput === false ? "بررسی اتصال" : "تأیید کد"}</button>
        ${a.credentials === "username" ? "" : `<button class="btn btn-ghost" type="button" data-auth-resend>ارسال دوباره کد</button>`}
        <button class="btn btn-ghost" type="button" data-auth-back>${a.credentials === "username" ? "تغییر نام کاربری" : "تغییر شماره"}</button>
      </div>
      <span class="hint" data-auth-code-hint>کد فرستاده شد.</span>
    </div>
    <div class="auth-step" data-auth-step="password" hidden>
      <div class="auth-row">
        <input class="input ltr-input" type="password" data-auth-password placeholder="${a.credentials === "username" ? "رمز عبور حساب" : "رمز دومرحله‌ای حساب"}" autocomplete="current-password" aria-label="رمز عبور">
        <button class="btn btn-primary" type="button" data-auth-verify-password>${a.credentials === "username" ? "ورود" : "تأیید رمز"}</button>
      </div>
      <span class="hint">${esc(a.passwordHint || "این حساب دارای تأیید دو مرحله‌ای است. رمز را وارد کنید.")}</span>
    </div>
    ${!logged && a.browserLogin ? `<div class="auth-browser-login" data-auth-browser>
      <div class="auth-browser-head">
        <b>${esc(a.browserLogin.title)}</b>
        <span class="pill pill-dev">توصیه‌شده</span>
      </div>
      <p class="hint">${esc(a.browserLogin.hint)}</p>
      <button class="btn btn-primary" type="button" data-auth-browser-start>باز کردن پنجره‌ی ورود</button>
      <div class="test-out" data-auth-browser-out></div>
    </div>` : ""}
    ${!logged && a.sessionImport ? `<details class="auth-import" data-auth-import-box>
      <summary>${esc(a.sessionImport.title)}</summary>
      <p class="hint">${esc(a.sessionImport.hint)}</p>
      <textarea class="textarea ltr-input" data-auth-import-input rows="3" placeholder="${esc(a.sessionImport.placeholder)}" aria-label="${esc(a.sessionImport.title)}" spellcheck="false"></textarea>
      <div class="auth-row">
        <button class="btn btn-ghost" type="button" data-auth-import>ورود با نشست</button>
      </div>
    </details>` : ""}
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

function renderProviderMode(p, _plat) {
  if (!p) {
    return `<div class="empty"><b>این سرویس هنوز اتصالی ندارد.</b></div>`;
  }
  const fields = p.auth ? p.fields.filter((f) => f.key !== p.auth.sessionField) : p.fields;
  const isAccount = Boolean(p.auth);
  return `
    <div class="prov-mode-container" data-id="${p.id}">
      <div class="prov-mode-banner">
        <div class="prov-mode-meta">
          <span class="mode-tag ${isAccount ? "mode-tag-client" : "mode-tag-bot"}">
            ${isAccount ? icons.user : icons.shield}
            ${isAccount ? "حساب کاربری (کلاینت)" : p.unofficial ? "API غیررسمی اپلیکیشن" : "API رسمی"}
          </span>
          <p class="prov-mode-desc">
            ${isAccount
      ? "اتصال از طریق پروتکل وب؛ ارسال و دریافت دوطرفه پیام‌ها به عنوان کاربر واقعی با دسترسی به مخاطبان و گروه‌ها."
      : p.description || "اتصال با API رسمی سرویس؛ تنظیمات را از این بخش وارد کنید."}
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
          ${p.id === "whatsapp" ? `
          <div class="wa-chat-panel" data-wa-chats>
            <div class="wa-chat-head">
              <div><b>چت‌ها و کانال‌های واتس‌اپ</b><span class="hint">گروه‌ها، گفتگوهای خصوصی و کانال‌ها</span></div>
              <div class="wa-chat-actions">
                <button class="btn btn-ghost btn-sm" type="button" data-wa-contacts>مخاطبین</button>
                <button class="btn btn-ghost btn-sm" type="button" data-wa-sync>همگام‌سازی</button>
                <button class="btn btn-ghost btn-sm" type="button" data-wa-load>نمایش لیست</button>
              </div>
            </div>
            <div class="wa-chat-list" data-wa-list><span class="hint">برای دریافت لیست، دکمه را بزنید.</span></div>
          </div>` : ""}
        </div>

        <div class="prov-tools-col">
          <div class="prov-tools-card">
            <h3>
              <span class="icon-inline">${icons.sparkles}</span>
              ${fa(p.tools.length)} ابزار هوش مصنوعی در اختیار مدل
            </h3>
            <input class="input tool-search" type="search" placeholder="جستجوی ابزار…" aria-label="جستجوی ابزار" oninput="this.closest('.prov-tools-card').querySelectorAll('.tool-line').forEach((x) => x.hidden = !x.innerText.toLowerCase().includes(this.value.toLowerCase()))">
            <div class="tool-list-compact">
              ${p.tools.map((t) => `<div class="tool-line"><a href="#/playground?tool=${t.name}" title="${esc(t.name)}">${esc(t.title)}</a></div>`).join("")}
            </div>
            ${p.docsUrl ? `<div class="prov-docs-link"><a href="${esc(p.docsUrl)}" target="_blank" rel="noopener">${icons.external} مستندات رسمی ${esc(p.nameFa)}</a></div>` : ""}
          </div>
        </div>
      </div>
    </div>`;
}

function providerTutorialHtml(plat) {
  const tutorial = providerTutorials[plat.key];
  if (!tutorial?.client?.length) return "";
  const isAccount = Boolean(plat.provider?.auth);
  return `
    <section class="prov-tutorial active" aria-label="راهنمای اتصال ${esc(plat.nameFa)}">
      <div class="prov-tutorial-head">
        <span class="prov-tutorial-mark">${icons.check}</span>
        <div>
          <b>راهنمای اتصال ${esc(plat.nameFa)}</b>
          <small>${isAccount ? "ورود با حساب کاربری" : "پیکربندی API"}</small>
        </div>
      </div>
      <ol class="prov-tutorial-steps">
        ${tutorial.client.map((step) => `<li>${esc(step)}</li>`).join("")}
      </ol>
      <div class="prov-tutorial-foot">
        <span>${icons.shield} نشست‌ها و توکن‌ها فقط در سرور ذخیره می‌شوند.</span>
        <span class="prov-tutorial-links">
          ${tutorial.appUrl ? `<a href="${esc(tutorial.appUrl)}" target="_blank" rel="noopener">${icons.external} ساخت اپ</a>` : ""}
          ${plat.docsUrl ? `<a href="${esc(plat.docsUrl)}" target="_blank" rel="noopener">${icons.external} مستندات رسمی</a>` : ""}
        </span>
      </div>
    </section>`;
}

function platformAccordionHtml(plat) {
  const isOpen = state.openPlatform === plat.key;
  const p = plat.provider;
  const isAccount = Boolean(p?.auth);
  const isReady = Boolean(p?.ready);

  return `
  <article class="prov-card ${isOpen ? "open" : ""} ${isReady ? "is-ready" : ""}" data-plat="${plat.key}">
    <div class="prov-card-header" data-plat-header="${plat.key}">
      <div class="disc" style="background:${plat.color}">${providerLogo(plat)}</div>
      <div class="prov-info">
        <div class="prov-info-top">
          <b class="prov-name">${esc(plat.nameFa)}</b>
          <span class="en-tag">${esc(plat.nameEn)}</span>
          ${p ? `<span class="region-tag">${isIranianProvider(p) ? "ایرانی" : "خارجی"}</span>` : ""}
        </div>
        <p class="prov-desc">${esc(plat.description)}</p>
      </div>

      <div class="prov-summary-badges">
        <span class="mode-badge ${p?.ready ? "ready" : ""}">${isAccount ? "حساب کاربری" : "API"}: ${status(p)}</span>
      </div>

      ${p ? `<label class="switch prov-quick-toggle" title="${p.enabledFromEnv ? "از env کنترل می‌شود" : p.enabled ? "خاموش کردن این حساب" : "روشن کردن این حساب"}">
        <input type="checkbox" data-toggle data-id="${p.id}" ${p.enabled ? "checked" : ""} ${p.enabledFromEnv ? "disabled" : ""} aria-label="${p.enabled ? "خاموش کردن" : "روشن کردن"} ${esc(p.nameFa)}">
        <span></span>
      </label>` : ""}

      <button type="button" class="btn btn-icon btn-quiet prov-toggle-btn" data-plat-expand="${plat.key}" aria-expanded="${isOpen}" aria-label="تنظیمات ${esc(plat.nameFa)}">
        ${icons.chevron}
      </button>
    </div>

    <div class="prov-card-body">
      <div class="prov-card-content">
        <div class="plat-panels">
          <div class="plat-panel active">
            ${renderProviderMode(p, plat)}
          </div>
        </div>
        ${providerTutorialHtml(plat)}
      </div>
    </div>
  </article>`;
}

// ---------------------------------------------------------------- posts / broadcast
const POST_PROVIDER_IDS = ["whatsapp", "telegram_client", "bale_client", "eitaa_client", "rubika_client", "soroush_client"];
const postTargetKey = (t) => `${t.provider}:${t.chatId}`;
const postTypeLabel = (type) => ({ private: "خصوصی", group: "گروه", channel: "کانال" }[type] || "مقصد");

async function pagePosts(main) {
  state.providers = await api("providers");
  const templatesResponse = await api("post-templates").catch(() => ({ templates: [] }));
  const providers = state.providers.filter((p) => POST_PROVIDER_IDS.includes(p.id));
  const chats = new Map();
  const loading = new Set();
  const errors = new Map();
  const selectedProviders = new Set();
  const targets = new Map();
  let filter = "all";
  let search = "";
  let editingId = "";
  let templates = templatesResponse.templates || [];

  const providerById = (id) => providers.find((p) => p.id === id);
  const providerName = (id) => {
    const p = providerById(id);
    return p ? serviceLabel(p) : id;
  };
  const allChats = () => [...selectedProviders].flatMap((id) => (chats.get(id) || []).map((c) => ({ ...c, provider: id })));
  const visibleChats = () => allChats().filter((c) => (filter === "all" || c.type === filter) && (!search || `${c.title} ${c.lastText || ""}`.toLowerCase().includes(search.toLowerCase())));

  main.innerHTML = `${head("ارسال پست", "متن را یک‌بار بنویس، مقصدها را انتخاب کن و همان پست را برای همه‌ی چت‌ها، گروه‌ها و کانال‌ها بفرست.", "ارسال گروهی",
    `<button class="btn btn-ghost btn-sm" type="button" data-post-new><span aria-hidden="true">+</span> قالب جدید</button>`)}
    <div class="post-layout">
      <section class="panel post-compose">
        <div class="post-section-head">
          <div><h2>متن پست</h2><p class="desc">یک قالب بساز و بعداً با یک کلیک دوباره استفاده کن.</p></div>
          <span class="post-target-count" data-target-count>۰ مقصد</span>
        </div>
        <div class="field post-name-field">
          <label for="post-name">نام قالب <span class="req">*</span></label>
          <input id="post-name" class="input" maxlength="80" placeholder="مثلاً اطلاعیه‌ی ساعت کاری">
        </div>
        <div class="field">
          <label for="post-text">متن پست <span class="req">*</span></label>
          <textarea id="post-text" class="textarea post-textarea" maxlength="4096" rows="8" placeholder="متن خود را بنویس…"></textarea>
          <div class="post-counter"><span data-char-count>۰</span><span>از ۴۰۹۶ کاراکتر</span></div>
        </div>
        <div class="post-preview-wrap">
          <span class="post-mini-label">پیش‌نمایش</span>
          <div class="post-preview" data-post-preview><span class="hint">متن پست اینجا نمایش داده می‌شود.</span></div>
        </div>
        <div class="post-actions">
          <button class="btn btn-primary" type="button" data-post-send>${icons.posts} ارسال به همه</button>
          <button class="btn btn-ghost" type="button" data-post-save>ذخیره‌ی قالب</button>
          <span class="hint" data-post-save-state></span>
        </div>
        <div class="post-result" data-post-result></div>
      </section>

      <section class="panel post-targets">
        <div class="post-section-head">
          <div><h2>مقصدها</h2><p class="desc">سرویس را انتخاب کن؛ سپس چت، گروه یا کانال را تیک بزن.</p></div>
          <span class="post-target-count" data-target-count>۰ مقصد</span>
        </div>
        <div class="post-provider-grid" id="post-provider-grid" aria-label="انتخاب سرویس">
          ${providers.map((p) => {
            const disabled = !p.ready;
            return `<button class="post-provider ${selectedProviders.has(p.id) ? "is-on" : ""}" type="button" data-post-provider="${p.id}" ${disabled ? "disabled" : ""} aria-pressed="${selectedProviders.has(p.id)}">
              <span class="post-provider-logo" style="background:${esc(p.color)}">${providerLogo(p)}</span>
              <span class="post-provider-text"><b>${esc(serviceLabel(p))}</b><small>${disabled ? "نیاز به اتصال" : "آماده"}</small></span>
              <span class="post-provider-tick">${selectedProviders.has(p.id) ? icons.check : ""}</span>
            </button>`;
          }).join("")}
        </div>
        <div id="post-chat-panel"></div>
      </section>
    </div>

    <section class="post-library">
      <div class="post-library-head"><div><h2>قالب‌های ذخیره‌شده</h2><p class="desc">قالب‌های آماده برای ارسال سریع به همان مقصدها.</p></div><span class="meta" data-template-count></span></div>
      <div class="post-template-grid" data-template-list></div>
    </section>`;

  const providerGrid = document.getElementById("post-provider-grid");
  const chatPanel = document.getElementById("post-chat-panel");
  const nameInput = document.getElementById("post-name");
  const textInput = document.getElementById("post-text");
  const preview = document.querySelector("[data-post-preview]");
  const resultBox = document.querySelector("[data-post-result]");
  const templateList = document.querySelector("[data-template-list]");
  const saveState = document.querySelector("[data-post-save-state]");

  function updateCounts() {
    document.querySelectorAll("[data-target-count]").forEach((el) => (el.textContent = `${fa(targets.size)} مقصد`));
  }

  function renderPreview() {
    const value = textInput.value.trim();
    preview.innerHTML = value ? esc(value) : `<span class="hint">متن پست اینجا نمایش داده می‌شود.</span>`;
    document.querySelector("[data-char-count]").textContent = fa(textInput.value.length);
  }

  function providerCard(p) {
    const disabled = !p.ready;
    return `<button class="post-provider ${selectedProviders.has(p.id) ? "is-on" : ""}" type="button" data-post-provider="${p.id}" ${disabled ? "disabled" : ""} aria-pressed="${selectedProviders.has(p.id)}">
      <span class="post-provider-logo" style="background:${esc(p.color || "#64748b")}">${providerLogo(p)}</span>
      <span class="post-provider-text"><b>${esc(serviceLabel(p))}</b><small>${disabled ? "نیاز به اتصال" : "آماده"}</small></span>
      <span class="post-provider-tick">${selectedProviders.has(p.id) ? icons.check : ""}</span>
    </button>`;
  }

  function renderProviderGrid() {
    providerGrid.innerHTML = providers.map(providerCard).join("");
  }

  function chatMatches(c) {
    const q = search.trim().toLowerCase();
    if (filter !== "all" && c.type !== filter) return false;
    if (q && !`${c.title} ${c.lastText || ""}`.toLowerCase().includes(q)) return false;
    return true;
  }

  function chatRow(c) {
    const key = postTargetKey(c);
    const checked = targets.has(key);
    return `<label class="post-chat">
      <input type="checkbox" data-post-chat="${esc(key)}" ${checked ? "checked" : ""}>
      <span class="post-chat-kind post-kind-${esc(c.type || "private")}">${esc(postTypeLabel(c.type))}</span>
      <span class="post-chat-body"><b>${esc(c.title)}</b><small>${esc(c.lastText || "بدون پیام اخیر")}</small></span>
      <span class="post-chat-provider">${esc(providerName(c.provider))}</span>
    </label>`;
  }

  function renderChatPanel() {
    updateCounts();
    if (!selectedProviders.size) {
      chatPanel.innerHTML = `<div class="post-empty"><b>هنوز سرویسی انتخاب نشده</b><span>یکی از سرویس‌های بالا را انتخاب کن تا چت‌ها، گروه‌ها و کانال‌هایش را ببینی.</span></div>`;
      return;
    }
    const filters = [["all", "همه"], ["private", "خصوصی"], ["group", "گروه"], ["channel", "کانال"]];
    const selectedChats = [...selectedProviders].map((id) => {
      const loadingNow = loading.has(id);
      const err = errors.get(id);
      return `<section class="post-provider-block">
        <div class="post-provider-block-head">
          <div><span class="post-provider-logo" style="background:${esc(providerById(id)?.color || "#64748b")}">${providerById(id) ? providerLogo(providerById(id)) : ""}</span><b>${esc(providerName(id))}</b></div>
          <div class="post-provider-block-actions">
            <button class="post-mini-link" type="button" data-post-refresh="${id}">${icons.refresh} به‌روزرسانی</button>
            <button class="post-mini-link" type="button" data-post-select-all="${id}">انتخاب همه</button>
          </div>
        </div>
        ${loadingNow ? `<div class="post-loading"><span class="boot-dot"></span>در حال دریافت گفتگوها…</div>` : err ? `<div class="err-box">${esc(err)}</div>` : (() => {
          const list = (chats.get(id) || []).filter(chatMatches);
          return list.length ? `<div class="post-chat-list">${list.map(chatRow).join("")}</div>` : `<div class="post-empty post-empty-small">گفتگویی با این فیلتر پیدا نشد.</div>`;
        })()}
      </section>`;
    }).join("");
    chatPanel.innerHTML = `<div class="post-chat-toolbar">
        <div class="post-filter" role="group" aria-label="نوع مقصد">
          ${filters.map(([key, label]) => `<button type="button" class="post-filter-btn ${filter === key ? "is-on" : ""}" data-post-filter="${key}">${label}</button>`).join("")}
        </div>
        <label class="post-search"><span class="sr-only">جستجوی مقصد</span><input class="input" type="search" placeholder="جستجوی نام مقصد…" value="${esc(search)}" data-post-search></label>
      </div>${selectedChats}`;
  }

  async function loadChats(id) {
    if (loading.has(id)) return;
    loading.add(id);
    errors.delete(id);
    renderChatPanel();
    try {
      const r = await api(`posts/chats?provider=${encodeURIComponent(id)}`);
      chats.set(id, r.chats || []);
    } catch (err) {
      errors.set(id, err.message);
    } finally {
      loading.delete(id);
      renderChatPanel();
    }
  }

  function addTemplateTargets(t) {
    for (const target of t.targets || []) {
      if (!target?.provider || !target?.chatId) continue;
      targets.set(postTargetKey(target), { provider: target.provider, chatId: target.chatId, title: target.title || target.chatId, type: target.type || "private" });
      if (!selectedProviders.has(target.provider)) selectedProviders.add(target.provider);
    }
    for (const id of t.providerIds || []) if (providers.some((p) => p.id === id)) selectedProviders.add(id);
  }

  function renderTemplates() {
    document.querySelector("[data-template-count]").textContent = `${fa(templates.length)} قالب`;
    if (!templates.length) {
      templateList.innerHTML = `<div class="post-empty"><b>هنوز قالبی ذخیره نشده</b><span>متن را بنویس، مقصدها را انتخاب کن و «ذخیره‌ی قالب» را بزن.</span></div>`;
      return;
    }
    templateList.innerHTML = templates.map((t) => `<article class="post-template-card ${editingId === t.id ? "is-editing" : ""}">
      <div class="post-template-top"><b>${esc(t.name)}</b><span>${fa((t.targets || []).length)} مقصد</span></div>
      <p>${esc((t.text || "").slice(0, 160))}${(t.text || "").length > 160 ? "…" : ""}</p>
      <div class="post-template-targets">${[...new Set((t.targets || []).map((x) => x.provider))].map((id) => `<span>${esc(providerName(id))}</span>`).join("") || "<span>بدون مقصد</span>"}</div>
      <div class="post-template-actions"><button class="btn btn-ghost btn-sm" type="button" data-post-load="${t.id}">بارگذاری</button><button class="btn btn-quiet btn-sm btn-danger" type="button" data-post-delete="${t.id}">حذف</button></div>
    </article>`).join("");
  }

  function collectTargets() {
    return [...targets.values()];
  }

  function validateCompose(requireName = true) {
    const name = nameInput.value.trim();
    const text = textInput.value.trim();
    if (!text) { toast("متن پست را وارد کنید.", true); textInput.focus(); return null; }
    if (requireName && !name) { toast("نام قالب را وارد کنید.", true); nameInput.focus(); return null; }
    return { name, text, providerIds: [...selectedProviders], targets: collectTargets() };
  }

  providerGrid.addEventListener("click", async (e) => {
    const button = e.target.closest("[data-post-provider]");
    if (!button || button.disabled) return;
    const id = button.dataset.postProvider;
    if (selectedProviders.has(id)) {
      selectedProviders.delete(id);
      for (const [key, target] of targets) if (target.provider === id) targets.delete(key);
    } else {
      selectedProviders.add(id);
    }
    renderProviderGrid();
    renderChatPanel();
    if (selectedProviders.has(id) && !chats.has(id)) await loadChats(id);
  });

  chatPanel.addEventListener("click", async (e) => {
    const filterBtn = e.target.closest("[data-post-filter]");
    if (filterBtn) { filter = filterBtn.dataset.postFilter; renderChatPanel(); return; }
    const refresh = e.target.closest("[data-post-refresh]");
    if (refresh) { const id = refresh.dataset.postRefresh; chats.delete(id); await loadChats(id); return; }
    const all = e.target.closest("[data-post-select-all]");
    if (all) {
      const id = all.dataset.postSelectAll;
      for (const c of (chats.get(id) || []).filter(chatMatches)) targets.set(postTargetKey(c), { provider: c.provider, chatId: c.chatId, title: c.title, type: c.type });
      renderChatPanel(); return;
    }
  });
  chatPanel.addEventListener("change", (e) => {
    const cb = e.target.closest("[data-post-chat]");
    if (!cb) return;
    const raw = cb.dataset.postChat;
    const sep = raw.indexOf(":");
    const provider = raw.slice(0, sep), chatId = raw.slice(sep + 1);
    if (cb.checked) {
      const c = allChats().find((x) => x.provider === provider && x.chatId === chatId);
      targets.set(postTargetKey({ provider, chatId }), { provider, chatId, title: c?.title || chatId, type: c?.type || "private" });
    } else {
      targets.delete(postTargetKey({ provider, chatId }));
    }
    updateCounts();
  });
  chatPanel.addEventListener("input", (e) => {
    if (!e.target.matches("[data-post-search]")) return;
    search = e.target.value;
    chatPanel.querySelectorAll(".post-chat").forEach((row) => {
      row.hidden = !row.innerText.toLowerCase().includes(search.trim().toLowerCase());
    });
  });

  templateList.addEventListener("click", async (e) => {
    const load = e.target.closest("[data-post-load]");
    if (load) {
      const t = templates.find((x) => x.id === load.dataset.postLoad);
      if (!t) return;
      editingId = t.id;
      nameInput.value = t.name || "";
      textInput.value = t.text || "";
      selectedProviders.clear();
      targets.clear();
      addTemplateTargets(t);
      renderProviderGrid(); renderPreview(); renderChatPanel(); renderTemplates();
      await Promise.all([...selectedProviders].filter((id) => !chats.has(id)).map(loadChats));
      return;
    }
    const del = e.target.closest("[data-post-delete]");
    if (del) {
      const t = templates.find((x) => x.id === del.dataset.postDelete);
      if (!t || !(await openModal({ title: "حذف قالب", message: `قالب «${t.name}» حذف شود؟`, confirmText: "حذف", tone: "danger" }))) return;
      try { await api(`post-templates/${t.id}`, { method: "DELETE" }); templates = templates.filter((x) => x.id !== t.id); if (editingId === t.id) editingId = ""; renderTemplates(); toast("قالب حذف شد"); } catch (err) { toast(err.message, true); }
    }
  });

  document.querySelector("[data-post-new]").onclick = () => {
    editingId = ""; nameInput.value = ""; textInput.value = ""; selectedProviders.clear(); targets.clear();
    renderProviderGrid(); renderChatPanel(); renderPreview(); renderTemplates(); nameInput.focus();
  };
  textInput.addEventListener("input", renderPreview);
  document.querySelector("[data-post-save]").onclick = async (e) => {
    const data = validateCompose();
    if (!data) return;
    const btn = e.currentTarget;
    saveState.textContent = "";
    try {
      const r = await busy(btn, () => api(editingId ? `post-templates/${editingId}` : "post-templates", { method: editingId ? "PUT" : "POST", body: data }));
      editingId = r.template?.id || editingId;
      templates = [r.template, ...templates.filter((x) => x.id !== r.template?.id)];
      renderTemplates();
      saveState.textContent = "ذخیره شد";
      toast("قالب ذخیره شد");
    } catch (err) {
      saveState.textContent = "";
      toast(err.message, true);
    }
  };
  document.querySelector("[data-post-send]").onclick = async (e) => {
    const data = validateCompose(false);
    if (!data) return;
    if (!data.targets.length) { toast("حداقل یک چت، گروه یا کانال انتخاب کنید.", true); return; }
    if (!(await openModal({ title: "ارسال پست", message: `این پست برای ${fa(data.targets.length)} مقصد در ${fa(new Set(data.targets.map((t) => t.provider)).size)} سرویس ارسال شود؟`, confirmText: "ارسال به همه" }))) return;
    const btn = e.currentTarget;
    resultBox.innerHTML = `<div class="post-loading"><span class="boot-dot"></span>در حال ارسال به ${fa(data.targets.length)} مقصد…</div>`;
    try {
      const r = await busy(btn, () => api("posts/send", { body: { text: data.text, targets: data.targets, confirm: true } }));
      const ok = (r.results || []).filter((x) => x.ok).length;
      const failed = (r.results || []).length - ok;
      resultBox.innerHTML = `<div class="post-result-head"><b>${fa(ok)} ارسال موفق</b>${failed ? `<span class="post-result-fail">${fa(failed)} ناموفق</span>` : ""}</div>
        <div class="post-result-list">${(r.results || []).map((x) => `<div class="post-result-row ${x.ok ? "is-ok" : "is-fail"}"><span>${x.ok ? icons.check : icons.cross}</span><b>${esc(x.target?.title || x.target?.chatId || "")}</b><small>${esc(providerName(x.target?.provider))}</small>${x.error ? `<em>${esc(x.error)}</em>` : ""}</div>`).join("")}</div>`;
      toast(failed ? `${fa(ok)} موفق، ${fa(failed)} ناموفق` : "پست برای همه ارسال شد", failed > 0);
    } catch (err) {
      resultBox.innerHTML = `<div class="err-box">${esc(err.message)}</div>`;
    }
  };

  renderPreview();
  updateCounts();
  renderChatPanel();
  renderTemplates();
}

async function pageProviders(main, q, section = "providers") {
  state.providers = await api("providers");
  // «ابزارها» زیرمنوی ایرانی/خارجی ندارد
  const region = section === "services" ? "" : q.get("region") === "iran" ? "iran" : q.get("region") === "other" ? "other" : "";
  const focus = q.get("focus");
  const open = q.get("open");

  // لینک قدیمی یا دستی به سرویسی که در بخش دیگر است → همان سرویس در بخش درست باز می‌شود
  const target = open ? state.providers.find((p) => p.id === open) : null;
  if (target && providerSection(target) !== section) {
    location.replace(providerHref(target));
    return;
  }

  const platforms = groupProviders(state.providers).filter(({ provider: p }) =>
    p && providerSection(p) === section &&
    (region === "iran" ? isIranianProvider(p) : region === "other" ? !isIranianProvider(p) : true),
  );

  if (focus) {
    state.openPlatform = focus;
  } else if (open) {
    state.openPlatform = parseProvider({ id: open }).platformKey;
  }

  const copy = {
    banking: {
      title: { iran: "سرویس‌های مالی ایرانی", other: "سرویس‌های مالی خارجی", "": "سرویس‌های مالی" },
      desc: {
        iran: "بانک‌ها و صرافی‌های ایرانی: موجودی، قیمت و بازار و سفارش‌ها. معامله تا وقتی خودتان روشنش نکنید خاموش است.",
        other: "صرافی‌های خارجی با API رسمی: قیمت و بازار، موجودی و سفارش‌ها. معامله تا وقتی خودتان روشنش نکنید خاموش است.",
        "": "بانک‌ها و صرافی‌های ایرانی و خارجی؛ موجودی، تراکنش‌ها و داده‌ی بازار در اختیار مدل قرار می‌گیرد. هر سرویس با یک کلید روشن یا خاموش می‌شود.",
      },
      empty: {
        iran: "هنوز سرویس مالی ایرانی به دیباپل اضافه نشده است.",
        other: "هنوز سرویس مالی خارجی به دیباپل اضافه نشده است.",
        "": "هنوز سرویس مالی به دیباپل اضافه نشده است.",
      },
    },
    providers: {
      title: { iran: "شبکه‌های اجتماعی ایرانی", other: "شبکه‌های اجتماعی خارجی", "": "شبکه‌های اجتماعی" },
      desc: {
        iran: "پیام‌رسان‌های ایرانی متصل به این سرور با حساب کاربری.",
        other: "پیام‌رسان‌ها و شبکه‌های اجتماعی خارجی متصل به این سرور با حساب کاربری.",
        "": "پیام‌رسان‌ها و شبکه‌های اجتماعی ایرانی و خارجی در یک جا. هر حساب با یک کلید روشن یا خاموش می‌شود.",
      },
      empty: {
        iran: "هنوز سرویس ایرانی در این دسته ثبت نشده است.",
        other: "سرویس‌های خارجی پس از افزودن، اینجا نمایش داده می‌شوند.",
        "": "هنوز سرویسی در این دسته ثبت نشده است.",
      },
    },
    services: {
      title: { "": "ابزارها" },
      desc: { "": "وردپرس، ووکامرس و ابزارهای مدیریت محتوا؛ ابزارهایی که پیام‌رسان یا سرویس مالی نیستند. هر سرویس با یک کلید روشن یا خاموش می‌شود." },
      empty: { "": "هنوز ابزاری در این دسته به دیباپل اضافه نشده است." },
    },
  }[section];
  main.innerHTML = `
    ${head(copy.title[region], copy.desc[region], section === "services" ? "مدیریت ابزارها" : "مدیریت سرویس‌ها")}
    <div class="providers-accordion-list" id="provs">
      ${platforms.length ? platforms.map(platformAccordionHtml).join("") : `<div class="empty"><b>هنوز سرویسی در این دسته ثبت نشده</b>${copy.empty[region]}</div>`}
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
    if (header && !e.target.closest("input, a, .switch")) {
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

    // 2. Eye reveal for secrets
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
      if (await openModal({
        title: "حذف توکن",
        message: `آیا توکن ذخیره‌شده برای ${p.nameFa} حذف شود؟ ارتباط هوش مصنوعی با این بخش قطع خواهد شد.`,
        confirmText: "حذف توکن",
        tone: "danger",
      })) {
        const keys = p.fields.filter((f) => f.type === "secret").map((f) => f.key);
        replace(await api(`providers/${id}`, { method: "PUT", body: { values: { __clear: keys } } }));
        toast("توکن با موفقیت حذف شد");
      }
      return;
    }

    // 8. WhatsApp chat list
    const waSync = e.target.closest("[data-wa-sync]");
    if (waSync) {
      if (!(await openModal({
        title: "همگام‌سازی کامل چت‌ها",
        message: "برای دریافت تاریخچه‌ی کامل، نشست فعلی بسته می‌شود و باید یک بار دیگر با QR وارد شوید. ادامه می‌دهید؟",
        confirmText: "ساخت QR جدید",
        tone: "danger",
      }))) return;
      try {
        await api("providers/whatsapp/auth/logout", { body: {} });
        const fresh = await busy(waSync, () => api("providers/whatsapp/auth/start", { body: { phone: "" } }));
        if (!fresh.ok) { toast(fresh.error, true); return; }
        state.authTx.whatsapp = fresh.result.transactionHash;
        const ab = document.querySelector('[data-auth][data-id="whatsapp"]');
        if (ab && fresh.result.qr) {
          const img = ab.querySelector("[data-auth-qr]");
          if (img) img.src = fresh.result.qr;
          ab.querySelectorAll("[data-auth-step]").forEach((el) => (el.hidden = el.dataset.authStep !== "qr"));
          const hint = ab.querySelector("[data-auth-qr-hint]");
          if (hint) hint.textContent = "QR را اسکن کنید؛ سپس «بررسی اتصال» را بزنید. تاریخچه پس از اتصال دریافت می‌شود.";
          ab.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        toast("QR جدید ساخته شد؛ برای دریافت تاریخچه اسکن کنید");
      } catch (ex) {
        toast(ex.message, true);
      }
      return;
    }
    const waContacts = e.target.closest("[data-wa-contacts]");
    if (waContacts) {
      const box = waContacts.closest("[data-wa-chats]");
      const list = box.querySelector("[data-wa-list]");
      list.innerHTML = `<span class="hint">در حال دریافت مخاطبین…</span>`;
      try {
        const r = await busy(waContacts, () => api("tools/whatsapp_get_contacts/call", { body: { args: { limit: 300 } } }));
        if (!r.ok) { list.innerHTML = `<div class="err-box">${esc(r.error)}</div>`; return; }
        const contacts = r.result?.contacts ?? [];
        list.innerHTML = contacts.length
          ? contacts.map((c) => `<button class="wa-chat-row" type="button" data-wa-pick="${esc(c.id)}">
              <span class="wa-chat-type">مخاطب</span>
              <span class="wa-chat-body"><b>${esc(c.name)}</b><small class="ltr">${esc(c.id)}</small></span>
            </button>`).join("")
          : `<span class="hint">${esc(r.result?.note || "مخاطبی پیدا نشد.")}</span>`;
      } catch (ex) {
        list.innerHTML = `<div class="err-box">${esc(ex.message)}</div>`;
      }
      return;
    }
    const waLoad = e.target.closest("[data-wa-load]");
    if (waLoad) {
      const box = waLoad.closest("[data-wa-chats]");
      const list = box.querySelector("[data-wa-list]");
      list.innerHTML = `<span class="hint">در حال دریافت چت‌ها…</span>`;
      try {
        const r = await busy(waLoad, () => api("tools/whatsapp_get_chats/call", { body: { args: { limit: 80 } } }));
        if (!r.ok) { list.innerHTML = `<div class="err-box">${esc(r.error)}</div>`; return; }
        const chats = r.result?.chats ?? [];
        list.innerHTML = chats.length
          ? chats.map((c) => `<button class="wa-chat-row" type="button" data-wa-pick="${esc(c.chat_id)}">
              <span class="wa-chat-type">${c.type === "group" ? "گروه" : c.type === "channel" ? "کانال" : "خصوصی"}</span>
              <span class="wa-chat-body"><b>${esc(c.title || c.chat_id)}</b><small class="ltr">${esc(c.chat_id)}</small></span>
              ${c.unread_count ? `<span class="wa-chat-unread">${fa(c.unread_count)}</span>` : ""}
            </button>`).join("")
          : `<span class="hint">${esc(r.result?.note || "چتی پیدا نشد. اگر تازه وارد شده‌اید چند لحظه صبر کنید و دوباره تلاش کنید.")}</span>`;
      } catch (ex) {
        list.innerHTML = `<div class="err-box">${esc(ex.message)}</div>`;
      }
      return;
    }
    const waPick = e.target.closest("[data-wa-pick]");
    if (waPick) {
      const input = e.target.closest(".prov-mode-container")?.querySelector('[data-arg="chat_id"]');
      if (input) { input.value = waPick.dataset.waPick; toast("شناسه چت در فرم قرار گرفت"); }
      return;
    }

    // 9. Auth flow for unofficial clients
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
    const showQr = (r) => {
      const img = authBox.querySelector("[data-auth-qr]");
      if (img && r.result?.qr) img.src = r.result.qr;
      showStep("qr");
      const hint = authBox.querySelector("[data-auth-qr-hint]");
      if (hint) hint.textContent = (r.result?.hint || "QR را اسکن کنید؛ سپس «بررسی اتصال» را بزنید.") + " این QR خودکار تازه می‌شود.";
      startQrPolling();
    };
    const startQrPolling = () => {
      stopAuthQrPolling();
      authQrTimer = setInterval(async () => {
        const qrStep = authBox.querySelector('[data-auth-step="qr"]');
        if (!document.body.contains(authBox) || !qrStep || qrStep.hidden) { stopAuthQrPolling(); return; }
        try {
          const r = await api(`providers/${authId}/auth/qr`);
          if (!r.ok) { authFail(r.error); stopAuthQrPolling(); return; }
          if (r.result?.ready) {
            const hint = authBox.querySelector("[data-auth-qr-hint]");
            if (hint) hint.textContent = "واتس‌اپ متصل شد؛ روی «بررسی اتصال» بزنید.";
            stopAuthQrPolling();
            return;
          }
          if (r.result?.error) { authFail(r.result.error); stopAuthQrPolling(); return; }
          const img = authBox.querySelector("[data-auth-qr]");
          if (img && r.result?.qr && img.src !== r.result.qr) img.src = r.result.qr;
        } catch {
          // A transient poll failure must not break the QR view.
        }
      }, 2500);
    };

    if (e.target.closest("[data-auth-start]")) {
      stopAuthQrPolling();
      const phone = authBox.querySelector("[data-auth-phone]")?.value.trim() ?? "";
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
        if (r.result.qr) {
          showQr(r);
          return;
        }
        showStep("code");
        if (r.result.hint && authBox.querySelector("[data-auth-code-hint]")) authBox.querySelector("[data-auth-code-hint]").textContent = r.result.hint;
        authBox.querySelector("[data-auth-code]")?.focus();
      } catch (ex) {
        authFail(ex.message);
      }
    }

    if (e.target.closest("[data-auth-resend]")) {
      stopAuthQrPolling();
      const phone = authBox.querySelector("[data-auth-phone]")?.value.trim() ?? "";
      try {
        const r = await busy(e.target.closest("[data-auth-resend]"), () => api(`providers/${authId}/auth/start`, { body: { phone } }));
        if (!r.ok) return authFail(r.error);
        state.authTx[authId] = r.result.transactionHash;
        if (r.result.qr) {
          showQr(r);
          toast("QR جدید ساخته شد");
          return;
        }
        if (r.result.step === "password") {
          showStep("password");
          authBox.querySelector("[data-auth-password]")?.focus();
          toast("دوباره رمز عبور را وارد کنید");
          return;
        }
        showStep("code");
        if (r.result.hint && authBox.querySelector("[data-auth-code-hint]")) authBox.querySelector("[data-auth-code-hint]").textContent = r.result.hint;
        authBox.querySelector("[data-auth-code]")?.focus();
        toast("کد ورود دوباره ارسال شد");
      } catch (ex) {
        authFail(ex.message);
      }
      return;
    }

    if (e.target.closest("[data-auth-back]")) {
      stopAuthQrPolling();
      delete state.authTx[authId];
      authOut.innerHTML = "";
      showStep("phone");
    }

    if (e.target.closest("[data-auth-verify-code]")) {
      stopAuthQrPolling();
      const code = authBox.querySelector("[data-auth-code]")?.value.trim() ?? "";
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
        if (r.result.step !== "done") {
          // مثلاً کد تازه فرستاده شده یا مرحله هنوز تمام نشده است
          if (r.result.transactionHash) state.authTx[authId] = r.result.transactionHash;
          if (r.result.hint && authBox.querySelector("[data-auth-code-hint]")) authBox.querySelector("[data-auth-code-hint]").textContent = r.result.hint;
          authBox.querySelector("[data-auth-code]")?.focus();
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
          authBox.querySelector("[data-auth-code]")?.focus();
          return;
        }
        if (r.result.step !== "done") {
          if (r.result.step === "password") {
            showStep("password");
            authBox.querySelector("[data-auth-password]")?.focus();
          }
          if (r.result.hint) authFail(r.result.hint);
          return;
        }
        delete state.authTx[authId];
        await refreshAuth();
        toast(`ورود به حساب ${p.nameFa} با موفقیت انجام شد`);
      } catch (ex) {
        authFail(ex.message);
      }
    }

    if (e.target.closest("[data-auth-browser-start]")) {
      const btn = e.target.closest("[data-auth-browser-start]");
      const browserOut = authBox.querySelector("[data-auth-browser-out]");
      if (authBox._browserTimer) clearInterval(authBox._browserTimer);
      browserOut.innerHTML = `<div class="hint">در حال باز کردن پنجره‌ی ورود…</div>`;
      try {
        const started = await busy(btn, () => api(`providers/${authId}/auth/browser/start`, { body: {} }));
        if (!started.ok) { browserOut.innerHTML = `<div class="err-box">${esc(started.error)}</div>`; return; }
        const jobId = started.result?.jobId;
        if (!jobId) { browserOut.innerHTML = `<div class="err-box">شناسه‌ی جلسه‌ی ورود دریافت نشد.</div>`; return; }
        browserOut.innerHTML = `<div class="hint">${esc(started.result?.hint || "در پنجره‌ی Chrome وارد شوید…")}</div>`;
        const poll = async () => {
          if (!document.body.contains(authBox)) { clearInterval(authBox._browserTimer); return; }
          try {
            const r = await api(`providers/${authId}/auth/browser/${encodeURIComponent(jobId)}`);
            if (!r.ok) {
              clearInterval(authBox._browserTimer);
              browserOut.innerHTML = `<div class="err-box">${esc(r.error)}</div>`;
              return;
            }
            if (r.result?.pending) {
              browserOut.innerHTML = `<div class="hint">${esc(r.result.hint || "منتظر تکمیل ورود در پنجره‌ی Chrome هستیم…")}</div>`;
              return;
            }
            if (r.result?.step === "done") {
              clearInterval(authBox._browserTimer);
              delete state.authTx[authId];
              await refreshAuth();
              toast(`ورود به حساب ${p.nameFa} با مرورگر انجام شد`);
            }
          } catch (ex) {
            clearInterval(authBox._browserTimer);
            browserOut.innerHTML = `<div class="err-box">${esc(ex.message)}</div>`;
          }
        };
        authBox._browserTimer = setInterval(poll, 2000);
        await poll();
      } catch (ex) {
        browserOut.innerHTML = `<div class="err-box">${esc(ex.message)}</div>`;
      }
      return;
    }

    if (e.target.closest("[data-auth-import]")) {
      const raw = authBox.querySelector("[data-auth-import-input]")?.value ?? "";
      authOut.innerHTML = "";
      if (!raw.trim()) return authFail("کوکی یا sessionid را وارد کنید.");
      try {
        const r = await busy(e.target.closest("[data-auth-import]"), () =>
          api(`providers/${authId}/auth/import`, { body: { session: raw } }),
        );
        if (!r.ok) return authFail(r.error);
        delete state.authTx[authId];
        await refreshAuth();
        toast(`ورود به حساب ${p.nameFa} با نشست انجام شد`);
      } catch (ex) {
        authFail(ex.message);
      }
    }

    if (e.target.closest("[data-auth-logout]") && await openModal({
      title: "خروج از حساب",
      message: `آیا از حساب کاربری ${p.nameFa} خارج می‌شوید؟ ابزارهای این بخش تا ورود مجدد غیرفعال خواهند شد.`,
      confirmText: "خروج از حساب",
      tone: "danger",
    })) {
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
  if (selected && (!state.openToolProvider || q.get("tool"))) state.openToolProvider = selected.p.id;
  main.innerHTML = `${head("آزمایش ابزارها", "اجرای مستقیم ابزارهای MCP توسط مدل‌های هوش مصنوعی با بازخورد و پاسخ زنده سرور.", "محیط آزمایش")}
    <div class="play">
      <nav class="tool-list" aria-label="فهرست ابزارها">
        ${state.providers.map((p) => {
          const open = p.id === state.openToolProvider;
          return `<section class="tool-acc${open ? " open" : ""}" data-tool-acc="${p.id}">
            <button class="tool-acc-head" type="button" data-tool-head="${p.id}" aria-expanded="${open}">
              <span class="tool-acc-logo" style="background:${p.color}">${providerLogo(p)}</span>
              <span class="tool-acc-name">${esc(p.nameFa)}<small>${fa(p.tools.length)} ابزار</small></span>
              ${status(p)}
              <span class="tool-acc-chevron">${icons.chevron}</span>
            </button>
            <div class="tool-acc-body" ${open ? "" : "hidden"}>
              ${p.tools.map((t) => `<button class="tool-btn" data-tool="${t.name}" aria-pressed="${t.name === selected?.name}">${esc(t.title)}<small>${esc(t.name)}</small></button>`).join("")}
            </div>
          </section>`;
        }).join("")}
      </nav>
      <div id="tool-pane"></div>
    </div>`;

  main.querySelector(".tool-list").addEventListener("click", (e) => {
    const head = e.target.closest("[data-tool-head]");
    if (head) {
      const id = head.dataset.toolHead;
      if (state.openToolProvider === id) {
        state.openToolProvider = null;
        main.querySelectorAll("[data-tool-acc]").forEach((section) => {
          section.classList.remove("open");
          section.querySelector("[data-tool-head]")?.setAttribute("aria-expanded", "false");
          const body = section.querySelector(".tool-acc-body");
          if (body) body.hidden = true;
        });
        return;
      }
      const first = state.providers.find((p) => p.id === id)?.tools[0];
      if (first) {
        state.openToolProvider = id;
        history.replaceState(null, "", `#/playground?tool=${first.name}`);
        pagePlayground(main, new URLSearchParams(`tool=${first.name}`));
        return;
      }
      state.openToolProvider = id;
      main.querySelectorAll("[data-tool-acc]").forEach((section) => {
        const open = section.dataset.toolAcc === id;
        section.classList.toggle("open", open);
        section.querySelector("[data-tool-head]")?.setAttribute("aria-expanded", String(open));
        const body = section.querySelector(".tool-acc-body");
        if (body) body.hidden = !open;
      });
      return;
    }
    const b = e.target.closest("[data-tool]");
    if (b) {
      state.openToolProvider = b.closest("[data-tool-acc]")?.dataset.toolAcc ?? state.openToolProvider;
      history.replaceState(null, "", `#/playground?tool=${b.dataset.tool}`);
      pagePlayground(main, new URLSearchParams(`tool=${b.dataset.tool}`));
    }
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
      ${p.ready ? "" : `<div class="err-box" style="margin-bottom:18px">${esc(p.nameFa)} هنوز آماده نیست. <a href="${providerHref(p)}">توکن را ثبت و روشنش کنید</a>.</div>`}
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
    if (!t.annotations.readOnlyHint && !(await openModal({
      title: "ارسال پیام واقعی",
      message: `این ابزار پیام واقعی به حساب ${p.nameFa} ارسال خواهد کرد. آیا مایل به ادامه هستید؟`,
      confirmText: "ارسال کن",
    }))) return;
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

function dayLabelFa(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return "امروز";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return "دیروز";
  return d.toLocaleDateString("fa-IR", { year: "numeric", month: "short", day: "numeric" });
}

function receiverHtml(p, st) {
  if (!p) return "";
  if (!st.supported)
    return `<div class="rcv off"><div class="disc sm" style="background:${p.color}">${providerLogo(p)}</div><div class="rcv-body"><b>${esc(p.nameFa)}</b><span class="hint">این سرویس فقط ارسال پیام دارد؛ دریافت در نسخه کلاینت پشتیبانی می‌شود.</span></div></div>`;
  const ready = p.ready;
  let pill, info = "";
  if (!ready) { pill = `<span class="pill pill-off">${p.auth ? "وارد نشده" : "توکن ثبت نشده"}</span>`; info = `<a href="${providerHref(p)}">${p.auth ? "ورود به حساب" : "ثبت توکن"}</a>`; }
  else if (st.lastError) { pill = '<span class="pill pill-err">خطا در دریافت</span>'; info = `<span class="err" title="${esc(st.lastError)}">${esc(st.lastError)}</span>`; }
  else if (st.running) { pill = '<span class="pill pill-ok">در حال دریافت</span>'; info = st.lastPollAt ? `آخرین بررسی ${ago(st.lastPollAt)}` : "در حال اتصال به سرور…"; }
  else pill = '<span class="pill pill-off">خاموش</span>';
  const webhook = /webhook/i.test(st.lastError || "");
  return `<div class="rcv${st.lastError ? " has-err" : ""}" data-rcv="${p.id}">
    <div class="disc sm" style="background:${p.color}">${providerLogo(p)}</div>
    <div class="rcv-body">
      <div class="rcv-top"><b>${esc(p.nameFa)}</b>${pill}</div>
      <span class="hint">${info}</span>
      ${st.hint ? `<span class="st-hint">${esc(st.hint)}</span>` : ""}
    </div>
    <div class="rcv-actions">
      ${webhook ? `<button class="btn btn-ghost btn-danger btn-sm" type="button" data-action="deleteWebhook">حذف وبهوک</button>` : ""}
      <button class="btn btn-ghost btn-sm" type="button" data-clear-inbox title="پاک کردن پیام‌های ذخیره‌شده این سرویس">پاک کردن</button>
      <button class="btn btn-ghost btn-sm" type="button" data-fetch ${ready ? "" : "disabled"}>بررسی الان</button>
      <label class="switch" title="دریافت خودکار پیام‌ها"><input type="checkbox" data-receive ${st.enabled ? "checked" : ""} ${ready && !p.receive.fromEnv ? "" : "disabled"} aria-label="دریافت خودکار ${esc(p.nameFa)}"><span></span></label>
    </div>
  </div>`;
}

async function pageInbox(main, q) {
  state.providers = await api("providers");
  const sel = { p: q.get("p") || "", c: q.get("c") || "" };
  let data = { statuses: [], chats: [], messages: [] };
  let lastSig = "";
  let filterProvider = "";
  let filterScope = "all";
  let chatQuery = "";
  let msgQuery = "";
  let msgSearchOpen = false;
  let rcvOpen = false;
  let rcvAutoChecked = false;

  main.innerHTML = `${head("صندوق پیام‌ها", "گفتگوهای زنده، فیلتر پیام‌های منتظر پاسخ و ارسال جواب مستقیم از یک فضای کاری.", "پیام‌های دریافتی",
    `<div class="inbox-head-actions">
      <span class="inbox-live-badge" id="inbox-live-badge">در حال بارگذاری…</span>
      <button class="btn btn-ghost btn-sm" type="button" id="inbox-toggle-rcv" aria-expanded="false">${icons.providers} <span>دریافت‌کننده‌ها</span><i class="rcv-err-dot" id="rcv-err-dot" hidden></i></button>
      <button class="btn btn-ghost btn-sm" type="button" id="inbox-fetch-all">${icons.refresh} <span>بررسی همه</span></button>
      <button class="btn btn-ghost btn-sm" type="button" id="inbox-refresh" aria-label="به‌روزرسانی">${icons.refresh} <span>به‌روزرسانی</span></button>
    </div>`)}

    <section class="rcv-panel" id="rcv-panel" hidden>
      <div class="rcv-panel-head">
        <div>
          <b>مدیریت دریافت خودکار پیام‌ها</b>
          <span class="hint" id="rcv-summary"></span>
        </div>
        <button class="btn btn-quiet btn-sm" type="button" id="rcv-close">بستن</button>
      </div>
      <section class="receivers" id="rcv"></section>
    </section>

    <section class="inbox${sel.p && sel.c ? " has-chat" : ""}" id="inbox-shell">
      <nav class="chat-list" aria-label="فهرست گفتگوها">
        <div class="chat-list-head">
          <div class="chat-list-title">
            <b>گفتگوها</b>
            <span id="chat-count" class="meta">۰ گفتگو</span>
          </div>
          <div class="chat-search">
            ${icons.search}
            <input class="input" id="chat-search" placeholder="جستجوی نام، شناسه یا متن پیام…" aria-label="جستجوی گفتگو">
            <button class="chat-search-clear" type="button" id="chat-search-clear" hidden aria-label="پاک کردن جستجو">${icons.cross}</button>
          </div>
          <div class="inbox-scopes" id="inbox-scopes" role="tablist" aria-label="فیلتر وضعیت گفتگو"></div>
          <div class="inbox-providers" id="inbox-providers"></div>
        </div>
        <div class="chat-list-body" id="chats"></div>
      </nav>
      <div class="convo" id="convo"></div>
    </section>`;

  const provOf = (id) => state.providers.find((x) => x.id === id);
  const defaultChat = (id) => provOf(id)?.fields.find((f) => f.key === "defaultChatId")?.value || "";
  const canSendOf = (p) => Boolean(p?.tools?.some((t) => t.name === `${p.id}_send_message`));

  const setRcvOpen = (open) => {
    rcvOpen = open;
    const panel = document.getElementById("rcv-panel");
    const btn = document.getElementById("inbox-toggle-rcv");
    if (panel) panel.hidden = !open;
    if (btn) {
      btn.setAttribute("aria-expanded", String(open));
      btn.classList.toggle("is-open", open);
    }
  };

  const drawReceivers = () => {
    document.getElementById("rcv").innerHTML = data.statuses.map((st) => receiverHtml(provOf(st.provider), st)).join("");
    const active = data.statuses.filter((s) => s.enabled && s.running).length;
    const errors = data.statuses.filter((s) => s.lastError).length;
    const summary = document.getElementById("rcv-summary");
    if (summary) summary.textContent = `${fa(active)} از ${fa(data.statuses.length)} سرویس فعال${errors ? ` · ${fa(errors)} خطا` : ""}`;
    const errDot = document.getElementById("rcv-err-dot");
    if (errDot) errDot.hidden = errors === 0;
  };

  const drawHeaderStats = () => {
    const active = data.statuses.filter((s) => s.enabled && s.running).length;
    const unanswered = data.chats.filter((c) => c.lastDirection !== "out").length;
    const badge = document.getElementById("inbox-live-badge");
    if (!badge) return;
    badge.innerHTML = `<i class="${active ? "on" : "off"}"></i><span>${fa(active)} دریافت فعال · ${fa(data.chats.length)} گفتگو${unanswered ? ` · ${fa(unanswered)} منتظر پاسخ` : ""}</span>`;
  };

  const drawScopes = () => {
    const wrap = document.getElementById("inbox-scopes");
    if (!wrap) return;
    const baseChats = filterProvider ? data.chats.filter((c) => c.provider === filterProvider) : data.chats;
    const unansweredCount = baseChats.filter((c) => c.lastDirection !== "out").length;
    const scopes = [
      { id: "all", label: "همه", count: baseChats.length },
      { id: "unanswered", label: "منتظر پاسخ", count: unansweredCount },
      { id: "private", label: "خصوصی" },
      { id: "group", label: "گروه و کانال" },
    ];
    wrap.innerHTML = scopes
      .map((s) => `<button class="inbox-scope${filterScope === s.id ? " active" : ""}" type="button" role="tab" aria-selected="${filterScope === s.id}" data-inbox-scope="${s.id}">
        <span>${s.label}</span>${s.count !== undefined ? `<b class="scope-count">${fa(s.count)}</b>` : ""}
      </button>`)
      .join("");
  };

  const drawProviders = () => {
    const wrap = document.getElementById("inbox-providers");
    if (!wrap) return;
    const list = data.statuses.map((st) => provOf(st.provider)).filter(Boolean);
    if (filterProvider && !list.some((p) => p.id === filterProvider)) filterProvider = "";
    wrap.innerHTML = [
      `<button class="inbox-provider${filterProvider === "" ? " active" : ""}" type="button" data-inbox-provider="">همه</button>`,
      ...list.map((p) => {
        const st = data.statuses.find((s) => s.provider === p.id);
        return `<button class="inbox-provider${filterProvider === p.id ? " active" : ""}" type="button" data-inbox-provider="${p.id}" title="${esc(p.nameFa)}">
          <span class="ip-logo">${providerLogo(p)}</span><span>${esc(p.nameFa.replace(/\s*\(.*?\)/g, ""))}</span>
          <i class="${st?.lastError ? "err" : st?.enabled && st?.running ? "on" : "off"}"></i>
        </button>`;
      }),
    ].join("");
  };

  const visibleChats = () => {
    const query = chatQuery.trim().toLowerCase();
    return data.chats.filter((c) => {
      if (filterProvider && c.provider !== filterProvider) return false;
      if (filterScope === "unanswered" && c.lastDirection === "out") return false;
      if (filterScope === "private" && c.type !== "private") return false;
      if (filterScope === "group" && c.type !== "group" && c.type !== "channel") return false;
      if (!query) return true;
      return (
        String(c.title || "").toLowerCase().includes(query) ||
        String(c.chatId).toLowerCase().includes(query) ||
        String(c.lastText || "").toLowerCase().includes(query)
      );
    });
  };

  const drawChats = () => {
    const el = document.getElementById("chats");
    const count = document.getElementById("chat-count");
    const chats = visibleChats();
    if (count) count.textContent = `${fa(chats.length)} گفتگو`;
    if (!chats.length) {
      const hasAny = data.chats.length > 0;
      el.innerHTML = `<div class="empty chat-empty">${icons.inbox}<b>${hasAny ? "گفتگویی با این فیلتر پیدا نشد" : "هنوز پیامی دریافت نشده"}</b><p>${hasAny ? "فیلتر یا عبارت جستجو را تغییر دهید." : "از دکمه‌ی «دریافت‌کننده‌ها» دریافت خودکار را روشن کنید یا «بررسی همه» را بزنید."}</p></div>`;
      return;
    }
    el.innerHTML = chats.map((c) => {
      const p = provOf(c.provider);
      const active = c.provider === sel.p && c.chatId === sel.c;
      const isDef = defaultChat(c.provider) === c.chatId;
      const waiting = c.lastDirection !== "out";
      return `<button class="chat-item${waiting ? " is-waiting" : ""}" type="button" data-p="${c.provider}" data-c="${esc(c.chatId)}" aria-current="${active}">
        <span class="disc sm" style="background:${p?.color || "var(--brand)"}">${providerLogo(p)}</span>
        <span class="ci-body">
          <span class="ci-top"><b dir="auto">${esc(c.title || c.chatId)}</b><span class="meta">${ago(c.lastDate)}</span></span>
          <span class="ci-sub">${c.lastDirection === "out" ? '<span class="ci-you">شما: </span>' : ""}<span dir="auto">${esc(kindFa[c.lastText] ?? c.lastText ?? "—")}</span></span>
          <span class="ci-tags">${waiting ? '<i class="wait">منتظر پاسخ</i>' : ""}${chatTypeFa[c.type] ? `<i>${chatTypeFa[c.type]}</i>` : ""}${isDef ? "<i class='def'>پیش‌فرض</i>" : ""}<i>${fa(c.count)} پیام</i></span>
        </span>
      </button>`;
    }).join("");
  };

  const renderMessages = () => {
    const list = document.getElementById("msgs");
    if (!list) return;
    const wasNearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    const qLower = msgQuery.trim().toLowerCase();
    const ordered = data.messages.slice().reverse();
    const filtered = qLower
      ? ordered.filter((m) => String(m.text || "").toLowerCase().includes(qLower) || String(m.from?.name || "").toLowerCase().includes(qLower))
      : ordered;

    const matchBadge = document.getElementById("msg-search-count");
    if (matchBadge) matchBadge.textContent = qLower ? `${fa(filtered.length)} نتیجه` : "";

    if (!filtered.length) {
      list.innerHTML = `<li class="msgs-empty">${qLower ? "پیامی با این عبارت در این گفتگو پیدا نشد." : "پیامی در این گفتگو ثبت نشده است."}</li>`;
      return;
    }

    let lastDay = "";
    const html = [];
    for (const m of filtered) {
      const day = dayLabelFa(m.date);
      if (day !== lastDay) {
        lastDay = day;
        html.push(`<li class="msg-day" aria-hidden="true"><span>${esc(day)}</span></li>`);
      }
      const out = m.direction === "out";
      const time = new Date(m.date).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
      const who = out
        ? m.source === "account"
          ? `<b>شما</b><span>از حساب کاربر</span>`
          : `<b>حساب</b><span>${m.source === "mcp" ? "منتقل‌شده به مدل" : "از داشبورد"}</span>`
        : `${m.from?.name ? `<b dir="auto">${esc(m.from.name)}</b>` : ""}${m.from?.username ? `<span class="ltr">@${esc(m.from.username)}</span>` : ""}`;
      const img = out && m.kind === "photo" && m.mediaUrl ? `<img class="msg-img" src="${esc(m.mediaUrl)}" alt="" loading="lazy" onerror="this.remove()">` : "";
      html.push(`<li class="msg${out ? " out" : ""}">
        <div class="msg-meta">${who}<span class="msg-time">${time}</span>${m.text ? `<button class="msg-copy" type="button" data-copy-msg="${esc(m.text)}" title="کپی متن پیام" aria-label="کپی متن پیام">کپی</button>` : ""}</div>
        ${img}
        ${kindFa[m.kind] ? `<span class="msg-kind">${kindFa[m.kind]}${m.buttonId ? `: <code class="ltr">${esc(m.buttonId)}</code>` : ""}</span>` : ""}
        ${m.text ? `<p dir="auto">${esc(m.text)}</p>` : ""}
      </li>`);
    }
    list.innerHTML = html.join("");
    if (wasNearBottom || !qLower) list.scrollTop = list.scrollHeight;
  };

  const drawConvo = () => {
    const el = document.getElementById("convo");
    const shell = document.getElementById("inbox-shell");
    const chat = data.chats.find((c) => c.provider === sel.p && c.chatId === sel.c);
    if (shell) shell.classList.toggle("has-chat", Boolean(chat));
    if (!chat) {
      el.innerHTML = `<div class="empty convo-empty">${icons.inbox}<b>یک گفتگو را انتخاب کنید</b><p>برای خواندن پیام‌ها، جستجو در تاریخچه و ارسال پاسخ مستقیم، یکی از گفتگوها را انتخاب کنید.</p></div>`;
      return;
    }
    const p = provOf(chat.provider);
    const isDef = defaultChat(chat.provider) === chat.chatId;
    const sendable = canSendOf(p);
    const keepDraft = el.querySelector("[data-draft]")?.value ?? "";
    el.innerHTML = `
      <header class="convo-head">
        <div class="convo-title">
          <button class="btn btn-ghost btn-sm convo-back" type="button" data-convo-back aria-label="بازگشت به گفتگوها">بازگشت</button>
          <span class="disc sm" style="background:${p?.color || "var(--brand)"}">${providerLogo(p)}</span>
          <div class="convo-title-text">
            <div class="convo-name-row"><b dir="auto">${esc(chat.title || chat.chatId)}</b>${chatTypeFa[chat.type] ? `<span class="pill pill-off">${chatTypeFa[chat.type]}</span>` : ""}</div>
            <div class="convo-id"><span class="meta">${esc(p?.nameFa || "")} · شناسه:</span>
              <code class="ltr">${esc(chat.chatId)}</code><button class="btn btn-quiet btn-sm" type="button" data-copy-id>کپی</button></div>
          </div>
        </div>
        <div class="convo-actions">
          <button class="btn btn-ghost btn-sm${msgSearchOpen ? " is-active" : ""}" type="button" data-toggle-msg-search aria-label="جستجو در پیام‌ها">${icons.search}<span>جستجو</span></button>
          ${isDef ? `<span class="pill pill-ok">پیش‌فرض</span>` : `<button class="btn btn-ghost btn-sm" type="button" data-set-default>تنظیم پیش‌فرض</button>`}
          <a class="btn btn-ghost btn-sm" href="#/playground?p=${encodeURIComponent(chat.provider)}" title="باز کردن ابزارهای ${esc(p?.nameFa || "")}">ابزارها</a>
        </div>
      </header>
      <div class="convo-search" ${msgSearchOpen ? "" : "hidden"}>
        ${icons.search}
        <input class="input" type="search" id="msg-search-input" value="${esc(msgQuery)}" placeholder="جستجو در متن یا فرستنده پیام‌های این گفتگو…" aria-label="جستجو در پیام‌ها">
        <span class="meta" id="msg-search-count"></span>
      </div>
      <div class="msgs-wrap">
        <ol class="msgs" id="msgs"></ol>
        <button class="msgs-jump" type="button" id="msgs-jump" hidden aria-label="رفتن به آخرین پیام">آخرین پیام ↓</button>
      </div>
      ${p?.ready && sendable ? `
      <form class="composer" data-reply>
        <textarea class="textarea" data-draft rows="1" dir="auto" placeholder="پاسخ مستقیم به ${esc(chat.title || chat.chatId)}… (Ctrl+Enter برای ارسال)" aria-label="متن جواب"></textarea>
        <button class="btn btn-primary" type="submit">${icons.send}<span>ارسال</span></button>
      </form>` : `
      <div class="composer-notice">
        <span>${!p?.ready ? `برای ارسال پاسخ، ابتدا ${esc(p?.nameFa || "سرویس")} را متصل کنید.` : `ارسال پیام متنی مستقیم برای ${esc(p?.nameFa || "این سرویس")} پشتیبانی نمی‌شود.`}</span>
        ${!p?.ready && p ? `<a class="btn btn-ghost btn-sm" href="${providerHref(p)}">تنظیم سرویس</a>` : ""}
      </div>`}`;

    const draftEl = el.querySelector("[data-draft]");
    if (draftEl) {
      draftEl.value = keepDraft;
      draftEl.style.height = "auto";
      if (keepDraft) draftEl.style.height = `${Math.min(draftEl.scrollHeight, 140)}px`;
    }
    renderMessages();
    const list = document.getElementById("msgs");
    const jump = document.getElementById("msgs-jump");
    if (list && jump) {
      list.addEventListener("scroll", () => {
        jump.hidden = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
      });
      jump.onclick = () => { list.scrollTop = list.scrollHeight; };
    }
  };

  const load = async (force = false) => {
    const qs = sel.p && sel.c ? `?provider=${encodeURIComponent(sel.p)}&chat=${encodeURIComponent(sel.c)}` : "";
    data = await api(`inbox${qs}`);
    if (!rcvAutoChecked) {
      rcvAutoChecked = true;
      const activeCount = data.statuses.filter((s) => s.enabled && s.running).length;
      if (data.chats.length === 0 && activeCount === 0) setRcvOpen(true);
    }
    const sig = JSON.stringify([data.statuses.map((s) => [s.enabled, s.running, s.lastError, s.received, s.lastPollAt && ago(s.lastPollAt)]), data.chats.map((c) => c.lastDate + c.count + c.lastDirection), data.messages.length, data.messages[0]?.key, sel]);
    if (force || sig !== lastSig) {
      if (force || !document.activeElement?.closest?.("[data-receive]")) drawReceivers();
      drawHeaderStats();
      drawScopes();
      drawProviders();
      drawChats();
      drawConvo();
    }
    lastSig = sig;
  };
  await load(true);
  state.timer = setInterval(() => { if (!document.hidden) load().catch(() => { }); }, 4000);

  document.getElementById("inbox-refresh").onclick = (e) => busy(e.currentTarget, () => load(true));
  document.getElementById("inbox-toggle-rcv").onclick = () => setRcvOpen(!rcvOpen);
  document.getElementById("rcv-close").onclick = () => setRcvOpen(false);
  document.getElementById("inbox-fetch-all").onclick = async (e) => {
    const readyIds = data.statuses.filter((s) => s.supported && provOf(s.provider)?.ready).map((s) => s.provider);
    if (!readyIds.length) {
      setRcvOpen(true);
      return toast("هیچ سرویس آماده‌ای برای بررسی وجود ندارد", true);
    }
    await busy(e.currentTarget, async () => {
      const results = await Promise.allSettled(readyIds.map((id) => api(`inbox/${id}/fetch`, { body: {} })));
      const added = results.reduce((sum, r) => sum + (r.status === "fulfilled" && r.value?.ok ? Number(r.value.added || 0) : 0), 0);
      toast(added ? `${fa(added)} پیام جدید دریافت شد` : "پیام جدیدی وجود نداشت");
      await load(true);
    });
  };

  const searchInput = document.getElementById("chat-search");
  const searchClear = document.getElementById("chat-search-clear");
  searchInput.addEventListener("input", (e) => {
    chatQuery = e.target.value;
    if (searchClear) searchClear.hidden = !chatQuery;
    drawChats();
  });
  searchClear.onclick = () => {
    chatQuery = "";
    searchInput.value = "";
    searchClear.hidden = true;
    drawChats();
    searchInput.focus();
  };

  main.addEventListener("input", (e) => {
    if (e.target.id === "msg-search-input") {
      msgQuery = e.target.value;
      renderMessages();
    }
    if (e.target.matches("[data-draft]")) {
      e.target.style.height = "auto";
      e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
    }
  });

  main.addEventListener("click", async (e) => {
    const sc = e.target.closest("[data-inbox-scope]");
    if (sc) {
      filterScope = sc.dataset.inboxScope || "all";
      drawScopes();
      drawChats();
      return;
    }
    const pf = e.target.closest("[data-inbox-provider]");
    if (pf) {
      filterProvider = pf.dataset.inboxProvider || "";
      drawProviders();
      drawScopes();
      drawChats();
      return;
    }
    const item = e.target.closest(".chat-item");
    if (item) {
      sel.p = item.dataset.p; sel.c = item.dataset.c;
      msgQuery = "";
      msgSearchOpen = false;
      history.replaceState(null, "", `#/inbox?p=${sel.p}&c=${encodeURIComponent(sel.c)}`);
      await load(true);
      return;
    }
    if (e.target.closest("[data-convo-back]")) {
      sel.p = ""; sel.c = "";
      msgQuery = "";
      msgSearchOpen = false;
      history.replaceState(null, "", "#/inbox");
      drawChats();
      drawConvo();
      return;
    }
    if (e.target.closest("[data-toggle-msg-search]")) {
      msgSearchOpen = !msgSearchOpen;
      if (!msgSearchOpen) msgQuery = "";
      drawConvo();
      if (msgSearchOpen) document.getElementById("msg-search-input")?.focus();
      return;
    }
    const copyMsgBtn = e.target.closest("[data-copy-msg]");
    if (copyMsgBtn) return copy(copyMsgBtn.dataset.copyMsg);

    const rcv = e.target.closest("[data-rcv]");
    if (rcv && e.target.closest("[data-fetch]")) {
      const r = await busy(e.target.closest("[data-fetch]"), () => api(`inbox/${rcv.dataset.rcv}/fetch`, { body: {} }));
      r.ok ? toast(r.added ? `${fa(r.added)} پیام جدید دریافت شد` : "پیام جدیدی وجود نداشت") : toast(r.error, true);
      return load(true);
    }
    if (rcv && e.target.closest("[data-clear-inbox]")) {
      const pName = provOf(rcv.dataset.rcv)?.nameFa || rcv.dataset.rcv;
      if (!(await openModal({
        title: "پاک کردن صندوق پیام",
        message: `آیا پیام‌های ذخیره‌شده‌ی ${pName} از صندوق پاک شوند؟`,
        confirmText: "پاک کن",
        tone: "danger",
      }))) return;
      await busy(e.target.closest("[data-clear-inbox]"), () => api(`inbox/${rcv.dataset.rcv}`, { method: "DELETE" }));
      if (sel.p === rcv.dataset.rcv) { sel.p = ""; sel.c = ""; history.replaceState(null, "", "#/inbox"); }
      toast(`صندوق ${pName} پاک شد`);
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
    if (r.ok) { draft.value = ""; draft.style.height = "auto"; await load(true); } else toast(r.error, true);
  });
  main.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.target.matches("[data-draft]")) e.target.closest("form").requestSubmit();
  });
}

// ---------------------------------------------------------------- triggers
const trgCatFa = { social: "پیام‌رسان‌ها", ai: "هوش مصنوعی", mcp: "MCP", forward: "فوروارد", webhook: "وبهوک" };
const trgEventFa = { incoming_message: "پیام ورودی", tool_called: "اجرای ابزار MCP", tool_error: "خطای ابزار MCP", manual: "اجرای دستی (Manual)" };
const trgActionFa = {
  reply_template: "پاسخ آماده",
  ai_reply: "پاسخ هوشمند AI",
  forward: "فوروارد به سرویس دیگر",
  call_tool: "اجرای ابزار MCP",
  webhook: "ارسال Webhook",
};
const trgActionHint = {
  reply_template: "یک متن ثابت (با متغیرها) به همان چت پاسخ می‌دهد.",
  ai_reply: "دیبا روتر بر اساس متن پیام یک پاسخ می‌سازد و می‌فرستد.",
  forward: "همان پیام را به یک سرویس و چت دیگر می‌فرستد.",
  call_tool: "یک ابزار MCP را با آرگومان دلخواه اجرا می‌کند.",
  webhook: "داده‌ی رویداد را به یک آدرس بیرونی (n8n، Make، CRM) POST می‌کند.",
};
const trgChatTypeFa = { "*": "همه", private: "خصوصی", group: "گروه", channel: "کانال" };

// نمونه‌های آماده برای «ساخت اتوماسیون جدید» — با کلیک، فرم از همین داده پر می‌شود
const trgSamples = [
  {
    id: "sample-welcome",
    badge: "پیام‌رسان‌ها",
    title: "خوش‌آمدگویی و راهنما",
    sub: "پاسخ خودکار به /start و سلام",
    data: {
      name: "خوش‌آمدگویی خودکار مشتریان",
      description: "وقتی کاربر در چت خصوصی سلام یا /start بفرستد، پیام خوش‌آمدگویی ارسال می‌شود.",
      category: "social",
      event: "incoming_message",
      match: { provider: "*", chatType: "private", contains: "/start, سلام, درود, hi, hello", toolName: "*" },
      action: {
        type: "reply_template",
        template: "سلام {{sender}} عزیز 👋\nبه پشتیبانی خوش آمدید. سوال یا درخواستتان را بنویسید تا راهنمایی‌تان کنیم.",
      },
    },
  },
  {
    id: "sample-pricing",
    badge: "پیام‌رسان‌ها",
    title: "پاسخ تعرفه و قیمت",
    sub: "کلمات قیمت / تعرفه / خرید",
    data: {
      name: "پاسخ خودکار تعرفه و قیمت",
      description: "هر پرسش درباره‌ی قیمت، تعرفه یا خرید را با متن آماده پاسخ می‌دهد.",
      category: "social",
      event: "incoming_message",
      match: { provider: "*", chatType: "*", contains: "قیمت, تعرفه, هزینه, خرید, اشتراک", toolName: "*" },
      action: {
        type: "reply_template",
        template: "تعرفه‌ها 👇\n• پایه: ۴۹۰ هزار تومان / ماه\n• حرفه‌ای: ۹۹۰ هزار تومان / ماه\nبرای مشاوره‌ی رایگان شماره‌ی خود را بفرستید.",
      },
    },
  },
  {
    id: "sample-support",
    badge: "پیام‌رسان‌ها",
    title: "ثبت تیکت پشتیبانی",
    sub: "پاسخ فوری با شماره‌ی پیگیری",
    data: {
      name: "ثبت خودکار تیکت پشتیبانی",
      description: "به پیام‌های حاوی مشکل یا خطا پاسخ می‌دهد و شماره‌ی پیگیری می‌سازد.",
      category: "social",
      event: "incoming_message",
      match: { provider: "*", chatType: "*", contains: "پشتیبانی, تیکت, مشکل, خرابی, خطا", toolName: "*" },
      action: {
        type: "reply_template",
        template: "درخواست پشتیبانی شما ثبت شد ✅\nشماره‌ی پیگیری: {{chatId}}-{{provider}}\nکارشناس تا ۲ ساعت کاری پاسخ می‌دهد.",
      },
    },
  },
  {
    id: "sample-ai",
    badge: "هوش مصنوعی",
    title: "منشی هوشمند دیبا روتر",
    sub: "پاسخ کوتاه AI به سوالات",
    data: {
      name: "پاسخگوی هوشمند سوالات",
      description: "سوالات چت خصوصی را با دیبا روتر تحلیل و پاسخ کوتاه فارسی ارسال می‌کند.",
      category: "ai",
      event: "incoming_message",
      match: { provider: "*", chatType: "private", contains: "؟, ?, چطور, قیمت, راهنما", toolName: "*" },
      action: {
        type: "ai_reply",
        systemPrompt: "تو پشتیبان دقیق و محترمانه هستی. به سوال کاربر در حداکثر ۳ جمله‌ی کوتاه و کاربردی پاسخ بده.",
      },
    },
  },
  {
    id: "sample-sentiment",
    badge: "هوش مصنوعی",
    title: "آرام‌سازی مشتری ناراضی",
    sub: "تشخیص شکایت و ارجاع فوری",
    data: {
      name: "تشخیص نارضایتی و پاسخ آرام‌کننده",
      description: "پیام‌های عصبانی یا شکایت را تشخیص می‌دهد و پاسخ رسمی آرام‌کننده می‌فرستد.",
      category: "ai",
      event: "incoming_message",
      match: { provider: "*", chatType: "*", contains: "شکایت, افتضاح, عصبانی, پشیمون, کلاهبرداری", toolName: "*" },
      action: {
        type: "ai_reply",
        systemPrompt:
          "کاربر ناراضی است. با لحن آرام عذرخواهی کن، مشکل را در یک جمله جمع‌بندی کن و بگو کارشناس ارشد تا ۱۰ دقیقه پیگیری می‌کند. قول مالی نده.",
      },
    },
  },
  {
    id: "sample-forward",
    badge: "فوروارد",
    title: "ارسال پیام‌های فوری به مدیر",
    sub: "فوری / مهم ← چت پیش‌فرض بله",
    data: {
      name: "اطلاع‌رسانی پیام‌های فوری",
      description: "هر پیام حاوی «فوری» یا «مهم» را از همه پیام‌رسان‌ها به چت پیش‌فرض بله می‌فرستد.",
      category: "forward",
      event: "incoming_message",
      match: { provider: "*", chatType: "*", contains: "فوری, مهم, اضطراری, urgent", toolName: "*" },
      action: {
        type: "forward",
        targetProvider: "bale_client",
        targetChatId: "",
        template: "🚨 پیام فوری از {{provider}} ({{sender}} | چت {{chatId}}):\n{{text}}",
      },
    },
  },
  {
    id: "sample-bridge",
    badge: "فوروارد",
    title: "پل بله ← تلگرام",
    sub: "همگام‌سازی دو پیام‌رسان",
    data: {
      name: "همگام‌سازی بله به تلگرام",
      description: "همه‌ی پیام‌های ورودی بله را برای تیم فنی به چت پیش‌فرض تلگرام می‌فرستد.",
      category: "forward",
      event: "incoming_message",
      match: { provider: "bale_client", chatType: "*", contains: "", toolName: "*" },
      action: {
        type: "forward",
        targetProvider: "telegram_client",
        targetChatId: "",
        template: "📩 از بله ({{sender}}):\n{{text}}",
      },
    },
  },
  {
    id: "sample-mcp-err",
    badge: "MCP",
    title: "هشدار خطای ابزار MCP",
    sub: "گزارش خطای ابزارها به مدیر",
    data: {
      name: "گزارش خودکار خطاهای MCP",
      description: "هنگام بروز خطا در هر ابزار MCP، جزئیات را به چت پیش‌فرض بله ارسال می‌کند.",
      category: "mcp",
      event: "tool_error",
      match: { provider: "*", chatType: "*", contains: "", toolName: "*" },
      action: {
        type: "forward",
        targetProvider: "bale_client",
        targetChatId: "",
        template: "⚠️ خطا در اجرای ابزار {{toolName}}:\n{{error}}",
      },
    },
  },
  {
    id: "sample-tool",
    badge: "اجرای ابزار",
    title: "دستور /ping سلامت حساب",
    sub: "فراخوانی ابزار با آرگومان JSON",
    data: {
      name: "پاسخ سلامت حساب با دستور /ping",
      description: "با دریافت /ping ابزار ارسال پیام را صدا می‌زند و وضعیت را تایید می‌کند.",
      category: "mcp",
      event: "incoming_message",
      match: { provider: "*", chatType: "*", contains: "/ping, تست حساب", toolName: "*" },
      action: {
        type: "call_tool",
        toolName: "bale_client_send_message",
        toolArgs: '{"chat_id":"{{chatId}}","text":"✅ حساب متصل است — {{provider}} | {{sender}}"}',
      },
    },
  },
  {
    id: "sample-webhook",
    badge: "وبهوک",
    title: "اتصال به n8n / Webhook",
    sub: "ارسال JSON پیام‌ها به سرور بیرونی",
    data: {
      name: "ارسال پیام‌ها به n8n",
      description: "تمامی پیام‌های ورودی را به شکل JSON به آدرس Webhook دلخواه می‌فرستد.",
      category: "webhook",
      event: "incoming_message",
      match: { provider: "*", chatType: "*", contains: "", toolName: "*" },
      action: {
        type: "webhook",
        webhookUrl: "https://example.com/webhook/diba-mcp",
      },
    },
  },
  {
    id: "sample-crm",
    badge: "وبهوک",
    title: "ثبت لید در CRM",
    sub: "قیمت / دمو / مشاوره ← CRM",
    data: {
      name: "ارسال لیدهای فروش به CRM",
      description: "پیام‌های حاوی درخواست قیمت یا دمو را به وبهوک CRM می‌فرستد.",
      category: "webhook",
      event: "incoming_message",
      match: { provider: "*", chatType: "private", contains: "قیمت, دمو, مشاوره, خرید", toolName: "*" },
      action: {
        type: "webhook",
        webhookUrl: "https://hooks.example.com/crm/leads",
      },
    },
  },
];

async function pageTriggers(main, q) {
  let data = await api("triggers");
  let triggerProviders = [];
  try {
    triggerProviders = state.providers.length ? state.providers : await api("providers");
    state.providers = triggerProviders;
  } catch { /* keep * option available */ }
  const providerOptions = [["*", "همه‌ی پیام‌رسان‌ها"], ...triggerProviders.map((p) => [p.id, p.nameFa || p.id])];
  let filterCat = "all";
  let query = "";
  let mode = q?.get("new") === "1" ? "create" : "list"; // list | create | edit
  let draft = null;

  // شنونده‌های این صفحه با خروج از آن آزاد می‌شوند تا کلیک‌ها دوباره اجرا نشوند
  const ac = new AbortController();
  pageDispose = () => ac.abort();
  const on = { signal: ac.signal };

  const blankDraft = () => JSON.parse(JSON.stringify(trgSamples[0].data));

  if (mode === "create") draft = blankDraft();

  const renderCreatePage = () => {
    const t = draft || blankDraft();
    const ev = t.event || "incoming_message";
    const ac2 = t.action?.type || "reply_template";
    const isIncoming = ev === "incoming_message";
    const isManual = ev === "manual";
    const vars = isIncoming
      ? ["{{sender}}", "{{text}}", "{{provider}}", "{{chatId}}", "{{chatTitle}}"]
      : ["{{toolName}}", "{{error}}", "{{args}}", "{{ms}}"];

    main.innerHTML = `${head(
      mode === "edit" ? `ویرایش اتوماسیون: ${esc(t.name)}` : "ساخت اتوماسیون جدید",
      "یک قالب آماده را انتخاب کنید یا شرط و اقدام دلخواه خود را بسازید.",
      "تریگرها و اتوماسیون",
      `<button class="btn btn-ghost btn-sm" type="button" id="trg-back">بازگشت به فهرست تریگرها</button>`,
    )}

    ${mode === "create" ? `
    <section class="trg-samples-wrap">
      <div class="trg-samples-head">
        <b>۱. انتخاب از نمونه‌های آماده (اختیاری)</b>
        <span class="hint">${fa(trgSamples.length)} قالب پرشده؛ با یک کلیک فرم را پر می‌کند.</span>
      </div>
      <div class="trg-samples">
        ${trgSamples.map((s) => `<button class="trg-sample${t.name === s.data.name ? " active" : ""}" type="button" data-trg-sample="${s.id}">
          <span class="pill pill-off">${s.badge}</span>
          <b>${esc(s.title)}</b>
          <span>${esc(s.sub)}</span>
        </button>`).join("")}
      </div>
    </section>` : ""}

    <section class="trg-builder">
      <div class="trg-preview" id="trg-preview" aria-live="polite"></div>

      <div class="trg-form-err" id="trg-form-err" role="alert" hidden></div>

      <form class="trg-form" id="trg-form" novalidate>
        <div class="trg-step">
          <div class="trg-step-head"><span class="trg-step-num">۱</span><div><b>چه زمانی اجرا شود؟</b><span>رویداد و شرطی که این اتوماسیون را فعال می‌کند.</span></div></div>
          <div class="trg-grid">
            <label><span>نام اتوماسیون</span><input class="input" name="name" required maxlength="80" value="${esc(t.name)}" placeholder="مثلاً پاسخ خودکار سلام"></label>
            <label><span>دسته‌بندی</span>
              ${selectControl("category", Object.entries(trgCatFa), t.category || "", "", "دسته‌بندی")}
            </label>
            <label><span>رویداد (Trigger Event)</span>
              ${selectControl("event", Object.entries(trgEventFa), ev, "trg-event", "رویداد")}
            </label>
          </div>
          <label><span>توضیح کوتاه</span><input class="input" name="description" value="${esc(t.description || "")}" placeholder="توضیح کاربرد این اتوماسیون"></label>

          <div class="trg-grid" id="trg-cond-incoming" ${isIncoming ? "" : "hidden"}>
            <label><span>پیام‌رسان</span>
              ${selectControl("provider", providerOptions, t.match?.provider || "*", "", "پیام‌رسان")}
            </label>
            <label><span>نوع گفتگو</span>
              ${selectControl("chatType", Object.entries(trgChatTypeFa), t.match?.chatType || "*", "", "نوع گفتگو")}
            </label>
            <label><span>کلمات کلیدی <small>(اختیاری)</small></span><input class="input" name="contains" value="${esc(t.match?.contains || "")}" placeholder="خالی = همه‌ی پیام‌ها؛ مثلاً: سلام, /start, قیمت"><small class="trg-hint">با ویرگول جدا کنید. <code class="ltr">*</code> در هر کلمه مثل الگو عمل می‌کند. خالی یعنی روی هر پیامی اجرا شود.</small></label>
          </div>

          <div class="trg-grid" id="trg-cond-mcp" ${!isIncoming && !isManual ? "" : "hidden"}>
            <label><span>الگوی نام ابزار MCP</span><input class="input ltr-input" name="matchToolName" value="${esc(t.match?.toolName || "*")}" placeholder="* یا *_send_* یا *_publish_*"></label>
          </div>

          <div class="trg-manual-note" ${isManual ? "" : "hidden"}>
            <span class="pill pill-ok">Manual Trigger</span>
            <p>این اتوماسیون با دکمه‌ی «اجرا» در لیست اجرا می‌شود. ورودی اجرا را هنگام اجرا به‌صورت JSON می‌دهید و در قالب‌ها با <code class="ltr">{{text}}</code>، <code class="ltr">{{sender}}</code> و ... قابل استفاده است.</p>
          </div>
        </div>

        <div class="trg-step">
          <div class="trg-step-head"><span class="trg-step-num">۲</span><div><b>چه کاری انجام شود؟</b><span>وقتی شرط بالا برقرار شد، این اقدام اجرا می‌شود.</span></div></div>
          <div class="trg-step-title trg-vars-row">
            <div class="trg-vars">
              <span>متغیرهای قابل استفاده:</span>
              ${vars.map((v) => `<button class="trg-var-chip" type="button" data-insert-var="${v}">${v}</button>`).join("")}
            </div>
          </div>
          <div class="trg-action-pick" role="radiogroup" aria-label="نوع اقدام">
            ${Object.entries(trgActionFa).map(([v, label]) => `
              <label class="trg-action-opt${ac2 === v ? " active" : ""}">
                <input type="radio" name="actionType" value="${v}" ${ac2 === v ? "checked" : ""}>
                <b>${label}</b><span>${trgActionHint[v] || ""}</span>
              </label>`).join("")}
          </div>

          <div class="trg-action-fields" data-ac-group="reply_template" ${ac2 === "reply_template" ? "" : "hidden"}>
            <label><span>متن پاسخ خودکار</span><textarea class="textarea" name="template" rows="3" placeholder="سلام {{sender}} عزیز...">${esc(t.action?.template || "")}</textarea></label>
          </div>

          <div class="trg-action-fields" data-ac-group="ai_reply" ${ac2 === "ai_reply" ? "" : "hidden"}>
            <label><span>دستورالعمل سیستم هوش مصنوعی (System Prompt)</span><textarea class="textarea" name="systemPrompt" rows="3" placeholder="تو پشتیبان فارسی هستی...">${esc(t.action?.systemPrompt || "")}</textarea></label>
          </div>

          <div class="trg-action-fields" data-ac-group="forward" ${ac2 === "forward" ? "" : "hidden"}>
            <div class="trg-grid">
              <label><span>سرویس مقصد</span><input class="input ltr-input" name="targetProvider" value="${esc(t.action?.targetProvider || "bale_client")}" placeholder="bale_client / telegram_client / rubika_client"></label>
              <label><span>شناسه‌ی چت مقصد (اختیاری)</span><input class="input ltr-input" name="targetChatId" value="${esc(t.action?.targetChatId || "")}" placeholder="خالی = چت پیش‌فرض سرویس"></label>
            </div>
            <label><span>متن پیام فوروارد</span><textarea class="textarea" name="forwardTemplate" rows="3" placeholder="📩 از {{provider}}: {{text}}">${esc(t.action?.template || "")}</textarea></label>
          </div>

          <div class="trg-action-fields" data-ac-group="call_tool" ${ac2 === "call_tool" ? "" : "hidden"}>
            <div class="trg-grid">
              <label><span>نام ابزار MCP</span>
                <div class="tool-pick-row">
                  <input class="input ltr-input" name="actionToolName" value="${esc(t.action?.toolName || "")}" placeholder="bale_client_send_message">
                  <button class="btn btn-ghost" type="button" data-pick-tool>انتخاب از سرویس‌ها</button>
                </div>
              </label>
              <label><span>آرگومان‌های JSON ابزار</span><textarea class="textarea ltr-input" name="toolArgs" rows="3" placeholder='{"chat_id":"{{chatId}}","text":"{{text}}"}'>${esc(t.action?.toolArgs || "")}</textarea></label>
            </div>
          </div>

          <div class="trg-action-fields" data-ac-group="webhook" ${ac2 === "webhook" ? "" : "hidden"}>
            <label><span>آدرس Webhook (POST JSON)</span><input class="input ltr-input" name="webhookUrl" value="${esc(t.action?.webhookUrl || "")}" placeholder="https://example.com/webhook"></label>
          </div>
        </div>

        <div class="trg-form-foot">
          <button class="btn btn-ghost" type="button" id="trg-cancel">انصراف</button>
          <button class="btn btn-primary" type="submit">${mode === "edit" ? "ذخیره‌ی تغییرات" : "ایجاد و فعال‌سازی اتوماسیون"}</button>
        </div>
      </form>
    </section>`;

    updatePreview();
  };

  // پیش‌نمایش زنده‌ی قانون از روی همان فرم
  const updatePreview = () => {
    const box = main.querySelector("#trg-preview");
    const form = main.querySelector("#trg-form");
    if (!box || !form) return;
    const fd = new FormData(form);
    const ev = String(fd.get("event") || "incoming_message");
    const act = String(fd.get("actionType") || "reply_template");
    const keywords = String(fd.get("contains") || "").trim();
    // نوع اقدام ممکن است دکمه‌ی رادیویی باشد؛ FormData همان مقدار انتخاب‌شده را می‌دهد
    const cond =
      ev === "incoming_message"
        ? `وقتی پیام ورودی در «${String(fd.get("provider") || "*").trim() || "*"}» (${trgChatTypeFa[String(fd.get("chatType") || "*")] || "همه"})${keywords ? ` شامل (${keywords})` : ""} برسد`
        : ev === "manual"
          ? "با اجرای دستی از داشبورد یا API"
          : `وقتی رویداد «${trgEventFa[ev] || ev}» برای ابزار (${String(fd.get("matchToolName") || "*").trim() || "*"}) رخ دهد`;
    box.innerHTML = `<span class="pill pill-ok">پیش‌نمایش قانون</span><span>${esc(cond)} ← <b>${trgActionFa[act] || act}</b></span>`;
  };

  const filteredTriggers = () => {
    const triggers = data.triggers || [];
    const needle = query.trim().toLowerCase();
    return triggers.filter((t) => {
      if (filterCat !== "all" && t.category !== filterCat) return false;
      if (!needle) return true;
      const hay = [t.name, t.description, t.match?.contains, t.match?.provider, t.match?.toolName, t.action?.type]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  };

  const emptyState = () => `<div class="trg-empty">
      <b>تریگری با این فیلتر پیدا نشد</b>
      <span>عبارت جستجو را پاک کنید، دسته‌ی دیگری را انتخاب کنید یا یک اتوماسیون تازه بسازید.</span>
    </div>`;

  const cardHtml = (t) => {
    const cond = t.event === "incoming_message"
      ? `${t.match?.provider && t.match.provider !== "*" ? t.match.provider : "همه‌ی سرویس‌ها"}${t.match?.chatType && t.match.chatType !== "*" ? ` · ${trgChatTypeFa[t.match.chatType] || t.match.chatType}` : ""}${t.match?.contains ? ` · کلمات: ${t.match.contains}` : ""}`
      : t.event === "manual"
        ? "اجرای دستی"
        : `ابزار: ${t.match?.toolName || "*"}`;
    return `<article class="trg-card${t.enabled ? " is-on" : ""}" data-trg-id="${esc(t.id)}">
      <div class="trg-card-top">
        <div class="trg-title">
          <span class="pill pill-off">${trgCatFa[t.category] || t.category}</span>
          <b title="${esc(t.name)}">${esc(t.name)}</b>
        </div>
        <label class="switch" title="فعال/غیرفعال کردن تریگر"><input type="checkbox" data-trg-toggle ${t.enabled ? "checked" : ""} aria-label="فعال‌سازی ${esc(t.name)}"><span></span></label>
      </div>
      <p class="hint">${esc(t.description || "")}</p>
      <div class="trg-meta">
        <span><b>رویداد:</b> ${trgEventFa[t.event] || t.event} (${esc(cond)})</span>
        <span><b>اقدام:</b> ${trgActionFa[t.action?.type] || t.action?.type}</span>
        ${t.hitCount ? `<span><b>اجرا:</b> ${fa(t.hitCount)} بار${t.lastRunAt ? ` (${ago(t.lastRunAt)})` : ""}</span>` : `<span><b>اجرا:</b> هنوز اجرا نشده</span>`}
      </div>
      ${t.lastError ? `<div class="trg-err">آخرین خطا: ${esc(t.lastError)}</div>` : ""}
      <div class="trg-actions">
        ${t.event === "manual" ? `<button class="btn btn-primary btn-sm" type="button" data-trg-run>اجرا</button>` : `<button class="btn btn-ghost btn-sm" type="button" data-trg-test>تست اجرا</button>`}
        <button class="btn btn-ghost btn-sm" type="button" data-trg-edit>ویرایش</button>
        <button class="btn btn-ghost btn-danger btn-sm" type="button" data-trg-del>حذف</button>
      </div>
    </article>`;
  };

  const listLogs = () => {
    const logs = data.logs || [];
    if (!logs.length) return `<p class="hint">هنوز تریگری اجرا نشده است. با دکمه‌ی «تست اجرا» اولین اجرای آزمایشی را ثبت کنید.</p>`;
    return `<div class="trg-log-list">${logs.slice(0, 25).map((l) => `<div class="trg-log ${l.ok ? "ok" : "fail"}">
        <span class="pill ${l.ok ? "pill-ok" : "pill-err"}">${l.ok ? "موفق" : "خطا"}</span>
        ${l.demo ? `<span class="pill pill-warn">نمونه</span>` : ""}
        <b>${esc(l.triggerName)}</b>
        <span class="trg-log-detail">${esc(l.detail)}</span>
        <span class="meta">${ago(l.at)}</span>
      </div>`).join("")}</div>`;
  };

  const drawCards = () => {
    const holder = main.querySelector("#trg-cards");
    if (!holder) return;
    const list = filteredTriggers();
    holder.innerHTML = list.length ? list.map(cardHtml).join("") : emptyState();
    const count = main.querySelector("#trg-result-count");
    if (count) count.textContent = `${fa(list.length)} از ${fa((data.triggers || []).length)} اتوماسیون`;
  };

  const drawLogs = () => {
    const holder = main.querySelector("#trg-logs-body");
    if (holder) holder.innerHTML = listLogs();
    const badge = main.querySelector("#trg-log-count");
    if (badge) badge.textContent = fa((data.logs || []).length);
  };

  const renderListPage = () => {
    const triggers = data.triggers || [];
    const logs = data.logs || [];
    const activeCount = triggers.filter((t) => t.enabled).length;
    const dayAgo = Date.now() - 86400_000;
    const dayLogs = logs.filter((l) => new Date(l.at).getTime() >= dayAgo);
    const dayOk = dayLogs.filter((l) => l.ok).length;
    const dayFail = dayLogs.length - dayOk;
    const builtinCount = triggers.filter((t) => t.builtin).length;
    const okRuns = logs.filter((l) => l.ok).length;

    main.innerHTML = `${head("تریگرها و اتوماسیون", "اتصال خودکار پیام‌رسان‌ها، هوش مصنوعی دیبا روتر، ابزارهای MCP و Webhookها.", "اتوماسیون",
      `<div class="inbox-head-actions">
        <span class="inbox-live-badge"><i class="${activeCount ? "on" : "off"}"></i><span>${fa(activeCount)} از ${fa(triggers.length)} تریگر فعال</span></span>
        <button class="btn btn-ghost btn-sm" type="button" id="trg-reset">بازنشانی پیش‌فرض‌ها</button>
        <button class="btn btn-primary btn-sm" type="button" id="trg-new">+ ساخت اتوماسیون جدید</button>
      </div>`)}

      <div class="trg-smart-card${triggers.find((t) => t.id === "ai-assistant-default" && t.enabled) ? " is-on" : ""}">
        <span class="trg-smart-icon">${icons.sparkles}</span>
        <div>
          <b>دستیار هوشمند پیش‌فرض</b>
          <p>${triggers.find((t) => t.id === "ai-assistant-default" && t.enabled) ? "به همه‌ی پیام‌های خصوصی، بدون نیاز به کلمه‌ی کلیدی پاسخ هوشمند می‌دهد. اتوماسیون‌های دارای کلمه‌ی کلیدی همیشه اولویت دارند." : "دستیار پیش‌فرض خاموش است. برای تجربه‌ی پیشنهادی، آن را از لیست پایین روشن کنید."}</p>
        </div>
      </div>

      <section class="trg-stats">
        <div class="trg-stat">
          <span>کل اتوماسیون‌ها</span>
          <b>${fa(triggers.length)}</b>
          <span class="hint">${fa(builtinCount)} نمونه‌ی آماده + ${fa(triggers.length - builtinCount)} سفارشی</span>
        </div>
        <div class="trg-stat${activeCount ? " is-ok" : ""}">
          <span>فعال</span>
          <b>${fa(activeCount)}</b>
          <span class="hint">${fa(triggers.length - activeCount)} خاموش</span>
        </div>
        <div class="trg-stat${dayFail ? " is-warn" : ""}">
          <span>اجرا در ۲۴ ساعت</span>
          <b>${fa(dayLogs.length)}</b>
          <span class="hint">${fa(dayOk)} موفق · ${fa(dayFail)} خطا</span>
        </div>
        <div class="trg-stat">
          <span>اجرای موفق</span>
          <b>${fa(okRuns)}</b>
          <span class="hint">از ${fa(logs.length)} اجرای ثبت‌شده</span>
        </div>
      </section>

      <div class="trg-toolbar">
        <div class="input-wrap trg-search">
          <input class="input" id="trg-search" type="search" value="${esc(query)}" placeholder="جستجو در نام، توضیح، کلمه‌ی کلیدی یا ابزار…" aria-label="جستجوی اتوماسیون">
          <span class="trg-search-icon">${icons.search}</span>
        </div>
        <span class="trg-count" id="trg-result-count"></span>
      </div>

      <div class="trg-cats" role="tablist">
        <button class="inbox-scope${filterCat === "all" ? " active" : ""}" type="button" data-trg-cat="all">همه <b class="scope-count">${fa(triggers.length)}</b></button>
        ${Object.entries(trgCatFa).map(([k, v]) => {
          const c = triggers.filter((t) => t.category === k).length;
          return `<button class="inbox-scope${filterCat === k ? " active" : ""}" type="button" data-trg-cat="${k}">${v} <b class="scope-count">${fa(c)}</b></button>`;
        }).join("")}
      </div>

      <section class="trg-list" id="trg-cards"></section>

      <section class="trg-logs">
        <div class="trg-logs-head">
          <b>گزارش اجرای تریگرها (<span id="trg-log-count">${fa(logs.length)}</span>)</b>
          <span class="hint">ردیف‌های نشان‌دار «نمونه» فقط برای نمایش ساخته شده‌اند و اجرای واقعی نیستند.</span>
          ${logs.length ? `<button class="btn btn-quiet btn-sm" type="button" id="trg-clear-logs">پاک کردن گزارش‌ها</button>` : ""}
        </div>
        <div id="trg-logs-body"></div>
      </section>`;

    drawCards();
    drawLogs();
  };

  const render = () => (mode === "list" ? renderListPage() : renderCreatePage());
  render();

  let lastFocusedTextarea = null;
  main.addEventListener("focusin", (e) => {
    if (e.target.matches("#trg-form textarea")) lastFocusedTextarea = e.target;
  }, on);

  main.addEventListener("input", (e) => {
    if (e.target.id === "trg-search") {
      query = e.target.value;
      drawCards();
      return;
    }
    if (e.target.closest("#trg-form")) {
      const errBox = main.querySelector("#trg-form-err");
      if (errBox && !errBox.hidden) errBox.hidden = true;
      updatePreview();
    }
  }, on);

  main.addEventListener("click", async (e) => {
    if (e.target.closest("[data-pick-tool]")) {
      const tool = await openToolPicker();
      if (tool) {
        const input = main.querySelector('[name="actionToolName"]');
        if (input) input.value = tool;
        updatePreview();
      }
      return;
    }
    const catBtn = e.target.closest("[data-trg-cat]");
    if (catBtn) {
      filterCat = catBtn.dataset.trgCat || "all";
      main.querySelectorAll("[data-trg-cat]").forEach((b) => b.classList.toggle("active", b === catBtn));
      drawCards();
      return;
    }
    if (e.target.closest("#trg-new")) {
      mode = "create";
      draft = blankDraft();
      history.replaceState(null, "", "#/triggers?new=1");
      return render();
    }
    if (e.target.id === "trg-cancel" || e.target.id === "trg-back") {
      mode = "list";
      draft = null;
      history.replaceState(null, "", "#/triggers");
      return render();
    }
    const sampleBtn = e.target.closest("[data-trg-sample]");
    if (sampleBtn) {
      const sample = trgSamples.find((s) => s.id === sampleBtn.dataset.trgSample);
      if (sample) {
        draft = JSON.parse(JSON.stringify(sample.data));
        render();
      }
      return;
    }
    const varChip = e.target.closest("[data-insert-var]");
    if (varChip) {
      const target = lastFocusedTextarea || main.querySelector("#trg-form .trg-action-fields:not([hidden]) textarea");
      if (target) {
        const v = varChip.dataset.insertVar;
        const pos = target.selectionStart ?? target.value.length;
        target.value = target.value.slice(0, pos) + v + target.value.slice(target.selectionEnd ?? pos);
        target.focus();
        updatePreview();
      }
      return;
    }
    if (e.target.closest("#trg-reset")) {
      await busy(e.target.closest("#trg-reset"), async () => {
        await api("triggers/reset-defaults", { body: {} });
        data = await api("triggers");
      });
      toast("تریگرهای پیش‌فرض بازیابی شدند");
      return render();
    }
    if (e.target.closest("#trg-clear-logs")) {
      await api("triggers/logs", { method: "DELETE" });
      data = await api("triggers");
      toast("گزارش‌ها پاک شدند");
      return render();
    }
    const card = e.target.closest("[data-trg-id]");
    if (!card) return;
    const id = card.dataset.trgId;
    if (e.target.closest("[data-trg-edit]")) {
      const found = (data.triggers || []).find((t) => t.id === id);
      if (found) {
        mode = "edit";
        draft = JSON.parse(JSON.stringify(found));
        render();
      }
      return;
    }
    if (e.target.closest("[data-trg-del]")) {
      if (!(await openModal({
        title: "حذف تریگر",
        message: "این تریگر حذف شود؟",
        confirmText: "حذف تریگر",
        tone: "danger",
      }))) return;
      await api(`triggers/${id}`, { method: "DELETE" });
      data = await api("triggers");
      toast("تریگر حذف شد");
      return render();
    }
    if (e.target.closest("[data-trg-run]")) {
      const btn = e.target.closest("[data-trg-run]");
      const raw = await openPromptModal({
        title: "اجرای دستی اتوماسیون",
        message: "ورودی این اجرا را به‌صورت JSON وارد کنید. متغیرها در قالب‌ها و آرگومان ابزارها قابل استفاده‌اند.",
        label: "ورودی اجرا (JSON)",
        value: '{\n  "text": "",\n  "sender": "کاربر تست"\n}',
        confirmText: "اجرای اتوماسیون",
      });
      if (raw === null) return;
      let vars;
      try {
        vars = JSON.parse(raw || "{}");
        if (!vars || typeof vars !== "object" || Array.isArray(vars)) throw new Error("ورودی باید یک شیء JSON باشد");
      } catch (ex) {
        toast(ex.message, true);
        return;
      }
      const r = await busy(btn, () => api(`triggers/${id}/run`, { body: { vars } }));
      data = await api("triggers");
      toast(r.ok ? r.detail : `خطا: ${r.detail}`, !r.ok);
      return render();
    }
    if (e.target.closest("[data-trg-test]")) {
      const btn = e.target.closest("[data-trg-test]");
      const r = await busy(btn, () => api(`triggers/${id}/test`, { body: {} }));
      data = await api("triggers");
      toast(r.ok ? r.detail : `خطا: ${r.detail}`, !r.ok);
      return render();
    }
  }, on);

  main.addEventListener("change", async (e) => {
    if (e.target.id === "trg-event") {
      const isInc = e.target.value === "incoming_message";
      const isManual = e.target.value === "manual";
      const incEl = document.getElementById("trg-cond-incoming");
      const mcpEl = document.getElementById("trg-cond-mcp");
      if (incEl) incEl.hidden = !isInc;
      if (mcpEl) mcpEl.hidden = isInc || isManual;
      const manualEl = main.querySelector(".trg-manual-note");
      if (manualEl) manualEl.hidden = !isManual;
      updatePreview();
      return;
    }
    if (e.target.name === "actionType") {
      const act = e.target.value;
      main.querySelectorAll("[data-ac-group]").forEach((el) => { el.hidden = el.dataset.acGroup !== act; });
      main.querySelectorAll(".trg-action-opt").forEach((el) => el.classList.toggle("active", el.querySelector("input").checked));
      updatePreview();
      return;
    }
    if (e.target.closest("#trg-form")) {
      updatePreview();
      return;
    }
    const sw = e.target.closest("[data-trg-toggle]");
    if (!sw) return;
    const id = sw.closest("[data-trg-id]").dataset.trgId;
    await api(`triggers/${id}`, { method: "PUT", body: { enabled: sw.checked } });
    data = await api("triggers");
    toast(sw.checked ? "تریگر فعال شد" : "تریگر غیرفعال شد");
    render();
  }, on);

  main.addEventListener("submit", async (e) => {
    if (e.target.id !== "trg-form") return;
    e.preventDefault();
    const fd = new FormData(e.target);
    const act = String(fd.get("actionType") || "reply_template");
    const payload = {
      name: String(fd.get("name") || "").trim(),
      description: String(fd.get("description") || "").trim(),
      category: String(fd.get("category") || "social"),
      event: String(fd.get("event") || "incoming_message"),
      match: {
        provider: String(fd.get("provider") || "*").trim() || "*",
        chatType: String(fd.get("chatType") || "*"),
        contains: String(fd.get("contains") || "").trim(),
        toolName: String(fd.get("matchToolName") || "*").trim() || "*",
      },
      action: {
        type: act,
        template: act === "forward" ? String(fd.get("forwardTemplate") || "") : String(fd.get("template") || ""),
        systemPrompt: String(fd.get("systemPrompt") || ""),
        targetProvider: String(fd.get("targetProvider") || "bale_client").trim(),
        targetChatId: String(fd.get("targetChatId") || "").trim(),
        webhookUrl: String(fd.get("webhookUrl") || "").trim(),
        toolName: String(fd.get("actionToolName") || "").trim(),
        toolArgs: String(fd.get("toolArgs") || "").trim(),
      },
    };
    const errBox = main.querySelector("#trg-form-err");
    const showFormErr = (msg, field) => {
      if (errBox) { errBox.textContent = msg; errBox.hidden = false; errBox.scrollIntoView({ block: "nearest" }); }
      // نام فیلد سرور مثل action.template است؛ به input متناظر نگاشت می‌شود
      const byName = { name: "name", description: "description", contains: "contains" };
      const sel = field && (byName[field] ? `[name="${byName[field]}"]` : field.startsWith("action.") || field.startsWith("match.") ? `[name="${field.split(".").pop()}"]` : null);
      const el = sel && main.querySelector(sel);
      if (el) el.focus();
    };
    if (!payload.name) return showFormErr("نام اتوماسیون را وارد کنید", "name");
    try {
      if (mode === "create") {
        await api("triggers", { body: { ...payload, enabled: true } });
        toast("اتوماسیون جدید ساخته و فعال شد");
      } else if (draft?.id) {
        await api(`triggers/${draft.id}`, { method: "PUT", body: payload });
        toast("تغییرات اتوماسیون ذخیره شد");
      }
      mode = "list";
      draft = null;
      history.replaceState(null, "", "#/triggers");
      data = await api("triggers");
      render();
    } catch (err) {
      if (err instanceof AuthError) return;
      showFormErr(err.message, err.field);
    }
  }, on);
}


// ---------------------------------------------------------------- settings
async function pageSettings(main) {
  const s = await api("settings");
  main.innerHTML = `${head("تنظیمات", "محیط اجرا، پروکسی و رمز عبور داشبورد را مدیریت کنید. تغییرات شبکه برای اتصال‌های جدید اعمال می‌شود.", "پیکربندی سرور")}
    <div class="settings-grid">
      <section class="panel">
        <h2>شبکه و پروکسی</h2>
        <p class="desc">برای سرویس‌هایی که از IP ایران به آن‌ها دسترسی ندارید، پروکسی HTTP یا SOCKS5 تنظیم کنید.</p>
        <div class="field">
          <span class="field-label">نوع پروکسی</span>
          <div class="seg" data-settings-proxy>
            ${[["none", "بدون پروکسی"], ["http", "HTTP"], ["socks5", "SOCKS5"]].map(([v, l]) => `<button type="button" data-proxy-type="${v}" aria-pressed="${s.proxyType === v}">${l}</button>`).join("")}
          </div>
        </div>
        <div class="field"><label for="settingsProxy">آدرس پروکسی</label><input id="settingsProxy" class="input ltr-input" value="${esc(s.proxyUrl || "")}" placeholder="http://127.0.0.1:8080 یا socks5://127.0.0.1:1080" ${s.proxyType === "none" ? "disabled" : ""}></div>
        <div class="settings-actions"><button class="btn btn-primary" type="button" id="save-settings">ذخیره تنظیمات</button><span class="hint" id="settings-status"></span></div>
      </section>

      <section class="panel">
        <h2>محیط اجرا</h2>
        <p class="desc">این مقادیر در سرور ذخیره می‌شوند. تغییر برخی از آن‌ها پس از ری‌استارت کامل اعمال می‌شود.</p>
        <div class="auth-two-col">
          <div class="field"><label for="retention">نگهداری لاگ (روز)</label><input id="retention" class="input ltr-input" type="number" min="1" max="365" value="${s.logRetentionDays}"></div>
          <div class="field"><label for="writeLimit">سقف نوشتن MCP در دقیقه</label><input id="writeLimit" class="input ltr-input" type="number" min="1" max="1000" value="${s.mcpWriteLimit}"></div>
        </div>
        <div class="settings-meta"><span>مسیر داده</span><code class="ltr">${esc(s.dataDir)}</code></div>
        <div class="settings-meta"><span>نسخه</span><code class="ltr">${esc(s.version || "")}</code></div>
        <div class="settings-actions"><button class="btn btn-ghost" type="button" id="save-runtime">ذخیره محیط</button><span class="hint" id="runtime-status"></span></div>
      </section>

      <section class="panel settings-proxy-pool" id="proxy-pool">
        <div class="px-head">
          <div>
            <h2>فهرست پروکسی</h2>
            <p class="desc">چند پروکسی ثبت کنید. با «سنجش سرعت» هر کدام چند بار آزمایش می‌شود و بر اساس سرعت، پایداری و سابقه رتبه می‌گیرد؛ با انتخاب خودکار، سریع‌ترین پروکسی سالم فعال می‌شود و هر ۵ دقیقه دوباره بررسی می‌شود.</p>
          </div>
          <label class="px-auto"><span>انتخاب خودکار سریع‌ترین</span><span class="switch"><input type="checkbox" id="px-auto" aria-label="انتخاب خودکار سریع‌ترین پروکسی"><span></span></span></label>
        </div>
        <div class="px-add">
          <textarea class="textarea ltr-input" id="px-list" rows="3" spellcheck="false" placeholder="هر خط یک پروکسی&#10;socks5://user:pass@10.0.0.1:1080&#10;http://10.0.0.2:3128" aria-label="فهرست پروکسی‌های تازه"></textarea>
          <div class="settings-actions">
            <button class="btn btn-primary" type="button" id="px-add-btn">افزودن به فهرست</button>
            <button class="btn btn-ghost" type="button" id="px-test-btn">سنجش سرعت همه</button>
            <span class="hint" id="px-status" role="status"></span>
          </div>
        </div>
        <div id="px-table"></div>
      </section>

      <section class="panel settings-password-panel">
        <h2>رمز عبور</h2>
        <p class="desc">پس از تغییر رمز، نشست‌های قبلی باطل می‌شوند و همین مرورگر دوباره وارد می‌شود.</p>
        ${s.passwordFromEnv ? '<div class="err-box">رمز عبور از متغیر <code class="ltr">ADMIN_PASSWORD</code> در فایل <code class="ltr">.env</code> کنترل می‌شود؛ برای تغییر، آن را ویرایش و سرور را ری‌استارت کنید.</div>' : `
        <form id="password-form">
          <div class="field"><label for="currentPw">رمز فعلی</label><input id="currentPw" type="password" class="input" autocomplete="current-password" required></div>
          <div class="field"><label for="newPw">رمز جدید</label><input id="newPw" type="password" class="input" autocomplete="new-password" minlength="8" required><span class="hint">حداقل ۸ کاراکتر</span></div>
          <div class="field"><label for="newPw2">تکرار رمز جدید</label><input id="newPw2" type="password" class="input" autocomplete="new-password" required></div>
          <div class="form-err" id="pw-err"></div>
          <button class="btn btn-primary" type="submit">تغییر رمز</button>
        </form>`}
      </section>
    </div>`;

  let proxyType = s.proxyType;
  const proxyInput = document.getElementById("settingsProxy");
  main.querySelectorAll("[data-settings-proxy] [data-proxy-type]").forEach((b) => {
    b.addEventListener("click", () => {
      proxyType = b.dataset.proxyType;
      main.querySelectorAll("[data-settings-proxy] [data-proxy-type]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      proxyInput.disabled = proxyType === "none";
      if (proxyType === "none") proxyInput.value = "";
    });
  });

  const saveSettings = async (withRuntime) => {
    const status = document.getElementById(withRuntime ? "runtime-status" : "settings-status");
    try {
      const body = withRuntime
        ? { ...s, proxyType, proxyUrl: proxyInput.value.trim(), logRetentionDays: Number(document.getElementById("retention").value), mcpWriteLimit: Number(document.getElementById("writeLimit").value) }
        : { proxyType, proxyUrl: proxyInput.value.trim(), logRetentionDays: s.logRetentionDays, mcpWriteLimit: s.mcpWriteLimit };
      const r = await api("settings", { method: "PUT", body });
      Object.assign(s, r);
      if (status) status.textContent = r.restartRecommended ? "ذخیره شد؛ برای اعمال کامل، سرور را ری‌استارت کنید." : "ذخیره شد.";
      toast("تنظیمات ذخیره شد");
    } catch (ex) {
      if (status) status.textContent = ex.message;
    }
  };
  document.getElementById("save-settings").addEventListener("click", () => saveSettings(false));
  document.getElementById("save-runtime").addEventListener("click", () => saveSettings(true));

  // ---- فهرست پروکسی
  const pxTable = document.getElementById("px-table");
  const pxStatus = document.getElementById("px-status");
  const pxAuto = document.getElementById("px-auto");
  const drawProxies = (pool) => {
    pxAuto.checked = pool.auto;
    if (!pool.entries.length) {
      pxTable.innerHTML = `<div class="empty"><b>هنوز پروکسی‌ای در فهرست نیست</b>نشانی‌ها را بالا وارد کنید و «افزودن به فهرست» را بزنید.</div>`;
      return;
    }
    pxTable.innerHTML = `<div class="px-list" role="list">${pool.entries.map((p, i) => {
      const state = !p.enabled ? ["pill-off", "خاموش"] : !p.checks ? ["pill-off", "سنجیده نشده"] : p.alive ? ["pill-ok", "سالم"] : ["pill-err", "بدون پاسخ"];
      return `<div class="px-row${p.active ? " is-active" : ""}${p.enabled ? "" : " is-off"}" role="listitem" data-px="${esc(p.id)}">
        <span class="px-rank">${p.alive && p.enabled ? fa(i + 1) : "—"}</span>
        <div class="px-main">
          <code class="ltr px-url" title="${esc(p.url)}">${esc(p.url)}</code>
          <div class="px-tags">
            <span class="pill ${state[0]}">${state[1]}</span>
            ${p.active ? '<span class="pill pill-ok">فعال</span>' : ""}
            <span class="px-kind">${p.kind === "socks5" ? "SOCKS5" : "HTTP"}</span>
            ${p.lastError && p.enabled ? `<span class="px-err" title="${esc(p.lastError)}">${esc(p.lastError)}</span>` : ""}
          </div>
        </div>
        <dl class="px-metrics">
          <div><dt>تأخیر</dt><dd>${p.ewmaMs === null ? "—" : `${fa(p.ewmaMs)} <small>ms</small>`}</dd></div>
          <div><dt>نوسان</dt><dd>${p.jitterMs === null ? "—" : `${fa(p.jitterMs)} <small>ms</small>`}</dd></div>
          <div><dt>موفقیت</dt><dd>${p.successRate === null ? "—" : `${fa(p.successRate)}٪`}</dd></div>
        </dl>
        <div class="px-actions">
          <button class="btn btn-ghost btn-sm" type="button" data-px-use ${p.active ? "disabled" : ""}>${p.active ? "در حال استفاده" : "استفاده"}</button>
          <label class="switch" title="${p.enabled ? "خاموش کردن این پروکسی" : "روشن کردن این پروکسی"}"><input type="checkbox" data-px-toggle ${p.enabled ? "checked" : ""} aria-label="روشن بودن پروکسی"><span></span></label>
          <button class="btn btn-icon btn-quiet btn-danger" type="button" data-px-del title="حذف" aria-label="حذف پروکسی">${icons.cross}</button>
        </div>
      </div>`;
    }).join("")}</div>`;
  };
  const pxCall = async (btn, fn, done) => {
    pxStatus.textContent = "";
    try {
      const r = btn ? await busy(btn, fn) : await fn();
      drawProxies(r);
      // پروکسی فعال برنامه ممکن است عوض شده باشد؛ فرم بالای صفحه هم همان را نشان دهد
      const fresh = await api("settings");
      Object.assign(s, fresh);
      proxyType = fresh.proxyType;
      proxyInput.value = fresh.proxyUrl || "";
      proxyInput.disabled = proxyType === "none";
      main.querySelectorAll("[data-settings-proxy] [data-proxy-type]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.proxyType === proxyType)));
      if (done) pxStatus.textContent = done(r);
    } catch (ex) {
      if (!(ex instanceof AuthError)) pxStatus.textContent = ex.message;
    }
  };
  api("proxies").then(drawProxies).catch((ex) => { if (!(ex instanceof AuthError)) pxStatus.textContent = ex.message; });
  document.getElementById("px-add-btn").addEventListener("click", (e) => {
    const box = document.getElementById("px-list");
    pxCall(e.currentTarget, () => api("proxies", { body: { list: box.value } }), (r) => {
      if (r.added) box.value = "";
      const parts = [`${fa(r.added)} پروکسی اضافه شد`];
      if (r.duplicates) parts.push(`${fa(r.duplicates)} تکراری`);
      if (r.invalid.length) parts.push(`${fa(r.invalid.length)} خط نامعتبر`);
      return parts.join(" · ");
    });
  });
  document.getElementById("px-test-btn").addEventListener("click", (e) => {
    pxStatus.textContent = "در حال سنجش…";
    pxCall(e.currentTarget, () => api("proxies/test", { body: {} }), (r) => {
      const alive = r.entries.filter((p) => p.alive && p.enabled).length;
      const reason = { first: "سریع‌ترین پروکسی فعال شد", faster: "پروکسی سریع‌تر جایگزین شد", failover: "پروکسی قبلی پاسخ نمی‌داد؛ جایگزین شد" }[r.switched?.reason];
      return `${fa(alive)} از ${fa(r.entries.length)} پروکسی پاسخ داد${reason ? ` · ${reason}` : ""}`;
    });
  });
  pxAuto.addEventListener("change", () => pxCall(null, () => api("proxies/auto", { method: "PUT", body: { auto: pxAuto.checked } }), () => (pxAuto.checked ? "انتخاب خودکار روشن شد؛ با سنجش بعدی سریع‌ترین پروکسی فعال می‌شود." : "انتخاب خودکار خاموش شد.")));
  pxTable.addEventListener("click", async (e) => {
    const id = e.target.closest("[data-px]")?.dataset.px;
    if (!id) return;
    const use = e.target.closest("[data-px-use]");
    if (use) return pxCall(use, () => api(`proxies/${id}`, { method: "PUT", body: { active: true } }), () => "این پروکسی فعال شد و انتخاب خودکار خاموش است.");
    const del = e.target.closest("[data-px-del]");
    if (del) return pxCall(del, () => api(`proxies/${id}`, { method: "DELETE" }), () => "پروکسی حذف شد.");
  });
  pxTable.addEventListener("change", (e) => {
    const toggle = e.target.closest("[data-px-toggle]");
    if (toggle) pxCall(null, () => api(`proxies/${toggle.closest("[data-px]").dataset.px}`, { method: "PUT", body: { enabled: toggle.checked } }));
  });

  const passwordForm = document.getElementById("password-form");
  if (passwordForm) passwordForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = document.getElementById("pw-err");
    err.textContent = "";
    const newPw = document.getElementById("newPw").value;
    if (newPw !== document.getElementById("newPw2").value) { err.textContent = "رمز جدید و تکرارش یکی نیستند"; return; }
    try {
      await busy(e.target.querySelector("button"), () => api("settings/password", { method: "POST", body: { currentPassword: document.getElementById("currentPw").value, newPassword: newPw } }));
      toast("رمز عبور تغییر کرد");
      e.target.reset();
    } catch (ex) {
      err.textContent = ex.message;
    }
  });
}

// ---------------------------------------------------------------- logs
/** صفحه‌بندی گزارش‌ها: شماره‌ی صفحه‌ی جاری، بازه و تعداد هر صفحه */
function logPagerHtml() {
  const page = state.logPage;
  const size = state.logPageSize;
  const total = state.logTotal;
  const totalPages = state.logTotalPages;
  const from = total ? (page - 1) * size + 1 : 0;
  const to = total ? Math.min(total, page * size) : 0;
  const numbers = [...new Set([1, totalPages, page - 1, page, page + 1])]
    .filter((n) => n >= 1 && n <= totalPages)
    .sort((a, b) => a - b);
  let pages = "";
  let previous = 0;
  for (const n of numbers) {
    if (previous && n - previous > 1) pages += `<span class="pager-gap" aria-hidden="true">…</span>`;
    pages += `<button type="button" class="pager-btn ${n === page ? "is-active" : ""}" data-page="${n}" ${n === page ? 'aria-current="page"' : ""} aria-label="صفحه ${fa(n)}">${fa(n)}</button>`;
    previous = n;
  }
  return `<span class="pager-info">${total
      ? `نمایش ${fa(from)}–${fa(to)} از ${fa(total)} گزارش`
      : "گزارشی با این مشخصات ثبت نشده است"
    }</span>
    <nav class="pager-pages" aria-label="صفحه‌بندی گزارش‌ها">
      <button type="button" class="pager-btn pager-step" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""} aria-label="صفحه‌ی قبل">قبلی</button>
      ${pages}
      <button type="button" class="pager-btn pager-step" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""} aria-label="صفحه‌ی بعد">بعدی</button>
    </nav>
    <label class="pager-size">در هر صفحه
      <select class="select" data-page-size aria-label="تعداد گزارش در هر صفحه">
        ${[10, 20, 50, 100].map((n) => `<option value="${n}" ${size === n ? "selected" : ""}>${fa(n)}</option>`).join("")}
      </select>
    </label>`;
}

function logResultHtml(value) {
  try {
    return `<pre class="json">${jsonHtml(value ? JSON.parse(value) : null)}</pre>`;
  } catch {
    return `<pre class="json">${esc(value || "")}</pre>`;
  }
}

async function pageLogs(main) {
  if (!state.providers.length) state.providers = await api("providers");
  main.innerHTML = `${head("گزارش فراخوانی‌ها", "گزارش فراخوانی‌های مدل‌های هوش مصنوعی و داشبورد به تفکیک پیام‌رسان و وضعیت، با صفحه‌بندی برای مرور همه‌ی رویدادها.", "رویدادها و لاگ‌ها",
    `<div class="toolbar" style="margin:0">
      <button class="btn btn-icon btn-ghost" id="reload" aria-label="به‌روزرسانی">${icons.refresh}</button>
      <button class="btn btn-ghost btn-danger btn-sm" id="clear">پاک کردن گزارش‌ها</button>
    </div>`)}
    <div class="toolbar">
      <div class="seg" role="group" aria-label="فیلتر وضعیت">
        ${[["all", "همه"], ["ok", "موفق"], ["fail", "ناموفق"]].map(([v, l]) => `<button data-ok="${v}" aria-pressed="${state.logFilter.ok === v}">${l}</button>`).join("")}
      </div>
      <div class="ui-select" id="pf" data-ui-select>
        <button class="ui-select-trigger" type="button" data-select-trigger aria-haspopup="listbox" aria-expanded="false" aria-label="فیلتر پیام‌رسان">
          <span data-select-label>${esc(state.providers.find((p) => p.id === state.logFilter.provider)?.nameFa || "همه‌ی پیام‌رسان‌ها")}</span>
          <span class="ui-select-chevron">${icons.chevron}</span>
        </button>
        <div class="ui-select-menu" role="listbox" hidden>
          <button type="button" class="ui-select-option ${state.logFilter.provider ? "" : "active"}" role="option" aria-selected="${!state.logFilter.provider}" data-select-value="">همه‌ی پیام‌رسان‌ها</button>
          ${state.providers.map((p) => `<button type="button" class="ui-select-option ${state.logFilter.provider === p.id ? "active" : ""}" role="option" aria-selected="${state.logFilter.provider === p.id}" data-select-value="${esc(p.id)}">${esc(p.nameFa)}</button>`).join("")}
        </div>
      </div>
    </div>
    <div class="calls" id="log-list"></div>
    <div class="pager" id="log-pager"></div>`;

  const list = document.getElementById("log-list");
  const pager = document.getElementById("log-pager");
  let openId = null;
  const draw = () => {
    list.innerHTML = state.logs.length
      ? `<div class="call call-head" aria-hidden="true">
          <span></span><span class="col-label">ابزار</span><span class="src">منبع</span><span class="meta call-dur">مدت</span><span class="meta call-ago">زمان</span>
        </div>` + state.logs.map((l) => callRow(l, true) + (l.id === openId ? `<div class="call-detail"><div class="tool-form" style="padding-top:14px">
          <div><div class="hint">آرگومان‌های ورودی به مدل</div><pre class="json">${jsonHtml(l.args)}</pre></div>
          <div><div class="hint">${l.ok ? "خروجی موفق" : "پیام خطا"}</div>${l.ok ? logResultHtml(l.result) : `<div class="err-box">${esc(l.error)}</div>`}</div>
        </div></div>` : "")).join("")
      : `<div class="empty"><b>گزارشی با این مشخصات یافت نشد</b>فیلترها را تغییر داده یا ابزاری را فراخوانی کنید.</div>`;
    pager.innerHTML = logPagerHtml();
    pager.hidden = state.logTotal === 0;
  };
  /**
   * صفحه‌ی جاری را از سرور می‌گیرد (فیلترها سمت سرور اعمال می‌شوند تا شمارش و
   * شماره‌ی صفحه‌ها درست باشد). silent برای به‌روزرسانی خودکار است.
   */
  const load = async (silent = false) => {
    const f = state.logFilter;
    const qs = new URLSearchParams({ page: String(state.logPage), pageSize: String(state.logPageSize) });
    if (f.ok !== "all") qs.set("ok", f.ok);
    if (f.provider) qs.set("provider", f.provider);
    try {
      const r = await api(`logs?${qs.toString()}`);
      if (Array.isArray(r)) {
        // پاسخ قدیمی (بدون صفحه‌بندی)
        state.logs = r;
        state.logTotal = r.length;
        state.logTotalPages = Math.max(1, Math.ceil(r.length / state.logPageSize));
      } else {
        state.logs = Array.isArray(r.items) ? r.items : [];
        state.logPage = Number(r.page) || 1;
        state.logPageSize = Number(r.pageSize) || state.logPageSize;
        state.logTotal = Number(r.total) || 0;
        state.logTotalPages = Number(r.totalPages) || 1;
      }
      draw();
    } catch (err) {
      if (!silent) throw err;
    }
  };
  await load();
  state.timer = setInterval(() => {
    // در صفحه‌های قدیمی محتوا را جابه‌جا نکن؛ به‌روزرسانی خودکار فقط برای صفحه‌ی اول
    if (!openId && state.logPage === 1 && document.body.contains(list)) load(true);
  }, 5000);

  list.addEventListener("click", (e) => {
    const r = e.target.closest("[data-log]");
    if (r) { openId = openId === r.dataset.log ? null : r.dataset.log; draw(); }
  });
  list.addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.closest("[data-log]")?.click(); });
  main.querySelector(".seg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ok]");
    if (!b) return;
    state.logFilter.ok = b.dataset.ok;
    state.logPage = 1;
    openId = null;
    main.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    load().catch((ex) => toast(ex.message, true));
  });
  const pf = document.getElementById("pf");
  const pfTrigger = pf.querySelector("[data-select-trigger]");
  const pfMenu = pf.querySelector(".ui-select-menu");
  const pfLabel = pf.querySelector("[data-select-label]");
  const closePf = () => {
    pfMenu.hidden = true;
    pf.classList.remove("open");
    pfTrigger.setAttribute("aria-expanded", "false");
  };
  const openPf = () => {
    pfMenu.hidden = false;
    pf.classList.add("open");
    pfTrigger.setAttribute("aria-expanded", "true");
  };
  pfTrigger.addEventListener("click", () => (pfMenu.hidden ? openPf() : closePf()));
  pf.querySelectorAll("[data-select-value]").forEach((option) => {
    option.addEventListener("click", () => {
      state.logFilter.provider = option.dataset.selectValue;
      pfLabel.textContent = option.textContent;
      pf.querySelectorAll("[data-select-value]").forEach((x) => {
        const active = x === option;
        x.classList.toggle("active", active);
        x.setAttribute("aria-selected", String(active));
      });
      closePf();
      state.logPage = 1;
      openId = null;
      load().catch((ex) => toast(ex.message, true));
    });
  });
  pf.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closePf(); pfTrigger.focus(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (pfMenu.hidden) openPf();
      const options = [...pf.querySelectorAll("[data-select-value]")];
      const index = options.indexOf(document.activeElement);
      const next = e.key === "ArrowDown"
        ? options[Math.min(options.length - 1, index + 1)]
        : options[Math.max(0, index - 1)];
      next?.focus();
    }
  });
  main.addEventListener("click", (e) => {
    if (!pf.contains(e.target)) closePf();
  });

  pager.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-page]");
    if (!btn || btn.disabled) return;
    const next = Number(btn.dataset.page);
    if (!Number.isFinite(next) || next === state.logPage) return;
    state.logPage = next;
    openId = null;
    load().catch((ex) => toast(ex.message, true));
  });
  pager.addEventListener("change", (e) => {
    if (!e.target.matches("[data-page-size]")) return;
    const size = Number(e.target.value);
    if (!Number.isFinite(size) || size === state.logPageSize) return;
    state.logPageSize = size;
    state.logPage = 1;
    openId = null;
    load().catch((ex) => toast(ex.message, true));
  });

  document.getElementById("reload").onclick = (e) => busy(e.currentTarget, () => load());
  document.getElementById("clear").onclick = async () => {
    if (!(await openModal({
      title: "پاک کردن گزارش‌ها",
      message: "آیا تمامی گزارش‌ها و فایل‌های لاگ پاک شوند؟",
      confirmText: "پاک کردن همه",
      tone: "danger",
    }))) return;
    await api("logs", { method: "DELETE" });
    state.logPage = 1;
    openId = null;
    await load();
    toast("تمام گزارش‌ها پاک شدند");
  };
}

// ---------------------------------------------------------------- diba router model picker
const DR_MODELS_TTL = 10 * 60 * 1000;
const DR_DEFAULT_MODEL = "dibachain/diba-router-free";
let drModelsCache = { at: 0, models: [] };

/** فهرست مدل‌های چت/بینایی دیبا روتر را می‌گیرد (پاسخ در حافظه کش می‌شود) */
async function drLoadModels(force = false) {
  if (!force && drModelsCache.models.length && Date.now() - drModelsCache.at < DR_MODELS_TTL) return drModelsCache.models;
  const r = await api("dibarouter/models");
  const models = Array.isArray(r.models) ? r.models.filter((m) => m && m.id) : [];
  drModelsCache = { at: Date.now(), models };
  return models;
}

const DR_DIGITS_FA = "۰۱۲۳۴۵۶۷۸۹";
const DR_DIGITS_AR = "٠١٢٣٤٥٦٧٨٩";
// جستجو را با فارسی/عربی و ارقام یکسان می‌کند تا «ي» و «ی» و «۳» و «3» یکی باشند
const drNorm = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[۰-۹]/g, (d) => String(DR_DIGITS_FA.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(DR_DIGITS_AR.indexOf(d)));

const drContextShort = (n) => {
  if (!n) return "";
  if (n >= 1048576) return `${fa(Math.round(n / 1048576))}M`;
  if (n >= 1024) return `${fa(Math.round(n / 1024))}K`;
  return fa(n);
};
const drProvider = (id) => String(id ?? "").split("/")[0] || String(id ?? "");
const drMonogram = (id) => (drProvider(id).match(/[a-z0-9]/i)?.[0] || "?").toUpperCase();
const drIsVision = (m) => String(m?.category ?? "").toLowerCase() === "vision";
const drRank = (m) => (m.id === DR_DEFAULT_MODEL ? 0 : m.is_free ? 1 : 2);

/**
 * انتخابگر مدل با جستجو و فیلتر — دکمه‌ی trigger + پنل listbox.
 * مقدار انتخاب‌شده در input[type=hidden] نگه داشته می‌شود تا فرم مثل قبل بخواندش.
 */
function initDibaModelPicker(field, opts = {}) {
  const root = field.querySelector(".dr-picker");
  const hidden = field.querySelector('input[type="hidden"]');
  const hint = field.querySelector(".hint");
  const note = field.querySelector(".dr-note");
  if (!root || !hidden) return null;

  const disabled = Boolean(opts.disabled);
  const load = typeof opts.load === "function" ? opts.load : drLoadModels;
  const ac = new AbortController();
  const signal = ac.signal;

  let models = [];
  let selected = String(opts.value || DR_DEFAULT_MODEL);
  let savedValue = selected;
  let query = "";
  let filter = "all";
  let active = -1;
  let visible = 120;
  let open = false;
  let loading = false;
  let refreshing = false;
  let error = "";
  let loaded = false;

  hidden.value = selected;
  root.innerHTML = `
    <button type="button" class="dr-trigger" id="dr-model-picker" aria-haspopup="listbox" aria-expanded="false" aria-controls="dr-model-listbox" aria-describedby="dr-model-hint" ${disabled ? "disabled" : ""}>
      <span class="dr-trigger-text" data-trigger-text></span>
      <span class="dr-trigger-chevron" aria-hidden="true">${icons.chevron}</span>
    </button>
    <div class="dr-panel" hidden>
      <div class="dr-panel-head">
        <div class="dr-search">
          <span class="dr-search-icon" aria-hidden="true">${icons.search}</span>
          <input class="dr-search-input" type="text" role="combobox" autocomplete="off" spellcheck="false" placeholder="جستجوی مدل…" aria-label="جستجوی مدل" aria-autocomplete="list" aria-controls="dr-model-listbox" aria-expanded="false">
          <button type="button" class="dr-search-clear" aria-label="پاک کردن جستجو" hidden>${icons.cross}</button>
        </div>
        <div class="dr-chips" role="group" aria-label="فیلتر مدل‌ها" data-chips></div>
      </div>
      <div class="dr-list" id="dr-model-listbox" role="listbox" aria-label="فهرست مدل‌ها" data-list></div>
      <div class="dr-panel-foot">
        <span class="dr-foot-count" data-count aria-live="polite"></span>
        <div class="dr-foot-actions">
          <button type="button" class="dr-foot-btn" data-more hidden>بیشتر</button>
          <button type="button" class="dr-foot-btn" data-refresh>${icons.refresh}<span>بروزرسانی</span></button>
        </div>
      </div>
    </div>`;

  const trigger = root.querySelector(".dr-trigger");
  const triggerText = root.querySelector("[data-trigger-text]");
  const panel = root.querySelector(".dr-panel");
  const search = root.querySelector(".dr-search-input");
  const clearBtn = root.querySelector(".dr-search-clear");
  const chips = root.querySelector("[data-chips]");
  const list = root.querySelector("[data-list]");
  const countEl = root.querySelector("[data-count]");
  const moreBtn = root.querySelector("[data-more]");
  const refreshBtn = root.querySelector("[data-refresh]");

  const modelById = (id) => models.find((m) => m.id === id);

  function filteredModels() {
    const tokens = drNorm(query).trim().split(/\s+/).filter(Boolean);
    const out = [];
    for (const m of models) {
      if (filter === "free" && !m.is_free) continue;
      if (filter === "tools" && !m.supports_tools) continue;
      if (filter === "vision" && !drIsVision(m)) continue;
      if (tokens.length) {
        const hay = drNorm(`${m.name} ${m.id}`);
        if (!tokens.every((t) => hay.includes(t))) continue;
      }
      out.push(m);
    }
    out.sort((a, b) => drRank(a) - drRank(b) || String(a.name).localeCompare(String(b.name), "en", { sensitivity: "base" }));
    return out;
  }

  function customId() {
    const q = query.trim();
    if (!q) return "";
    return models.some((m) => m.id.toLowerCase() === q.toLowerCase()) ? "" : q;
  }

  function counts() {
    let free = 0;
    let tools = 0;
    let vision = 0;
    for (const m of models) {
      if (m.is_free) free++;
      if (m.supports_tools) tools++;
      if (drIsVision(m)) vision++;
    }
    return { all: models.length, free, tools, vision };
  }

  function paintTrigger() {
    const model = modelById(selected);
    const name = (model && model.name) || selected || "انتخاب مدل";
    const showId = Boolean(model && model.name && model.name !== selected);
    triggerText.innerHTML = `<span class="dr-trigger-name">${esc(name)}</span>${showId ? `<span class="dr-trigger-id">${esc(selected)}</span>` : ""}`;
    trigger.title = selected;
  }

  function paintHint() {
    if (!hint) return;
    hint.classList.remove("hint-dirty");
    if (disabled) {
      hint.textContent = "مدل از متغیر محیطی خوانده می‌شود و از داشبورد تغییر نمی‌کند.";
      return;
    }
    if (loading && !models.length) {
      hint.textContent = "در حال دریافت فهرست مدل‌ها از دیبا روتر…";
      return;
    }
    if (error && !models.length) {
      hint.textContent = "فهرست مدل‌ها دریافت نشد؛ از دکمهٔ «بروزرسانی» در انتخابگر دوباره تلاش کنید.";
      return;
    }
    if (selected !== savedValue) {
      hint.textContent = "تغییر ذخیره نشده؛ برای اعمال، «ذخیره اتصال» را بزنید.";
      hint.classList.add("hint-dirty");
      return;
    }
    if (!models.length) {
      hint.textContent = "انتخابگر مدل را باز کنید و نام یا شناسهٔ مدل را جستجو کنید.";
      return;
    }
    const free = counts().free;
    hint.innerHTML = `${fa(models.length)} مدل چت و بینایی${free ? ` · ${fa(free)} مدل رایگان` : ""} · بر اساس نام یا شناسه جستجو کنید`;
  }

  function paintNote() {
    if (!note) return;
    const model = modelById(selected);
    if (!model) {
      note.hidden = true;
      note.innerHTML = "";
      return;
    }
    const bits = [];
    if (model.is_free) bits.push(`<span class="dr-note-free">رایگان</span>`);
    if (model.context_length) bits.push(`<span>زمینهٔ ${fa(model.context_length)} توکن</span>`);
    if (model.supports_tools) bits.push(`<span>فراخوانی ابزار</span>`);
    if (drIsVision(model)) bits.push(`<span>درک تصویر</span>`);
    note.innerHTML = `${bits.length ? `<div class="dr-note-meta">${bits.join(`<span class="dr-note-sep" aria-hidden="true">·</span>`)}</div>` : ""}${model.description ? `<p class="dr-note-desc">${esc(model.description)}</p>` : ""}`;
    note.hidden = !note.innerHTML;
  }

  function paintChips() {
    if (!models.length) {
      chips.innerHTML = "";
      return;
    }
    const c = counts();
    const defs = [
      ["all", "همه", c.all],
      ["free", "رایگان", c.free],
      ["tools", "ابزار", c.tools],
      ["vision", "بینایی", c.vision],
    ].filter(([key, , n]) => key === "all" || key === "free" || n > 0);
    chips.innerHTML = defs
      .map(([key, label, n]) => `<button type="button" class="dr-chip" data-filter="${key}" aria-pressed="${filter === key}">${label}<span class="dr-chip-count">${fa(n)}</span></button>`)
      .join("");
  }

  function optionHtml(m, index) {
    const isSelected = m.id === selected;
    return `<div class="dr-opt${index === active ? " active" : ""}" role="option" id="dr-opt-${index}" data-opt-index="${index}" data-id="${esc(m.id)}" aria-selected="${isSelected}" tabindex="-1">
      <span class="dr-opt-mark" aria-hidden="true">${esc(drMonogram(m.id))}</span>
      <span class="dr-opt-body">
        <span class="dr-opt-name">${esc(m.name)}</span>
        <span class="dr-opt-meta">
          <span class="dr-opt-id">${esc(m.id)}</span>
          ${m.context_length ? `<span class="dr-opt-sep" aria-hidden="true">·</span><span title="زمینهٔ ${fa(m.context_length)} توکن">${drContextShort(m.context_length)}</span>` : ""}
          ${m.supports_tools ? `<span class="dr-opt-flag" role="img" aria-label="فراخوانی ابزار" title="فراخوانی ابزار">${icons.tools}</span>` : ""}
          ${drIsVision(m) ? `<span class="dr-opt-flag" role="img" aria-label="درک تصویر" title="درک تصویر">${icons.image}</span>` : ""}
        </span>
      </span>
      <span class="dr-opt-end">
        ${m.is_free ? `<span class="dr-opt-free">رایگان</span>` : ""}
        <span class="dr-opt-check" aria-hidden="true">${icons.check}</span>
      </span>
    </div>`;
  }

  function customHtml(index, id) {
    return `<div class="dr-opt dr-opt-custom${index === active ? " active" : ""}" role="option" id="dr-opt-custom" data-opt-index="${index}" data-custom="1" aria-selected="${selected === id}" tabindex="-1">
      <span class="dr-opt-mark" aria-hidden="true">${icons.plus}</span>
      <span class="dr-opt-body">
        <span class="dr-opt-name">استفاده از «<span class="dr-custom-id">${esc(id)}</span>»</span>
        <span class="dr-opt-meta">شناسهٔ دلخواه مدل</span>
      </span>
      <span class="dr-opt-end"><span class="dr-opt-check" aria-hidden="true">${icons.check}</span></span>
    </div>`;
  }

  function paintList() {
    if (!open) return;
    const rows = filteredModels();
    const custom = customId();
    const shown = Math.min(rows.length, visible);
    const optionCount = shown + (custom ? 1 : 0);
    if (!optionCount) active = -1;
    else if (active < 0 || active >= optionCount) active = 0;

    if (loading && !models.length) {
      list.innerHTML = `<div class="dr-state"><span class="dr-spinner" aria-hidden="true"></span><span>در حال دریافت فهرست مدل‌ها…</span></div>`;
    } else if (error && !models.length) {
      list.innerHTML = `<div class="dr-state dr-state-error"><span class="dr-state-icon">${icons.alert}</span><b>فهرست مدل‌ها دریافت نشد</b><span>${esc(error)}</span><button type="button" class="btn btn-ghost btn-sm" data-retry>تلاش دوباره</button></div>`;
    } else if (!rows.length && !custom) {
      list.innerHTML = models.length
        ? `<div class="dr-state"><span class="dr-state-icon">${icons.search}</span><b>مدلی پیدا نشد</b><span>نام یا شناسهٔ دیگری را امتحان کنید.</span></div>`
        : `<div class="dr-state"><span class="dr-state-icon">${icons.alert}</span><b>فهرست خالی است</b><span>دیبا روتر مدلی برنگرداند.</span></div>`;
    } else {
      list.innerHTML = rows.slice(0, shown).map((m, i) => optionHtml(m, i)).join("") + (custom ? customHtml(shown, custom) : "");
    }

    const activeEl = active >= 0 ? list.querySelector(`[data-opt-index="${active}"]`) : null;
    search.setAttribute("aria-activedescendant", activeEl?.id || "");
    activeEl?.scrollIntoView({ block: "nearest" });

    countEl.textContent =
      loading && !models.length
        ? ""
        : refreshing
          ? "در حال بروزرسانی…"
          : rows.length > shown
            ? `نمایش ${fa(shown)} از ${fa(rows.length)} مدل`
            : `${fa(rows.length)} مدل`;
    moreBtn.hidden = rows.length <= shown;
    refreshBtn.disabled = loading || refreshing;
    clearBtn.hidden = !search.value;
  }

  async function loadModels(force = false) {
    if (loading) return;
    loading = true;
    refreshing = models.length > 0;
    error = "";
    paintHint();
    paintList();
    try {
      const list_ = await load(force);
      models = Array.isArray(list_) ? list_ : [];
      loaded = true;
      if (filter === "tools" && !models.some((m) => m.supports_tools)) filter = "all";
      if (filter === "vision" && !models.some(drIsVision)) filter = "all";
    } catch (err) {
      error = String(err?.message ?? err);
    } finally {
      loading = false;
      refreshing = false;
      paintChips();
      paintTrigger();
      paintNote();
      paintHint();
      paintList();
    }
  }

  function openPanel() {
    if (disabled || open) return;
    open = true;
    root.classList.add("open");
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    search.setAttribute("aria-expanded", "true");
    fitPanel();
    query = "";
    search.value = "";
    visible = 120;
    paintChips();
    const rows = filteredModels();
    const index = rows.findIndex((m) => m.id === selected);
    if (index >= 0) {
      visible = Math.max(visible, Math.ceil((index + 1) / 120) * 120);
      active = index;
    } else {
      active = rows.length ? 0 : customId() ? 0 : -1;
    }
    paintList();
    search.focus({ preventScroll: true });
    if (!loaded && !loading && !error) loadModels();
  }

  /** پنل را در فضای آزاد بالا/پایین دکمه جا می‌دهد */
  function fitPanel() {
    if (!open) return;
    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const up = spaceBelow < 420 && spaceAbove > spaceBelow;
    root.classList.toggle("drop-up", up);
    const space = Math.max(220, Math.min(460, up ? spaceAbove : spaceBelow));
    panel.style.maxHeight = `${space}px`;
  }

  function closePanel(refocus = false) {
    if (!open) return;
    open = false;
    root.classList.remove("open");
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    search.setAttribute("aria-expanded", "false");
    search.setAttribute("aria-activedescendant", "");
    if (refocus && !disabled) trigger.focus({ preventScroll: true });
  }

  function apply(id) {
    if (!id) return;
    selected = id;
    hidden.value = id;
    paintTrigger();
    paintNote();
    paintHint();
    closePanel(true);
  }

  function moveActive(delta) {
    const rows = filteredModels();
    const count = Math.min(rows.length, visible) + (customId() ? 1 : 0);
    if (!count) return;
    active = active < 0 ? 0 : Math.max(0, Math.min(count - 1, active + delta));
    paintList();
  }

  trigger.addEventListener(
    "click",
    () => {
      if (disabled) return;
      if (open) closePanel(true);
      else openPanel();
    },
    { signal },
  );

  search.addEventListener(
    "input",
    () => {
      query = search.value;
      visible = 120;
      active = 0;
      paintList();
    },
    { signal },
  );

  search.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        moveActive(e.key === "ArrowDown" ? 1 : -1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const rows = filteredModels();
        const shown = Math.min(rows.length, visible);
        const custom = customId();
        if (active >= 0 && active < shown) apply(rows[active].id);
        else if (custom && active === shown) apply(custom);
        else if (rows.length === 1) apply(rows[0].id);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closePanel(true);
      } else if (e.key === "Tab") {
        closePanel(false);
      }
    },
    { signal },
  );

  clearBtn.addEventListener(
    "click",
    () => {
      search.value = "";
      query = "";
      visible = 120;
      active = models.length ? 0 : -1;
      paintList();
      search.focus({ preventScroll: true });
    },
    { signal },
  );

  chips.addEventListener(
    "click",
    (e) => {
      const btn = e.target.closest("[data-filter]");
      if (!btn) return;
      filter = btn.dataset.filter;
      visible = 120;
      active = 0;
      paintChips();
      paintList();
      search.focus({ preventScroll: true });
    },
    { signal },
  );

  list.addEventListener(
    "click",
    (e) => {
      if (e.target.closest("[data-retry]")) {
        loadModels(true);
        return;
      }
      const opt = e.target.closest(".dr-opt");
      if (!opt) return;
      if (opt.dataset.custom) {
        const id = customId();
        if (id) apply(id);
        return;
      }
      if (opt.dataset.id) apply(opt.dataset.id);
    },
    { signal },
  );

  moreBtn.addEventListener(
    "click",
    () => {
      visible += 120;
      paintList();
      search.focus({ preventScroll: true });
    },
    { signal },
  );

  refreshBtn.addEventListener("click", () => loadModels(true), { signal });

  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!open || root.contains(e.target)) return;
      closePanel(false);
    },
    { signal },
  );
  window.addEventListener("resize", fitPanel, { signal });
  window.addEventListener("scroll", fitPanel, { passive: true, signal });

  paintTrigger();
  paintNote();
  paintHint();
  paintChips();
  loadModels();

  return {
    saved() {
      savedValue = selected;
      paintHint();
    },
    reload: () => loadModels(true),
    get value() {
      return selected;
    },
    destroy: () => ac.abort(),
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
        <div class="field dr-model-field" id="dr-model-field">
          <label for="dr-model-picker">مدل ${d.modelFromEnv ? '<span class="env-badge">از env</span>' : ""}</label>
          <input type="hidden" id="dr-model" value="${esc(d.model)}">
          <div class="dr-picker"></div>
          <div class="dr-note" hidden></div>
          <span class="hint" id="dr-model-hint"></span>
        </div>
        <div class="prov-actions">
          <button class="btn btn-primary" type="submit">ذخیره اتصال</button>
          <button class="btn btn-ghost" type="button" id="dr-test">تست اتصال</button>
        </div>
        <div class="test-out" id="dr-out"></div>
      </form>
    </div>

    <aside class="dr-guide">
      <div class="dr-guide-card">
        <span class="eyebrow">سازگار با OpenAI</span>
        <h3>اتصال در چند خط</h3>
        <p class="hint">همان کلید و مدلی که اینجا ذخیره می‌کنید، در SDKهای OpenAI، LangChain و Vercel AI هم قابل استفاده است.</p>
        <pre class="json ltr">${esc(`base_url = "${d.defaultBase}"\napi_key  = "sk-dc-v1-..."\nmodel    = "${d.model}"`)}</pre>
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
  const picker = initDibaModelPicker(document.getElementById("dr-model-field"), {
    value: d.model,
    disabled: d.modelFromEnv,
    load: (force) => drLoadModels(force),
  });
  pageDispose = () => picker?.destroy();

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
      picker?.saved();
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
      code: JSON.stringify({ mcpServers: { "diba-mcp": { command: "npx", args: ["-y", "diba-mcp", "stdio", "--data", c.dataDir] } } }, null, 2),
      note: "در حالت stdio سرور روی همین سیستم اجرا می‌شود و از همان پوشه‌ی داده‌ی داشبورد استفاده می‌کند؛ نیازی به توکن نیست. حالت HTTP و stdio را هم‌زمان برای یک حساب اجرا نکنید.",
    },
    "اسکریپت Express / Node.js": {
      lang: "js",
      code: `import express from "express";\nimport { createDibaMcp } from "diba-mcp";\n\nconst app = express();\nconst dibaMcp = createDibaMcp({ dataDir: "./data/diba-mcp" });\n\n// اتصال داشبورد و اندپوینت MCP به پروژه اکسپرس شما\napp.use("/diba-mcp", dibaMcp.router());\n\n// یا فراخوانی مستقیم بدون هوش مصنوعی:\nawait dibaMcp.engine.callTool("bale_client_send_message", { text: "سفارش جدید ثبت شد" }, "dashboard");`,
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
          <div class="endpoint"><input id="ep" class="input ltr-input" readonly value="${esc(url)}"><button class="btn btn-ghost" data-copy="${esc(url)}">کپی آدرس</button><button class="btn btn-ghost" type="button" id="mcp-test">تست اتصال</button></div>
          <span class="hint">پروتکل انتقال: HTTP POST بدون نشست با پشتیبانی از SSE.</span>
          <span class="hint">برای کلاینت ابری (مثل Claude.ai) این آدرس باید از اینترنت در دسترس باشد؛ از دامنه یا تانل استفاده کنید. برای Claude Code/Desktop روی همین سیستم، <code class="ltr">127.0.0.1</code> کافی است. حالت HTTP و stdio را هم‌زمان اجرا نکنید.</span>
          <div class="test-out" id="mcp-test-out"></div>
        </div>
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
    if (e.target.closest("#mcp-test")) {
      const out = document.getElementById("mcp-test-out");
      out.innerHTML = "";
      try {
        const r = await busy(e.target.closest("#mcp-test"), () => api("connection/test", { body: {} }));
        out.innerHTML = `<div class="call"><span class="dot" style="background:var(--success)"></span><span>اتصال MCP برقرار است — ${fa(r.tools)} ابزار در ${fa(r.ms)} میلی‌ثانیه</span><span class="src ltr mono">${esc(r.url)}</span><span></span><span></span></div>`;
      } catch (ex) {
        out.innerHTML = `<div class="err-box">${esc(ex.message)}</div>`;
      }
    }
    if (e.target.closest("#rotate") && await openModal({
      title: "ساخت توکن جدید",
      message: "آیا توکن دسترسی کنونی باطل شود؟ تمام کلاینت‌های متصل باید با توکن جدید تنظیم شوند.",
      confirmText: "توکن جدید",
      tone: "danger",
    })) {
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
  // اولین اجرا: رمز عبور هم داخل همان نصب‌کننده انتخاب می‌شود
  if (!s.authenticated) return s.needsSetup ? renderInstaller({ setup: true }) : renderAuth();
  state.profile = s.profile || null;
  // تا نصب اولیه کامل نشود داشبورد باز نمی‌شود
  if (s.needsInstall) return renderInstaller({ firstRun: true });
  renderShell();
  const verEl = document.getElementById("ver");
  if (verEl) verEl.textContent = `نسخه ${s.version}`;
  render();
}

window.addEventListener("hashchange", () => { if (document.getElementById("main")) render(); });
boot();

