# دیباچین — Design System

**Version:** 1.0.0 · **Last synced with production:** 2026-11-08 · **Source of truth:** <https://dibachain.ir>
**Stack observed:** static PHP-rendered site · single global stylesheet `/assets/css/style.css` · Vazirmatn · RTL-first · no framework, no utility classes.

> This document is a **working** design system, not a screenshot description. Every token, radius, shadow, breakpoint and interaction below was read from the live stylesheet, so you can rebuild the site, extend it, or build a product that looks native to the دیباچین brand.
>
> `Observed` = found verbatim in production CSS. `Derived` = added by this document to complete the system (spacing scale, states, tokens that the site hard-codes). Derived items are marked.

---

## Table of contents

1. [How to use this document](#1-how-to-use-this-document)
2. [Brand foundations](#2-brand-foundations)
3. [Design tokens](#3-design-tokens)
4. [RTL & Persian typography](#4-rtl--persian-typography)
5. [Components](#5-components)
6. [Page templates & composition](#6-page-templates--composition)
7. [Content, voice & SEO patterns](#7-content-voice--seo-patterns)
8. [Project system — the registry & cross-references](#8-project-system--the-registry--cross-references)
9. [Accessibility & performance](#9-accessibility--performance)
10. [Governance, versioning & changelog](#10-governance-versioning--changelog)
11. [Appendices](#11-appendices)

**Companion files**

| File | Purpose |
|---|---|
| `design-tokens.css` | Drop-in token layer + primitives. Copy into any project. |
| `project-entry-template.md` | Blank, fully commented project entry. Duplicate per project. |
| `projects/*.md` | Six seed entries (one per live project) — valid, linkable, ready to extend. |
| `validate-projects.ps1` | Dependency-free graph validator implementing §8.10. |
| `research/clean.css` | Verbatim copy of the production stylesheet this system was extracted from. |

---

## 1. How to use this document

### 1.1 Reading paths

| You are… | Read |
|---|---|
| Starting a new site/page that must feel like دیباچین | §2 → §3 → §6, then copy `design-tokens.css` |
| Building a component | §3 (tokens) → §5 (the matching component) |
| Adding a portfolio project | §8.2 → §8.5 → `project-entry-template.md` |
| Reviewing a design | §2.3 (principles) → §6.9 (composition rules) → §9 (a11y) |
| Migrating the real site | §3.1–3.4 (token parity) first |

### 1.2 The one-paragraph summary

دیباچین is a **light, airy, engineering-credible** B2B site with one saturated blue (`#2563eb`), a single neutral slate ramp, generous Persian line-height (1.85–2.1), 18–20 px card radii, soft blue-tinted shadows, and a signature motion language of **8–10 px hover lifts, gradient top-bars that wipe in RTL, and floating/pulsing blue orbs**. Pages are built from full-width sections that alternate white → `#f8fafc` → `#f1f5f9`, with exactly one dark navy hero when the page needs drama (`#0b1a47` / `#0a1636`). Everything is RTL and mirrored with CSS logical properties (`inset-inline`, `margin-inline`, `padding-inline`).

### 1.3 Non-negotiables

These are the five things that make a page look like دیباچین. Break them and it stops being the brand:

1. **One blue, used sparingly.** Blue is for the primary action, icons, links, and one gradient. Never as a large flat background except in the dark hero / CTA panel.
2. **White cards on a near-white page.** Surfaces are `#ffffff`; the page is `#ffffff` or `#f8fafc`; separation comes from `1px solid #e2e8f0` + a soft shadow, never from heavy fills.
3. **Big radius, soft shadow.** 18–20 px corners on cards, 12–14 px on controls, 999 px on pills. Shadows are blue-tinted and diffuse.
4. **Persian-first rhythm.** `line-height: 1.85` body, `2–2.1` for prose, headings `800` weight with `-0.2px` tracking, no uppercase.
5. **Motion is a lift, not a bounce.** `cubic-bezier(.22,.61,.36,1)`, 200–400 ms, `translateY(-6…-10px)` on hover. Everything collapses under `prefers-reduced-motion`.

---

## 2. Brand foundations

### 2.1 Positioning

دیباچین is an **AI + software engineering company**: Persian-language LLMs and models (خانوادهٔ دیبا), a model router (DibaRouter), and delivery services (chatbots, automation, data, VoIP, custom software). The design must read as *technical partner*, not *marketing agency*.

| Dimension | The brand is | The brand is not |
|---|---|---|
| Tone | precise, calm, confident, practical | hyped, playful, salesy |
| Visual | clean, blue, spacious, product-led | dark-neon "AI", gradient soup, glassmorphism everywhere |
| Proof | models on Hugging Face, open-source repos, real clients | stock-photo handshakes, vague superlatives |
| Language | formal Persian, second person plural (شما) | slang, English-first headlines |

### 2.2 Personality in five words

**Trustworthy · Technical · Persian-native · Open · Calm**

### 2.3 Design principles

1. **Evidence over adjectives.** Every claim gets a number, a model name, a repo link, or a client. The UI supports proof: `.result-item`, `.stat`, Hugging Face + GitHub buttons.
2. **One decision per screen region.** Each section has one job and one primary action (`#contact`). Secondary actions are always `.btn-ghost`.
3. **Air is the premium signal.** Large vertical rhythm (`clamp(56px, 8vw, 110px)`), generous card padding (28–32 px), 1.85 line-height. Density is never used to look "enterprise".
4. **Blue means "go" and "intelligence".** Icons, numbers, links, active states, and the single gradient. Blue is a *signal*, so its scarcity is what makes it work.
5. **RTL is the default, not a translation.** All spacing/borders use logical properties; arrows flip with `.flip`; dropdown accent bars sit on the inline-start edge.
6. **Motion explains, never decorates.** Floating logo = "alive intelligence"; data dots on the industry hub = "data flows"; card lift = "interactive". No animation runs without a meaning.

### 2.4 Logo usage

| Rule | Value |
|---|---|
| Header mark | `/assets/img/logo-sm.png`, `40×40`, `object-fit: contain` |
| Lockup | mark + wordmark «دیباچین», gap `10px`, wordmark `22px / 800`, `letter-spacing: -.3px` |
| Hero mark | `/assets/img/hero.svg`, max-width `290px` (250 tablet / 220–200 mobile) |
| Clear space | ≥ 1× the mark height on all sides |
| Shadow | `filter: drop-shadow(0 24px 40px rgba(37,99,235,.38))` — hero only |
| Don't | recolor, outline, place on busy photography, rotate, add a second glow |

Wordmark colour is always `--ink` on light and `#fff` on dark. Never blue.

### 2.5 Imagery

- **Product screenshots and hardware photos**, 16:9.5 for project cards, 16:10 for blog cards, 2:1 for the about banner.
- Warm-neutral photography only; blue UI screenshots are acceptable because they echo the brand.
- Every image needs a Persian `alt` that names the artifact, not the file (`روتر هوشمند DRouter روی برد ESP32`).
- Decorative backgrounds are code, not images: dot/grid patterns + blurred radial blobs (§3.9).

---

## 3. Design tokens

All tokens below are **observed** unless marked *derived*. They live in `:root` exactly as they do in production.

### 3.1 Color — brand

| Token | Hex | Use |
|---|---|---|
| `--brand` | `#2563eb` | primary button, links, active pill, icon fill |
| `--brand-600` | `#1d4ed8` | hover of primary, link hover, CTA text |
| `--brand-700` | `#1e40af` | gradient end, dark text on blue-50 |
| `--brand-400` | `#3b82f6` | gradient start, glowing accents |
| `--brand-300` | `#60a5fa` | focus border, dashed connectors |
| `--brand-200` | `#93c5fd` | borders, hub link base, card number |
| `--brand-50` | `#eff6ff` | icon tiles, eyebrow bg, tag pills |
| `--brand-wash` | `#eaf0ff` | skill category chip (feature-local) |
| `#dbeafe` (raw) | `#dbeafe` | eyebrow border, gradient card border — *should be tokenized as `--brand-100`* |

### 3.2 Color — neutrals

| Token | Hex | Use |
|---|---|---|
| `--ink` | `#0f172a` | headings, primary text |
| `--ink-2` | `#334155` | body copy, nav links |
| `--muted` | `#64748b` | descriptions, meta, secondary text |
| `--muted-2` | `#94a3b8` | timestamps, disabled, separators |
| `--line` | `#e2e8f0` | every border, divider, grid pattern |
| `--bg` | `#ffffff` | page + card surface |
| `--bg-soft` | `#f8fafc` | alternating section, input fill, chips |
| `--bg-slate` | `#f1f5f9` | second alternating section, inline code |

### 3.3 Color — semantic

| Role | Foreground | Background | Border |
|---|---|---|---|
| Success (form ok) | `#15803d` | `#dcfce7` | `#bbf7d0` |
| Success (check icon) | `#16a34a` | — | — |
| Error (form error) | `#b91c1c` | `#fee2e2` | `#fecaca` |
| Error (field / hint) | `#dc2626` | — | `#f87171` |
| Warning / rating | `#d97706` | — | — |
| Info / PDF doc | `#2563eb` | `#eff6ff` | — |
| Danger doc | `#dc2626` | `#fef2f2` | — |

### 3.4 Color — dark surfaces *(for heroes, CTA panels, landing pages)*

| Token *(derived names)* | Hex | Use |
|---|---|---|
| `--navy-900` | `#0a1636` | landing gradient start |
| `--navy-800` | `#0b1a47` | about/contact hero base, overlay tint |
| `--navy-700` | `#0f2260` | landing mid stop, local card |
| `--navy-600` | `#1e3a8a` | local card end, radial highlight |
| `--navy-glow` | `#7dd3fc` | dark-mode accent (icons, gradients) |
| `--github` | `#1f2328` | repo button |

Dark surfaces use **white text at 86–92% opacity** for body copy, never `--muted`.

### 3.5 Typography

```css
font-family: Vazirmatn, "Segoe UI", Tahoma, system-ui, sans-serif;
```

| Role | Size | Weight | Line-height | Tracking | Colour |
|---|---|---|---|---|---|
| Hero H1 | `clamp(30px, 4.4vw, 52px)` | 800 | 1.32 | `-.2px` | `--ink` |
| Landing H1 | `clamp(30px, 4.6vw, 52px)` | 800 | 1.3 | `-.5px` | `#fff` |
| Page title | `clamp(28px, 4vw, 44px)` | 800 | 1.4 | `-.2px` | `--ink` |
| Section title | `clamp(24px, 3vw, 36px)` | 800 | 1.4 | `-.2px` | `--ink` |
| Article H1 | `clamp(26px, 3.6vw, 40px)` | 800 | 1.5 | `-.2px` | `--ink` |
| H2 | `24px` (prose) / `clamp(22px,2.6vw,27px)` | 800 | 1.5 | `-.2px` | `--ink` |
| H3 | `20px` | 800 | 1.4 | `-.2px` | `--ink` |
| Card title | `17–20px` | 800 | 1.6 | `-.2px` | `--ink` |
| Lead | `17px` | 400 | 2 | — | `--muted` |
| Body | `16px` | 400 | 1.85 | — | `--ink` |
| Prose body | `17px` | 400 | 2.1 | — | `--ink-2` |
| Nav link | `14.5px` | 600 | 1.5 | — | `--ink-2` |
| Eyebrow | `13.5px` | 700 | 1.5 | — | `--brand-600` |
| Button | `15px` (sm 14 / lg 16) | 700 | 1 | — | context |
| Meta | `12.5–13.5px` | 600–700 | 1.7 | — | `--muted-2` |
| Stat value | `clamp(30px, 4vw, 44px)` | 800 | 1 | `-1px` | `--brand-600` |

**Rules**
- Headings are always `800`. There is no 900 and no 500 heading.
- Never uppercase (meaningless for Persian, and the Latin product names are proper nouns).
- `letter-spacing` is only ever negative, and only on `h1–h4` and stat values.
- Body copy never below `14px`; meta never below `11.5px`.
- Persian digits (`۰–۹`) in all user-facing numbers; Latin digits only inside code, model names (`X1`, `M3`) and URLs.

### 3.6 Spacing

Production does not tokenize space; it hard-codes values. This is the **derived** scale that matches every observed value:

| Token | px | Typical use |
|---|---|---|
| `--s-1` | 4 | hairline gaps |
| `--s-2` | 8 | icon + label |
| `--s-3` | 12 | button icon gap, tight stacks |
| `--s-4` | 16 | form field gap, list gap |
| `--s-5` | 20 | card inner rows |
| `--s-6` | 24 | container padding, grid gap |
| `--s-7` | 28 | card padding, project grid gap |
| `--s-8` | 32 | card padding, footer gap |
| `--s-10` | 40 | panel padding |
| `--s-12` | 48 | section sub-blocks |
| `--s-14` | 56 | hero / dark section padding |
| `--s-20` | 80 | large section padding |

| Layout rhythm token | Value |
|---|---|
| Section padding | `clamp(56px, 8vw, 110px)` |
| Section head margin | `54px` (centered) / `42px` (row layout) |
| Grid gap — tight | `18–22px` (cards) |
| Grid gap — standard | `24–28px` |
| Grid gap — wide | `48px` (two-column hero/industry/CTA) |
| Container | `max-width: 1200px`, `padding-inline: 24px` (18 px ≤480) |

### 3.7 Radius

| Token | px | Use |
|---|---|---|
| `--radius-sm` | 12 | inputs, small buttons, share buttons, nav sub links |
| `--radius` | 18 | standard cards, panels, dropdown |
| `--radius-lg` | 28 | CTA cards, hero-adjacent panels |
| *(raw)* 14 | 14 | buttons, back-to-top, logo tiles |
| *(raw)* 16 | 16 | timeline cards, contact items, cap icon tiles |
| *(raw)* 20 | 20 | service/project/cap cards, glass header |
| *(raw)* 24 | 24 | featured post, about banner/card |
| `999px` | pill | nav, chips, tabs, tags, badges, eyebrow |

### 3.8 Elevation & borders

```css
--shadow-sm:    0 1px 2px rgba(15,23,42,.06), 0 1px 3px rgba(15,23,42,.05);
--shadow:       0 10px 30px -12px rgba(15,23,42,.15);
--shadow-lg:    0 30px 60px -20px rgba(37,99,235,.28);
--shadow-brand: 0 18px 40px -14px rgba(37,99,235,.45);
```

| Level | Token | Applies to |
|---|---|---|
| 0 | `--shadow-sm` | resting cards, inputs, chips, header at top |
| 1 | `--shadow` | dropdown, hero-adjacent panel, form card |
| 2 | `--shadow-lg` | card **hover**, featured post hover |
| 3 | `--shadow-brand` | primary button, blue CTA panel, active icon tile |
| Glass | `0 18px 44px -18px rgba(15,23,42,.30)` | scrolled header |

Borders are always `1px solid var(--line)` — except the eyebrow (`#dbeafe`) and invalid fields (`#f87171`). On hover, cards set `border-color: transparent` **and** raise the shadow; they never keep a visible border.

### 3.9 Backgrounds & decoration

| Pattern | CSS | Used by |
|---|---|---|
| Dot field | `radial-gradient(var(--brand-300) 1px, transparent 1.4px) / 28px`, opacity `.18`, radial mask | hero, calm sections |
| Grid | two `linear-gradient(var(--line) 1px, …) / 44–52px`, opacity `.35–.5`, radial mask | hero, landing, process |
| Blue blob | `radial-gradient(circle, #bfdbfe, transparent 70%)`, `blur(70px)`, opacity `.5`, `floatY 14–18s` | hero corners |
| Top gradient bar | `linear-gradient(90deg, var(--brand-400), var(--brand-700))`, 4 px, `scaleX(0→1)` from inline-end | cards, on hover |
| Dashed connector | `repeating-linear-gradient(90deg, var(--brand-200) 0 9px, transparent 9px 19px)` | process steps |

**Masks matter.** Every pattern is masked to an ellipse so it fades at the edges: `mask-image: radial-gradient(ellipse 80% 65% at 50% 25%, #000, transparent 72%)`. Unmasked patterns look like a texture bug.

### 3.10 Motion

| Token | Value |
|---|---|
| `--ease` | `cubic-bezier(.22,.61,.36,1)` |
| Fast | `180–220ms` — colour, opacity, nav hover |
| Standard | `250–350ms` — buttons, cards, dropdown |
| Slow | `400–700ms` — header morph, reveal, image zoom |

| Behaviour | Spec |
|---|---|
| Card hover | `translateY(-8px…-10px)` + level-2 shadow, `350ms` |
| Button hover | `translateY(-3px)`, shadow grows |
| Image zoom | `scale(1.05–1.07)`, `500–600ms` |
| Header on scroll | height `74→62px`, glass blur `18px`, radius `20px`, `400ms` |
| Reveal | `opacity 0→1`, `translateY(26px→0)`, `700ms`, stagger via `--d` |
| Float | `translateY(0 → -14px → 0)`, `3.6s / 4.5s / 6s / 7s` |
| Pulse | `box-shadow 0 0 0 0 → 13px` transparent, `2.9s` |
| Gradient trace | `stroke-dashoffset 0 → -100`, `4.5s linear` |

**Reduced motion:** the site already ships the correct guard — reuse it verbatim:

```css
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after {
    animation-duration: .001ms !important;
    transition-duration: .001ms !important;
  }
}
```

### 3.11 Layout, breakpoints & z-index

| Breakpoint | Meaning |
|---|---|
| `1200px` | container max — above this only page margins grow |
| `980px` | tablet: hero stacks (visual first), 3-col → 2-col, footer 2-col, sidebars unstick |
| `860px` | landing grid stacks, local card un-sticks |
| `760px` | mobile: hamburger nav, drawer, submenus become accordions, 2-col → 1-col, footer contact stacks |
| `600px` | hero centers, industry hub becomes a chip wrap |
| `480px` | container padding 18px, all grids 1-col, full-width buttons |

| z-index | Layer |
|---|---|
| 0 | section backgrounds, patterns, watermarks |
| 1 | section content (`.container` is lifted to 1) |
| 2–4 | hero visual, hub nodes |
| 90 | back-to-top |
| 100 | sticky header |
| 200 | dropdown, read-progress |
| 999 | skip-link when focused |

### 3.12 Reference CSS

```css
:root {
  /* brand */
  --brand: #2563eb; --brand-600: #1d4ed8; --brand-700: #1e40af;
  --brand-400: #3b82f6; --brand-300: #60a5fa; --brand-200: #93c5fd;
  --brand-50: #eff6ff; --brand-100: #dbeafe;

  /* neutrals */
  --ink: #0f172a; --ink-2: #334155; --muted: #64748b; --muted-2: #94a3b8;
  --line: #e2e8f0; --bg: #ffffff; --bg-soft: #f8fafc; --bg-slate: #f1f5f9;

  /* dark */
  --navy-900: #0a1636; --navy-800: #0b1a47; --navy-700: #0f2260;
  --navy-600: #1e3a8a; --navy-glow: #7dd3fc;

  /* shape */
  --radius-sm: 12px; --radius: 18px; --radius-lg: 28px;

  /* elevation */
  --shadow-sm: 0 1px 2px rgba(15,23,42,.06), 0 1px 3px rgba(15,23,42,.05);
  --shadow: 0 10px 30px -12px rgba(15,23,42,.15);
  --shadow-lg: 0 30px 60px -20px rgba(37,99,235,.28);
  --shadow-brand: 0 18px 40px -14px rgba(37,99,235,.45);

  /* layout */
  --container: 1200px;
  --ease: cubic-bezier(.22,.61,.36,1);

  font-family: Vazirmatn, "Segoe UI", Tahoma, system-ui, sans-serif;
}
```

---

## 4. RTL & Persian typography

### 4.1 Document setup

```html
<html lang="fa" dir="rtl">
```

Order of CSS: tokens → reset/base → layout → components → pages → responsive. No `!important` except the reduced-motion block and the mobile hub overrides that must beat inline positions.

### 4.2 Logical properties are mandatory

The site never writes `left/right` for layout; it uses `inset-inline-start`, `margin-inline`, `padding-inline`, `border-inline-start`. Only three places use physical values, deliberately: the back-to-top button (`inset-inline-start: 24px`), the hero trace SVG, and `left: 50%` centering.

| Do | Don't |
|---|---|
| `padding-inline-start: 28px` | `padding-left: 28px` |
| `inset-inline-end: 0` | `right: 0` |
| `border-inline-start: 4px solid` | `border-left: 4px` |
| `margin-inline: auto` | `margin-left/right: auto` |
| `transform-origin: inline-start` | `transform-origin: left` |

### 4.3 Directional icons

Arrows point **left** in RTL. Reuse the existing utilities:

```css
.flip { transform: scaleX(-1); }        /* mirror a right-pointing arrow */
.up   { transform: rotate(-90deg); }    /* breadcrumb/back arrow */
```

Icon sizes: `--icon: 26px`, `.icon-sm 18px`, `.icon-xs 15px`, list/meta `15–19px`, feature tiles `28–30px`, watermarks `130px`.

### 4.4 Persian typesetting rules

| Rule | Guidance |
|---|---|
| **نیم‌فاصله (ZWNJ)** | Required: `می‌شود`, `هوشمندسازی`, `کسب‌وکار`, `چت‌بات`, `زیرساخت`. Never `میشود` or `می شود`. |
| Punctuation | Persian `،` `؛` `:` and `«…»` for quotes. Latin `,` `;` only inside Latin product names. |
| Numbers | Persian digits in copy (`۱۴۰۵`, `۱۱۸۹۲۱`); Latin digits in code, model names, versions (`X1`, `M3`, `32`), URLs. |
| Mixed LTR in RTL | Wrap Latin runs that sit next to punctuation: `dir="ltr"` + `unicode-bidi: isolate` (already done for phone/email in the footer). |
| Emphasis | `**bold**` (weight 700) inside prose; never italics (Persian has no italic tradition and Vazirmatn's is synthetic). |
| Headings | Short, 2 lines max on mobile, no ending period. |
| Line length | Prose column `820px` max (`~65–70` Persian chars). Never full-width paragraphs. |
| Line-height | `1.85` UI, `2.0` lead, `2.1` long-form prose — Persian needs the extra leading for diacritics. |

### 4.5 Numerals & dates

- Dates: `۱۴۰۵/۰۸/۱۵` (Jalali, zero-padded, slash-separated). In meta rows: `۱۴۰۵/۰۸/۱۵ • ۱ دقیقه`.
- Counts in chips: Latin digits are currently used inside `.skill-stars` (`★ ۱۱۸۹۲۱`) — keep Persian for user-facing counts.
- Percentages: `۸۰٪` with the Persian percent sign, no space.

---

## 5. Components

Each component lists **anatomy → states → CSS → usage notes**. Class names are the production names, so your markup stays compatible with the existing stylesheet.

### 5.1 Buttons

**Anatomy:** optional leading icon (18–20 px) · label · optional trailing arrow (`.flip` in RTL).

| Variant | Class | Background | Text | Border | Shadow |
|---|---|---|---|---|---|
| Primary | `.btn.btn-primary` | `--brand` → hover `--brand-600` | `#fff` | none | `--shadow-brand` |
| Ghost | `.btn.btn-ghost` | `#fff` | `--ink` | `1px --line` | `--shadow-sm` |
| Glass (on dark) | `.btn-ghost.glass` | `rgba(255,255,255,.1)` | `#fff` | `rgba(255,255,255,.28)` | none + `blur(6px)` |
| Dark (repo) | `.gh-link` | `#1f2328` | `#fff` | none | none → hover `--shadow` |
| On blue panel | `.contact-panel .btn-primary` | `#fff` | `--navy-700` | none | none |

**Sizes:** `.btn-sm` 44 px / 20 px padding / 14 px · default 52 px / 26 px / 15 px · `.btn-lg` 56 px / 30 px / 16 px · `.btn-block` full width.

```css
.btn {
  --bh: 52px;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  height: var(--bh); padding-inline: 26px; border: 0; border-radius: 14px;
  font-weight: 700; font-size: 15px; white-space: nowrap;
  transition: transform .25s var(--ease), box-shadow .25s var(--ease), background .25s;
}
.btn-primary { background: var(--brand); color: #fff; box-shadow: var(--shadow-brand); }
.btn-primary:hover { background: var(--brand-600); transform: translateY(-3px);
  box-shadow: 0 24px 48px -16px rgba(37,99,235,.55); }
.btn-primary:active { transform: translateY(-1px); }

.btn-ghost { background: #fff; color: var(--ink); border: 1px solid var(--line); box-shadow: var(--shadow-sm); }
.btn-ghost:hover { border-color: var(--brand-300); color: var(--brand-600); transform: translateY(-3px); box-shadow: var(--shadow); }
```

**States:** default / hover / active (`-1px`) / focus (`0 0 0 4px rgba(37,99,235,.12)` + `--brand-300` border) *derived* / disabled (`opacity:.5; pointer-events:none`) *derived*.

**Usage**
- Max **one** primary button per viewport region.
- Label = verb + object in Persian: «مشاوره رایگان», «شروع کنید», «مشاهده همه», «درخواست مشاوره رایگان».
- Never more than 2 buttons in a hero; stack them full-width ≤480 px.
- On blue surfaces, the hierarchy inverts: white filled button + translucent ghost.

### 5.2 Eyebrow, badge, chip, tab, tag pill

| Component | Class | Spec |
|---|---|---|
| Eyebrow | `.eyebrow` | `--brand-50` bg, `--brand-600` text, `#dbeafe` border, `7px 14px`, radius 999, 13.5/700; optional leading 16 px icon |
| Category badge (image overlay) | `.post-badge` | `rgba(37,99,235,.92)`, white, `5px 12px`, 12/700, `blur(4px)` |
| Static category badge | `.post-badge.static` | `--brand-50` bg, `--brand-700` text, no absolute |
| Filter chip | `.chip` | white, `--line`, `9px 18px`, 14/700; active = `--brand` fill + `--shadow-brand` |
| Tab with count | `.tab` + `.tab-count` | same as chip; count pill `rgba(15,23,42,.08)` → `rgba(255,255,255,.25)` when active |
| Tag pill | `.tag-pill` | `--brand-50` bg, `--brand-700`, `6px 14px`, 13/700 |
| Project category | `.project-cat` | `--brand-50` bg, `--brand-700`, `4px 12px`, 12.5/700 |
| Skill category | `.skill-cat` | `--brand-wash` bg, `--brand`, 11/700, radius 7 |
| Neutral tag | `.skill-tag` | `#f1f5f9` bg, `--ink-2`, 10.5/700, radius 6 |

**Rule:** pills are for *taxonomy*, buttons are for *actions*. Never style a filter as a button or vice versa.

### 5.3 Header & navigation

**Anatomy:** sticky `.site-header` → `.header-inner` grid `1fr auto 1fr` → brand · capsule nav · actions (CTA + hamburger).

```css
.site-header { position: sticky; top: 0; z-index: 100; background: transparent; }
.header-inner {
  display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 20px;
  height: 74px; border-radius: 20px; border: 1px solid transparent;
  transition: height .4s var(--ease), background .4s var(--ease),
              box-shadow .4s var(--ease), border-color .4s var(--ease);
}
.site-header.scrolled { padding-top: 12px; }
.site-header.scrolled .header-inner {
  height: 62px; max-width: min(1120px, calc(100% - 40px));
  background: rgba(255,255,255,.72);
  backdrop-filter: saturate(180%) blur(18px);
  border-color: rgba(226,232,240,.9);
  box-shadow: 0 18px 44px -18px rgba(15,23,42,.30);
}
```

| Part | Spec |
|---|---|
| Brand | 40 px mark + «دیباچین» 22/800, `justify-self: start` |
| Nav capsule | `rgba(248,250,252,.75)`, `1px --line`, padding 5 px, radius 999, gap 2 px |
| Nav link | `9px 17px`, 14.5/600, `--ink-2`; hover = white bg + `--shadow-sm` + `--brand-600`; active = blue gradient fill + white + `0 8px 18px -8px rgba(37,99,235,.6)` |
| Dropdown | absolute, `top: calc(100% + 14px)`, `inset-inline-end: 0`, min-width 286 px, white 98%, `--brand-200` border, radius 18, `0 26px 60px -20px rgba(37,99,235,.38)` |
| Dropdown accent | `::after` 3 px gradient bar across the top; `::before` 16 px invisible hover bridge |
| Dropdown item | 2 lines: title 14/700 + description 11.5 at 72% opacity; 3 px blue rail grows from inline-start on hover |
| Scrolled nav | becomes transparent inside the glass bar |
| Mobile ≤760 | drawer `inset: 74px 0 auto 0`, white 98%, `blur(14px)`, `translateY(-140%) → 0`; submenus become accordions (`max-height` 0 → 660 px) |

**Interaction contract**
- Dropdown opens on hover **and** focus-within at ≥761 px; on click at any size.
- `aria-expanded` on `.nav-group-btn`, `aria-haspopup="true"`, `Escape` closes, click-outside closes.
- Active page = `.active` on link **and** `.active` on the parent `.nav-group`.
- Hamburger animates three 2 px bars into an X via `body.nav-open`; `body.nav-open` also sets `overflow: hidden`.
- The header is *outside* `<main>`; that is what makes `position: sticky` survive `overflow-x: clip`.

### 5.4 Hero (light)

**Anatomy:** decorative `.hero-bg` (2 blobs + grid) → `.hero-text` (eyebrow, H1 with `.text-grad`, lead, 2 buttons) → `.hero-visual` (logo + glow + SVG trace).

| Property | Value |
|---|---|
| Min height | `calc(100dvh - 74px)`; mobile `auto` with `40px 44px` padding |
| Grid | `1fr 1fr`, gap 56 px; ≤980 → 1 col, gap 36, **visual first** (`order:-1`) |
| H1 | gradient span on the key phrase: `linear-gradient(90deg, var(--brand-400), var(--brand-700))` + `background-clip: text` |
| Blobs | `blur(70px)`, opacity .5, `floatY 14s/18s`, one reversed |
| Trace | white 6 px stroke, `stroke-dasharray: 15 85`, `trace 4.5s linear`, blue drop-shadows |
| Mobile ≤600 | text centered, actions centered, media 220 px |

```css
.text-grad {
  background: linear-gradient(90deg, var(--brand-400), var(--brand-700));
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
```

**Rule:** only **one** gradient-highlighted phrase per H1, and it must be the value proposition, not the company name.

### 5.5 Cards

All cards share a base: white, `1px --line`, radius 18–20, `--shadow-sm`, `transition 350ms`, hover `translateY(-8/-10px)` + `--shadow-lg` + transparent border. They differ in their *signature*:

| Card | Class | Signature |
|---|---|---|
| Service | `.service-card` | 4 px gradient top-bar wipes **from inline-end to inline-start**; huge 130 px icon watermark at 4.5% opacity; icon tile `--brand-50` → blue gradient + `rotate(-6deg) scale(1.06)`; "more" link fades up |
| Capability | `.cap-card` | whole card fills with blue gradient on hover; text/icon/num all invert to white; number 15/800 in `--brand-200` top-inline-end |
| Value | `.value-card` | centered; 62 px gradient icon tile; no top bar |
| Process step | `.pcard` | centered; 66 px gradient icon tile with pulsing halo; giant `56px` number watermark `--brand-50`; connected by a dashed rail |
| Project | `.project-card` | 16:9.5 media, `scale(1.07)` zoom, dark gradient overlay with «مشاهده پروژه» on hover |
| Post | `.post-card` | 16:10 media, category badge overlay, meta row, `scale(1.06)` zoom |
| Stat | `.stat` | centered, `--shadow-sm` → `--shadow` on hover, big blue value |
| Contact | `.contact-card` | centered, 56 px `--brand-50` icon tile, label 13/muted + value 15/800 |
| Featured post | `.featured-post` | 1.1fr/1fr split, radius 24, `--shadow`, image zoom 1.05, title goes `--brand-700` on hover |
| CTA | `.service-cta` | solid blue gradient card, white text, radial white sheen, arrow widens 8→14 px |

```css
.service-card {
  display: flex; flex-direction: column; background: #fff; border: 1px solid var(--line);
  border-radius: 20px; padding: 32px 28px; box-shadow: var(--shadow-sm);
  position: relative; overflow: hidden;
  transition: transform .35s var(--ease), box-shadow .35s, border-color .35s;
}
.service-card::before {
  content: ""; position: absolute; inset: 0 0 auto 0; height: 4px;
  background: linear-gradient(90deg, var(--brand-400), var(--brand-700));
  transform: scaleX(0); transform-origin: inline-end;
  transition: transform .4s var(--ease);
}
.service-card:hover { transform: translateY(-10px); box-shadow: var(--shadow-lg); border-color: transparent; }
.service-card:hover::before { transform: scaleX(1); transform-origin: inline-start; }
```

**Card content limits**
- Title ≤ 2 lines, description ≤ 3 lines (14–14.5 px, `line-height: 1.95–2`).
- One icon per card, 28–30 px, inside a 58–66 px tile.
- Never put a button inside a card that is itself a link; use the card link + a text link.

### 5.6 Section header patterns

| Pattern | Class | Use |
|---|---|---|
| Centered | `.section-head` / `.how-head` | 90% of sections: eyebrow → H2 → lead (max 640 px, centered) → 54 px gap |
| Row with link | `.section-head-row` | Preview sections: left-aligned eyebrow + title, «مشاهده همه» arrow on the far inline-end, baseline-aligned, wraps on mobile |

```html
<div class="section-head center">
  <span class="eyebrow">خدمات تخصصی</span>
  <h2 class="section-title">خدمات ما</h2>
  <p class="section-lead">از اتوماسیون و توسعه نرم‌افزار تا زیرساخت هوشمند…</p>
</div>
```

### 5.7 Forms

**Anatomy:** `.field` (label + optional `.opt` hint + control + `.err`) → `.form-alert` → submit.

| Property | Value |
|---|---|
| Field gap | 7 px label→input, 16 px between fields |
| Input | `15px`, `13px 15px`, radius 12, `1.5px --line`, bg `--bg-soft` |
| Focus | border `--brand-300`, bg `#fff`, ring `0 0 0 4px rgba(37,99,235,.12)` |
| Invalid | border `#f87171`, ring `rgba(248,113,113,.12)`, message `#dc2626` 12.5 |
| Optional hint | `.opt` — `--muted-2`, 12.5/500, in parentheses: «(اختیاری)» |
| Textarea | `resize: vertical` |
| Honeypot | `.hp` — absolutely off-screen, `opacity: 0` |
| Labels | Always visible. **No** floating labels, no placeholder-as-label. |
| Layout | `.form-two` = 2-col grid, gap 16; stacks ≤760 |

```css
.field input, .field textarea {
  font-family: inherit; font-size: 15px; color: var(--ink);
  padding: 13px 15px; border: 1.5px solid var(--line); border-radius: 12px;
  background: var(--bg-soft); width: 100%; resize: vertical;
  transition: border-color .2s, box-shadow .2s, background .2s;
}
.field input:focus, .field textarea:focus {
  outline: none; border-color: var(--brand-300); background: #fff;
  box-shadow: 0 0 0 4px rgba(37,99,235,.12);
}
```

**Alerts:** `.form-alert.ok` (`#dcfce7` / `#15803d` / `#bbf7d0`) and `.form-alert.error` (`#fee2e2` / `#b91c1c` / `#fecaca`), radius 12, 14/600. Announce with `role="status"` / `role="alert"`.

**Contact panel (the blue sibling):** `.contact-panel` = blue gradient, white text, `--shadow-brand`, radius 20, `height: 100%`, points list with white 18 px checks, social pills `rgba(255,255,255,.15)`. It always sits beside the form and never above it on desktop.

### 5.8 Footer

**Anatomy:** 5-column grid (`repeat(4, 1fr) 1.4fr`) → brand column (logo, blurb ≤320 px, socials) + 4 link columns → optional docs bar → bottom bar (copyright + legal links + enamad badge).

| Part | Spec |
|---|---|
| Container | `padding-top: 64px`, `border-top: 1px --line`, white |
| Column title | 15/800 `--ink`, `margin-bottom: 18px` |
| Links | 14.5 `--muted`, gap 11 px; hover `--brand-600` + `padding-inline-end: 4px` (a subtle RTL nudge) |
| Socials | 42 px squares, radius 12, `--bg-soft`, `--line`; hover blue fill + lift |
| Contact list | icon 17 px `--brand`, text 13.5/`--muted`, `overflow-wrap: anywhere` |
| Bottom | `13.5` `--muted`, `justify-content: space-between` |
| ≤980 | 2 columns; brand column spans all, `order:-1` |
| ≤480 | 1 column |

Footer link groups are *products*, *resources*, *services*, *company* — keep that information architecture; it mirrors the header dropdowns.

### 5.9 Navigation aids & feedback

| Component | Class | Spec |
|---|---|---|
| Breadcrumbs | `.crumbs` | centered, `--muted-2` 13/600, gap 8, hover blue, separator `/` |
| Pagination | `.page-btn` | 42 px, radius 12, white/`--line`; active blue; `.page-dots` muted |
| Back to top | `.to-top` | fixed `bottom 24 / inline-start 24`, 48 px, radius 14, blue, `--shadow-brand`, fades + lifts in |
| Reading progress | `.read-progress` | fixed 3 px top bar, gradient, width = scroll % |
| Share rail | `.share-sticky` | 44 px icons sticky at `top: 100px`, vertical «اشتراک‌گذاری» label |
| FAQ | `.faq-item` (`<details>`) | radius 16, `+` rotates 45° when open, open border = 40% brand mix |
| Empty state | `.empty-state` | 48 px icon `--muted-2`, 17 px text, centered, 70 px padding |
| 404 | `.notfound` | 80–160 px gradient code, H1, lead, 2 actions |
| Skip link | `.skip-link` | `top:-60px → 8px` on focus, blue, radius 10 |
| Timeline | `.timeline` | vertical 2 px brand gradient, 20 px markers with white fill + 3 px brand ring, cards radius 16 |

### 5.10 Tables & rich text (article scope)

| Element | Spec |
|---|---|
| Prose wrapper | `.post-content`, max-width 820, 17/2.1, `--ink-2` |
| H2 / H3 in prose | 24 / 20, `--ink`, top margin 36 / 28 |
| Links | `--brand-600`, underline, `text-underline-offset: 3px` |
| Inline code | `--bg-slate`, radius 6, `.9em`, `direction: ltr`, inline-block |
| Blockquote | 4 px brand inline-start border, `--bg-soft`, radius `0 12 12 0`, 600 weight |
| Table | wrapped in `.table-scroll` (radius 14, 1px border), header = brand-50 gradient + brand-700 text, zebra rows `--bg-soft`, cell padding `13px 16px` |
| Images | radius 14, `margin-top: 22px` |
| Callout/step | **Derived** — reuse `.cta-card` or `.service-cta` at reduced padding |

---

## 6. Page templates & composition

### 6.1 The section rhythm (most important layout rule)

Pages are stacked full-width `<section class="section">` blocks. Backgrounds alternate to segment content **without** drawing lines:

| Step | Background | Typical content |
|---|---|---|
| 1 | `#fff` (hero) | H1 + value proposition + 2 buttons |
| 2 | `#fff` + dot pattern | process / how it works |
| 3 | `--bg-slate` `#f1f5f9` | industries / split with visual |
| 4 | `#fff` | services grid |
| 5 | `--bg-soft` `#f8fafc` | capabilities grid |
| 6 | `#fff` | models / product spotlight |
| 7 | `--bg-soft` | featured product (blue panel) |
| 8 | `#fff` | project preview |
| 9 | `--bg-soft` | blog preview |
| 10 | `#fff` | skills / MCP preview |
| 11 | `#fff` + blue gradient card | contact CTA |
| 12 | `#fff` + border-top | footer |

**Never** two adjacent sections with the same background *unless* one is a hero/CTA and the other is plain content. **Never** more than one dark navy section on a page (the hero), except the small `.service-cta` / `.contact-panel` cards.

### 6.2 Home page

| # | Section | Component set |
|---|---|---|
| 1 | Hero | `.hero` + blobs + grid, eyebrow «هوش مصنوعی برای کسب‌وکارها», gradient H1, 2 CTAs, logo visual |
| 2 | Process «دیباچین چگونه به شما کمک می‌کند؟» | `.pcards` 4× `.pcard` with dashed connector, Persian ordinals ۰۱–۰۴ |
| 3 | Industries «هر کسب‌وکار، پتانسیل هوشمند شدن دارد» | `.industries` split text + `.industries-hub` (logo center, 8 nodes, animated data dots) |
| 4 | Services «خدمات ما» | `.services-grid` 3×2: 5 `.service-card` + 1 `.service-cta` blue card |
| 5 | Capabilities «چه کارهایی…» | `.caps-grid` 3×3 `.cap-card`, numbered ۰۱–۰۹ |
| 6 | Models «خانوادهٔ دیبا» | 6 model cards + «آشنایی کامل» ghost + Hugging Face link |
| 7 | DibaRouter spotlight | 2-col: copy + 3 bullet features + 2 CTAs, external `dibarouter.ir` |
| 8 | Projects «پروژه‌هایی که متحول کردیم» | `.project-grid.three`, 3 cards, «مشاهده همه» |
| 9 | Blog «آخرین مقالات» | `.post-grid` 3 cards, «همه مقالات» |
| 10 | Skills | 3 `.skill-card` horizontal preview |
| 11 | MCP | 3 `.skill-card`-style servers |
| 12 | Contact | `.cta-card` 2-col: pitch + `.cta-form` |
| 13 | Footer | 5-col |

**Above the fold budget:** eyebrow ≤ 40 chars · H1 ≤ 90 chars / 2 lines · lead ≤ 160 chars · 2 buttons.

### 6.3 Portfolio index

```
.page-hero            ← eyebrow «نمونه‌کارها», H1, lead, dot pattern
.section              ← .project-grid (2-col) of .project-card
                        media 16:9.5 + overlay CTA + category pill + title + excerpt + client
                        empty state if filtered to zero
```

Card copy limits: category ≤ 24 chars · title ≤ 60 · excerpt ≤ 160 · client line «کارفرما: **نام**».

### 6.4 Project detail

| Order | Element | Notes |
|---|---|---|
| 1 | `.crumbs` | خانه / نمونه‌کارها / {category} |
| 2 | Category pill | `.project-cat` |
| 3 | H1 | `.post-single-title`, 26–40 px |
| 4 | Client line | «کارفرما: **…**» 14/`--muted` |
| 5 | Cover | `.post-cover`, radius 20, `--shadow`, 16:9.5 or 2:1 |
| 6 | Tag row | `.tag-pill` ×3–6, tech only |
| 7 | Intro | First paragraph = problem, second = what it is, third = honest scope limit |
| 8 | Body | `.post-content` H2/H3 sections, lists, tables |
| 9 | Results | `.project-results` → `.result-item` with green check, 3–6 items |
| 10 | Repo link | `.gh-link` with GitHub mark, «مشاهده سورس پروژه در گیت‌هاب» |
| 11 | **Related projects** | `.related` section — see §8.8 |
| 12 | CTA | `.project-cta`: «پروژه‌ای مشابه در ذهن دارید؟» + primary button |

The observed detail page already follows this shape minus steps 9 and 11 — add them, because they are what turn a gallery into a system.

### 6.5 Blog index & article

**Index:** `.page-hero` (title + `.blog-search` pill + `.blog-tabs` with counts) → optional `.featured-post` → `.post-grid` 3-col → `.pagination`.

**Article:** `.read-progress` fixed → `.post-head` (crumbs, category pill, H1, meta with author chip, date, read time) → `.post-layout` grid `60px | 1fr` (sticky share rail) → `.post-cover` → `.post-content` → `.post-tags` → `.share-inline` → `.author-box` → related posts (`.related`) → CTA.

Meta ordering is fixed: `۱۴۰۵/۰۸/۱۵ • ۱ دقیقه` and, when present, author chip before date.

### 6.6 About

`.about-hero` dark (`#0b1a47` + banner overlay) → `.about-content-wrap` (820 px, 2-col bullet grid with gradient dots) → `.timeline-section` (`.timeline` vertical) → `.about-values` (4 `.value-card`) → stats (`.stats-grid` 4× `.stat`) → CTA.

### 6.7 Contact

`.contact-cards` (4 centered `.contact-card`, flex `1 1 220px`, max 300) → `.contact-main` grid `1.5fr 1fr` (form + `.contact-panel`) → `.contact-map` (radius 18, 360 px iframe) → CTA.

### 6.8 Service landing pages

Dark, dramatic variant for paid/local landing pages (`/chatbot`, `/automation`, `/ai-everything`):

```
.landing-hero          ← navy radial gradient, centered, eyebrow glass, gradient H1 phrase,
                         lead, 2 buttons (white filled + glass ghost), .landing-trust pills
.landing-body
  .landing-grid        ← 1fr | 340px
    .landing-content   ← white card, prose
    .landing-aside     ← sticky .local-card (blue gradient contact card)
.landing-faq           ← <details> list, max 820px
```

H1 in `.landing-hero` uses a **different** gradient (`#7dd3fc → #a5b4fc`) than the light hero. Use it only on navy.

### 6.9 Composition rules

1. **One H1 per page.** Section titles are H2; card titles H3.
2. **One primary CTA per section**; repeated primary CTAs must point to the same destination.
3. **Max 3 columns of text**; prose never exceeds 820 px.
4. **Alternate backgrounds** by section, not by card.
5. **Icons carry meaning**: each icon family (line style, 1.5–2 px stroke, 24–30 px) is consistent on a page. Do not mix filled and outline sets.
6. **Dark only where earned**: hero, CTA panel, local card, footer of dark layouts. Never a dark card in a light grid (the blue `.service-cta` is the exception because it is the section's CTA).
7. **Numbers are content.** Stats, step numbers, counts and results are always present in a section that makes a quantitative claim.

---

## 7. Content, voice & SEO patterns

### 7.1 Voice

- **Formal, second-person plural**: «کسب‌وکار شما», «می‌توانید», never «تو».
- **Concrete first**: name the model, the protocol, the outcome. «کاهش ۴۰٪ زمان پاسخ» beats «بهبود چشمگیر».
- **Humble scope**: the DRouter page explicitly says it is not a replacement for OpenWrt. Emulate that honesty; it converts better in B2B.
- **Sentence length** 12–20 words. One idea per sentence.
- **No emoji** in production copy. Emoji only as a brand mark before an external platform name (the site uses 🤗 for Hugging Face) — acceptable once.

### 7.2 Approved CTA vocabulary

| Context | Label |
|---|---|
| Primary consult | «مشاوره رایگان» / «درخواست مشاوره رایگان» / «رزرو مشاوره رایگان» |
| Explore | «مشاهده خدمات», «مشاهده همه», «همهٔ اسکیل‌ها», «آشنایی کامل با خانوادهٔ دیبا» |
| Learn | «بیشتر بدانید», «ادامه مطلب», «مطالعه» |
| Product | «شروع کنید در dibarouter.ir» |
| Repo | «مشاهده سورس پروژه در گیت‌هاب» |
| Card | «مشاهده پروژه», «اطلاعات بیشتر» |

Never: «کلیک کنید», «همین حالا بخرید», «شگفت‌زده شوید».

### 7.3 Eyebrow vocabulary (the section's "chapter name")

`فرآیند همکاری` · `خدمات تخصصی` · `توانمندی‌های ما` · `خانوادهٔ دیبا` · `محصول تازهٔ دیباچین` · `نمونه‌کارها` · `وبلاگ` · `کتابخانهٔ اسکیل‌ها` · `کتابخانهٔ MCP` — 2–4 words, never a full sentence.

### 7.4 Copy blocks

| Block | Length | Shape |
|---|---|---|
| Hero H1 | ≤ 90 chars | benefit + audience: «هوشمندسازی و گسترش کسب‌وکار شما با قدرت هوش مصنوعی» |
| Lead | ≤ 160 chars | what we do + for whom + proof |
| Card title | ≤ 30 | noun phrase, no verb |
| Card description | ≤ 110 | one benefit + one mechanism |
| Section lead | ≤ 200 | the "why this section exists" |
| Project excerpt | ≤ 160 | problem → solution, no metrics (metrics live in results) |
| Meta description | 120–160 | includes «دیباچین» + city/product when relevant |

### 7.5 Page metadata

```yaml
title: "نمونه‌کارها | دیباچین"            # pattern: {Page} | دیباچین
description: "…"                          # 120–160 chars
canonical: https://dibachain.ir/portfolio
og_image: /assets/img/og-image.png        # 1200×630
lang: fa-IR
dir: rtl
```

Observed SEO conventions worth keeping: `Sitemap:` per content type (`sitemap-pages`, `-models`, `-blog`, `-skills`, `-portfolio`, `-mcp`), `llms.txt`-friendly robots (`GPTBot`, `ClaudeBot`, `PerplexityBot` all allowed), and Persian slugs for pages while product IDs stay Latin (`/diba-base`, `/dibaone-x1`).

### 7.6 Do / Don't

| Do | Don't |
|---|---|
| «هوش مصنوعی فارسی، آفلاین روی CPU» | «انقلاب هوش مصنوعی» |
| «کاهش هزینه و خطا» | «بهترین در جهان» |
| Persian digits `۱۴۰۵` | `2026` in Persian copy |
| ZWNJ in every compound | `می شود`, `کسب و کار` |
| One proof per claim | Four adjectives per claim |

---

## 8. Project system — the registry & cross-references

This is the layer that makes the design system **growable**: every project is a first-class object with a stable ID, a taxonomy, media, and typed relationships to other projects (and to models, services, posts). The site already renders project cards; this section turns them into a graph you can maintain.

### 8.1 The model in one picture

```
project ──belongs to──▶ category (taxonomy)
   │
   ├── delivered by ──▶ service (chatbot | automation | data | software | voip | consulting)
   ├── powered by ────▶ model (diba-base | diba-embed | diba-vision | diba-stt | platrix | dibaone-x1 …)
   ├── published as ──▶ post (case study / launch article)
   └── relates to ────▶ project ◀── the focus of this section
```

Every arrow is declared **once**, in the *source* project's `relations:`. The inverse is computed, never written twice. That single rule is what keeps a growing portfolio consistent.

### 8.2 Project object (frontmatter schema)

```yaml
---
# ── identity ──────────────────────────────────────────────
id: drouter                            # stable, Latin, kebab-case, immutable
title: تبدیل ESP32 به یک روتر هوشمند با DRouter
short_title: DRouter                   # for breadcrumbs, chips, dense lists
slug: drouter-esp32-v2ray              # URL segment (Latin preferred)
legacy_slug: /portfolio/drouter-esp32-v2ray   # optional: current live path
locale: fa-IR
dir: rtl

# ── classification ────────────────────────────────────────
category: hardware                     # key from §8.3
category_label: سخت افزار              # rendered label (Persian)
services: [software-development]       # service keys
models: []                             # model IDs, e.g. [diba-base]
tags: [esp32, router, v2ray, مدیریت کاربران]

# ── facts ─────────────────────────────────────────────────
client: دیباچین
year: 1404                             # Jalali
status: shipped                        # concept | in-progress | shipped | maintained | archived
featured: true                         # eligible for home preview
order: 2                               # sort inside category (ascending)
open_source: true

# ── media ─────────────────────────────────────────────────
cover: /uploads/20260819-919db20ce403.webp
cover_alt: روتر هوشمند DRouter روی برد ESP32
cover_ratio: "16/9.5"                  # 16/9.5 cards | 2/1 hero | 16/10 blog

# ── copy ──────────────────────────────────────────────────
excerpt: یک فریمور متن‌باز برای ESP32 که برد را به روتر Wi-Fi هوشمند تبدیل می‌کند.
results:                               # 3–6, each ≤ 60 chars, verifiable
  - مدیریت کاربران و محدودیت حجم مصرف
  - پروکسی شفاف VLESS/Trojan بدون نصب VPN
  - پنل مدیریت تحت وب روی سخت‌افزار کم‌مصرف

# ── links ─────────────────────────────────────────────────
links:
  repo: https://github.com/AliAkrami1375/DRouter-Firmware
  live: null
  docs: null

# ── graph ─────────────────────────────────────────────────
relations:
  - { type: part-of, target: dsp32, note: "هر دو خانوادهٔ ESP32" }
  - { type: case-study-of, target: "service:software-development" }

# ── meta ──────────────────────────────────────────────────
seo:
  title: DRouter؛ تبدیل ESP32 به یک روتر هوشمند | دیباچین
  description: …
updated: 1405-08-19
---
```

**Required:** `id`, `title`, `slug`, `category`, `client`, `year`, `status`, `cover`, `cover_alt`, `excerpt`, `relations`.
**Everything else optional.** Missing optional fields must not break the card — render fallbacks (no `results` → hide block; no `repo` → hide button).

### 8.3 Taxonomy

**Categories** (mirror the live portfolio filters):

| Key | Label (fa) | Card accent |
|---|---|---|
| `iot-embedded` | اینترنت اشیا (IoT) و سیستم‌های تعبیه‌شده | blue |
| `hardware` | سخت افزار | blue |
| `conversational-ai` | هوش مصنوعی مکالمه‌ای | blue |
| `data-bi` | تحلیل داده و هوش تجاری | blue |
| `speech-ai` | هوش مصنوعی و پردازش گفتار | blue |
| `security-infra` | امنیت و زیرساخت | blue |

(All categories currently share the same accent — the taxonomy is semantic, not chromatic. If you add a second accent, add it as a token, never as a hex in a template.)

**Status:** `concept` (no public page) · `in-progress` (no metrics yet) · `shipped` (default) · `maintained` (ongoing support) · `archived` (kept for reference, badge «آرشیو»).

**Services & models** must use the canonical keys from the navigation, never free text: `chatbot`, `automation`, `data-analytics`, `software-development`, `voip`, `ai-consulting`, `mcp`; models: `diba-base`, `diba-embed`, `diba-vision`, `diba-stt`, `platrix`, `dibaone-x1`, `dibaone-m3`, `dibarouter`.

### 8.4 ID & URL conventions

| Rule | Rationale |
|---|---|
| `id` is **Latin kebab-case**, 2–4 words, immutable | Persian slugs get percent-encoded and break cross-references |
| `id` must not change even if the title changes | it is the graph's primary key |
| `slug` may be Persian (as today) or Latin; if Latin, keep it equal to `id` | one less mapping to remember |
| `legacy_slug` holds the current percent-encoded path during migration | preserves SEO when you normalize URLs |
| Never reuse a retired `id` | old references would silently point at a new project |
| Anchors: `#results`, `#stack`, `#gallery` | stable, lowercase, English |

### 8.5 Adding a project — the 8-step checklist

1. **Pick the ID** before writing anything: `smart-support-agent`, not `project-2026-01`.
2. **Duplicate** `project-entry-template.md` → `projects/<id>.md`.
3. **Fill identity + classification.** Category and client are mandatory.
4. **Prepare media**: cover at 1600×950 (16:9.5), WebP, ≤250 KB, Persian `cover_alt`.
5. **Write the excerpt** (≤160 chars, problem → solution) and **3–6 results** (each verifiable).
6. **Declare relations** (§8.6/8.7): at least one. A project with zero relations is a dead end.
7. **Add the row to the registry** (§8.9) and reference it from at least one sibling project so it has an inbound edge.
8. **Validate** (§8.10): IDs exist, no self-reference, no duplicate edges, symmetric edges mirrored, `featured` count ≤ 3.

### 8.6 Cross-reference syntax

Inside any Markdown body (project, post, service page), a reference is written with double brackets:

```markdown
<!-- canonical, namespaced -->
[[project:drouter]]                  → renders short_title as a link
[[project:drouter|DRouter Router]]   → custom label
[[project:drouter#results]]          → deep link to an anchor
[[model:diba-stt]]                   → link to the model page
[[service:chatbot]]                  → link to the service page
[[post:li-translate-launch]]         → link to the article
[[skill:mcp-server-development]]     → link to the skills entry
[[mcp:grafana]]                      → link to the MCP server entry

<!-- shorthand: resolve against the project registry first -->
[[dsp32]]
```

**Resolution order:** `project` → `model` → `service` → `post` → `skill` → `mcp`. Explicit namespaces always win.

**Grammar**

```
ref      := "[[" target ("|" label)? "]]"
target   := (namespace ":")? id ("#" anchor)?
namespace:= project | model | service | post | skill | mcp
```

**Rendering contract**

| Context | Output |
|---|---|
| Inline in prose | `<a class="xref" href="/portfolio/{slug}">label</a>` |
| In a card list | `.rel-card` (compact horizontal card) |
| Unknown target | **build error**, never a red link |
| Reference to self | build error |
| Same target twice in one paragraph | render once, dedupe silently |

**Inline reference style (derived)** — it must read as a project, not as a generic link:

```css
.xref {
  display: inline-flex; align-items: center; gap: 4px;
  font-weight: 700; color: var(--brand-700);
  background: var(--brand-50); border: 1px solid var(--brand-100);
  border-radius: 7px; padding: 0 6px; text-decoration: none;
  transition: background .2s var(--ease), border-color .2s var(--ease);
}
.xref::before { content: "◆"; font-size: 8px; color: var(--brand-400); }
.xref:hover { background: #fff; border-color: var(--brand-300); }
```

### 8.7 Relationship vocabulary

| Type | Meaning | Inverse (auto) | Symmetric |
|---|---|---|---|
| `part-of` | this project is a module/sub-project of the target | `includes` | no |
| `builds-on` | reuses the target's code, platform or data | `used-by` | no |
| `similar-to` | same problem space, worth cross-reading | `similar-to` | **yes** |
| `supersedes` | replaces an older project | `superseded-by` | no |
| `case-study-of` | a delivery instance of a product/service page | `has-case-study` | no |
| `enables` | unlocks or powers the target | `enabled-by` | no |

**Rules**

1. Declare the edge on the **more specific** project (the module declares `part-of`, not the platform declaring `includes`).
2. `similar-to` is symmetric: writing it once on either side implies the inverse — the generator mirrors it.
3. A project may have **at most 6** relations; the UI renders the **first 4** by priority: `part-of` → `builds-on` → `supersedes` → `case-study-of` → `enables` → `similar-to`.
4. `supersedes` chains must stay acyclic (A→B→C allowed; A→B→A is an error).
5. Relations are **directional facts**, not tags. If you cannot write the inverse sentence in Persian, the edge is wrong.
6. Every edge may carry a short `note` (≤60 chars) rendered as a subtitle on `.rel-card`.
7. `target` is normally a project `id`. A **namespaced target** (`service:chatbot`, `model:diba-stt`) is allowed for `case-study-of` and `builds-on`; it renders as a chip, not as a related-project card, and never appears in the related grid.

### 8.8 Rendering the graph

**A. "Related projects" block** — reuse the existing project card at reduced density. It sits after the body and before the CTA.

```html
<section class="section related" aria-labelledby="related-title">
  <div class="container">
    <div class="section-head-row">
      <div>
        <span class="eyebrow">پروژه‌های مرتبط</span>
        <h2 class="section-title" id="related-title">پروژه‌های مرتبط</h2>
      </div>
      <a class="link-arrow" href="/portfolio">مشاهده همه <svg class="icon-sm flip">…</svg></a>
    </div>

    <div class="project-grid three">
      <!-- one card per resolved relation, max 4 -->
      <article class="project-card">
        <a class="project-media" href="/portfolio/dsp32" aria-label="مشاهده پروژه Dsp32">
          <img src="/uploads/dsp32.webp" alt="پلتفرم Dsp32" loading="lazy" width="1600" height="950">
          <span class="project-overlay"><span class="project-view">مشاهده پروژه</span></span>
        </a>
        <div class="project-body">
          <span class="project-cat">اینترنت اشیا</span>
          <h3 class="project-title"><a href="/portfolio/dsp32">پلتفرم جامع Dsp32…</a></h3>
          <p class="rel-type">مشابه · هر دو فریمور ESP32</p>
        </div>
      </article>
    </div>
  </div>
</section>
```

```css
/* relation type caption — derived, fits the existing card */
.rel-type {
  margin-top: 10px; font-size: 12.5px; font-weight: 700;
  color: var(--muted-2); display: inline-flex; align-items: center; gap: 6px;
}
.rel-type::before { content: ""; width: 6px; height: 6px; border-radius: 50%;
  background: var(--brand-300); }
```

**B. Compact cross-reference list** (for sidebars, "built with", "part of"):

```css
.rel-list { display: flex; flex-direction: column; gap: 10px; }
.rel-card {
  display: grid; grid-template-columns: 56px 1fr auto; align-items: center; gap: 12px;
  padding: 10px 14px 10px 10px; background: #fff;
  border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow-sm);
  transition: transform .25s var(--ease), box-shadow .25s, border-color .25s;
}
.rel-card:hover { transform: translateY(-2px); border-color: var(--brand-200); box-shadow: var(--shadow); }
.rel-card img { width: 56px; height: 56px; border-radius: 10px; object-fit: cover; }
.rel-card-title { font-size: 14px; font-weight: 800; color: var(--ink); line-height: 1.6; }
.rel-card-meta { font-size: 12px; color: var(--muted); }
.rel-card-arrow { color: var(--brand); }
```

**C. Backlinks** — «ارجاعات» — auto-computed list of projects that point *at* this one. Render as a simple `.tag-pill` row or a text list:

> این پروژه در `[[project:drouter]]` و `[[project:support-agent]]` ارجاع داده شده است.

**D. Where references appear**

| Surface | Rule |
|---|---|
| Project detail | Related block (max 4) + backlinks if any |
| Project card | No relations rendered — cards stay clean |
| Home preview | Only `featured: true`, max 3, sorted by `order` |
| Service page | «نمونه‌کارهای مرتبط» = projects whose `services` include this service, max 3 |
| Blog post | Project callout near the end: `.project-cta` with the referenced project |
| Model page | «پروژه‌هایی که از این مدل استفاده می‌کنند» (reverse `models` lookup) |

### 8.9 The registry

Keep this table in sync with the YAML files — it is the human-readable index and the source for the "all projects" page. **One row per project.**

| ID | Title (fa) | Category | Client | Year | Status | Featured | Relations (declared) |
|---|---|---|---|---|---|---|---|
| `dsp32` | پلتفرم جامع سیستم‌عامل تعبیه‌شده Dsp32 برای خانواده ESP32 | `iot-embedded` | دیباچین | 1404 | shipped | ✅ | — (`includes` drouter, derived) |
| `drouter` | تبدیل ESP32 به یک روتر هوشمند با DRouter | `hardware` | دیباچین | 1404 | maintained | ✅ | `part-of` dsp32 |
| `support-agent` | سیستم پشتیبانی هوشمند فروشگاه آنلاین | `conversational-ai` | فروشگاه آنلاین | 1404 | shipped | — | `similar-to` li-translate |
| `bi-dashboard` | پلتفرم تحلیل داده مدیریتی | `data-bi` | مجموعه بازرگانی | 1404 | shipped | — | `case-study-of` service:data-analytics |
| `li-translate` | Li Translate — پلتفرم زیرنویس و ترجمه هوشمند | `speech-ai` | Li Translate | 1404 | shipped | ✅ | `case-study-of` service:software-development |
| `security-agent` | Security Agent — تأمین امنیت هوشمند سرور | `security-infra` | Security Agent | 1404 | shipped | — | `case-study-of` service:software-development |

> **Seed status:** the six projects, categories and clients are taken from the live portfolio; the entries in `projects/*.md` are valid seeds. The relations are **suggested** scaffolding to demonstrate the model — confirm each one with the project owner before publishing. The live site currently ships no related-projects block, so nothing is contradicted.

**Suggested relation graph (v1)**

```
        dsp32 ◀──part-of── drouter                (dsp32 ⇢ includes drouter, derived)

  support-agent ◀──similar-to──▶ li-translate     (symmetric: declare once)

  bi-dashboard  ──case-study-of──▶ service:data-analytics
  li-translate  ──case-study-of──▶ service:software-development
  security-agent──case-study-of──▶ service:software-development
```

Every node has at least one edge, so the graph is connected and no warning fires. As the portfolio grows, prefer `builds-on` and `part-of` edges between projects — they are what make the "related" block feel like a product family rather than a random gallery.

### 8.10 Validation rules (CI)

Fail the build on:

| Check | Rule |
|---|---|
| `id` format | `^[a-z0-9]+(-[a-z0-9]+)*$`, unique across all content types |
| Required fields | present and non-empty |
| Category / service / model keys | must exist in the taxonomy |
| Relation target | must resolve to an existing project `id`, or to a valid namespaced `service:` / `model:` key for `case-study-of` / `builds-on` |
| Self-reference | `target !== id` |
| Duplicate edge | same `type + target` declared twice |
| Symmetric mirror | `similar-to` present exactly once per pair after generation |
| Cycle | `supersedes` and `part-of` graphs are acyclic |
| `featured` count | ≤ 3 globally |
| Cover | file exists, WebP/AVIF, ≥1200 px wide, has `cover_alt` |
| Reference syntax | every `[[…]]` resolves; no orphan `[[` |
| Orphans | warn on projects with zero inbound and zero outbound edges |
| Slug collision | unique `slug`, `legacy_slug` preserved |

Warnings (do not fail): missing `results`, missing `repo`, category with 1 project, project older than 2 years without `archived`.

**Ship it as code.** `validate-projects.ps1` implements the structural rules — ids, required fields, taxonomy, relation targets, symmetry, cycles, `[[…]]` references and the featured budget — with no dependencies:

```bash
# Windows (execution policy may block unsigned scripts)
powershell -ExecutionPolicy Bypass -File validate-projects.ps1

# PowerShell 7 / macOS / Linux
pwsh -File validate-projects.ps1
```

Output on the seeded registry:

```
Projects: 6 | featured: 3 | relations: 6
OK — graph is valid (0 warnings)
```

Wire it into CI as a required check on any change under `projects/`.

### 8.11 Media spec

| Asset | Ratio | Size | Format | Notes |
|---|---|---|---|---|
| Project cover (card) | 16:9.5 | 1600×950 | WebP q80 | subject centered, safe area 10% |
| Project cover (detail) | 2:1 or 16:9.5 | 2000×1000 | WebP | same composition, no text overlay |
| Blog cover | 16:10 | 1600×1000 | WebP | category badge overlays top-inline-end (12 px inset) |
| OG image | 1.91:1 | 1200×630 | PNG/WebP | brand mark + title, `og-image.png` default |
| Logo | – | 40×40 / SVG | SVG/PNG | `object-fit: contain` |
| MCP/skill thumbnail | 1:1 | 160×160 | WebP | used in `.rel-card` at 56 px |

**Alt text formula:** `{artifact} {context}` — «پنل مدیریت DRouter روی برد ESP32». Never «تصویر پروژه».

### 8.12 Worked example — full entry with references

```markdown
---
id: drouter
title: تبدیل ESP32 به یک روتر هوشمند با DRouter
short_title: DRouter
slug: drouter-esp32-v2ray
category: hardware
category_label: سخت افزار
services: [software-development]
models: []
tags: [esp32, router, v2ray, مدیریت کاربران]
client: دیباچین
year: 1404
status: maintained
featured: true
order: 2
open_source: true
cover: /uploads/20260819-919db20ce403.webp
cover_alt: روتر هوشمند DRouter روی برد ESP32
cover_ratio: "16/9.5"
excerpt: یک فریمور متن‌باز که یک برد ESP32 را به روتر Wi-Fi هوشمند با مدیریت کاربران و پروکسی شفاف تبدیل می‌کند.
results:
  - مدیریت کاربران و محدودیت حجم مصرف
  - پروکسی شفاف VLESS/Trojan بدون نصب VPN
  - پنل مدیریت تحت وب روی سخت‌افزار کم‌مصرف
links:
  repo: https://github.com/AliAkrami1375/DRouter-Firmware
  live: null
relations:
  - { type: part-of, target: dsp32, note: "از پلتفرم Dsp32" }
  - { type: case-study-of, target: "service:software-development" }
updated: 1405-08-19
---

## DRouter چیست و چه مشکلی را حل می‌کند؟

DRouter یک فریمور متن‌باز است که با نصب آن روی یک برد ESP32، همان برد به یک
روتر Wi-Fi کوچک و هوشمند تبدیل می‌شود.

> DRouter جایگزین کامل OpenWrt نیست؛ برای ده‌ها کاربر هم‌زمان یا امکانات سازمانی
> همچنان روتر لینوکسی انتخاب بهتری است.

این پروژه روی همان پایه‌ای ساخته شده که [[project:dsp32|پلتفرم Dsp32]] فراهم می‌کند
و برای سناریوهای مشابه، [[project:security-agent]] گزینهٔ مکمل زیرساختی است.
برای پیاده‌سازی مشابه، [[service:software-development]] را ببینید.
```

---

## 9. Accessibility & performance

### 9.1 Accessibility contract

| Requirement | Implementation |
|---|---|
| Language & direction | `<html lang="fa" dir="rtl">` on every page |
| Skip link | `.skip-link` → `#home`, visible on focus |
| Focus | `0 0 0 4px rgba(37,99,235,.12)` + `--brand-300` border; never `outline: none` without a replacement |
| Contrast | `--ink` on white = 17.9:1 · `--ink-2` = 10.4:1 · `--muted` on white = 5.1:1 · white on `--brand` = 5.2:1. **Never** use `--muted-2` for body text, only meta/decorative. |
| Target size | 44×44 minimum (buttons, socials 42, share 44) |
| Keyboard | Dropdown: `Enter/Space` open, `Escape` close, focus returns to trigger; drawer traps focus; `<details>` for FAQ |
| ARIA | `aria-expanded` + `aria-haspopup` on `.nav-group-btn`; `aria-current="page"` on active nav; `role="status"` on success alert; `role="alert"` on error; `aria-labelledby` on every `<section>` with a heading |
| Motion | Full `prefers-reduced-motion` collapse |
| Images | Meaningful `alt`; decorative blobs/patterns have no `<img>` (pure CSS) |
| Forms | Visible labels, `autocomplete`, `inputmode="tel"` for phone, error text linked via `aria-describedby` |
| Zoom | Layout survives 200% zoom: no fixed heights on text containers, `min-height` only on media |

### 9.2 Performance budget

| Metric | Target | Why it is achievable here |
|---|---|---|
| LCP | < 2.0 s | hero is text + SVG; LCP is the H1, not an image |
| CLS | < 0.05 | every image has `width`/`height` or `aspect-ratio` |
| CSS | ≤ 60 KB gzipped | one stylesheet, no framework |
| JS | ≤ 30 KB | nav, reveal, counters, forms — no framework |
| Fonts | 1 family, 2–3 weights (400/600/700/800) | `font-display: swap`, `preload` the 700 |
| Images | WebP, `loading="lazy"` below the fold, explicit dimensions | already the site's pattern |
| Third parties | only the enamad badge + optional analytics | everything else is local |

**Practical rules**
- Icons are inline SVG (stroke 1.5–2, `currentColor`), never an icon font.
- Backgrounds are CSS gradients and masks, not images.
- `filter: blur(70px)` blobs are cheap but keep them ≤ 3 per page and `pointer-events: none`.
- Reveal animations must degrade: `.js .reveal` pattern means no-JS users see all content.
- Sticky elements: at most 3 (header, share rail, aside card).

---

## 10. Governance, versioning & changelog

### 10.1 Ownership

| Artifact | Owner | Change process |
|---|---|---|
| `design-tokens.css` | design + frontend | PR, token diff table in description, visual regression on 3 pages |
| `dibachain-design-system.md` | design | PR, bump version, log in §10.3 |
| `projects/*.md` | content + project owner | PR with validation passing |
| Taxonomies (§8.3) | design lead | additive only; renaming requires a migration note |

### 10.2 Versioning

`MAJOR.MINOR.PATCH`

- **MAJOR** — a token changes value or a component's anatomy changes (visual break).
- **MINOR** — new component, new template, new relationship type.
- **PATCH** — copy fixes, docs, new project entries.

Every entry in §10.3 states `what / why / migration`.

### 10.3 Changelog

| Version | Date | Change | Migration |
|---|---|---|---|
| 1.0.0 | 2026-11-08 | Initial extraction from production: full brand/neutral/dark token sets, type scale, 4 shadows, 5 breakpoints, 30+ components, 9 page templates, project registry + reference model + validator | none |

### 10.4 Known gaps (to close in 1.1)

1. `#dbeafe` is hard-coded 6× — promote to `--brand-100`.
2. Spacing is not tokenized in production — adopt §3.6 tokens.
3. No dark mode. If added, it must be a *token remap* (`--bg`, `--ink`, `--line`), not a second stylesheet; the navy surfaces already prove the palette works.
4. `.skill-card` uses `--brand-wash` and `--surface` fallbacks that are not declared in `:root`.
5. Component states (focus, disabled, loading) are undocumented in CSS — this doc adds them as *derived*.
6. Persian slug → Latin slug migration needs a 301 map (`legacy_slug` field is the placeholder).

---

## 11. Appendices

### A. Token JSON (for Tailwind, Figma Tokens, Style Dictionary)

```json
{
  "color": {
    "brand": { "50": "#EFF6FF", "100": "#DBEAFE", "200": "#93C5FD", "300": "#60A5FA",
               "400": "#3B82F6", "500": "#2563EB", "600": "#1D4ED8", "700": "#1E40AF" },
    "ink":   { "900": "#0F172A", "700": "#334155", "500": "#64748B", "400": "#94A3B8" },
    "line":  { "200": "#E2E8F0" },
    "surface": { "0": "#FFFFFF", "50": "#F8FAFC", "100": "#F1F5F9" },
    "navy":  { "900": "#0A1636", "800": "#0B1A47", "700": "#0F2260", "600": "#1E3A8A" },
    "feedback": { "success": "#16A34A", "error": "#DC2626", "warning": "#D97706" }
  },
  "radius": { "sm": "12px", "md": "18px", "lg": "28px", "pill": "999px" },
  "shadow": {
    "sm":    "0 1px 2px rgba(15,23,42,.06), 0 1px 3px rgba(15,23,42,.05)",
    "md":    "0 10px 30px -12px rgba(15,23,42,.15)",
    "lg":    "0 30px 60px -20px rgba(37,99,235,.28)",
    "brand": "0 18px 40px -14px rgba(37,99,235,.45)"
  },
  "font": { "family": "Vazirmatn", "fallback": "Segoe UI, Tahoma, system-ui, sans-serif" },
  "size": {
    "body": "16px", "prose": "17px", "h3": "20px", "h2": "24px",
    "section": "clamp(24px, 3vw, 36px)", "page": "clamp(28px, 4vw, 44px)",
    "hero": "clamp(30px, 4.4vw, 52px)"
  },
  "lineHeight": { "body": 1.85, "prose": 2.1, "heading": 1.4, "hero": 1.32 },
  "motion": { "ease": "cubic-bezier(.22,.61,.36,1)", "fast": "200ms", "base": "300ms", "slow": "500ms" },
  "layout": { "container": "1200px", "gutter": "24px", "sectionY": "clamp(56px, 8vw, 110px)" },
  "breakpoint": { "sm": "480px", "md": "760px", "lg": "980px", "xl": "1200px" }
}
```

### B. Component inventory (acceptance checklist)

- [ ] Button — primary / ghost / glass / dark / sm / lg / block / icon-only
- [ ] Eyebrow, category badge, filter chip, tab, tag pill
- [ ] Header — at top, scrolled, dropdown open, mobile drawer, active page
- [ ] Hero — light, dark landing, page hero, post head
- [ ] Section head — centered, row-with-link
- [ ] Cards — service, service-cta, capability, value, process, project, post, featured post, stat, contact, skill, MCP, related
- [ ] Forms — default, focus, invalid, success, error, honeypot, 2-col
- [ ] Footer — 5-col, docs bar, bottom bar, badges
- [ ] Nav aids — breadcrumbs, pagination, back-to-top, read progress, share rail
- [ ] Feedback — empty state, 404, alerts, loading skeleton *(derived)*
- [ ] Content — prose, table, blockquote, code, timeline, FAQ
- [ ] Project — registry row, related block, backlinks, inline `.xref`

### C. Persian ↔ English glossary (keeps copy and classes aligned)

| Class / key | Persian label |
|---|---|
| `services` | خدمات |
| `capabilities` | توانمندی‌ها |
| `process` | فرآیند همکاری |
| `portfolio` | نمونه‌کارها |
| `blog` | وبلاگ |
| `skills` | اسکیل‌ها |
| `mcp` | سرورهای MCP |
| `models` | مدل‌ها |
| `related` | پروژه‌های مرتبط |
| `results` | نتایج |
| `client` | کارفرما |
| `status` | وضعیت |
| `free-consult` | مشاوره رایگان |

### D. Source map

| What | Where it came from |
|---|---|
| Tokens, components, responsive rules | `https://dibachain.ir/assets/css/style.css` (verbatim copy: `research/clean.css`) |
| Navigation & information architecture | `https://dibachain.ir/` |
| Portfolio taxonomy & project facts | `https://dibachain.ir/portfolio`, `/portfolio/drouter-esp32-v2ray` |
| Route inventory | `https://dibachain.ir/sitemap.xml` + `sitemap-pages.xml` |
| Indexing policy | `https://dibachain.ir/robots.txt` |

---

*End of document — دیباچین Design System v1.0.0*

