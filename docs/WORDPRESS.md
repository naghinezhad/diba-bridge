<div dir="rtl">

# اتصال وردپرس به دیباپل

با سرویس «وردپرس» در دیباپل می‌توانید یک سایت وردپرس را از طریق MCP مدیریت کنید: نوشته‌ها و برگه‌ها، دسته‌ها و برچسب‌ها، رسانه، دیدگاه‌ها، کاربران، افزونه‌ها و پوسته‌ها، فهرست‌ها، سئو، ووکامرس و ابزارهای نگهداری.

- کد سرویس: `src/providers/wordpress.ts`
- افزونه‌ی همراه وردپرس: `wordpress-plugin/diba-bridge-connector/`
- تست‌ها: `test/unit/wordpress.test.ts`

## دو روش اتصال

حداقل یکی از این دو روش لازم است؛ می‌توانید هر دو را هم‌زمان داشته باشید.

| | روش ۱: Application Password | روش ۲: افزونه‌ی Diba Bridge Connector |
|---|---|---|
| نصب روی سایت | لازم نیست (از وردپرس ۵٫۶ داخل هسته است) | نصب و فعال‌سازی افزونه |
| احراز هویت | HTTP Basic با نام کاربری + رمز برنامه | هدر `X-Diba-Bridge-Key` |
| مسیر | `/wp-json/wp/v2/...` | `/wp-json/diba-bridge/v1/...` |
| ابزارهای هسته (محتوا، رسانه، دیدگاه، کاربر، افزونه، پوسته، فهرست، تنظیمات) | بله | بله (از مسیر `proxy` افزونه) |
| ابزارهای پیشرفته (کش، جستجو و جایگزینی، ویرایش گروهی، کرون، سئو، حالت تعمیرات، آمار، سلامت سایت، گزینه‌ها) | خیر | بله |
| ووکامرس | خیر | بله (بدون نیاز به کلید جدای ووکامرس) |
| محدودسازی (بخش‌ها، فقط‌خواندنی، IP، سقف درخواست) و گزارش فعالیت | خیر | بله |

**کدام را انتخاب کنم؟**

- فقط مدیریت محتوای ساده می‌خواهید و نمی‌خواهید افزونه نصب کنید ← روش ۱.
- ووکامرس، سئو یا ابزارهای نگهداری می‌خواهید، یا هاست شما هدر `Authorization` را حذف می‌کند ← روش ۲.
- هر دو ثبت شده باشند: ابزارهای هسته مستقیم با Application Password اجرا می‌شوند و ابزارهای پیشرفته با کلید افزونه.

### روش ۱ — ساخت Application Password

۱. در پیشخوان وردپرس به «کاربران ← شناسنامه» بروید.
۲. در بخش «رمزهای عبور برنامه» یک نام (مثلاً `Diba Bridge`) بدهید و «افزودن رمز عبور برنامه‌ی جدید» را بزنید.
۳. رمز نمایش‌داده‌شده را همراه نام کاربری در دیباپل وارد کنید.

سایت باید HTTPS داشته باشد؛ در غیر این صورت وردپرس این قابلیت را غیرفعال می‌کند.

### روش ۲ — نصب افزونه‌ی Diba Bridge Connector

نیازمندی‌ها: وردپرس ۶٫۰ یا بالاتر، PHP ۷٫۴ یا بالاتر، HTTPS.

۱. پوشه‌ی `wordpress-plugin/diba-bridge-connector` را zip کنید (خود پوشه داخل zip باشد):

<div dir="ltr">

```bash
cd wordpress-plugin
zip -r diba-bridge-connector.zip diba-bridge-connector
```

</div>

در ویندوز: روی پوشه راست‌کلیک ← Send to ← Compressed (zipped) folder.

۲. در پیشخوان وردپرس: «افزونه‌ها ← افزودن ← بارگذاری افزونه»، فایل zip را انتخاب و نصب کنید و افزونه را فعال کنید. (یا پوشه را مستقیم در `wp-content/plugins/` کپی کنید.)
۳. به «تنظیمات ← Diba Bridge» بروید و «ساخت کلید» را بزنید. کلید (`dbk_...`) فقط همین یک بار نمایش داده می‌شود؛ آن را کپی کنید.
۴. «کاربر اجرای درخواست‌ها» را انتخاب کنید. همه‌ی درخواست‌ها با دسترسی‌های همین کاربر بررسی می‌شوند.
۵. «بخش‌های مجاز» را انتخاب کنید. پیش‌فرض فقط «محتوا» و «رسانه» روشن است؛ برای ووکامرس، کاربران، افزونه‌ها، گزینه‌ها و ابزارها باید بخش مربوط را خودتان روشن کنید.
۶. در صورت نیاز: حالت فقط‌خواندنی، فهرست IP مجاز، سقف درخواست در دقیقه و مدت نگه‌داری گزارش را تنظیم و ذخیره کنید.

## تنظیم در دیباپل

### از داشبورد

در صفحه‌ی سرویس‌ها «وردپرس» را باز کنید و این فیلدها را پر کنید:

| فیلد | توضیح |
|---|---|
| آدرس سایت | مثل `https://example.com` (اسلش انتهایی، `/wp-admin` و `/wp-json` خودکار حذف می‌شوند؛ نصب در زیرپوشه هم پشتیبانی می‌شود) |
| نام کاربری وردپرس | برای روش ۱ |
| Application Password | برای روش ۱ |
| کلید افزونه | برای روش ۲ (`dbk_...`) |

سپس «تست اتصال» را بزنید؛ نام سایت، کاربر متصل و (با افزونه) نسخه‌ی وردپرس برمی‌گردد.

### با متغیر محیطی

<div dir="ltr">

```bash
WORDPRESS_SITE_URL=https://example.com
WORDPRESS_USERNAME=admin
WORDPRESS_APP_PASSWORD="xxxx xxxx xxxx xxxx xxxx xxxx"
WORDPRESS_CONNECTOR_KEY=dbk_...
```

</div>

مقدار env بر مقدار داشبورد اولویت دارد و در داشبورد قفل نمایش داده می‌شود.

## نکته‌های فنی

- **پیوند یکتای ساده:** اگر `/wp-json` جواب ندهد، سرویس خودکار به شکل `/?rest_route=/...` برمی‌گردد و همان را برای آن سایت به خاطر می‌سپارد.
- **پراکسی:** همه‌ی درخواست‌ها از لایه‌ی شبکه‌ی دیباپل رد می‌شوند (`SOCKS_PROXY` / `HTTPS_PROXY`).
- **صفحه‌بندی:** فهرست‌ها `total`، `total_pages`، `page`، `per_page`، `count` و `items` برمی‌گردانند (از هدرهای `X-WP-Total` و `X-WP-TotalPages`).
- **خروجی جمع‌وجور:** فهرست‌ها فقط فیلدهای اصلی و خلاصه‌ی متنی برمی‌گردانند؛ محتوای کامل را با `wordpress_get_post` بگیرید (`format: "text"` برای متن بدون HTML).
- **خطاها:** خطاهای وردپرس با پیام فارسی و کد اصلی برمی‌گردند، مثل `[rest_forbidden]`. اگر پاسخ سایت JSON نباشد (فایروال، افزونه‌ی امنیتی، خطای سرور) همین موضوع اعلام می‌شود.
- **نوع محتوای سفارشی:** پارامتر `type` (مثلاً `product` یا `portfolio`) و `taxonomy` خودکار به `rest_base` درست تبدیل می‌شوند؛ نوع باید `show_in_rest` داشته باشد.
- **فیلدهای متا:** فقط متاهایی که با `show_in_rest` ثبت شده‌اند از طریق `meta` خوانده و نوشته می‌شوند (رفتار هسته‌ی وردپرس).
- **آپلود رسانه:** از لینک عمومی، data URL یا base64. خواندن مسیر محلی سرور عمداً پشتیبانی نمی‌شود. سقف حجم ۲۰ مگابایت است و دانلود از آدرس‌های داخلی مسدود است (مگر با `ALLOW_PRIVATE_MEDIA_URLS=true`).
- **زمان پاسخ:** هر درخواست ۴۵ ثانیه مهلت دارد (آپلود، نصب افزونه و عملیات گروهی ۱۲۰ ثانیه).

## فهرست ابزارها

همه‌ی نام‌ها با `wordpress_` شروع می‌شوند. علامت «افزونه» یعنی ابزار فقط با کلید افزونه‌ی اتصال کار می‌کند.

### سایت

| ابزار | کار |
|---|---|
| `wordpress_get_site_info` | نام، آدرس، نسخه، پوسته‌ی فعال، تعداد افزونه‌های فعال، وضعیت ووکامرس/سئو و افزونه‌ی اتصال |
| `wordpress_site_health` | سلامت سایت: نسخه‌ها، حافظه، به‌روزرسانی‌های معوق، دیباگ، کش، کرون (افزونه) |
| `wordpress_get_settings` | خواندن تنظیمات هسته |
| `wordpress_update_settings` | تغییر تنظیمات هسته |

### محتوا

| ابزار | کار |
|---|---|
| `wordpress_list_post_types` | انواع محتوا و `rest_base` آن‌ها |
| `wordpress_list_posts` | فهرست نوشته/برگه/نوع سفارشی با فیلتر و صفحه‌بندی |
| `wordpress_get_post` | یک نوشته با محتوای کامل و متا |
| `wordpress_create_post` | ساخت (پیش‌فرض پیش‌نویس)؛ زمان‌بندی با `status: "future"` و `date`؛ تصویر شاخص، دسته، برچسب، متا |
| `wordpress_update_post` | ویرایش، انتشار، زمان‌بندی، بازگردانی از زباله‌دان |
| `wordpress_delete_post` | انتقال به زباله‌دان (یا حذف دائمی با `force`) |
| `wordpress_list_revisions` | بازبینی‌های یک نوشته |
| `wordpress_search` | جستجو در همه‌ی محتوا و دسته‌ها |
| `wordpress_list_taxonomies` | طبقه‌بندی‌ها |
| `wordpress_list_terms` | دسته‌ها، برچسب‌ها یا هر طبقه‌بندی با `taxonomy` |
| `wordpress_create_term` / `wordpress_update_term` / `wordpress_delete_term` | مدیریت دسته و برچسب |

### رسانه

| ابزار | کار |
|---|---|
| `wordpress_list_media` | کتابخانه‌ی رسانه |
| `wordpress_upload_media` | آپلود از لینک، data URL یا base64 |
| `wordpress_update_media` | عنوان، متن جایگزین، توضیح |
| `wordpress_delete_media` | حذف دائمی |

### دیدگاه‌ها

| ابزار | کار |
|---|---|
| `wordpress_list_comments` | فهرست با فیلتر وضعیت و نوشته |
| `wordpress_create_comment` | دیدگاه جدید یا پاسخ (با `parent`) |
| `wordpress_moderate_comment` | تأیید، انتظار، جفنگ، زباله‌دان |
| `wordpress_delete_comment` | زباله‌دان یا حذف دائمی |

### کاربران

| ابزار | کار |
|---|---|
| `wordpress_get_me` | کاربر متصل |
| `wordpress_list_users` / `wordpress_get_user` | فهرست و جزئیات |
| `wordpress_create_user` / `wordpress_update_user` | ساخت و ویرایش (نقش، رمز، مشخصات) |
| `wordpress_delete_user` | حذف؛ `reassign` (کاربر گیرنده‌ی محتوا) اجباری است |

### افزونه‌ها و پوسته‌ها

| ابزار | کار |
|---|---|
| `wordpress_list_plugins` | افزونه‌های نصب‌شده |
| `wordpress_activate_plugin` / `wordpress_deactivate_plugin` | فعال/غیرفعال |
| `wordpress_install_plugin` | نصب از مخزن wordpress.org با slug |
| `wordpress_delete_plugin` | حذف (باید غیرفعال باشد) |
| `wordpress_list_themes` | پوسته‌های نصب‌شده |
| `wordpress_activate_theme` | تغییر پوسته‌ی فعال (افزونه) |

### فهرست‌ها (منو)

| ابزار | کار |
|---|---|
| `wordpress_list_menus` | فهرست‌ها و جایگاه‌ها |
| `wordpress_get_menu_items` | آیتم‌های یک فهرست |
| `wordpress_create_menu_item` / `wordpress_update_menu_item` / `wordpress_delete_menu_item` | مدیریت آیتم‌ها |

خواندن فهرست‌ها اگر مسیر هسته در دسترس نباشد از افزونه انجام می‌شود.

### ابزارهای پیشرفته (افزونه)

| ابزار | کار |
|---|---|
| `wordpress_get_options` / `wordpress_update_option` | خواندن و تغییر گزینه‌های مجاز `wp_options` |
| `wordpress_flush_cache` | پاک‌سازی کش شیء، ترنزینت‌های منقضی، افزونه‌های کش رایج و (اختیاری) قوانین بازنویسی |
| `wordpress_search_replace_content` | جستجو و جایگزینی در محتوا؛ پیش‌فرض آزمایشی (`dry_run`) |
| `wordpress_bulk_update_posts` | تغییر گروهی وضعیت، نویسنده، دسته و برچسب (تا ۱۰۰ نوشته) |
| `wordpress_list_cron` / `wordpress_run_cron` | کارهای زمان‌بندی‌شده و اجرای فوری یکی از آن‌ها |
| `wordpress_get_seo_meta` / `wordpress_update_seo_meta` | عنوان و توضیح سئو، کلیدواژه، canonical، noindex، Open Graph (Yoast SEO یا Rank Math) |
| `wordpress_maintenance_mode` | روشن/خاموش کردن حالت تعمیرات یا خواندن وضعیت |
| `wordpress_get_stats` | آمار محتوا، دیدگاه‌ها، کاربران، رسانه |
| `wordpress_activity_log` | گزارش فعالیت افزونه |

### ووکامرس (افزونه + ووکامرس فعال)

| ابزار | کار |
|---|---|
| `wordpress_wc_list_products` / `wordpress_wc_get_product` | محصولات |
| `wordpress_wc_create_product` / `wordpress_wc_update_product` / `wordpress_wc_delete_product` | مدیریت محصول (قیمت، موجودی، وضعیت، دسته، تصویر) |
| `wordpress_wc_list_orders` / `wordpress_wc_get_order` | سفارش‌ها |
| `wordpress_wc_update_order` | تغییر وضعیت و افزودن یادداشت |
| `wordpress_wc_list_customers` | مشتریان |
| `wordpress_wc_list_coupons` / `wordpress_wc_create_coupon` | کدهای تخفیف |
| `wordpress_wc_sales_report` | خلاصه‌ی فروش یک بازه (پیش‌فرض ۳۰ روز اخیر) |

### درخواست دلخواه

`wordpress_rest_request` برای هر مسیر REST که ابزار اختصاصی ندارد (مثلاً `/wp/v2/blocks` یا مسیر یک افزونه‌ی دیگر). `path` فقط مسیر نسبی زیر `/wp-json` است؛ آدرس کامل، میزبان دیگر، `..`، کوئری داخل مسیر و نویسه‌های رمزشده رد می‌شوند. این ابزار فقط‌خواندنی علامت نخورده چون روش‌های غیر GET سایت را تغییر می‌دهند.

## جدول مسیرهای افزونه

همه زیر `/wp-json/diba-bridge/v1` هستند و هدر `X-Diba-Bridge-Key` می‌خواهند. این جدول باید با `src/providers/wordpress.ts` و کلاس‌های پوشه‌ی `includes/` افزونه هماهنگ بماند.

<div dir="ltr">

| Method | Route | Scope | Capability | Used by tool |
|---|---|---|---|---|
| GET | `/ping` | — | `read` | connection test |
| GET | `/site-info` | — | `read` | `get_site_info` |
| POST | `/proxy` | by inner path | `read` + core checks | all core tools when only the key is set, `rest_request` |
| POST | `/media` | media | `upload_files` | `upload_media` |
| POST | `/themes/activate` | plugins | `switch_themes` | `activate_theme` |
| GET | `/menus` | content | `edit_theme_options` | `list_menus` (fallback) |
| GET | `/menus/{id}/items` | content | `edit_theme_options` | `get_menu_items` (fallback) |
| GET | `/site-health` | tools | `view_site_health_checks` | `site_health` |
| GET | `/options` | options | `manage_options` | `get_options` |
| POST | `/options` | options | `manage_options` | `update_option` |
| POST | `/cache/flush` | tools | `manage_options` | `flush_cache` |
| POST | `/search-replace` | tools | `edit_others_posts` | `search_replace_content` |
| POST | `/posts/bulk` | content | `edit_posts` + per post | `bulk_update_posts` |
| GET | `/cron` | tools | `manage_options` | `list_cron` |
| POST | `/cron/run` | tools | `manage_options` | `run_cron` |
| GET | `/maintenance` | tools | `manage_options` | `maintenance_mode` |
| POST | `/maintenance` | tools | `manage_options` | `maintenance_mode` |
| GET | `/stats` | content | `edit_posts` | `get_stats` |
| GET | `/activity-log` | tools | `manage_options` | `activity_log` |
| GET | `/seo/{id}` | content | `edit_posts` + `edit_post` | `get_seo_meta` |
| POST | `/seo/{id}` | content | `edit_posts` + `edit_post` | `update_seo_meta` |
| GET | `/wc/products` | woocommerce | `edit_products` | `wc_list_products` |
| POST | `/wc/products` | woocommerce | `edit_products` | `wc_create_product` |
| GET | `/wc/products/{id}` | woocommerce | `edit_products` + `edit_post` | `wc_get_product` |
| POST | `/wc/products/{id}` | woocommerce | `edit_products` + `edit_post` | `wc_update_product` |
| DELETE | `/wc/products/{id}` | woocommerce | `delete_products` + `delete_post` | `wc_delete_product` |
| GET | `/wc/orders` | woocommerce | `edit_shop_orders` | `wc_list_orders` |
| GET | `/wc/orders/{id}` | woocommerce | `edit_shop_orders` | `wc_get_order` |
| POST | `/wc/orders/{id}` | woocommerce | `edit_shop_orders` | `wc_update_order` |
| GET | `/wc/customers` | woocommerce | `list_users` | `wc_list_customers` |
| GET | `/wc/coupons` | woocommerce | `edit_shop_coupons` | `wc_list_coupons` |
| POST | `/wc/coupons` | woocommerce | `publish_shop_coupons` | `wc_create_coupon` |
| GET | `/wc/reports/sales` | woocommerce | `view_woocommerce_reports` | `wc_sales_report` |

</div>

مسیرهای `/seo/*` فقط وقتی Yoast SEO یا Rank Math فعال باشد و مسیرهای `/wc/*` فقط وقتی ووکامرس فعال باشد ثبت می‌شوند.

**بخش (scope) مسیر `proxy` بر اساس مسیر داخلی:** `/wp/v2/users` ← کاربران؛ `/wp/v2/plugins`، `/wp/v2/themes`، قالب‌ها و ابزارک‌ها ← افزونه‌ها و پوسته‌ها؛ `/wp/v2/settings` ← گزینه‌ها؛ `/wp/v2/media` ← رسانه؛ `/wc/...` ← ووکامرس؛ بقیه‌ی `/wp/v2/...` ← محتوا؛ مسیر افزونه‌های دیگر ← ابزارها. مسیرهای خود افزونه و `application-passwords` از `proxy` مسدودند.

## نکته‌های امنیتی

- **کلید:** فقط هش کلید (HMAC-SHA256 با salt سایت) ذخیره می‌شود و مقایسه با `hash_equals` است. کلید فقط یک بار نمایش داده می‌شود؛ با «ساخت کلید جدید» یا «باطل کردن کلید» فوراً از کار می‌افتد. اگر saltهای وردپرس عوض شوند باید کلید جدید بسازید.
- **کلید جای دسترسی را نمی‌گیرد:** هر درخواست به‌عنوان کاربر انتخاب‌شده اجرا می‌شود و هر مسیر `current_user_can` را بررسی می‌کند. برای کمترین دسترسی، یک کاربر جدا با نقش پایین‌تر (مثلاً ویرایشگر) بسازید و همان را انتخاب کنید.
- **بخش‌ها و فقط‌خواندنی:** هر بخش جدا روشن می‌شود؛ در حالت فقط‌خواندنی هر درخواست تغییردهنده رد می‌شود (جستجو و جایگزینی آزمایشی مجاز می‌ماند).
- **HTTPS:** درخواست روی HTTP رد می‌شود مگر اینکه برای توسعه‌ی محلی صریحاً مجاز شود.
- **IP و سقف درخواست:** فهرست IP/CIDR مجاز (فقط `REMOTE_ADDR`؛ هدرهای forwarded قابل اعتماد نیستند)، سقف درخواست در دقیقه و قفل موقت بعد از ۱۰ کلید اشتباه در ۵ دقیقه.
- **گزینه‌ها:** فقط فهرست مجاز (به‌علاوه‌ی نام‌هایی که مدیر اضافه می‌کند) خوانده و نوشته می‌شود. کلیدها و saltها، `active_plugins`، نقش‌های کاربری، ترنزینت‌ها، تنظیمات خود افزونه و هر نامی که شبیه رمز/توکن/کلید باشد همیشه مسدود است. تغییر `siteurl` و `home` به `confirm: true` نیاز دارد و `admin_email` و پوسته از این مسیر قابل تغییر نیستند.
- **جستجو و جایگزینی:** پیش‌فرض آزمایشی است؛ نوشته‌ها با `wp_update_post` ذخیره می‌شوند (بازبینی می‌ماند) و داده‌ی سریال‌شده بدون ساختن شیء باز و دوباره سریال می‌شود؛ ردیف‌های دارای شیء دست نمی‌خورند.
- **چیزهایی که عمداً وجود ندارند:** اجرای کد PHP یا SQL دلخواه، خواندن یا نوشتن فایل دلخواه، و ساخت Application Password از طریق کلید.
- **گزارش فعالیت:** هر درخواست (پذیرفته یا ردشده) با زمان، مسیر، وضعیت، کاربر و IP ثبت و هر روز بر اساس مدت نگه‌داری پاک‌سازی می‌شود.
- **در دیباپل:** رمز برنامه و کلید افزونه فیلد «secret» هستند و فقط روی سرور نگه‌داری می‌شوند. ابزارهای حذف و تغییرهای گسترده با `destructiveHint` علامت خورده‌اند تا کلاینت MCP قبل از اجرا تأیید بگیرد.
- **حذف افزونه:** با حذف افزونه تنظیمات، جدول گزارش و کار زمان‌بندی‌شده پاک می‌شوند.

## مجوز

کد دیباپل مجوز MIT دارد. پوشه‌ی `wordpress-plugin/diba-bridge-connector` (افزونه‌ی وردپرس) جدا و با مجوز GPL-2.0-or-later منتشر می‌شود.

</div>
