# Social connectors — Telegram, Instagram, WhatsApp, LinkedIn, X

These connectors are separate from the Iranian messengers. Each one has its own credentials and can be enabled independently from **پیام‌رسان‌ها → خارجی**.

## Telegram (user account, MTProto)

1. Open **تلگرام (حساب کاربری)** in the dashboard.
2. Enter the phone number and click **ارسال کد ورود**.
3. Enter the Telegram code and 2FA password if requested.
4. After login, the account tools become available.

Tools: `telegram_client_get_me`, `telegram_client_get_chats`, `telegram_client_send_message`, `telegram_client_get_history`, and group/channel management tools.

## Instagram (account login)

1. Open **اینستاگرام** in the dashboard.
2. Enter the username without `@` and click **ادامه**.
3. Enter the account password.
4. If the account has 2FA or a security checkpoint, enter the verification code when prompted.
5. The session is stored server-side; no API key or Meta Developer Portal app is needed.

Instagram limits logins by IP. If the server is in Iran or on a datacenter IP and you see `429`/timeout, set a proxy in the Instagram provider field (or `INSTAGRAM_PROXY_URL`) or in **Settings → proxy**. HTTP and SOCKS5 proxies are supported, and the global `HTTPS_PROXY` / `SOCKS_PROXY` variables are used as a fallback. Wait 15–60 minutes before retrying after a 429; repeated attempts can extend the limit.

Instagram's legacy password endpoint now rejects many clients with `error_type: needs_upgrade` (*"Your version of Instagram is out of date"*) before it even checks the password. The bundled JS client cannot complete Instagram's newer Bloks/CAA login flow. If password login fails this way, use **ورود با کوکی مرورگر** in the same card:

1. Log in to `instagram.com` in a desktop browser.
2. Open DevTools → Application → Cookies → `https://www.instagram.com`.
3. Copy `sessionid`, `csrftoken`, and `ds_user_id`.
4. Paste them (e.g. `sessionid=…; csrftoken=…; ds_user_id=…`) into the cookie box and click **ورود با نشست**. A bare `sessionid` value is also accepted.

Treat these cookies like a password; they are stored server-side and masked in the dashboard.

Tools: `instagram_get_me`, `instagram_get_user`, `instagram_get_media`, `instagram_get_comments`, `instagram_list_chats`, `instagram_get_messages`, `instagram_publish_photo`.

`instagram_list_chats` / `instagram_get_messages` read the direct-message inbox (chat list and recent messages). Instagram direct messages are **read-only** here: the assistant can list and read them, but cannot send DMs.

`instagram_publish_photo` accepts a public image URL or a `data:` URL uploaded from the dashboard.

## WhatsApp (QR login)

This is a native WhatsApp Web multi-device connection using Baileys. No OpenWA service, API key, or pairing code is required.

1. Open **واتس‌اپ** in the dashboard.
2. Click **نمایش QR ورود**.
3. On the phone open **WhatsApp → Linked devices → Link a device**.
4. Scan the QR shown in the dashboard.
5. After the phone confirms the device, click **بررسی اتصال**.
6. The session is stored under `data/whatsapp-auth/` on the server.

Tools: `whatsapp_get_session`, `whatsapp_get_chats`, `whatsapp_send_message`, `whatsapp_send_image`, `whatsapp_send_document`.

The phone must have an active WhatsApp account. The server needs a stable internet connection; WhatsApp may require a VPN depending on the network. If the server cannot open the WhatsApp WebSocket directly, set `HTTPS_PROXY` (HTTP proxy) or `SOCKS_PROXY` (SOCKS5) in `.env`; the WhatsApp socket uses the same proxy configuration.

## LinkedIn

### Initial setup

1. Go to the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps/new) and create an app.
2. Associate the app with a LinkedIn Page you manage.
3. In **Products**, request **Share on LinkedIn** (for publishing) and **Sign In with LinkedIn using OpenID Connect** (for profile reads).
4. In **Auth**, add a redirect URL such as `https://your-domain/callback`.
5. Complete the OAuth 2.0 authorization-code flow with scopes:
   - `openid`
   - `profile`
   - `w_member_social`
6. Exchange the authorization code for an access token using the app's Client ID and Client Secret.
7. Paste the access token into the **لینکدین** provider.
8. Optionally set the Author URN (`urn:li:person:...`). If empty, it is resolved from `/v2/userinfo`.
9. Set the API version if your app requires a different one (default: `202506`), then run **تست اتصال**.

Tokens are stored server-side. Publishing requires an approved app with `w_member_social`; otherwise LinkedIn returns a permission error.

Tools: `linkedin_get_me`, `linkedin_get_posts`, `linkedin_create_post`, `linkedin_delete_post`.

## X (Twitter) account login

1. Open **ایکس (حساب کاربری)** in the dashboard.
2. Enter the username without `@` and click **ادامه**.
3. Enter the account password.
4. If the account has email confirmation or 2FA, set the optional **Email** and **Two-Factor Secret** fields before logging in.
5. The session cookies are stored server-side; no API key or Developer Portal app is needed.

Tools: `x_get_me`, `x_get_user`, `x_search_recent`, `x_get_user_posts`, `x_post`.

This uses X's web/private API through an unofficial client. Accounts can be rate-limited or challenged by X; use at your own risk.

## Environment variables

```env
TELEGRAM_CLIENT_ENABLED=true
TELEGRAM_CLIENT_PHONE=+989121234567
TELEGRAM_CLIENT_SESSION=1BVtsOK...
TELEGRAM_CLIENT_API_ID=2040
TELEGRAM_CLIENT_API_HASH=b18441a1ff607e10a989891a5462e627

INSTAGRAM_USERNAME=
INSTAGRAM_SESSION=
INSTAGRAM_PROXY_URL=

WHATSAPP_PHONE=+989121234567
WHATSAPP_SESSION=connected
WHATSAPP_DEFAULT_CHAT_ID=

X_USERNAME=
X_EMAIL=
X_TWO_FACTOR_SECRET=
X_SESSION=

LINKEDIN_ACCESS_TOKEN=
LINKEDIN_AUTHOR_URN=
LINKEDIN_API_VERSION=202506
LINKEDIN_BASE_URL=https://api.linkedin.com
```
