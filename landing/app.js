(() => {
  const header = document.querySelector("[data-header]");
  const menuButton = document.querySelector("[data-menu-button]");
  const nav = document.querySelector("#primary-nav");

  const setMenu = (open) => {
    if (!header || !menuButton) return;
    header.classList.toggle("nav-open", open);
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.setAttribute("aria-label", open ? "بستن منو" : "باز کردن منو");
  };

  menuButton?.addEventListener("click", () => {
    setMenu(!header?.classList.contains("nav-open"));
  });

  nav?.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => setMenu(false)));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setMenu(false);
  });

  document.addEventListener("click", (event) => {
    if (!header?.classList.contains("nav-open")) return;
    if (header.contains(event.target)) return;
    setMenu(false);
  });

  const onScroll = () => header?.classList.toggle("is-scrolled", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  // Tabs: native buttons with roving tabindex and arrow-key support.
  const tabs = Array.from(document.querySelectorAll("[data-tab]"));
  const panels = tabs.map((tab) => document.getElementById(tab.getAttribute("aria-controls")));
  const selectTab = (index, focus = false) => {
    tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (panels[i]) panels[i].hidden = !selected;
    });
    if (focus) tabs[index]?.focus();
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(index));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      let next = index;
      if (event.key === "ArrowLeft") next = index + 1;
      if (event.key === "ArrowRight") next = index - 1;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      next = (next + tabs.length) % tabs.length;
      selectTab(next, true);
    });
  });

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    }
  };

  document.querySelectorAll("[data-copy-target]").forEach((button) => {
    button.addEventListener("click", async () => {
      const target = document.getElementById(button.getAttribute("data-copy-target"));
      const text = target?.textContent?.trim();
      if (!text) return;
      const ok = await copyText(text);
      const label = button.querySelector("span");
      if (!label) return;
      const old = label.textContent;
      label.textContent = ok ? "کپی شد" : "کپی نشد";
      button.classList.add("is-copied");
      window.setTimeout(() => {
        label.textContent = old;
        button.classList.remove("is-copied");
      }, 1800);
    });
  });

  const year = document.querySelector("[data-year]");
  if (year) year.textContent = String(new Date().getFullYear());
})();
