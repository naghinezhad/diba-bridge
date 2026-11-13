<p align="center">
  <a href="https://dibachain.ir" target="_blank" rel="noopener noreferrer">
    <img src="public/assets/logo-sm.png" alt="دیباپل | DibaBridge" width="88" height="88" />
  </a>
</p>

<h1 align="center" style="margin-bottom: 2px;">دیباپل</h1>
<p align="center" style="margin-top: 0; font-family: ui-monospace, 'JetBrains Mono', monospace; color: #2563eb; font-weight: 700; font-size: 19px; letter-spacing: 0.5px;">
  DibaBridge · MCP
</p>

<p align="center">
  <b>دروازه هوشمند اتصال پیام‌رسان‌های ایرانی به هوش مصنوعی بر بستر پروتکل MCP</b><br>
  <i>Universal Model Context Protocol (MCP) Server & Dashboard for Iranian Messengers</i>
</p>

<p align="center">
  توسعه داده‌شده توسط <a href="https://dibachain.ir"><b>دیباچین (Dibachain)</b></a>
</p>

<p align="center">
  <a href="#-فارسی">فارسی (پیش‌فرض)</a> •
  <a href="#-english">English</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D22.19-blue.svg" alt="Node version" />
  <img src="https://img.shields.io/badge/protocol-MCP_1.32+-green.svg" alt="MCP Version" />
  <img src="https://img.shields.io/badge/license-MIT-purple.svg" alt="License" />
  <img src="https://img.shields.io/badge/docker-ready-2496ed.svg" alt="Docker" />
  <img src="https://img.shields.io/badge/brand-Diba_Bridge_%7C_%D8%AF%DB%8C%D8%A8%D8%A7_%D9%BE%D9%84-2563eb.svg" alt="Diba Bridge" />
</p>

---

<div id="-فارسی" dir="rtl">

## 🇮🇷 فارسی

**دیبا پل (Diba Bridge)** یک سرور قدرتمند، امن و استاندارد بر پایه پروتکل **Model Context Protocol (MCP)** است که امکان اتصال پیام‌رسان‌های ایرانی (**بله**، **ایتا**، **روبیکا** و **سروش‌پلاس**) را به دستیارها و کلاینت‌های هوش مصنوعی نظیر **Claude Code**، **Cursor**، **Claude Desktop** و سایر ابزارهای متصل به LLM فراهم می‌سازد.

این پروژه به همراه یک **داشبورد مدیریتی مدرن فارسی** ارائه می‌شود که بر اساس **سیستم طراحی اختصاصی دیباچین** پیاده‌سازی شده است و مدیریت یکپارچه حساب‌های کاربری، خواندن و پاسخ‌گویی به پیام‌های زنده، تست اتصال و آزمایش ابزارها را بسیار ساده و کارآمد می‌کند.

---

### قابلیت‌های اصلی دیبا پل

- 🔐 **اتصال با حساب کاربری (بدون ربات):**
  - **بله (Bale):** حساب کاربری (پروتکل وب، WebSocket و Protobuf)
  - **ایتا (Eitaa):** حساب کاربری (پروتکل MTProto با پل محلی EitaaBun)
  - **روبیکا (Rubika):** حساب کاربری (پروتکل کلاینت وب با تبادل کلید RSA/AES)
  - **سروش‌پلاس (Soroush+):** حساب کاربری (پروتکل تلگرامی MTProto)
  - **تلگرام:** حساب کاربری (MTProto)
- 📬 **صندوق پیام‌های دریافتی یکپارچه (Shared Inbox):** مشاهده پیام‌های دریافتی، تفکیک پیام‌های ورودی و خروجی، امکان پاسخ‌گویی مستقیم و استفاده هوش مصنوعی از ابزار `get_updates`.
- ⚡ **تریگرها و اتوماسیون (Automation Triggers):** صفحه‌ی `#/triggers` با ۳۸ قانون آماده‌ی ویرایش‌پذیر؛ پاسخ خودکار، پاسخ هوشمند دیبا روتر، فوروارد بین پیام‌رسان‌ها، اجرای ابزار MCP و ارسال به Webhook (n8n / Make / CRM). هر تریگر شرط (پیام‌رسان، نوع چت، کلمه‌ی کلیدی، ابزار) و اقدام دارد و با یک کلیک روشن، تست یا خاموش می‌شود. تاریخچه‌ی اجرا در `data/triggers.json` ذخیره می‌شود.
- 🎨 **داشبورد اختصاصی با زبان طراحی دیباچین:** رابط کاربری مدرن، تفکیک آکاردئونی پیام‌رسان‌ها با تب پیش‌فرض حساب کاربری، تم تاریک/روشن و واکنش‌گرایی کامل.
- 🧪 **محیط آزمایش زنده (Playground):** تست دستی ابزارها، ارسال متن، تصویر و فایل با قابلیت Drag & Drop یا Paste (Ctrl+V) و مشاهده پاسخ JSON سرور.
- 🔒 **امنیت در سطح سازمانی:** استفاده از توکن‌های Bearer، محدودکننده نرخ درخواست (Rate Limiting) و ذخیره‌سازی نشست‌ها روی سرور محلی با مجوز امنیتی ۶۰۰.
- 🌐 **تست خودکار شبکه و سلامت اتصال (NetCheck & SelfTest):** بررسی وضعیت دسترسی سرور به APIهای داخلی و خارجی با پشتیبانی از SOCKS5 و HTTP Proxy.

---

### نصب و راه‌اندازی سریع

پیش‌نیاز: **Node.js نسخه ۲۲.۱۹ یا بالاتر** (یا استفاده از داکر).

#### ۱. اجرای سریع بدون نیاز به نصب (با npx)
```bash
npx diba-mcp
```

#### ۲. نصب سراسری
```bash
npm install -g diba-mcp
diba-mcp
```

#### ۳. اجرا با داکر (Docker)
```bash
docker run -d --name diba-bridge -p 127.0.0.1:3790:3790 \
  -e ADMIN_PASSWORD=your-secure-password \
  -v diba-bridge-data:/app/data \
  ghcr.io/yunessfa/diba-mcp:latest
```

سپس داشبورد را در مرورگر باز کنید:  
👉 **http://127.0.0.1:3790**

> **کد راه‌اندازی اولیه:** در اجرای اول (در صورت عدم تعیین `ADMIN_PASSWORD`)، یک کد راه‌اندازی شش‌حرفی در کنسول نمایش داده می‌شود که با استفاده از آن می‌توانید رمز عبور داشبورد را ثبت نمایید.

---

### دستورات خط فرمان (CLI)

| دستور | توضیحات |
|---|---|
| `diba-mcp` | اجرای کامل سرور (داشبورد مدیریتی + اندپوینت پروتکل MCP) |
| `diba-mcp stdio` | اجرای سبک با انتقال stdio برای کلاینت Claude Desktop |
| `diba-mcp netcheck` | بررسی ارتباط سرور با آدرس API پیام‌رسان‌ها |
| `diba-mcp selftest [provider] --send` | تست جامع مرحله‌به‌مرحله شامل شبکه، توکن، چت و ارسال آزمایشی |
| `diba-mcp token` | نمایش توکن احراز هویت اندپوینت MCP |
| `diba-mcp reset-password` | بازنشانی رمز عبور ورود به داشبورد |

---

### اتصال به کلاینت‌های هوش مصنوعی

#### ۱. Claude Desktop
تنظیمات زیر را به فایل `claude_desktop_config.json` اضافه کنید:

```json
{
  "mcpServers": {
    "diba-bridge": {
      "command": "npx",
      "args": ["-y", "diba-mcp", "stdio"]
    }
  }
}
```

#### ۲. Claude Code (CLI)
```bash
claude mcp add --transport http diba-bridge http://127.0.0.1:3790/mcp --header "Authorization: Bearer <YOUR_TOKEN>"
```

#### ۳. Cursor و کلاینت‌های JSON
```json
{
  "mcpServers": {
    "diba-bridge": {
      "url": "http://127.0.0.1:3790/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_TOKEN>"
      }
    }
  }
}
```

---

### فهرست ابزارهای هوش مصنوعی (MCP Tools)

| پیام‌رسان | ابزارهای در دسترس مدل هوش مصنوعی |
|---|---|
| **بله (ربات)** | `bale_get_me`, `bale_send_message`, `bale_send_photo`, `bale_send_document`, `bale_get_chat`, `bale_get_updates` |
| **بله (حساب کاربری)** | `bale_client_get_me`, `bale_client_send_message`, `bale_client_get_chat`, `bale_client_get_dialogs`, `bale_client_get_history`, `bale_client_get_updates` |
| **ایتا (ربات)** | `eitaa_get_me`, `eitaa_send_message`, `eitaa_send_photo`, `eitaa_send_file` |
| **ایتا (حساب کاربری)** | `eitaa_client_get_me`, `eitaa_client_send_message`, `eitaa_client_get_chat`, `eitaa_client_get_chats`, `eitaa_client_get_history`, `eitaa_client_get_updates` |
| **روبیکا (ربات)** | `rubika_get_me`, `rubika_send_message`, `rubika_send_photo`, `rubika_send_file`, `rubika_send_location`, `rubika_get_chat`, `rubika_get_updates` |
| **روبیکا (حساب کاربری)** | `rubika_client_get_me`, `rubika_client_send_message`, `rubika_client_send_photo`, `rubika_client_send_file`, `rubika_client_get_chat`, `rubika_client_get_chats`, `rubika_client_get_history`, `rubika_client_get_updates` + مدیریت گروه/کانال: `list_groups`, `create_group`, `group_members`, `add_group_members`, `remove_group_member`, `edit_group`, `leave_group`, `delete_group`, `list_channels`, `create_channel`, `channel_members`, `add_channel_members`, `remove_channel_member`, `edit_channel`, `delete_channel` |
| **سروش‌پلاس (ربات)** | `soroush_get_me`, `soroush_send_message`, `soroush_send_photo`, `soroush_send_document`, `soroush_get_chat`, `soroush_get_updates` |
| **سروش‌پلاس (حساب کاربری)** | `soroush_client_get_me`, `soroush_client_send_message`, `soroush_client_send_photo`, `soroush_client_send_file`, `soroush_client_get_chat`, `soroush_client_get_chats`, `soroush_client_get_history`, `soroush_client_get_updates` + مدیریت گروه/کانال: `list_groups`, `create_group`, `group_members`, `add_group_members`, `edit_group`, `leave_group`, `delete_group`, `list_channels`, `create_channel`, `channel_members`, `add_channel_members`, `edit_channel`, `leave_channel`, `delete_channel` |
| **ابزارهای عمومی** | `list_services`, `list_chats` |

---

### درباره دیباچین (Dibachain)

<p align="center">
  <a href="https://dibachain.ir" target="_blank" rel="noopener noreferrer">
    <img src="public/assets/logo-sm.png" alt="لوگوی دیباچین" width="84" />
  </a>
</p>

**دیباچین (Dibachain)** یک شرکت تخصصی در حوزه **مهندسی نرم‌افزار، هوش مصنوعی (AI)، توسعه مدل‌های زبانی بومی، ایجنت‌های هوشمند سازمانی و زیرساخت‌های مقیاس‌پذیر** است.

فعالیت دیباچین از سال **۱۳۹۴** توسط تیمی از متخصصان نرم‌افزار در مشهد آغاز گردید و با گسترش بازارهای فناوری، امروزه با ثبت دفتر بین‌المللی در **دبی (امارات متحده عربی)** به ارائه خدمات می‌پردازد:
- **خانواده مدل‌های دیبا (Diba Models):** مدل‌های زبانی متن‌باز و تخصصی برای زبان فارسی، میزبانی‌شده بر بستر Hugging Face.
- **روتر هوشمند دیبا (DibaRouter):** زیرساخت مسیریابی هوشمند و کم‌هزینه بین مدل‌های مختلف زبانی برای کسب‌وکارها.
- **راهکارهای اتوماسیون سازمانی و ایجنت‌های هوشمند:** چت‌بات‌های پاسخگوی مشتریان، سیستم‌های صوتی و پردازش تصویر و داده.

#### اطلاعات و راه‌های ارتباط با دیباچین
- 🌐 **وب‌سایت رسمی:** [dibachain.ir](https://dibachain.ir)
- 📞 **شماره تماس:** [۰۲۱-۹۱۰۳۵۸۷۴](tel:+982191035874)
- ✉️ **پست الکترونیکی:** [info@dibachain.ir](mailto:info@dibachain.ir)
- 🏢 **آدرس دفتر فنی:** مشهد، میدان جانباز، برج اداری تجاری پاژ، ساختمان اداری ۱، طبقه ۱۰، واحد ۱۰۰۲
- 🕒 **ساعات کاری:** شنبه تا پنجشنبه (۹:۰۰ الی ۲۱:۰۰)

---

</div>

<div id="-english">

## 🇬🇧 English

**Diba Bridge (دیبا پل)** is an enterprise-grade, high-performance **Model Context Protocol (MCP)** server with an integrated web management dashboard. It connects leading Iranian messaging networks (**Bale**, **Eitaa**, **Rubika**, and **Soroush Plus**) to modern AI agents, developer tools, and LLM clients including **Claude Code**, **Cursor**, **Claude Desktop**, and custom autonomous workflows.

Developed by **[Dibachain](https://dibachain.ir)**, the dashboard and API strictly follow Dibachain's production design system, delivering a clean, accessible, and responsive user experience.

---

### Key Features

- ⚡ **User-account architecture (no bots):**
  - **Bale:** Personal User Account (internal Web client protocol via gRPC-Web, WebSocket, and Protobuf).
  - **Eitaa:** Personal User Account (MTProto protocol powered by the EitaaBun local bridge).
  - **Rubika:** Personal User Account (Web client protocol with RSA/AES key exchange).
  - **Soroush Plus:** Personal User Account (Telegram-compatible MTProto client protocol).
  - **Telegram:** Personal User Account (MTProto via GramJS).
  - **WhatsApp:** Personal account via QR multi-device login (Baileys).
- 💬 **Integrated Live Inbox:** Synchronize real-time conversations across personal accounts, allowing two-way responses from either the dashboard or the AI agent (`get_updates`).
- ⚡ **Automation Triggers:** A dedicated `#/triggers` page ships with 38 editable presets — auto-replies, DibaRouter AI answers, cross-messenger forwarding, MCP tool calls and outbound webhooks (n8n / Make / CRM). Each rule has a condition (provider, chat type, keywords, tool) and an action, and can be toggled, tested or deleted in one click; run history lives in `data/triggers.json`.
- 🎨 **Dibachain Design System:** Production-grade UI featuring unified messenger accordions, default account tabs, Dark/Light modes, and accessible RTL typography.
- 🧪 **Live Tool Playground:** Execute tools interactively, upload images or files via drag & drop or clipboard paste (Ctrl+V), and inspect raw JSON payloads.
- 🛡️ **Robust Security:** Authenticated Bearer tokens, granular rate limiting, brute-force protection, and secure local session credential storage (POSIX permissions 600).
- 🌍 **Network Diagnostics:** Built-in `netcheck` and automated `selftest` suites with SOCKS5 and HTTP proxy support.

---

### Quick Start

Requires **Node.js >= 22.19** or **Docker**.

#### 1. Zero Installation (Run with npx)
```bash
npx diba-mcp
```

#### 2. Global Installation
```bash
npm install -g diba-mcp
diba-mcp
```

#### 3. Run with Docker
```bash
docker run -d --name diba-bridge -p 127.0.0.1:3790:3790 \
  -e ADMIN_PASSWORD=your-secure-password \
  -v diba-bridge-data:/app/data \
  ghcr.io/yunessfa/diba-mcp:latest
```

Access the dashboard at:  
👉 **http://127.0.0.1:3790**

> **Initial Setup:** On first launch without `ADMIN_PASSWORD` in your environment, a 6-character setup code is printed to the console. Enter this code in the dashboard to set your administrative password.

---

### CLI Reference

| Command | Description |
|---|---|
| `diba-mcp` | Start full server (Web dashboard + MCP HTTP endpoint) |
| `diba-mcp stdio` | Run lightweight stdio transport for Claude Desktop |
| `diba-mcp netcheck` | Verify server network reachability to all messenger APIs |
| `diba-mcp selftest [provider] --send` | Run automated end-to-end tests (network, tokens, chat and delivery) |
| `diba-mcp token` | Print current active MCP authentication token |
| `diba-mcp reset-password` | Reset dashboard administrator password |

---

### AI Client Integration

#### 1. Claude Desktop
Add the following configuration to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "diba-bridge": {
      "command": "npx",
      "args": ["-y", "diba-mcp", "stdio"]
    }
  }
}
```

#### 2. Claude Code (CLI)
```bash
claude mcp add --transport http diba-bridge http://127.0.0.1:3790/mcp --header "Authorization: Bearer <YOUR_TOKEN>"
```

#### 3. Cursor & JSON-based MCP Clients
```json
{
  "mcpServers": {
    "diba-bridge": {
      "url": "http://127.0.0.1:3790/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_TOKEN>"
      }
    }
  }
}
```

---

### MCP Tools Inventory

| Platform | Exposed MCP Tools |
|---|---|
| **Bale (Bot)** | `bale_get_me`, `bale_send_message`, `bale_send_photo`, `bale_send_document`, `bale_get_chat`, `bale_get_updates` |
| **Bale (User Account)** | `bale_client_get_me`, `bale_client_send_message`, `bale_client_get_chat`, `bale_client_get_dialogs`, `bale_client_get_history`, `bale_client_get_updates` |
| **Eitaa (Bot)** | `eitaa_get_me`, `eitaa_send_message`, `eitaa_send_photo`, `eitaa_send_file` |
| **Eitaa (User Account)** | `eitaa_client_get_me`, `eitaa_client_send_message`, `eitaa_client_get_chat`, `eitaa_client_get_chats`, `eitaa_client_get_history`, `eitaa_client_get_updates` |
| **Rubika (Bot)** | `rubika_get_me`, `rubika_send_message`, `rubika_send_photo`, `rubika_send_file`, `rubika_send_location`, `rubika_get_chat`, `rubika_get_updates` |
| **Rubika (User Account)** | `rubika_client_get_me`, `rubika_client_send_message`, `rubika_client_send_photo`, `rubika_client_send_file`, `rubika_client_get_chat`, `rubika_client_get_chats`, `rubika_client_get_history`, `rubika_client_get_updates` + group/channel management: `rubika_client_list_groups`, `create_group`, `group_members`, `add_group_members`, `remove_group_member`, `edit_group`, `leave_group`, `delete_group`, `list_channels`, `create_channel`, `channel_members`, `add_channel_members`, `remove_channel_member`, `edit_channel`, `delete_channel` |
| **Soroush Plus (Bot)** | `soroush_get_me`, `soroush_send_message`, `soroush_send_photo`, `soroush_send_document`, `soroush_get_chat`, `soroush_get_updates` |
| **Soroush Plus (User Account)** | `soroush_client_get_me`, `soroush_client_send_message`, `soroush_client_send_photo`, `soroush_client_send_file`, `soroush_client_get_chat`, `soroush_client_get_chats`, `soroush_client_get_history`, `soroush_client_get_updates` + group/channel management: `soroush_client_list_groups`, `create_group`, `group_members`, `add_group_members`, `edit_group`, `leave_group`, `delete_group`, `list_channels`, `create_channel`, `channel_members`, `add_channel_members`, `edit_channel`, `leave_channel`, `delete_channel` |
| **General Utilities** | `list_services`, `list_chats` |

---

### About Dibachain

<p align="center">
  <a href="https://dibachain.ir" target="_blank" rel="noopener noreferrer">
    <img src="public/assets/logo-sm.png" alt="Dibachain Logo" width="84" />
  </a>
</p>

**Dibachain** is an engineering technology company specializing in **large language models (LLMs), artificial intelligence systems, enterprise business automation, and high-throughput software architecture**.

Founded in 2015 in Mashhad, Iran, Dibachain has expanded its technical reach internationally with registered operations in **Dubai, United Arab Emirates**:
- **Diba Model Family:** Open-source Persian language models and specialized evaluation datasets hosted on Hugging Face.
- **DibaRouter:** Low-latency, cost-effective smart model routing platform for enterprises.
- **AI Automation & Intelligent Agents:** Multi-channel 24/7 autonomous support bots, computer vision pipelines, and voice integration systems.

#### Contact & Company Information
- 🌐 **Official Website:** [dibachain.ir](https://dibachain.ir)
- 📞 **Phone Support:** [+98 (21) 9103-5874](tel:+982191035874)
- ✉️ **Email:** [info@dibachain.ir](mailto:info@dibachain.ir)
- 🏢 **Technical Center:** Unit 1002, 10th Floor, Tower 1, Paj Commercial Complex, Janbaz Sq., Mashhad, Iran
- 🕒 **Business Hours:** Saturday – Thursday, 09:00 – 21:00 (IRST)

---

### License

Distributed under the **MIT License**. Maintained and powered by the Dibachain engineering team.

</div>
