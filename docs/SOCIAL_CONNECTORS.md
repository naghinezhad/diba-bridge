# Social connectors — Telegram, Instagram, WhatsApp (OpenWA), X

These connectors are separate from the Iranian messengers. Each one has its own credentials and can be enabled independently from **پیام‌رسان‌ها → خارجی**.

## Telegram (Bot API)

1. Create a bot with [@BotFather](https://t.me/BotFather).
2. In the dashboard open **تلگرام (ربات رسمی)**.
3. Paste the bot token and save.
4. Add the bot to a group/channel, or start a private chat with it.

Tools: `telegram_get_me`, `telegram_send_message`, `telegram_send_photo`, `telegram_send_document`, `telegram_get_chat`, `telegram_get_updates`.

This uses the official Bot API. A bot cannot read arbitrary private user conversations; for a user-account protocol a separate MTProto client is required.

## Instagram (Graph API — Business/Creator)

Instagram does not offer a general personal-account API. This connector uses the official **Instagram Graph API** for a Business/Creator account.

1. Convert the account to a professional account.
2. Create a Meta app and get an access token with `instagram_basic` and `instagram_content_publish`.
3. Get the Instagram Business Account ID.
4. Enter both values in the **اینستاگرام** provider.

Tools: `instagram_get_me`, `instagram_get_media`, `instagram_get_comments`, `instagram_publish_photo`.

`instagram_publish_photo` needs a publicly reachable image URL.

## WhatsApp (OpenWA)

This connector expects a running [OpenWA](https://docs.open-wa.org/) REST gateway. It is a bridge, not a replacement for the WhatsApp client.

1. Start OpenWA and create/link a WhatsApp session.
2. Set the base URL (default `http://127.0.0.1:2785/api`), the API key, and the session ID in the **واتس‌اپ (OpenWA)** provider.
3. Test the connection, then use the WhatsApp tools.

Tools: `whatsapp_get_session`, `whatsapp_get_chats`, `whatsapp_get_messages`, `whatsapp_send_message`, `whatsapp_send_image`, `whatsapp_send_document`.

The API key is sent as the `X-API-Key` header. OpenWA must stay running.

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

## X (Twitter) API v2

1. Create an app in the X Developer Portal.
2. Copy its **Bearer Token** (read access).
3. For posting or reading your own profile, create a user access token with write permission and paste it as **User Access Token**.
4. Optionally set a default username.

Tools: `x_get_me`, `x_get_user`, `x_search_recent`, `x_get_user_posts`, `x_post`.

`x_post` requires a user access token. App-only bearer tokens are read-only.

## Environment variables

```env
TELEGRAM_TOKEN=
TELEGRAM_BASE_URL=https://api.telegram.org
TELEGRAM_DEFAULT_CHAT_ID=

INSTAGRAM_ACCESS_TOKEN=
INSTAGRAM_IG_USER_ID=
INSTAGRAM_BASE_URL=https://graph.facebook.com/v23.0

WHATSAPP_BASE_URL=http://127.0.0.1:2785/api
WHATSAPP_API_KEY=
WHATSAPP_SESSION_ID=
WHATSAPP_DEFAULT_CHAT_ID=

X_BEARER_TOKEN=
X_USER_ACCESS_TOKEN=
X_DEFAULT_USERNAME=
X_BASE_URL=https://api.x.com/2

LINKEDIN_ACCESS_TOKEN=
LINKEDIN_AUTHOR_URN=
LINKEDIN_API_VERSION=202506
LINKEDIN_BASE_URL=https://api.linkedin.com
```
