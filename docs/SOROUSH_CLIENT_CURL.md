# Test Soroush Plus user-account login with curl

Soroush Plus uses MTProto. The provider logs in with phone + code (+ 2FA password),
stores a StringSession, then sends/receives as your own account.

```bash
BASE="http://127.0.0.1:3790"
COOKIE="/tmp/diba.cookies"
ADMIN_PASSWORD="your-dashboard-password"
PHONE="09121234567"
```

PowerShell: use `curl.exe`, a Windows cookie path, and put JSON bodies in a file
(`--data-binary '@body.json'`) if quotes are stripped.

## 1) Dashboard login

```bash
curl -sS -c "$COOKIE" -X POST "$BASE/api/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"password\":\"$ADMIN_PASSWORD\"}"
```

## 2) Send the login code

```bash
curl -sS -b "$COOKIE" -X POST "$BASE/api/providers/soroush_client/auth/start" \
  -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE\"}"
```

Response contains `transactionHash` and `step:"code"`:

```bash
TX="..."
```

## 3) Verify the code

```bash
curl -sS -b "$COOKIE" -X POST "$BASE/api/providers/soroush_client/auth/code" \
  -H 'content-type: application/json' \
  -d "{\"transactionHash\":\"$TX\",\"code\":\"12345\"}"
```

If the account has 2FA, the response is `step:"password"`:

```bash
curl -sS -b "$COOKIE" -X POST "$BASE/api/providers/soroush_client/auth/password" \
  -H 'content-type: application/json' \
  -d "{\"transactionHash\":\"$TX\",\"password\":\"YOUR_2FA_PASSWORD\"}"
```

## 4) Check the account

```bash
curl -sS -b "$COOKIE" -X POST "$BASE/api/tools/soroush_client_get_me/call" \
  -H 'content-type: application/json' -d '{"args":{}}'
```

## 5) Chats and sending

```bash
curl -sS -b "$COOKIE" -X POST "$BASE/api/tools/soroush_client_get_chats/call" \
  -H 'content-type: application/json' -d '{"args":{"limit":30}}'

curl -sS -b "$COOKIE" -X POST "$BASE/api/tools/soroush_client_send_message/call" \
  -H 'content-type: application/json' \
  -d '{"args":{"chat_id":"123456789","text":"سلام از dibaMCP"}}'
```

Photo/file:

```bash
curl -sS -b "$COOKIE" -X POST "$BASE/api/tools/soroush_client_send_photo/call" \
  -H 'content-type: application/json' \
  -d '{"args":{"chat_id":"123456789","photo":"https://example.com/cat.png","caption":"تست"}}'

curl -sS -b "$COOKIE" -X POST "$BASE/api/tools/soroush_client_send_file/call" \
  -H 'content-type: application/json' \
  -d '{"args":{"chat_id":"123456789","file":"https://example.com/report.pdf"}}'
```

## 6) Receiving

```bash
curl -sS -b "$COOKIE" -X POST "$BASE/api/inbox/soroush_client/receive" \
  -H 'content-type: application/json' -d '{"enabled":true}'

curl -sS -b "$COOKIE" -X POST "$BASE/api/tools/soroush_client_get_updates/call" \
  -H 'content-type: application/json' -d '{"args":{}}'
```

## MCP endpoint

```bash
TOKEN=$(curl -sS -b "$COOKIE" "$BASE/api/connection" | python -c 'import sys,json; print(json.load(sys.stdin)["token"])')

curl -sS "$BASE/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"soroush_client_get_me","arguments":{}}}'
```

## Troubleshooting

- `PHONE_NUMBER_INVALID`: use `09…` or `+98…` without spaces.
- `PHONE_CODE_INVALID` / `PHONE_CODE_EXPIRED`: request a new code.
- `SESSION_PASSWORD_NEEDED`: the dashboard/curl password step is required.
- `FLOOD`: wait a few minutes before retrying.
- Network error: this client connects directly to `im-server.splus.ir` and ignores the project proxy.
