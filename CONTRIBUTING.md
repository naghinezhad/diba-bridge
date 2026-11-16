<div dir="rtl">

# راهنمای مشارکت در دیباپل

از اینکه می‌خواهید در **دیباپل (DibaBridge)** مشارکت کنید ممنونیم. این راهنما کوتاه است تا سریع شروع کنید.

## پیش‌نیاز

- Node.js نسخه‌ی ۲۲٫۱۹ یا بالاتر
- npm

## راه‌اندازی محیط توسعه

```bash
git clone https://github.com/Dibachain-Company/diba-bridge.git
cd diba-bridge
npm ci
cp .env.example .env
npm run dev
```

داشبورد روی `http://127.0.0.1:3790` بالا می‌آید.

## قبل از فرستادن Pull Request

```bash
npm run typecheck
npm test
```

هر دو باید بدون خطا تمام شوند؛ CI هم دقیقاً همین‌ها را روی `main` و Pull Requestها اجرا می‌کند.

## روند کار

1. مخزن را Fork کنید و از `main` یک شاخه بسازید: `feat/...`، `fix/...` یا `docs/...`.
2. تغییر را کوچک و متمرکز نگه دارید؛ یک موضوع در هر Pull Request.
3. برای رفتار جدید یا باگ رفع‌شده تست بنویسید (`test/unit`).
4. Pull Request را به شاخه‌ی `main` باز کنید و قالب آن را پر کنید.

## ساختار پروژه

| مسیر | محتوا |
| :-- | :-- |
| `src/core/` | موتور، ذخیره‌سازی تنظیمات، صندوق پیام، حافظه، تریگرها |
| `src/core/assistant/` | دستیار دیبا: تشخیص نیت، پیدا کردن مخاطب، پیش‌نویس و ارسال |
| `src/providers/` | سرویس‌ها (هر فایل یک `ProviderDef`) |
| `src/http/` | روتر داشبورد و اندپوینت MCP |
| `public/` | رابط کاربری داشبورد |
| `wordpress-plugin/` | پلاگین همراه وردپرس |
| `test/` | تست‌های واحد و سرتاسری |
| `docs/` | مستندات تکمیلی |

## اضافه کردن سرویس جدید

1. در `src/providers/` یک فایل بسازید که یک `ProviderDef` برگرداند (نمونه‌ی ساده: `linkedin.ts`).
2. آن را در `src/providers/index.ts` به فهرست اضافه کنید.
3. نام هر ابزار را با شناسه‌ی سرویس شروع کنید (`myservice_do_something`) و ابزارهای فقط‌خواندنی را با `readOnlyHint` علامت بزنید.
4. تست واحد با سرور ساختگی HTTP اضافه کنید.

## سبک کد

- TypeScript با حالت strict؛ از `any` فقط در مرز داده‌های بیرونی استفاده کنید.
- توضیح‌های کد فارسی، توضیح ابزارها برای مدل (فیلد `description`) انگلیسی.
- پیام‌های خطای قابل‌نمایش به کاربر فارسی باشند.
- هرگز توکن، نشست، شماره‌ی تلفن، شناسه‌ی چت یا متن پیام واقعی را کامیت نکنید.

## پیام کامیت

قالب [Conventional Commits](https://www.conventionalcommits.org/) را ترجیح می‌دهیم:

```
feat(wordpress): add media upload tool
fix(assistant): resolve pronoun follow-ups
```

## گزارش مشکل امنیتی

مشکلات امنیتی را در ایشوی عمومی ننویسید؛ [SECURITY.md](SECURITY.md) را ببینید.

## مجوز

با ارسال مشارکت می‌پذیرید که کد شما با [مجوز MIT](LICENSE) منتشر شود. پوشه‌ی `wordpress-plugin/` طبق الزام وردپرس با مجوز GPL-2.0-or-later منتشر می‌شود.

</div>
