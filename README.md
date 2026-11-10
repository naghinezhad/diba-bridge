<p align="center">
  <a href="https://dibachain.ir" target="_blank" rel="noopener noreferrer">
    <img src="public/assets/logo-sm.png" alt="دیباچین | Dibachain" width="100" height="100" />
  </a>
</p>

<h1 align="center">dibaMCP</h1>

<p align="center">
  <b>دروازه هوشمند اتصال پیام‌رسان‌های ایرانی به هوش مصنوعی (پروتکل MCP)</b><br>
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
  <img src="https://img.shields.io/badge/version-0.4.1-brand.svg" alt="Version 0.4.1" />
</p>

---

<div id="-فارسی" dir="rtl">

## 🇮🇷 فارسی

**dibaMCP** یک سرور قدرتمند، امن و متن‌باز مبتنی بر پروتکل **Model Context Protocol (MCP)** است که امکان اتصال مستقیم و دوطرفه پیام‌رسان‌های محبوب ایرانی (**بله**، **ایتا**، **روبیکا** و **سروش‌پلاس**) را به مدل‌ها و دستیارهای هوش مصنوعی مانند **Claude Code**، **Cursor**، **Claude Desktop** و کلیه کلاینت‌های استاندارد هوش مصنوعی فراهم می‌کند.

این پروژه همراه با یک **داشبورد فارسی مدرن** و طراحی‌شده بر اساس **سیستم طراحی رسمی دیباچین** ارائه می‌شود تا مدیریت حساب‌ها، ربات‌ها، مشاهده پیام‌های دریافتی، تست خطوط ارتباطی و آزمایش ابزارها در کمترین زمان ممکن انجام پذیرد.

---

### قابلیت‌های کلیدی

- 🤖 **پشتیبانی دوگانه (ربات رسمی + حساب کاربری):**
  - **بله (Bale):** ربات رسمی Bot API + کلاینت حساب کاربری (پروتکل وب/WebSocket)
  - **ایتا (Eitaa):** ربات رسمی ایتایار + کلاینت حساب کاربری (پروتکل MTProto با پل EitaaBun)
  - **روبیکا (Rubika):** ربات رسمی + کلاینت حساب کاربری (پروتکل کلاینت اختصاصی وب)
  - **سروش‌پلاس (Soroush+):** ربات رسمی Bot API + کلاینت حساب کاربری (پروتکل MTProto)
- 📬 **صندوق پیام‌های دریافتی یکپارچه (Shared Inbox):** دریافت پیام‌ها به همراه ارسال پاسخ مستقیم از داشبورد و از طریق ابزار `get_updates` مدل هوش مصنوعی.
- 🎨 **داشبورد فارسی با سیستم طراحی دیباچین:** رابط کاربری واکنش‌گرا، پشتیبانی از حالت تیره (Dark Mode)، پالت رنگ استاندارد، آکاردئون یکپارچه پیام‌رسان‌ها با اولویت حساب کاربری.
- ⚡ **آزمایشگاه زنده ابزارها (Playground):** فراخوانی آزمایشی ابزارها، ارسال تصویر و فایل با Drag & Drop یا Paste (Ctrl+V) و مشاهده پاسخ خام JSON.
- 🔒 **امنیت در سطح سازمانی:** اعتبارسنجی با توکن‌های Bearer، حفاظت در برابر Brute-force، جداسازی دسترسی‌ها و ذخیره نشست‌ها به صورت رمزنگاری‌شده محلی.
- 🌐 **تست هوشمند شبکه (NetCheck & SelfTest):** امکان بررسی اتصال از داخل یا خارج از ایران به همراه پشتیبانی از SOCKS5/HTTP Proxy.

---

### نصب و راه‌اندازی سریع

پیش‌نیاز: **Node.js نسخه ۲۲.۱۹ یا بالاتر** (یا استفاده از **Docker**).

#### روش ۱: اجرای فوری بدون نیاز به نصب (پیشنهادی)
```bash
npx diba-mcp
```

#### روش ۲: نصب سراسری با npm
```bash
npm install -g diba-mcp
diba-mcp
```

#### روش ۳: اجرا با داکر (Docker)
```bash
docker run -d --name diba-mcp -p 127.0.0.1:3790:3790 \
  -e ADMIN_PASSWORD=your-secure-password \
  -v diba-mcp-data:/app/data \
  ghcr.io/yunessfa/diba-mcp:latest
```

پس از اجرا، داشبورد در آدرس زیر در دسترس خواهد بود:
👉 **http://127.0.0.1:3790**

> **نکته راه‌اندازی اولیه:** در اولین اجرا در صورت مشخص نکردن `ADMIN_PASSWORD` در فایل محیطی، یک کد راه‌اندازی ۶ حرفی در ترمینال چاپ می‌شود. با وارد کردن آن کد در داشبورد، رمز عبور دلخواه مدیریت را تعیین کنید.

---

### دستورات خط فرمان (CLI)

| دستور | توضیحات |
|---|---|
| `diba-mcp` | اجرای سرور ترکیبی (داشبورد وب + اندپوینت MCP) |
| `diba-mcp stdio` | اجرای سبک با ورودی/خروجی استاندارد برای Claude Desktop |
| `diba-mcp netcheck` | بررسی سلامت دسترسی سرور به سرورهای بله، ایتا، روبیکا و سروش |
| `diba-mcp selftest [provider] --send` | تست جامع گام‌به‌گام شبکه، توکن و ارسال پیام آزمایشی |
| `diba-mcp token` | دریافت و چاپ توکن اتصال MCP |
| `diba-mcp reset-password` | بازنشانی رمز عبور داشبورد |

---

### اتصال به کلاینت‌های هوش مصنوعی

#### ۱. Claude Desktop
فایل پیکربندی Claude Desktop (`claude_desktop_config.json`) را باز کرده و خطوط زیر را اضافه کنید:

```json
{
  "mcpServers": {
    "diba-mcp": {
      "command": "npx",
      "args": ["-y", "diba-mcp", "stdio"]
    }
  }
}
```

#### ۲. Claude Code (CLI)
```bash
claude mcp add --transport http diba-mcp http://127.0.0.1:3790/mcp --header "Authorization: Bearer <YOUR_TOKEN>"
```

#### ۳. Cursor و کلاینت‌های مبتنی بر HTTP
```json
{
  "mcpServers": {
    "diba-mcp": {
      "url": "http://127.0.0.1:3790/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_TOKEN>"
      }
    }
  }
}
```

---

### فهرست ابزارهای MCP (Tools)

| پلتفرم | ابزارهای در اختیار مدل |
|---|---|
| **بله (ربات)** | `bale_get_me`, `bale_send_message`, `bale_send_photo`, `bale_send_document`, `bale_get_chat`, `bale_get_updates` |
| **بله (حساب کاربری)** | `bale_client_get_me`, `bale_client_send_message`, `bale_client_get_chat`, `bale_client_get_dialogs`, `bale_client_get_history`, `bale_client_get_updates` |
| **ایتا (ربات)** | `eitaa_get_me`, `eitaa_send_message`, `eitaa_send_photo`, `eitaa_send_file` |
| **ایتا (حساب کاربری)** | `eitaa_client_get_me`, `eitaa_client_send_message`, `eitaa_client_get_chat`, `eitaa_client_get_chats`, `eitaa_client_get_history`, `eitaa_client_get_updates` |
| **روبیکا (ربات)** | `rubika_get_me`, `rubika_send_message`, `rubika_send_photo`, `rubika_send_file`, `rubika_send_location`, `rubika_get_chat`, `rubika_get_updates` |
| **روبیکا (حساب کاربری)** | `rubika_client_get_me`, `rubika_client_send_message`, `rubika_client_send_photo`, `rubika_client_send_file`, `rubika_client_get_chat`, `rubika_client_get_chats`, `rubika_client_get_history`, `rubika_client_get_updates` |
| **سروش‌پلاس (ربات)** | `soroush_get_me`, `soroush_send_message`, `soroush_send_photo`, `soroush_send_document`, `soroush_get_chat`, `soroush_get_updates` |
| **سروش‌پلاس (حساب کاربری)** | `soroush_client_get_me`, `soroush_client_send_message`, `soroush_client_send_photo`, `soroush_client_send_file`, `soroush_client_get_chat`, `soroush_client_get_chats`, `soroush_client_get_history`, `soroush_client_get_updates` |
| **مدیریت عمومی** | `list_services`, `list_chats` |

---

### درباره دیباچین (Dibachain)

<p align="center">
  <img src="public/assets/logo-sm.png" alt="لوگوی دیباچین" width="80" />
</p>

**دیباچین (Dibachain)** یک شرکت پیشرو در حوزه **مهندسی نرم‌افزار، هوش مصنوعی (AI)، توسعه مدل‌های زبانی بومی (LLM)، سیستم‌های خودکارساز سازمانی و زیرساخت‌های مقیاس‌پذیر** است.

فعالیت دیباچین از سال **۱۳۹۴** در مشهد آغاز شده و امروزه با گسترش بازارهای بین‌المللی و ثبت دفتر رسمی در **دبی (امارات متحده عربی)**، راهکارهای فنی در کلاس جهانی ارائه می‌دهد:
- **خانواده مدل‌های دیبا (Diba Models):** مدل‌های زبانی متن‌باز و تخصصی برای زبان فارسی بر بستر Hugging Face.
- **روتر هوشمند دیبا (DibaRouter):** زیرساخت هدایت بهینه، کم‌هزینه و پرسرعت درخواست‌های هوش مصنوعی.
- **توسعه ایجنت‌ها و سیستم‌های اتوماسیون سازمانی:** چت‌بات‌های پاسخگوی ۲۴ ساعته، خطوط تحلیل داده و پردازش صوت و تصویر.

#### راه‌های ارتباطی با دیباچین
- 🌐 **وب‌سایت رسمی:** [dibachain.ir](https://dibachain.ir)
- 📞 **شماره تماس پشتیبانی و مشاوره:** [۰۲۱-۹۱۰۳۵۸۷۴](tel:+982191035874)
- ✉️ **ایمیل ارتباطی:** [info@dibachain.ir](mailto:info@dibachain.ir)
- 🏢 **آدرس دفتر فنی:** مشهد، میدان جانباز، برج اداری تجاری پاژ، ساختمان اداری ۱، طبقه ۱۰، واحد ۱۰۰۲
- 🕒 **ساعات کاری:** شنبه تا پنجشنبه، از ساعت ۹:۰۰ الی ۲۱:۰۰

---

</div>

<div id="-english">

## 🇬🇧 English

**dibaMCP** is a modern, high-performance, and secure **Model Context Protocol (MCP)** server with an integrated Persian web management dashboard. It connects leading Iranian messaging networks (**Bale**, **Eitaa**, **Rubika**, and **Soroush Plus**) to cutting-edge AI coding agents, assistants, and LLM clients including **Claude Code**, **Cursor**, **Claude Desktop**, and custom autonomous workflows.

Developed by **[Dibachain](https://dibachain.ir)**, the dashboard and API are built following Dibachain's production design system, ensuring an accessible, responsive, and robust developer experience.

---

### Highlights

- ⚡ **Dual Provider Support (Official Bot API & User Client Accounts):**
  - **Bale:** Official Bot API + User Web client protocol (gRPC-Web / WebSocket / Protobuf).
  - **Eitaa:** Official Eitaayar API + User MTProto client via EitaaBun bridge.
  - **Rubika:** Official Bot API + User Web client protocol (RSA/AES exchange).
  - **Soroush Plus:** Official Bot API + User MTProto client protocol.
- 💬 **Shared Live Inbox:** Real-time synchronization of inbound messages with direct reply capabilities from both the dashboard and the AI model (`get_updates`).
- 🎨 **Dibachain Design System:** Clean, accessible UI with Dark/Light themes, logical RTL layout, and responsive accordions featuring default Client tabs.
- 🧪 **Interactive Playground:** Direct invocation of tools with file/image drag & drop, clipboard paste support, and real-time response inspection.
- 🛡️ **Enterprise-Grade Security:** Bearer token authentication, rate limiting, and encrypted local storage.
- 🌍 **Connectivity Diagnostics:** Built-in `netcheck` and step-by-step `selftest` tools with SOCKS5/HTTP proxy support.

---

### Quick Start

Requires **Node.js >= 22.19** or **Docker**.

#### 1. Instant Run via npx (Zero Installation)
```bash
npx diba-mcp
```

#### 2. Global Installation via npm
```bash
npm install -g diba-mcp
diba-mcp
```

#### 3. Run with Docker
```bash
docker run -d --name diba-mcp -p 127.0.0.1:3790:3790 \
  -e ADMIN_PASSWORD=your-secure-password \
  -v diba-mcp-data:/app/data \
  ghcr.io/yunessfa/diba-mcp:latest
```

Open your browser at:  
👉 **http://127.0.0.1:3790**

---

### CLI Reference

| Command | Description |
|---|---|
| `diba-mcp` | Start full server (Web dashboard + MCP endpoint) |
| `diba-mcp stdio` | Run lightweight stdio transport for Claude Desktop |
| `diba-mcp netcheck` | Test connectivity from current host to messenger APIs |
| `diba-mcp selftest [provider] --send` | Comprehensive step-by-step test of credentials, network & delivery |
| `diba-mcp token` | Display active MCP authorization token |
| `diba-mcp reset-password` | Reset dashboard administrator password |

---

### AI Client Integration

#### Claude Desktop
Add to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "diba-mcp": {
      "command": "npx",
      "args": ["-y", "diba-mcp", "stdio"]
    }
  }
}
```

#### Claude Code (CLI)
```bash
claude mcp add --transport http diba-mcp http://127.0.0.1:3790/mcp --header "Authorization: Bearer <YOUR_TOKEN>"
```

#### Cursor & Standard HTTP Clients
```json
{
  "mcpServers": {
    "diba-mcp": {
      "url": "http://127.0.0.1:3790/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_TOKEN>"
      }
    }
  }
}
```

---

### About Dibachain

<p align="center">
  <a href="https://dibachain.ir" target="_blank" rel="noopener noreferrer">
    <img src="public/assets/logo-sm.png" alt="Dibachain Logo" width="80" />
  </a>
</p>

**Dibachain** is an AI and software engineering company specializing in **large language models (LLMs), autonomous AI agents, enterprise automation, and high-concurrency infrastructure**. Founded in 2015 with offices in Mashhad, Iran and Dubai, UAE, Dibachain builds technical products that empower modern businesses:
- **Diba Model Family:** Open-weights Persian LLMs and benchmarks on Hugging Face.
- **DibaRouter:** Intelligent, low-latency AI inference routing layer.
- **Enterprise Automation:** 24/7 intelligent conversational agents, document parsing, and business process automation.

#### Contact & Connect
- 🌐 **Official Website:** [dibachain.ir](https://dibachain.ir)
- 📞 **Phone:** [+98 (21) 9103-5874](tel:+982191035874)
- ✉️ **Email:** [info@dibachain.ir](mailto:info@dibachain.ir)
- 🏢 **R&D Center:** Unit 1002, 10th Floor, Tower 1, Paj Business Complex, Janbaz Sq., Mashhad, Iran
- 🕒 **Hours:** Saturday – Thursday, 09:00 – 21:00 (IRST)

---

### License

Distributed under the **MIT License**. Created by Yuness and powered by the Dibachain engineering team.

</div>
