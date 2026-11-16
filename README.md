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
  <a href="#-english">English</a> •
  <a href="https://dibachain-company.github.io/diba-bridge/">Landing page</a>
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
- 🌐 **اتصال به وردپرس:** مدیریت کامل سایت وردپرسی از طریق MCP — نوشته‌ها و برگه‌ها، رسانه، دیدگاه‌ها، کاربران، افزونه‌ها و ووکامرس — با رمز برنامه (Application Password) یا افزونه‌ی همراه `wordpress-plugin/diba-bridge-connector`. راهنما: [docs/WORDPRESS.md](docs/WORDPRESS.md)
- 🏦 **سرویس‌های بانکی:** تب جدای «سرویس‌های بانکی» در داشبورد با زیرمنوی **ایرانی / خارجی**. فعلاً **بلوبانک** (ایرانی) با توکن نشست اپلیکیشن وصل می‌شود و موجودی، کارت‌ها و تراکنش‌ها را می‌خواند؛ هنوز سرویس بانکی خارجی اضافه نشده است. راهنما: [docs/blubank-testing.md](docs/blubank-testing.md)
- 📬 **صندوق پیام‌های دریافتی یکپارچه (Shared Inbox):** مشاهده پیام‌های دریافتی، تفکیک پیام‌های ورودی و خروجی، امکان پاسخ‌گویی مستقیم و استفاده هوش مصنوعی از ابزار `get_updates`.
- ⚡ **تریگرها و اتوماسیون (Automation Triggers):** صفحه‌ی `#/triggers` با ۳۸ قانون آماده‌ی ویرایش‌پذیر؛ پاسخ خودکار، پاسخ هوشمند دیبا روتر، فوروارد بین پیام‌رسان‌ها، اجرای ابزار MCP و ارسال به Webhook (n8n / Make / CRM). هر تریگر شرط (پیام‌رسان، نوع چت، کلمه‌ی کلیدی، ابزار) و اقدام دارد و با یک کلیک روشن، تست یا خاموش می‌شود. تاریخچه‌ی اجرا در `data/triggers.json` ذخیره می‌شود.
- 🎨 **داشبورد اختصاصی با زبان طراحی دیباچین:** رابط کاربری مدرن، یک اتصال «حساب کاربری» برای هر پیام‌رسان در آکاردئون اختصاصی، تم تاریک/روشن و واکنش‌گرایی کامل.
- ⏻ **روشن/خاموش کردن حساب با یک کلید:** هر حساب کاربری یک کلید دارد (هم روی کارت بسته و هم داخل پنل)؛ با خاموش کردن آن ابزارهای آن حساب از دسترس مدل خارج و دریافت پیام متوقف می‌شود، اما نشست ذخیره می‌ماند و با روشن کردن دوباره بدون ورود مجدد برمی‌گردد.
- 🧪 **محیط آزمایش زنده (Playground):** تست دستی ابزارها، ارسال متن، تصویر و فایل با قابلیت Drag & Drop یا Paste (Ctrl+V) و مشاهده پاسخ JSON سرور.
- 🧠 **حافظه‌ی ماندگار دستیار:** گفتگوها، اطلاعات پایدار کاربر و مخاطبان شناخته‌شده در `data/assistant.json` ذخیره می‌شوند؛ ابزارهای `memory_search` و `memory_remember` برای MCP و همگام‌سازی تاریخچه بین دستگاه‌ها.
- ✉️ **ارسال هوشمند به نام مخاطب:** با گفتن «به [نام] پیام بده»، دستیار نزدیک‌ترین مخاطب/چت را از بین چت‌ها، مخاطبین و حافظه پیدا می‌کند، متن پیشنهادی را می‌سازد و **پس از تأیید شما** ارسال می‌کند. ارسال به گروه/کانال، مخاطب مبهم، متن تکراری/اسپم و ارسال پرتکرار مسدود می‌شود و هیچ chat_id در گفتگو نمایش داده نمی‌شود.
- 🔒 **امنیت در سطح سازمانی:** استفاده از توکن‌های Bearer، محدودکننده نرخ درخواست (Rate Limiting) و ذخیره‌سازی نشست‌ها روی سرور محلی با مجوز امنیتی ۶۰۰.
- 🌐 **تست خودکار شبکه و سلامت اتصال (NetCheck & SelfTest):** بررسی وضعیت دسترسی سرور به APIهای داخلی و خارجی با پشتیبانی از SOCKS5 و HTTP Proxy.

> **تغییر مهم:** اتصال با ربات رسمی (Bot API) برای بله، ایتا، روبیکا، سروش‌پلاس و تلگرام به‌طور کامل حذف شده است. هر پیام‌رسان فقط یک اتصال «حساب کاربری» دارد و توکن‌های رباتی که قبلاً ذخیره شده بودند دیگر بارگذاری نمی‌شوند.

---

### 🗺️ نقشه‌راه محصول

این بخش نشان می‌دهد الآن کجای مسیر هستیم و قدم‌های بعدی چیست. تمرکز نقشه‌راه روی سه لایه است: **ارتباط پایدار**، **داده‌های مالی** و **تعامل هوشمند با مشتری**.

| # | مسیر | وضعیت | خروجی نهایی |
|---|---|---|---|
| ۱ | **اتصال به پیام‌رسان‌ها** | ✅ انجام شده | اتصال به واتس‌اپ، تلگرام، بله، روبیکا، سروش‌پلاس و ایتا؛ صندوق ورودی یکپارچه، ارسال/دریافت پیام، تریگرها و ابزارهای MCP |
| ۲ | **اتصال به پلتفرم‌های بانکی و مدیریت موجودی حساب‌ها** | 🚧 در حال انجام | اتصال امن به حساب‌های بانکی/مالی، نمای یکپارچه‌ی موجودی و تراکنش‌ها، هشدار و مغایرت‌گیری |
| ۳ | **اتصال پیج اینستاگرام و دایرکت هوشمند** | 🚧 در حال انجام | اتصال پیج حرفه‌ای، دریافت دایرکت و کامنت، پاسخ هوشمند با تأیید انسان و ارجاع به اپراتور |

#### وضعیت فعلی

- **پیام‌رسان‌ها:** بالغ و قابل استفاده؛ حساب‌های کاربری، دریافت زنده، ارسال، تریگر و ابزارهای MCP فعال‌اند.
- **اینستاگرام:** ورود امن با پنجره‌ی مرورگر، عبور از کد واتساپ/۲FA و بازیابی نشست انجام شده است. پروفایل و مدیای حساب هم از طریق ابزارهای MCP خوانده می‌شود. **دایرکت هوشمند هنوز فعال نیست.**
- **بانکداری:** تب «سرویس‌های بانکی» اضافه شده و **بلوبانک** به‌صورت آزمایشی با توکن نشست اپلیکیشن وصل می‌شود (موجودی، کارت‌ها، تراکنش‌ها). این اتصال از API منتشرنشده‌ی اپلیکیشن است، ورود خودکار ندارد و پاسخ‌ها بدون اسکیمای رسمی خوانده می‌شوند. اتصال به APIهای رسمی بانکی و بانک‌های خارجی هنوز انجام نشده است.

#### قدم‌های بعدی

1. **تثبیت لایه‌ی پیام‌رسان:** پایش خطا، بازپخش رویدادها و تست‌های پایدار برای اتصال‌های طولانی‌مدت.
2. **اتصال پیج اینستاگرام:** تکمیل دسترسی‌های پیج، دریافت دایرکت/کامنت و اتصال آن به موتور تریگر.
3. **دایرکت هوشمند:** تشخیص نیت، پاسخ مبتنی بر دانش کسب‌وکار، تأیید انسانی، ثبت سرنخ و ارجاع به اپراتور.
4. **بانکداری فقط‌خواندنی:** اتصال به APIهای رسمی، همگام‌سازی موجودی و تراکنش، نمای چندحسابی و هشدار تغییر موجودی.
5. **عملیات بانکی با تأیید:** انتقال/دستور پرداخت فقط در مرحله‌ی بعد، با تأیید صریح و لاگ کامل.

> **اصل مسیر:** هر قابلیت مالی یا ارسال پیام ابتدا در حالت امن و قابل‌بازبینی عرضه می‌شود؛ اقدام‌های حساس بدون تأیید انسانی انجام نمی‌شوند.

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
 ساخت و اجرا از سورس همین مخزن:

```bash
docker compose up -d --build
```

برای استفاده از داده‌های همین پوشه (`./data`) در کانتینر:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

سپس داشبورد را در مرورگر باز کنید:  
👉 **http://127.0.0.1:3790**

> **کد راه‌اندازی اولیه:** در اجرای اول (در صورت عدم تعیین `ADMIN_PASSWORD`)، یک کد راه‌اندازی شش‌حرفی در کنسول نمایش داده می‌شود که با استفاده از آن می‌توانید رمز عبور داشبورد را ثبت نمایید.  
> برای رد شدن کامل از این مرحله، `ADMIN_PASSWORD` را در `.env` تنظیم کنید.

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
      "args": ["-y", "diba-mcp", "stdio", "--data", "/absolute/path/to/diba-mcp/data"]
    }
  }
}
```
> مسیر `--data` باید همان پوشه‌ی داده‌ی داشبورد باشد (پیش‌فرض `./data`). دستور آماده با مسیر درست را از تب **اتصال به هوش مصنوعی** کپی کنید. حالت HTTP و stdio را هم‌زمان برای یک حساب اجرا نکنید.

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

### دستیار سطح‌بالای MCP (پیش‌فرض)

به‌صورت پیش‌فرض MCP فقط **یک ابزار** به کلاینت می‌دهد: `diba_agent`

این ابزار یک جمله‌ی ساده‌ی فارسی یا انگلیسی را می‌فهمد و خودش تمام کار را انجام می‌دهد:

1. **سرویس را از خود جمله** تشخیص می‌دهد («داخل تلگرام»، «on WhatsApp»، …)؛ اگر سرویس مشخص نشده باشد، همه‌ی سرویس‌های آماده را با هم جستجو می‌کند.
2. **اول چت‌های اخیر**، بعد **مخاطبین/دفترچه‌ی سرویس** و در آخر **حافظه‌ی دستیار** را می‌گردد.
3. نام‌ها را **آوایی** تطبیق می‌دهد: «عماد» = «Emad» = «Emmad»، «جان» = «John»، «علی» = «Ali». (بدون مدل و بدون شبکه)
4. **چت‌های بی‌نام** (فقط شناسه یا JID) را با `get_chat` همان سرویس نام‌دار می‌کند؛ اگر نام نبود، `@username` و در آخر برچسب کوتاه‌شده نمایش داده می‌شود. این نام‌ها در جستجو و ارسال هم قابل استفاده‌اند.
5. اگر مخاطب یکتا و متن صریح بود، **همان‌جا ارسال می‌کند**؛ اگر چند گزینه بود فهرست کوتاه **بدون chat_id** می‌دهد؛ اگر متن باید نوشته شود، پیش‌نویس + تأیید.
6. گفتگو را **موقت** (۳۰ دقیقه) نگه می‌دارد: «بله»، «۱»، «لغو» و «متن را عوض کن» در همان رشته کار می‌کنند (`conversation_id`).
7. فهرست چت‌ها، خواندن پیام‌ها، وضعیت سرویس‌ها، توانایی‌ها و **اجرای هر ابزار سطح‌پایین** (`tool` + `args`) هم از همین ابزار انجام می‌شود.

ورودی‌ها:

```json
{
  "request": "به عماد داخل تلگرام پیام بده که فردا جلسه داریم",
  "conversation_id": "mcp",
  "provider": "telegram_client",
  "recipient": "عماد",
  "selection_token": "...",
  "text": "سلام عماد جان، فردا جلسه داریم.",
  "confirm": true,
  "dry_run": false,
  "tool": "telegram_client_get_history",
  "args": { "chat_id": "...", "limit": 10 }
}
```

- همه‌ی فیلدها جز `request` اختیاری‌اند؛ برای یک پیام ساده فقط `request` کافی است.
- `provider` وقتی پر می‌شود که بخواهید جستجو را به یک سرویس محدود کنید.
- `selection_token` توکن مبهم انتخاب مخاطب است، نه chat_id.
- `confirm: true` پیش‌نویس در انتظار یا اجرای ابزار نوشتنی را تأیید می‌کند.
- `dry_run: true` فقط نشان می‌دهد چه چیزی ارسال می‌شد (برای آزمایش).
- `conversation_id` رشته‌ی گفتگو را نگه می‌دارد (پیش‌فرض `mcp`).
- هیچ chat_id به مدل داده نمی‌شود.

پاسخ‌ها:

| `status` | معنی |
|---|---|
| `done` | کار انجام شد (ارسال/یافتن/فهرست/خواندن) |
| `need_person` | چند گزینه؛ با `selection_token` یا شماره انتخاب کن |
| `need_confirmation` | پیش‌نویس آماده است؛ با «بله» یا `confirm` تأیید کن |
| `need_info` | نام یا متن پیام کم است |
| `need_provider` | برای این کار سرویس مشخصی لازم است |
| `error` | توضیح خطا در `message` |

حالت‌های MCP با متغیر `MCP_MODE`:

| مقدار | رفتار |
|---|---|
| `agent` (پیش‌فرض) | فقط `diba_agent` |
| `tools` | همان ابزارهای سطح‌پایین قبلی |
| `both` | هم دستیار سطح‌بالا و هم ابزارهای سطح‌پایین |

مثال:

```bash
MCP_MODE=tools npx diba-mcp
```

> در حالت `agent`، لیست ابزارهای MCP فقط `diba_agent` است و کلاینت هوش مصنوعی باید پیام‌های `need_person` / `need_confirmation` / `need_info` را به کاربر نشان بدهد و پاسخ را با همان فیلدها برگرداند.

---

### ابزارهای سطح‌پایین (فقط در `MCP_MODE=tools` یا `both`)

| پیام‌رسان | ابزارهای در دسترس مدل هوش مصنوعی |
|---|---|
| **بله (حساب کاربری)** | `bale_client_get_me`, `bale_client_send_message`, `bale_client_get_chat`, `bale_client_get_dialogs`, `bale_client_get_history`, `bale_client_get_updates` |
| **ایتا (حساب کاربری)** | `eitaa_client_get_me`, `eitaa_client_send_message`, `eitaa_client_get_chat`, `eitaa_client_get_chats`, `eitaa_client_get_history`, `eitaa_client_get_updates` |
| **روبیکا (حساب کاربری)** | `rubika_client_get_me`, `rubika_client_send_message`, `rubika_client_send_photo`, `rubika_client_send_file`, `rubika_client_get_chat`, `rubika_client_get_chats`, `rubika_client_get_history`, `rubika_client_get_updates` + مدیریت گروه/کانال: `list_groups`, `create_group`, `group_members`, `add_group_members`, `remove_group_member`, `edit_group`, `leave_group`, `delete_group`, `list_channels`, `create_channel`, `channel_members`, `add_channel_members`, `remove_channel_member`, `edit_channel`, `delete_channel` |
| **سروش‌پلاس (حساب کاربری)** | `soroush_client_get_me`, `soroush_client_send_message`, `soroush_client_send_photo`, `soroush_client_send_file`, `soroush_client_get_chat`, `soroush_client_get_chats`, `soroush_client_get_history`, `soroush_client_get_updates` + مدیریت گروه/کانال: `list_groups`, `create_group`, `group_members`, `add_group_members`, `edit_group`, `leave_group`, `delete_group`, `list_channels`, `create_channel`, `channel_members`, `add_channel_members`, `edit_channel`, `leave_channel`, `delete_channel` |
| **ابزارهای عمومی** | `list_services`, `list_chats` |

---

### اتصال به وردپرس

دیباپل سایت وردپرسی شما را هم به دستیارهای هوش مصنوعی وصل می‌کند؛ با **۶۸ ابزار** برای مدیریت کامل سایت.

| حوزه | کارهایی که می‌شود انجام داد |
| :-- | :-- |
| محتوا | فهرست، ساخت، ویرایش، زمان‌بندی و حذف نوشته، برگه و هر نوع محتوای سفارشی؛ بازبینی‌ها و جست‌وجو |
| دسته‌بندی‌ها | مدیریت دسته، برچسب و هر طبقه‌بندی دیگر |
| رسانه | بارگذاری از لینک یا Base64، ویرایش متن جایگزین و عنوان، حذف |
| دیدگاه‌ها | فهرست، پاسخ، تأیید، انتظار، هرزنامه و حذف |
| کاربران | فهرست، ساخت، ویرایش و حذف با انتقال محتوا |
| افزونه‌ها و پوسته‌ها | نصب از مخزن وردپرس، فعال و غیرفعال‌سازی، حذف، تعویض پوسته |
| فهرست‌ها و تنظیمات | آیتم‌های منو، تنظیمات سایت و گزینه‌های مجاز |
| ووکامرس | محصولات، سفارش‌ها، مشتریان، کدهای تخفیف و گزارش فروش |
| ابزارها | پاک‌سازی کش، جایگزینی متن (پیش‌فرض آزمایشی)، ویرایش گروهی، کرون، سئو (Yoast و Rank Math)، حالت تعمیر، آمار و گزارش فعالیت |

**دو روش اتصال:**

1. **رمز برنامه (Application Password):** بدون نصب چیزی روی سایت؛ برای ابزارهای REST هسته‌ی وردپرس کافی است.
2. **افزونه‌ی همراه Diba Bridge Connector:** پوشه‌ی [`wordpress-plugin/diba-bridge-connector`](wordpress-plugin/diba-bridge-connector) را فشرده و در وردپرس نصب کنید، در تنظیمات افزونه یک کلید بسازید و آن را در داشبورد دیباپل وارد کنید. ابزارهای ووکامرس، سئو، کش و گزینه‌ها به این افزونه نیاز دارند.

افزونه کلید را فقط به‌صورت هش نگه می‌دارد، هر درخواست را با دسترسی‌های یک کاربر وردپرس اجرا می‌کند و برای هر حوزه کلید روشن/خاموش جدا، حالت فقط‌خواندنی، فهرست IP مجاز، محدودیت نرخ و گزارش فعالیت دارد.

```dotenv
WORDPRESS_SITE_URL=https://example.com
WORDPRESS_USERNAME=admin
WORDPRESS_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
WORDPRESS_CONNECTOR_KEY=dbk_...
```

راهنمای کامل، فهرست همه‌ی ابزارها و نکات امنیتی: [docs/WORDPRESS.md](docs/WORDPRESS.md)

---

### مشارکت در پروژه

دیباپل متن‌باز است و از مشارکت شما استقبال می‌کنیم. پیش از ارسال Pull Request، [راهنمای مشارکت](CONTRIBUTING.md) و [منشور رفتاری](CODE_OF_CONDUCT.md) را بخوانید. مشکلات امنیتی را طبق [SECURITY.md](SECURITY.md) گزارش دهید.

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
- 🌐 **WordPress integration:** Manage a WordPress site over MCP — posts and pages, media, comments, users, plugins and WooCommerce — using an Application Password or the companion plugin in `wordpress-plugin/diba-bridge-connector`. Guide: [docs/WORDPRESS.md](docs/WORDPRESS.md)
  - **WhatsApp:** Personal account via QR multi-device login (Baileys).
- 🏦 **Banking services:** a dedicated “Banking services” tab in the dashboard with an **Iranian / International** submenu. **BluBank** (Iranian) is the first provider: it connects with an app session token and reads balances, cards and transactions. No international banking provider has been added yet. Guide: [docs/blubank-testing.md](docs/blubank-testing.md)
- 💬 **Integrated Live Inbox:** Synchronize real-time conversations across personal accounts, allowing two-way responses from either the dashboard or the AI agent (`get_updates`).
- ⚡ **Automation Triggers:** A dedicated `#/triggers` page ships with 38 editable presets — auto-replies, DibaRouter AI answers, cross-messenger forwarding, MCP tool calls and outbound webhooks (n8n / Make / CRM). Each rule has a condition (provider, chat type, keywords, tool) and an action, and can be toggled, tested or deleted in one click; run history lives in `data/triggers.json`.
- 🎨 **Dibachain Design System:** Production-grade UI with one account connection per messenger, Dark/Light modes, and accessible RTL typography.
- ⏻ **One-switch account control:** every account has a toggle on the collapsed card and inside its panel. Turning it off removes that account's tools from the model and stops message receiving, while the saved session stays; turning it back on restores the account without logging in again.
- 🧪 **Live Tool Playground:** Execute tools interactively, upload images or files via drag & drop or clipboard paste (Ctrl+V), and inspect raw JSON payloads.
- 🧠 **Persistent assistant memory:** conversations, durable user facts and known recipients are stored in `data/assistant.json`; `memory_search` and `memory_remember` are exposed over MCP, and history syncs across devices.
- ✉️ **Safe name-based sending:** “message [name]” makes the assistant surface the closest matching chats/contacts (fuzzy/partial names and recent chats included), compose a natural message, and send it **only after your confirmation**. Chat IDs are never shown in the conversation; groups/channels, duplicate/spammy text and high-frequency sends are blocked to reduce ban risk.
- 🛡️ **Robust Security:** Authenticated Bearer tokens, granular rate limiting, brute-force protection, and secure local session credential storage (POSIX permissions 600).
- 🌍 **Network Diagnostics:** Built-in `netcheck` and automated `selftest` suites with SOCKS5 and HTTP proxy support.

> **Breaking change:** official Bot API connections for Bale, Eitaa, Rubika, Soroush Plus and Telegram have been removed entirely. Each messenger now has a single user-account connection, and previously saved bot tokens are no longer loaded.

---

### 🗺️ Product Roadmap

This roadmap shows where the product stands today and where it is heading. The work is organized around three layers: **reliable connectivity**, **financial data**, and **intelligent customer conversations**.

| # | Track | Status | Outcome |
|---|---|---|---|
| 1 | **Messaging platform integrations** | ✅ Done | WhatsApp, Telegram, Bale, Rubika, Soroush+, and Eitaa connected; unified inbox, send/receive, triggers, and MCP tools |
| 2 | **Banking platform integrations & account balance management** | 🚧 In progress | Secure connections to banking/financial accounts, a unified balance and transaction view, alerts, and reconciliation |
| 3 | **Instagram page connection & smart Direct** | 🚧 In progress | Professional page connection, DM and comment ingestion, AI-assisted replies with human approval, and operator handoff |

#### Where we are

- **Messaging:** mature and usable. User-account connections, live ingestion, sending, triggers, and MCP tools are in place.
- **Instagram:** secure sign-in through a real browser window, WhatsApp/2FA code handling, and session restoration are complete. Profile and media data are available through MCP tools. **Smart Direct is not live yet.**
- **Banking:** the “Banking services” tab is in place and **BluBank** connects experimentally with an app session token (balances, cards, transactions). It uses the app's unpublished API, has no automated sign-in, and decodes responses without an official schema. Official banking APIs and international banks are not connected yet.

#### What comes next

1. **Harden the messaging layer:** error monitoring, event replay, and long-running connection tests.
2. **Connect Instagram pages:** complete page permissions, ingest DMs/comments, and route them into the trigger engine.
3. **Smart Direct:** intent detection, business-knowledge replies, human approval, lead capture, and operator handoff.
4. **Read-only banking:** official API connections, balance and transaction sync, a multi-account view, and balance-change alerts.
5. **Approval-gated banking actions:** transfers and payment instructions only in a later phase, with explicit confirmation and a full audit trail.

> **Roadmap principle:** every financial or outbound-messaging capability ships in a safe, observable mode first; sensitive actions never run without human approval.

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
Build and run from this repository:

```bash
docker compose up -d --build
```

To use this checkout's `./data` directory inside the container:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

Access the dashboard at:  
👉 **http://127.0.0.1:3790**

> **Initial Setup:** On first launch without `ADMIN_PASSWORD` in your environment, a 6-character setup code is printed to the console. Enter this code in the dashboard to set your administrative password.  
> To skip this step entirely, set `ADMIN_PASSWORD` in `.env`.

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
      "args": ["-y", "diba-mcp", "stdio", "--data", "/absolute/path/to/diba-mcp/data"]
    }
  }
}
```
> `--data` must point to the dashboard's data directory (default `./data`). Copy the ready-made command with the correct path from the **Connect** tab. Do not run HTTP and stdio for the same account at the same time.

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
| **Bale (User Account)** | `bale_client_get_me`, `bale_client_send_message`, `bale_client_get_chat`, `bale_client_get_dialogs`, `bale_client_get_history`, `bale_client_get_updates` |
| **Eitaa (User Account)** | `eitaa_client_get_me`, `eitaa_client_send_message`, `eitaa_client_get_chat`, `eitaa_client_get_chats`, `eitaa_client_get_history`, `eitaa_client_get_updates` |
| **Rubika (User Account)** | `rubika_client_get_me`, `rubika_client_send_message`, `rubika_client_send_photo`, `rubika_client_send_file`, `rubika_client_get_chat`, `rubika_client_get_chats`, `rubika_client_get_history`, `rubika_client_get_updates` + group/channel management: `rubika_client_list_groups`, `create_group`, `group_members`, `add_group_members`, `remove_group_member`, `edit_group`, `leave_group`, `delete_group`, `list_channels`, `create_channel`, `channel_members`, `add_channel_members`, `remove_channel_member`, `edit_channel`, `delete_channel` |
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

### WordPress Integration

Diba Bridge also connects your WordPress site to AI assistants, with **68 tools** covering the whole site.

| Area | What you can do |
| :-- | :-- |
| Content | List, create, edit, schedule and delete posts, pages and any custom post type; revisions and search |
| Taxonomies | Manage categories, tags and custom taxonomies |
| Media | Upload from a URL or Base64, edit alt text and titles, delete |
| Comments | List, reply, approve, hold, mark as spam and delete |
| Users | List, create, update and delete with content reassignment |
| Plugins & themes | Install from WordPress.org, activate, deactivate, delete, switch theme |
| Menus & settings | Menu items, site settings and allow-listed options |
| WooCommerce | Products, orders, customers, coupons and a sales report |
| Tools | Cache flush, search and replace (dry-run by default), bulk edits, cron, SEO meta (Yoast and Rank Math), maintenance mode, statistics and activity log |

**Two ways to connect:**

1. **Application Password** — nothing to install on the site; enough for the WordPress core REST tools.
2. **Diba Bridge Connector plugin** — zip [`wordpress-plugin/diba-bridge-connector`](wordpress-plugin/diba-bridge-connector), install it in WordPress, generate a key in its settings page and paste it into the Diba Bridge dashboard. WooCommerce, SEO, cache and option tools require it.

The plugin stores only a hash of the key, runs every request with the capabilities of a WordPress user you choose, and offers per-area switches, a read-only mode, an IP allow-list, rate limiting and an audit log.

Full guide, tool reference and security notes: [docs/WORDPRESS.md](docs/WORDPRESS.md)

---

### Contributing

Diba Bridge is open source and contributions are welcome. Please read the [contributing guide](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md) before opening a pull request, and report security issues as described in [SECURITY.md](SECURITY.md).

---

### License

Distributed under the **MIT License**. The companion WordPress plugin in `wordpress-plugin/` is licensed under GPL-2.0-or-later, as WordPress requires. Maintained and powered by the Dibachain engineering team.

</div>
