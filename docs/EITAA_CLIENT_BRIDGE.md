# Eitaa user account via the EitaaBun bridge

Eitaa Web (`web.eitaa.com`) is a Telegram Web K / MTProto client, not an HTTP API.
dibaMCP does not reimplement that protocol. Instead it talks to
[`EitaaBun`](https://github.com/ghaemifard/EitaaBun), a local Bun + Express service
that exposes Eitaa account operations over HTTP.

The provider is `eitaa_client`. Its tools are prefixed with `eitaa_client_`.

## Requirements

- [Bun](https://bun.sh) 1.1+ (`winget install Oven-sh.Bun` on Windows)
- Git (only for the first download)
- The bridge and dibaMCP should run on the same machine, or at least be able to
  reach each other over HTTP.

## 1) Start the bridge

From the project directory:

```bash
npm run eitaa:bridge
```

On first run it clones EitaaBun into `.eitaa-bridge`, installs its dependencies,
and starts it on `http://127.0.0.1:1234`.

If you prefer to run it yourself:

```bash
git clone --depth 1 https://github.com/ghaemifard/EitaaBun.git
cd EitaaBun
bun install
bun run index.ts
```

Leave it running in a terminal. The bridge keeps its login files under
`~/eitaSessions/`.

## 2) Configure dibaMCP

In the dashboard, open **ایتا (حساب کاربری)** and set:

| Field | Value |
|---|---|
| آدرس پل | `http://127.0.0.1:1234` |
| آدرس وب‌هوک | `http://127.0.0.1:3790/api/eitaa-bridge/webhook` |
| توکن وب‌هوک | `diba-eitaa` (or your own) |

Then click **ورود با حساب ایتا**:

1. phone number (`09…` or `+98…`)
2. code from the Eitaa app/SMS
3. 2FA password if the account has one

Or with env:

```env
EITAA_CLIENT_ENABLED=true
EITAA_CLIENT_BRIDGE_URL=http://127.0.0.1:1234
EITAA_CLIENT_PHONE=+989121234567
EITAA_CLIENT_SESSION={"phone":"+989121234567","imei":"...","token":"..."}
EITAA_CLIENT_WEBHOOK_URL=http://127.0.0.1:3790/api/eitaa-bridge/webhook
EITAA_CLIENT_WEBHOOK_SECRET=diba-eitaa
EITAA_CLIENT_RECEIVE=true
```

The session value is filled automatically by the login flow.

## 3) Test

```bash
BASE="http://127.0.0.1:3790"
COOKIE="/tmp/diba.cookies"

curl -sS -c "$COOKIE" -X POST "$BASE/api/auth/login" \
  -H 'content-type: application/json' \
  -d '{"password":"YOUR_DASHBOARD_PASSWORD"}'

curl -sS -b "$COOKIE" -X POST "$BASE/api/providers/eitaa_client/auth/start" \
  -H 'content-type: application/json' \
  -d '{"phone":"09121234567"}'
```

Use the returned `transactionHash`:

```bash
curl -sS -b "$COOKIE" -X POST "$BASE/api/providers/eitaa_client/auth/code" \
  -H 'content-type: application/json' \
  -d '{"transactionHash":"TX","code":"12345"}'
```

If the response is `step:"password"`:

```bash
curl -sS -b "$COOKIE" -X POST "$BASE/api/providers/eitaa_client/auth/password" \
  -H 'content-type: application/json' \
  -d '{"transactionHash":"TX","password":"YOUR_2FA_PASSWORD"}'
```

Then:

```bash
curl -sS -b "$COOKIE" -X POST "$BASE/api/tools/eitaa_client_get_me/call" \
  -H 'content-type: application/json' -d '{"args":{}}'

curl -sS -b "$COOKIE" -X POST "$BASE/api/tools/eitaa_client_get_chats/call" \
  -H 'content-type: application/json' -d '{"args":{"limit":30}}'

curl -sS -b "$COOKIE" -X POST "$BASE/api/tools/eitaa_client_send_message/call" \
  -H 'content-type: application/json' \
  -d '{"args":{"chat_id":"123456789","text":"سلام از dibaMCP"}}'
```

`chat_id` must be an Eitaa numeric id. Run `eitaa_client_get_chats` once first so
the provider learns the matching `access_hash` and peer type.

## Receiving messages

When the provider connects, it calls EitaaBun `startUpdates` with the webhook URL.
EitaaBun POSTs new messages to:

```text
POST /api/eitaa-bridge/webhook?token=diba-eitaa
```

The route is intentionally outside dashboard authentication because EitaaBun does
not send a session cookie. It checks the token and the active phone number.

Enable **دریافت خودکار** in the dashboard for `eitaa_client`.

## Limitations

- EitaaBun is an external, unlicensed upstream project; run it at your own risk.
- The bridge must stay running. If it restarts, the provider reloads the saved
  session on the next call.
- Media sending is not exposed by this provider yet; use text messages.
- If dibaMCP is inside Docker and EitaaBun is on the host, set the bridge URL to
  `http://host.docker.internal:1234` and the webhook URL to an address the host
  can reach (usually `http://host.docker.internal:3790/api/eitaa-bridge/webhook`).
- Eitaa can change its MTProto layer; update EitaaBun if the bridge stops working.
