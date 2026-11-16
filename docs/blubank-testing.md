# تست provider بلوبانک

این provider در `src/providers/blubank.ts` است و در `src/providers/index.ts` ثبت شده.
در داشبورد زیر تب **سرویس‌های بانکی ← ایرانی** (`#/banking?region=iran`) دیده می‌شود؛
دسته‌ی آن `banking` و منطقه‌اش `iran` است.
برای تست دستی، به یک Access Token از نشست اپلیکیشن بلوبانک نیاز داری.

## ۱. گرفتن توکن

توکن را از HAR نشست لاگین‌شده یا از حافظه‌ی دستگاه استخراج کن و در تنظیمات
provider (کلید `accessToken`) بگذار. اگر احراز هویت با کوکی است، `cookie` را پر کن.

## ۲. تست سریع بدون کلاینت MCP

```bash
cd diba-bridge
node --import tsx -e "
import { blubank } from './src/providers/blubank.ts';
const ctx = { config: { accessToken: 'TOKEN_اینجا' } };
const tool = blubank.tools.find(t => t.name === 'blubank_get_balance');
console.log(await tool.handler({}, ctx));
"
```

## ۳. ابزارهای موجود

| ابزار | کار |
|---|---|
| `blubank_key_exchange` | مرحله ۱ ورود (تبادل کلید) |
| `blubank_login` | مرحله ۲ ورود (بدنه‌ی رمزنگاری‌شده base64) |
| `blubank_verify_otp` | مرحله ۳ ورود (بدنه‌ی رمزنگاری‌شده base64) |
| `blubank_get_balance` | موجودی سپرده‌ها |
| `blubank_list_cards` | کارت‌ها/پروفایل‌ها |
| `blubank_get_user_profile` | پروفایل کاربر |
| `blubank_identities` | هویت‌ها (JSON) |
| `blubank_list_transactions` | تراکنش‌ها |
| `blubank_list_hashtags` | برچسب‌های تراکنش |
| `blubank_list_merchant_categories` | دسته‌بندی پذیرندگان |
| `blubank_flags` | پرچم‌های ویژگی |
| `blubank_raw_request` | درخواست خام به هر مسیر |

## ۴. نکته‌های مهم

- **ورود رمزنگاری‌شده است:** بدنه‌ی `login` و `verify_otp` در اپ بلوبانک رمز
  می‌شود. این provider خودش رمز نمی‌کند؛ payload خام base64 را از HAR بده.
- **پاسخ‌ها protobuf هستند:** خروجی شامل `strings`، `amounts`، `ibans` و
  `cards` است که از پیام بیرون کشیده شده‌اند.
- **بدون توکن:** ابزارها خطای واضح «Access Token یا Cookie» می‌دهند.

## ۵. اجرای تست‌های خودکار

```bash
cd diba-bridge
node --import tsx --test test/unit/blubank.test.ts
```
