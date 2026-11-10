# Test Rubika user-account login with curl

This walks through the full flow against a running dibaMCP server:

- dashboard login cookie
- Rubika phone → password (if any) → code
- reading the logged-in profile
- listing chats and sending a message
- turning on the inbox and reading updates
- calling the same tools over the MCP endpoint

Set these first (bash / Git Bash):

```bash
BASE="http://127.0.0.1:3790"
COOKIE="/tmp/diba.cookies"
ADMIN_PASSWORD="your-dashboard-password"
PHONE="09121234567"
```

> On PowerShell use `curl.exe` and a Windows cookie path, for example
> `$COOKIE="$env:TEMP\diba.cookies"`.
>
> PowerShell’s native argument parsing can strip the quotes from `-d '{"phone":"..."}'`.
> If that happens, put the JSON body in a file and use `--data-binary '@body.json'`:
>
> ```powershell
> '{"phone":"09121234567"}' | Set-Content -Encoding ascii body.json
> curl.exe -sS -b $COOKIE -X POST "$BASE/api/providers/rubika_client/auth/start" `
>   -H 'content-type: application/json' --data-binary '@body.json'
> ```

---

## 1) Log in to the dashboard

```bash
curl -sS -c "$COOKIE" -X POST "$BASE/api/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"password\":\"$ADMIN_PASSWORD\"}"
```

Expected: `{"ok":true}` and a session cookie in `$COOKIE`.

## 2) Request the Rubika code

```bash
curl -sS -b "$COOKIE" -X POST "$BASE/api/providers/rubika_client/auth/start" \
  -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE\"}"
```

Two possible responses:

```json
{"ok":true,"result":{"step":"code","transactionHash":"abc123...","hint":"کد ۵ رقمی روبیکا را وارد کنید."}}
```

or, when the account has two-step verification:

```json
{"ok":true,"result":{"step":"password","transactionHash":"abc123...","hint":"رمز دومرحله‌ای..."}}
```

Save the hash:

```bash
TX="abc123..."
```

## 3) Only if step was `password`

```bash
curl -sS -b "$COOKIE" -X POST "$BASE/api/providers/rubika_client/auth/password" \
  -H 'content-type: application/json' \
  -d "{\"transactionHash\":\"$TX\",\"password\":\"YOUR_RUBIKA_PASSWORD\"}"
```

Expected: `step:"code"` (the code is now sent). Keep the same `$TX`.

## 4) Verify the code

```bash
curl -sS -b "$COOKIE" -X POST "$BASE/api/providers/rubika_client/auth/code" \
  -H 'content-type: application/json' \
  -d "{\"transactionHash\":\"$TX\",\"code\":\"12345\"}"
```

Expected: `step:"done"`. The provider is now enabled and the session is saved.

## 5) Check the logged-in account

```bash
curl -sS -b "$COOKIE" -X POST "$BASE/api/tools/rubika_client_get_me/call" \
  -H 'content-type: application/json' \
  -d '{"args":{}}'
```

This calls the same MCP tool the model uses, but through the dashboard API.

## 6) List chats and find a `chat_id`

```bash
curl -sS -b "$COOKIE" -X POST "$BASE/api/tools/rubika_client_get_chats/call" \
  -H 'content-type: application/json' \
  -d '{"args":{"limit":30}}'
```

`chat_id` is Rubika’s `object_guid`:

- `u0…` = private user
- `g0…` = group
- `c0…` = channel

## 7) Send a text message

```bash
CHAT_ID="u0..."
curl -sS -b "$COOKIE" -X POST "$BASE/api/tools/rubika_client_send_message/call" \
  -H 'content-type: application/json' \
  -d "{\"args\":{\"chat_id\":\"$CHAT_ID\",\"text\":\"سلام از dibaMCP\"}}"
```

Photo/file:

```bash
curl -sS -b "$COOKIE" -X POST "$BASE/api/tools/rubika_client_send_photo/call" \
  -H 'content-type: application/json' \
  -d "{\"args\":{\"chat_id\":\"$CHAT_ID\",\"photo\":\"https://example.com/cat.png\",\"caption\":\"عکس تست\"}}"

curl -sS -b "$COOKIE" -X POST "$BASE/api/tools/rubika_client_send_file/call" \
  -H 'content-type: application/json' \
  -d "{\"args\":{\"chat_id\":\"$CHAT_ID\",\"file\":\"https://example.com/report.pdf\"}}"
```

## 8) Receive messages

Turn on automatic receiving:

```bash
curl -sS -b "$COOKIE" -X POST "$BASE/api/inbox/rubika_client/receive" \
  -H 'content-type: application/json' \
  -d '{"enabled":true}'
```

Then ask the account for recent chats/messages:

```bash
curl -sS -b "$COOKIE" -X POST "$BASE/api/tools/rubika_client_get_updates/call" \
  -H 'content-type: application/json' \
  -d '{"args":{}}'
```

Or read the stored inbox for one chat:

```bash
curl -sS -b "$COOKIE" "$BASE/api/inbox?provider=rubika_client&chat=$CHAT_ID"
```

Send a message from another Rubika account to this one; after a few seconds it appears in the inbox.

## 9) Optional: call the MCP endpoint directly

Get the MCP token:

```bash
TOKEN=$(curl -sS -b "$COOKIE" "$BASE/api/connection" | python -c 'import sys,json; print(json.load(sys.stdin)["token"])')
```

Call a tool with JSON-RPC:

```bash
curl -sS "$BASE/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"rubika_client_get_me","arguments":{}}}'
```

## Troubleshooting

- `401` on `/api/...`: log in again and use `-b "$COOKIE"`.
- `INVALID_INPUT` on `auth/start`: use `09…` or `+98…` without spaces. The server converts it to Rubika’s `98…` format automatically.
- `step:"password"`: call the password endpoint, then verify the code.
- `TOO_REQUESTS`: wait a few minutes; Rubika is rate-limiting login attempts.
- `NOT_SUPPORTED_API_VERSION`: the Rubika client library needs updating (the private API changed).
- `نشست روبیکا معتبر نیست`: log out from the card, then repeat steps 2–4.
- No messages in the inbox: turn on “دریافت خودکار” and check that only this server instance is using the account.
- Network error: this client connects directly to Rubika (`iranlms.ir`) and does not use the project’s `SOCKS_PROXY`/`HTTPS_PROXY`.
