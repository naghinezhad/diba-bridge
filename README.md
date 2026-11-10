# dibaMCP

سرور MCP برای وصل کردن سرویس‌های ایرانی به مدل‌های هوش مصنوعی (Claude، Cursor و هر کلاینت MCP دیگر)، همراه با داشبورد فارسی برای مدیریت.

**مرحله‌ی ۱ (همین نسخه):** پیام‌رسان‌ها — بله، روبیکا و سروش‌پلاس (هم ربات و هم حساب کاربری)، ایتا (ربات + حساب کاربری با پل EitaaBun)

## نصب و اجرا

پیش‌نیاز: Node.js نسخه‌ی ۲۲.۱۹ یا جدیدتر (یا فقط Docker).
> اگر با `bun dev` اجرا می‌کنید، Bun فقط اسکریپت را اجرا می‌کند و `tsx` از Node موجود در `PATH` استفاده می‌کند؛ اول Node 24 را فعال کنید (مثلاً `fnm use 24` یا `nvm use 24`).

**با npx — بدون نصب:**

```bash
npx diba-mcp
```

**نصب سراسری:**

```bash
npm install -g diba-mcp
diba-mcp
```

> تا قبل از انتشار روی npm، از فایل آماده‌ی آخرین [Release](https://github.com/yunessfa/diba-MCP/releases) نصب کنید:
> `npm i -g https://github.com/yunessfa/diba-MCP/releases/download/v0.4.1/diba-mcp-0.4.1.tgz`

**با Docker:**

```bash
docker run -d --name diba-mcp -p 127.0.0.1:3790:3790 \
  -e ADMIN_PASSWORD=your-password \
  -v diba-mcp-data:/app/data \
  ghcr.io/yunessfa/diba-mcp:latest
```

بعد مرورگر را باز کنید: **http://127.0.0.1:3790**

بار اول (اگر `ADMIN_PASSWORD` نداده باشید) یک **کد راه‌اندازی** شش‌حرفی در ترمینال چاپ می‌شود. با آن در داشبورد رمز بسازید.
بعد در «پیام‌رسان‌ها» توکن ربات‌ها را ثبت کنید و از «اتصال به هوش مصنوعی» آدرس و توکن MCP را بردارید.

### دستورهای CLI

| دستور | کار |
|---|---|
| `diba-mcp` | داشبورد + اندپوینت MCP |
| `diba-mcp stdio` | اجرا با stdio برای Claude Desktop |
| `diba-mcp netcheck` | آیا این سیستم به API بله، ایتا، روبیکا و سروش می‌رسد؟ |
| `diba-mcp selftest bale --send` | تست کامل یک پیام‌رسان (بدون نام: همه‌ی پیام‌رسان‌های آماده)؛ `--chat <id>` چت مقصد |
| `diba-mcp token` | نمایش توکن اتصال MCP |
| `diba-mcp reset-password` | حذف رمز داشبورد (اجرای بعدی کد راه‌اندازی می‌دهد) |

گزینه‌ها: `--port 8080`، `--host 0.0.0.0`، `--data /path` (پیش‌فرض `~/.diba-mcp`)، `--env file.env`، `--help`

**Claude Desktop** (`claude_desktop_config.json`):

```json
{ "mcpServers": { "diba-mcp": { "command": "npx", "args": ["-y", "diba-mcp", "stdio"] } } }
```

### توسعه روی همین ریپو

| دستور | کار |
|---|---|
| `npm install` و `npm run dev` | اجرای توسعه با ری‌لود خودکار (داده در `./data`) |
| `npm run cli -- <دستور>` | اجرای CLI از روی سورس |
| `npm run build` و `npm start` | ساخت و اجرای نسخه‌ی production |
| `npm test` | همه‌ی تست‌ها (واحد + سرتاسری) |
| `npm run typecheck` | بررسی تایپ‌ها |
| `npm run netcheck` | بررسی دسترسی به API پیام‌رسان‌ها |

### انتشار نسخه‌ی جدید

```bash
npm version patch --no-git-tag-version   # یا minor / major
git commit -am "v0.2.1" && git push
```

بعد در گیت‌هاب: **Actions ← Release ← Run workflow**. (push یک تگ `vX.Y.Z` هم همین کار را می‌کند.)
GitHub Actions این‌ها را می‌سازد: ایمیج Docker با شماره‌ی نسخه، یک GitHub Release با فایل نصب `.tgz`، و اگر secret به اسم `NPM_TOKEN` در ریپو تعریف شده باشد، انتشار روی npm.

> نصب مستقیم از `github:yunessfa/diba-MCP` پشتیبانی نمی‌شود (npm هنگام نصب سراسری از git ابزار build را نصب نمی‌کند)؛ از فایل Release یا npm استفاده کنید.

## ساختار

```
src/
├─ core/
│  ├─ types.ts        # ProviderDef و ToolDef — قرارداد هر سرویس
│  ├─ engine.ts       # قلب پروژه: اجرای ابزار، اعتبارسنجی، لاگ، ساخت McpServer
│  ├─ store.ts        # تنظیمات در data/config.json (env اولویت دارد)
│  ├─ http.ts         # fetch با timeout و پیام خطای فارسی، پاک کردن توکن از خطاها
│  ├─ auth.ts         # رمز ادمین (scrypt)، نشست امضاشده (HMAC)، محدودکننده‌ی نرخ
│  ├─ net.ts          # همه‌ی درخواست‌های بیرونی + پراکسی SOCKS/HTTP
│  ├─ netcheck.ts     # تست دسترسی سرور به API پیام‌رسان‌ها
│  └─ logger.ts       # لاگ فراخوانی‌ها: حافظه + فایل روزانه در data/logs
├─ providers/
│  ├─ telegram-like.ts  # factory مشترک بله و سروش‌پلاس (Bot API شبیه تلگرام)
│  ├─ bale.ts  bale-client.ts  soroush.ts  soroush-client.ts  eitaa.ts  eitaa-client.ts  rubika.ts  rubika-client.ts
│  └─ index.ts          # فهرست سرویس‌ها
├─ http/router.ts     # express.Router: /mcp + /api + داشبورد
├─ index.ts           # API کتابخانه برای الحاق
├─ cli.ts             # خط فرمان diba-mcp
├─ server.ts          # راه‌اندازهای HTTP / stdio / netcheck
├─ main.ts            # اجرای HTTP از روی env (Docker، npm run dev)
└─ stdio.ts           # اجرای stdio
public/               # داشبورد (HTML/CSS/JS ساده، بدون build)
docs/                 # راهنمای تست curl (ورود روبیکا با حساب کاربری)
vendor/balejs/        # کتابخانه‌ی کلاینت بله، وصله‌شده برای Node 24
test/
├─ unit/             # تست‌های واحد (auth، store، net، engine)
└─ e2e.ts            # تست سرتاسری با کلاینت واقعی MCP
```

## ابزارها

| پیام‌رسان | ابزارها |
|---|---|
| بله (ربات) | `bale_get_me` `bale_send_message` `bale_send_photo` `bale_send_document` `bale_get_chat` `bale_get_updates` |
| بله (حساب کاربری) | `bale_client_get_me` `bale_client_send_message` `bale_client_get_chat` `bale_client_get_dialogs` `bale_client_get_history` `bale_client_get_updates` |
| سروش‌پلاس (ربات) | `soroush_get_me` `soroush_send_message` `soroush_send_photo` `soroush_send_document` `soroush_get_chat` `soroush_get_updates` |
| سروش‌پلاس (حساب کاربری) | `soroush_client_get_me` `soroush_client_send_message` `soroush_client_send_photo` `soroush_client_send_file` `soroush_client_get_chat` `soroush_client_get_chats` `soroush_client_get_history` `soroush_client_get_updates` |
| ایتا (ربات) | `eitaa_get_me` `eitaa_send_message` `eitaa_send_photo` `eitaa_send_file` |
| ایتا (حساب کاربری، پل EitaaBun) | `eitaa_client_get_me` `eitaa_client_get_chat` `eitaa_client_send_message` `eitaa_client_get_chats` `eitaa_client_get_history` `eitaa_client_get_updates` |
| روبیکا (ربات) | `rubika_get_me` `rubika_send_message` `rubika_send_photo` `rubika_send_file` `rubika_send_location` `rubika_get_chat` `rubika_get_updates` |
| روبیکا (حساب کاربری) | `rubika_client_get_me` `rubika_client_send_message` `rubika_client_send_photo` `rubika_client_send_file` `rubika_client_get_chat` `rubika_client_get_chats` `rubika_client_get_history` `rubika_client_get_updates` |
| همه | `list_services` `list_chats` |

**ارسال عکس و فایل:** ورودی هر ابزار رسانه‌ای می‌تواند لینک عمومی، فایل انتخاب‌شده از دستگاه (در داشبورد: دکمه، کشیدن و رها کردن، یا Ctrl+V)، یا `file_id` قبلی همان پیام‌رسان باشد. لینک‌ها را خود سرور دانلود و آپلود می‌کند، پس لازم نیست پیام‌رسان به آن لینک دسترسی داشته باشد. حداکثر حجم ۲۰ مگابایت.
برای امنیت، دانلود از آدرس‌های داخلی (localhost، شبکه‌ی خصوصی، metadata ابری) مسدود است؛ اگر عمداً لازم دارید: `ALLOW_PRIVATE_MEDIA_URLS=true`.

اگر برای سرویسی «چت پیش‌فرض» تعیین کنید، `chat_id` اختیاری می‌شود و مدل می‌تواند فقط با `text` پیام بفرستد.

## پیام‌های دریافتی و پیدا کردن chat_id

در داشبورد، صفحه‌ی **«پیام‌های دریافتی»**:

1. برای بله (ربات یا حساب کاربری)، روبیکا (ربات یا حساب کاربری)، سروش (ربات یا حساب کاربری) یا ایتا (حساب کاربری) «دریافت خودکار» را روشن کنید (یا یک بار «بررسی الان» را بزنید).
2. از گوشی یک پیام به ربات بدهید. برای کانال: ربات را ادمین کنید و یک پست بگذارید.
3. چت در فهرست ظاهر می‌شود: شناسه‌اش را کپی کنید، «تنظیم به‌عنوان چت پیش‌فرض» را بزنید یا همان‌جا جواب بدهید.

پیام‌هایی که خود ربات می‌فرستد (از داشبورد، از طرف هوش مصنوعی یا در تست کامل) هم در همان گفتگو، سمت دیگر و با رنگ متفاوت نمایش داده می‌شوند.

وقتی دریافت خودکار روشن است، ابزار `*_get_updates` مدل از همین صندوق جواب می‌دهد و `list_chats` فهرست چت‌ها را به مدل می‌دهد. پیام‌ها در `data/inbox` ذخیره می‌شوند (۵۰۰ پیام آخر هر پیام‌رسان).
از env هم می‌شود روشنش کرد: `BALE_RECEIVE=true` یا `BALE_CLIENT_RECEIVE=true`.

> فقط یک برنامه باید پیام‌های یک ربات را بخواند. اگر روی ربات وبهوک تنظیم شده یا برنامه‌ی دیگری با همان توکن کار می‌کند، دریافت خودکار را روشن نکنید. خطای وبهوک در همان صفحه با دکمه‌ی «حذف وبهوک» نمایش داده می‌شود.
> ایتایار دریافت پیام ندارد.

## بله با حساب کاربری (Bale Client)

بله برای ربات‌ها Bot API رسمی دارد، اما برای **خود کاربر** API عمومی ندارد. این پروژه یک سرویس جدا به نام **«بله (حساب کاربری)»** دارد که از پروتکل داخلی کلاینت وب بله استفاده می‌کند (gRPC-Web برای ورود و WebSocket + Protobuf برای پیام‌ها). با آن می‌شود مثل خودتان — با همان حساب شخصی — پیام فرستاد و خواند؛ بدون ربات و بدون اینکه طرف مقابل ربات ببیند.

**ورود:**

1. در «پیام‌رسان‌ها» کارت **بله (حساب کاربری)** را باز کنید.
2. شماره را با `09…` یا `+98…` وارد کنید و «ارسال کد ورود» را بزنید.
3. کد پیامک/بله را وارد کنید. اگر حساب رمز دومرحله‌ای دارد، رمز را هم می‌پرسد.
4. بعد از ورود، نشست روی همین سرور ذخیره می‌شود و سرویس خودکار روشن می‌شود.

نشست به شکل `userId:jwt` در فایل تنظیمات (با دسترسی ۶۰۰) ذخیره می‌شود. از env هم می‌شود آن را داد: `BALE_CLIENT_SESSION` و `BALE_CLIENT_PHONE`. «خروج از حساب» نشست را پاک می‌کند.

**دریافت پیام:** در صفحه‌ی «پیام‌های دریافتی» برای این سرویس «دریافت خودکار» را روشن کنید یا `BALE_CLIENT_RECEIVE=true`. پیام‌هایی که از گوشی/وب خودتان می‌فرستید با برچسب «از حساب بله» نمایش داده می‌شوند.

**نکته‌های مهم:**

- این API **خصوصی و غیررسمی** است؛ بله می‌تواند بدون اطلاع تغییرش دهد. برای همین سرویس جدا از ربات است تا خرابی یکی روی دیگری اثر نگذارد.
- تا این نسخه ارسال **متن** پشتیبانی می‌شود؛ برای عکس و فایل از ربات بله (`bale_send_photo` / `bale_send_document`) استفاده کنید. خواندن نوع و کپشن عکس/فایل در صندوق کار می‌کند.
- فقط یک نمونه از این سرور باید با یک نشست به بله وصل شود. اگر همزمان با کلاینت وب/موبایل وصل شوید مشکلی نیست، ولی دو نمونه از dibaMCP با یک نشست می‌توانند پیام‌ها را از دست هم دربیاورند.
- این کلاینت مستقیم به `next-ws.bale.ai` وصل می‌شود و از `SOCKS_PROXY`/`HTTPS_PROXY` پروژه عبور نمی‌کند. اگر سرور خارج از ایران است و بله دسترسی را بست، سرور را داخل ایران اجرا کنید یا مسیر شبکه را شفاف تونل کنید. آدرس‌ها در تنظیمات همین سرویس (`baseUrl` و `wsUrl`) قابل تغییرند.

پیاده‌سازی پروتکل از کتابخانه‌ی متن‌باز [`@hoseinbnoob/balejs`](https://github.com/Zellias/balejs) (MIT) استفاده می‌کند که برای سازگاری با Node 24 به‌صورت وصله‌شده در [`vendor/balejs`](vendor/balejs) قرار گرفته است.

## روبیکا با حساب کاربری (Rubika Client)

روبیکا هم مثل بله برای ربات‌ها Bot API دارد، اما برای حساب شخصی API عمومی ندارد. سرویس **«روبیکا (حساب کاربری)»** با پروتکل خصوصی کلاینت روبیکا (ورود با شماره/کد، تبادل کلید RSA/AES و WebSocket) کار می‌کند و پیام‌ها را با همان حساب خودتان می‌فرستد و می‌خواند.

**ورود:**

1. در «پیام‌رسان‌ها» کارت **روبیکا (حساب کاربری)** را باز کنید.
2. شماره را با `09…` وارد کنید و «ارسال کد ورود» را بزنید.
3. اگر حساب رمز دومرحله‌ای دارد، اول رمز را وارد کنید؛ بعد کد روبیکا را بزنید.
4. بعد از ورود، نشست (JSON شامل `auth`، `guid` و کلید خصوصی) در `config.json` با دسترسی ۶۰۰ ذخیره و سرویس خودکار روشن می‌شود.

از env هم می‌شود نشست را داد: `RUBIKA_CLIENT_SESSION` (JSON) و `RUBIKA_CLIENT_PHONE`. دریافت خودکار: `RUBIKA_CLIENT_RECEIVE=true`.

**تست با curl:** دستورهای کامل ورود، دریافت کد، گرفتن `chat_id`، ارسال پیام و خواندن صندوق در [`docs/RUBIKA_CLIENT_CURL.md`](docs/RUBIKA_CLIENT_CURL.md) آمده است.

**نکته‌ها:**

- این API خصوصی است و روبیکا می‌تواند بدون اطلاع تغییرش دهد؛ سرویس جدا از ربات است تا خرابی یکی روی دیگری اثر نگذارد.
- ارسال متن، عکس و فایل پشتیبانی می‌شود. برای `file_id` قبلی در این سرویس پشتیبانی نیست؛ لینک عمومی یا فایل انتخاب‌شده بدهید.
- یک نمونه از dibaMCP با یک نشست به روبیکا وصل شود؛ چند نمونه همزمان می‌توانند پیام‌ها را از دست هم دربیاورند.
- این کلاینت مستقیم به سرورهای `iranlms.ir` وصل می‌شود و از `SOCKS_PROXY`/`HTTPS_PROXY` پروژه عبور نمی‌کند؛ اگر سرور خارج از ایران است و روبیکا دسترسی را بست، سرور را داخل ایران اجرا کنید.

پیاده‌سازی پروتکل از کتابخانه‌ی متن‌باز [`rubjs`](https://github.com/hadi-rostami/rubjs) (نسخه‌ی ۳.۲.۴) استفاده می‌کند.

## ایتا با حساب کاربری (Eitaa Client)

ایتا هم MTProto است و کتابخانه‌ی مستقیم Node ندارد. برای همین سرویس **«ایتا (حساب کاربری)»** از یک **پل محلی** به نام [EitaaBun](https://github.com/ghaemifard/EitaaBun) استفاده می‌کند: EitaaBun روی پورت `1234` اجرا می‌شود و dibaMCP از طریق HTTP با آن حرف می‌زند.

```bash
# پیش‌نیاز: Bun
npm run eitaa:bridge
```

بار اول EitaaBun را در `.eitaa-bridge` دانلود و نصب می‌کند. بعد در داشبورد:

- **آدرس پل:** `http://127.0.0.1:1234`
- **آدرس وب‌هوک:** `http://127.0.0.1:3790/api/eitaa-bridge/webhook`
- **ورود با حساب ایتا:** شماره → کد → رمز دومرحله‌ای (اگر دارد)

راهنمای کامل و دستورهای curl: [`docs/EITAA_CLIENT_BRIDGE.md`](docs/EITAA_CLIENT_BRIDGE.md).

**نکته‌ها:** پل باید همیشه روشن باشد. ارسال متن، فهرست گفتگوها، تاریخچه و دریافت webhook پشتیبانی می‌شود؛ ارسال مدیا در این نسخه نیست.

## سروش‌پلاس با حساب کاربری (Soroush Client)

سروش‌پلاس روی **MTProto** (پروتکل تلگرام) کار می‌کند، نه یک API ساده. سرویس **«سروش‌پلاس (حساب کاربری)»** از کتابخانه‌ی `sroosh` (پیاده‌سازی GramJS برای سرورهای سروش) استفاده می‌کند و ورود با شماره/کد، رمز دومرحله‌ای، دریافت WebSocket و ارسال متن/عکس/فایل را پشتیبانی می‌کند.

**ورود:**

1. در «پیام‌رسان‌ها» کارت **سروش‌پلاس (حساب کاربری)** را باز کنید.
2. شماره را با `09…` یا `+98…` وارد کنید و «ارسال کد ورود» را بزنید.
3. کد ارسال‌شده در اپ سروش (یا پیامک) را وارد کنید.
4. اگر حساب رمز دومرحله‌ای دارد، رمز را وارد کنید.

نشست به شکل StringSession در `config.json` ذخیره می‌شود. از env هم: `SOROUSH_CLIENT_SESSION` و `SOROUSH_CLIENT_PHONE`؛ دریافت خودکار: `SOROUSH_CLIENT_RECEIVE=true`.

**تست با curl:** دستورها در [`docs/SOROUSH_CLIENT_CURL.md`](docs/SOROUSH_CLIENT_CURL.md).

**نکته‌ها:**

- API خصوصی MTProto است و سروش می‌تواند لایه/سرور را تغییر دهد؛ کتابخانه‌ی `sroosh` باید در آن صورت به‌روزرسانی شود.
- این کلاینت مستقیم به `im-server.splus.ir` وصل می‌شود و از `SOCKS_PROXY`/`HTTPS_PROXY` پروژه عبور نمی‌کند.
- فقط یک نمونه از dibaMCP با یک نشست به سروش وصل شود.
- ورود فقط با شماره و کد انجام می‌شود؛ API ID/Hash به‌صورت داخلی و ثابت در برنامه است.

پیاده‌سازی از کتابخانه‌ی متن‌باز [`sroosh`](https://github.com/hadi-rostami/srooshjs) (نسخه‌ی ۱.۰.۱، MIT) استفاده می‌کند.

## تست کامل

در «پیام‌رسان‌ها» هر سرویس دکمه‌ی **«تست کامل»** دارد (یا `diba-mcp selftest`). قدم‌به‌قدم بررسی می‌کند:
تنظیمات ← دسترسی شبکه ← توکن ← دسترسی به چت ← ارسال متن ← ارسال عکس ← دریافت پیام.
برای هر خطا یک راهنمای فارسی نشان می‌دهد و با «کپی گزارش» نتیجه را به‌صورت متن (بدون توکن) برمی‌دارید.

**محدودیت‌ها:** ایتایار فقط به کانال/گروه ارسال می‌کند و دریافت پیام ندارد. `get_updates` در بله و سروش وقتی webhook تنظیم شده باشد کار نمی‌کند. کلاینت‌های حساب کاربری (بله، روبیکا، ایتا و سروش‌پلاس) API خصوصی دارند و ممکن است بعد از تغییر سرویس نیاز به به‌روزرسانی داشته باشند؛ «بله با حساب کاربری» و «ایتا با حساب کاربری» فعلاً فقط متن می‌فرستند (خواندن نوع و کپشن عکس/فایل کار می‌کند).

## تنظیمات امنیت و محدودیت‌ها

| متغیر | پیش‌فرض | کار |
|---|---|---|
| `MCP_RATE_LIMIT` | `120` | حداکثر درخواست به `/mcp` در دقیقه برای هر IP |
| `MCP_WRITE_LIMIT` | `30` | حداکثر فراخوانی ابزارهای ارسالی (پیام، عکس، ...) از طرف مدل در دقیقه — جلوی ارسال انبوه ناخواسته را می‌گیرد |
| `LOG_RETENTION_DAYS` | `14` | فایل‌های لاگ قدیمی‌تر پاک می‌شوند |
| `LOG_TO_FILE` | `true` | `false` = لاگ فقط در حافظه |
| `UPSTREAM_TIMEOUT_MS` | `20000` | سقف انتظار برای جواب API پیام‌رسان‌ها |

نشست داشبورد کوکی امضاشده است و با ری‌استارت سرور از بین نمی‌رود. «خروج» همه‌ی نشست‌ها را باطل می‌کند.

## الحاق به پروژه‌ی دیگر

```js
import express from "express";
import { createDibaMcp } from "diba-mcp";   // npm i diba-mcp

const app = express();
const dibaMcp = createDibaMcp({ dataDir: "./data/diba-mcp" });

app.use("/diba-mcp", dibaMcp.router());                  // داشبورد + /diba-mcp/mcp
// app.use("/diba-mcp", dibaMcp.router({ dashboard: false }));  // فقط اندپوینت MCP

// استفاده‌ی مستقیم از کد، بدون مدل:
await dibaMcp.engine.callTool("eitaa_send_message", { text: "سفارش جدید" }, "dashboard");
```

تا وقتی روی npm منتشر نشده: `npm i https://github.com/yunessfa/diba-MCP/releases/download/v0.4.1/diba-mcp-0.4.1.tgz`

## اضافه کردن سرویس جدید

یک فایل در `src/providers/` بسازید:

```ts
import { z } from "zod";
import { defineTool, type ProviderDef } from "../core/types.js";
import { request } from "../core/http.js";

export const kavenegar: ProviderDef = {
  id: "kavenegar", name: "Kavenegar", nameFa: "کاوه‌نگار", category: "sms",
  color: "#0ea5e9", glyph: "ک", description: "ارسال پیامک",
  fields: [{ key: "apiKey", label: "کلید API", type: "secret", required: true }],
  tools: [
    defineTool({
      name: "kavenegar_send_sms", title: "ارسال پیامک",
      description: "Send an SMS via Kavenegar",
      input: { receptor: z.string(), message: z.string() },
      handler: (a, ctx) => request(`https://api.kavenegar.com/v1/${ctx.config.apiKey}/sms/send.json`, { json: a, secrets: [ctx.config.apiKey] }),
    }),
  ],
};
```

و در `src/providers/index.ts` به آرایه اضافه‌اش کنید. داشبورد، فرم تنظیمات، آزمایشگاه و ابزار MCP خودکار ساخته می‌شوند.

اگر سرویس API رسمی کلاینت ندارد (مثل بله با حساب کاربری)، می‌توانید در `ProviderDef` فیلد `auth` را هم پیاده کنید؛ آن‌وقت فرم ورود مرحله‌ای (شماره ← کد ← رمز دومرحله‌ای) در کارت همان سرویس نمایش داده می‌شود و نشست با `save` در تنظیمات ذخیره می‌شود.

## استقرار با داکر

```bash
cp .env.example .env          # ADMIN_PASSWORD را عوض کنید
docker compose up -d --build
docker compose exec diba-mcp node dist/netcheck.js   # آیا سرور به APIها می‌رسد؟
```

راهنمای کامل قدم‌به‌قدم (سرور خارج از ایران، تونل SSH، HTTPS با Caddy): **[DEPLOY.md](DEPLOY.md)**

- **سرور خارج از ایران:** بعضی APIهای ایرانی IP خارجی را محدود می‌کنند. با `npm run netcheck` بررسی کنید؛ اگر بسته بود `SOCKS_PROXY` یا `HTTPS_PROXY` را به یک سرور داخل ایران بدهید. همه‌ی درخواست‌های بیرونی از `src/core/net.ts` رد می‌شوند.
- داشبورد را روی اینترنت فقط با HTTPS باز کنید (پروفایل `https` در compose، با `TRUST_PROXY=1`).
- تنظیمات و توکن‌ها در volume `diba-mcp-data` (فایل `config.json` با دسترسی 600) می‌مانند. هیچ‌وقت `.env` یا `data/` را commit نکنید.

## نقشه‌ی راه

1. ✅ پیام‌رسان‌ها: بله، ایتا، روبیکا، سروش‌پلاس — متن، عکس، فایل، دریافت پیام و تست کامل
2. دکمه‌ها در پیام‌ها و «منوی ربات» (پیام خوش‌آمد، دکمه‌ها و جواب خودکار) از داشبورد
3. پیامک: کاوه‌نگار، SMS.ir، ملی‌پیامک
4. پرداخت: زرین‌پال، IDPay (ساخت لینک و verify — callback روی پروژه‌ی میزبان)
5. نقشه: نشان، Map.ir
6. ابزارهای آفلاین: کد ملی، شبا، تاریخ شمسی، اعداد فارسی
7. ذخیره‌ی لاگ در دیتابیس، چند کاربر و دسترسی جدا برای هر توکن
