# Diba Assistant API (OpenAI-compatible)

Diba Bridge exposes its assistant through the same HTTP API that OpenAI clients speak. Point any
OpenAI SDK, LangChain, n8n node or `curl` at your Diba Bridge server and talk to an agent that can
read and act on every service you connected: messengers and social networks, banks and exchanges,
WordPress.

The assistant runs its tools **on the server**. A request goes in as plain messages and comes back
as a normal chat completion with the final answer; the client does not have to implement tool
calling.

> فارسی: دستیار دیبا یک API سازگار با OpenAI دارد. آدرس پایه‌ی هر SDK سازگار با OpenAI را روی
> `http://<سرور>:3790/v1` بگذارید، توکن MCP را به‌جای کلید API بدهید و مدل `diba-agent` را صدا
> بزنید. ابزارها روی همین سرور اجرا می‌شوند و پاسخ نهایی برمی‌گردد.

## Quick start

| Setting | Value |
|---|---|
| Base URL | `http://127.0.0.1:3790/v1` (or `https://your-domain/v1`) |
| API key | the MCP token from the dashboard page "اتصال به هوش مصنوعی" |
| Model | `diba-agent` |

Requirements: DibaRouter must be connected in the dashboard (DibaRouter tab), because the assistant
needs a language model to think with. Without it the API answers `503 model_not_configured`.

```bash
curl -s http://127.0.0.1:3790/v1/chat/completions \
  -H "Authorization: Bearer $DIBA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "diba-agent",
    "messages": [{"role": "user", "content": "قیمت بیت‌کوین در نوبیتکس و والکس چقدر است؟"}]
  }'
```

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:3790/v1", api_key=DIBA_TOKEN)

answer = client.chat.completions.create(
    model="diba-agent",
    messages=[{"role": "user", "content": "Which services are ready?"}],
)
print(answer.choices[0].message.content)
```

```js
import OpenAI from "openai";

const client = new OpenAI({ baseURL: "http://127.0.0.1:3790/v1", apiKey: process.env.DIBA_TOKEN });

const stream = await client.chat.completions.create({
  model: "diba-agent",
  messages: [{ role: "user", content: "Summarize the unread messages in Bale." }],
  stream: true,
});
for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
```

If Diba Bridge is mounted under a prefix (for example `app.use("/diba-mcp", dibaMcp.router())`),
the base URL is `http://host/diba-mcp/v1`.

## Endpoints

### `GET /v1/models`

Lists the models this server offers.

```json
{ "object": "list", "data": [{ "id": "diba-agent", "object": "model", "created": 1760000000, "owned_by": "dibachain" }] }
```

`GET /v1/models/diba-agent` returns the single model object.

### `POST /v1/chat/completions`

| Field | Type | Notes |
|---|---|---|
| `model` | string | `diba-agent`, or `diba-agent:<upstream model id>` to run this request on another DibaRouter model, e.g. `diba-agent:openai/gpt-4o-mini`. Defaults to `diba-agent`. |
| `messages` | array | Required. `user` and `assistant` turns form the conversation. `system` / `developer` messages are added to the assistant's instructions. `content` may be a string or a list of `{ "type": "text", "text": "..." }` parts. |
| `stream` | boolean | `true` for Server-Sent Events in the `chat.completion.chunk` format. |
| `stream_options.include_usage` | boolean | Adds a final chunk with `usage` and empty `choices`. |
| `temperature` | number | 0 to 2. Default 0.35. |
| `max_tokens` / `max_completion_tokens` | integer | Upper bound for the answer. Capped by the model's context window. |
| `user` | string | Used as the conversation key (see below). |
| `metadata.conversation_id` | string | Conversation key; takes precedence over `user`. |
| `n` | integer | Only `1`. |

Ignored without an error, so existing clients keep working: `tools`, `tool_choice`,
`response_format`, `top_p`, `stop`, `presence_penalty`, `frequency_penalty`, `seed`, `logprobs`.
Image and audio parts in `content` are skipped.

Response:

```json
{
  "id": "chatcmpl-6f1c0a9b2d3e4f5a6b7c8d9e",
  "object": "chat.completion",
  "created": 1794900000,
  "model": "diba-agent",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "…final answer…", "refusal": null },
      "logprobs": null,
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 1840, "completion_tokens": 96, "total_tokens": 1936 },
  "system_fingerprint": null,
  "diba": {
    "upstream_model": "dibachain/diba-router-free",
    "tool_calls": [{ "name": "nobitex_get_ticker", "ok": true, "ms": 412 }],
    "awaiting_confirmation": false,
    "truncated": false
  }
}
```

- `finish_reason` is `stop`, or `length` when the model ran out of output tokens.
- `usage` is an estimate summed over every model call of the turn (the assistant may call the
  model several times while it uses tools).
- `diba` is an extension that standard clients ignore:
  - `tool_calls`: the tools the assistant ran on the server (name, success, duration; never the arguments).
  - `awaiting_confirmation`: the assistant prepared a message to send and waits for the user to
    confirm. Send the user's reply ("بله" / "yes", or "لغو" / "cancel") with the same conversation key.
  - `truncated`: the step budget ran out and the answer summarizes what was done so far.

### Streaming

With `"stream": true` the response is `text/event-stream`:

```
data: {"id":"chatcmpl-…","object":"chat.completion.chunk","created":…,"model":"diba-agent","choices":[{"index":0,"delta":{"role":"assistant","content":""},"logprobs":null,"finish_reason":null}]}

: status در حال اجرای nobitex_get_ticker…

: tool nobitex_get_ticker ok

data: {"id":"chatcmpl-…","object":"chat.completion.chunk",…,"choices":[{"index":0,"delta":{"content":"قیمت "},"logprobs":null,"finish_reason":null}]}

data: {"id":"chatcmpl-…","object":"chat.completion.chunk",…,"choices":[{"index":0,"delta":{},"logprobs":null,"finish_reason":"stop"}],"diba":{…}}

data: [DONE]
```

Progress (`: status …`, `: tool …`) is sent as SSE comment lines. Standard clients skip them, and
they keep the connection alive while tools run. Text the model writes before calling a tool is
streamed as it arrives, followed by the final answer.

## Conversations, memory and confirmations

The API is stateless like OpenAI's: send the conversation so far in `messages` on every request.
Two things are kept on the server and are tied to a **conversation key**:

- the assistant's long-term memory of the conversation, and
- a pending "send this message?" confirmation.

The key is taken from the `X-Conversation-Id` header, then `metadata.conversation_id`, then `user`.
Use a different key per end user or thread. Without a key all requests share one conversation named
`api`, which is fine for a single script but not for several users.

```python
client.chat.completions.create(
    model="diba-agent",
    messages=history,
    extra_headers={"X-Conversation-Id": "support-ticket-4821"},
)
```

## What the assistant will and will not do

The same safety rules apply as in the dashboard chat:

- Tools that write (sending, deleting, publishing, trading) run only when the user asked for
  exactly that.
- "Send a message to <name>" goes through a prepare / confirm step; nothing is sent before the
  user confirms.
- Exchange orders are previewed first and are placed only with the exchange's "allow trading"
  switch on and an explicit confirmation.
- Tokens, passwords, chat ids and full phone numbers are not included in answers.
- A system message from the client is treated as extra instructions and cannot switch these rules off.

Anyone holding the token can make the assistant act on your connected accounts, exactly as they
could through MCP. Keep the token secret, rotate it from the dashboard if it leaks, and put the
server behind HTTPS before exposing it to the internet.

## Errors

Errors use the OpenAI shape:

```json
{ "error": { "message": "Incorrect API key provided.", "type": "authentication_error", "param": null, "code": "invalid_api_key" } }
```

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `null` / `no_message` | Malformed body, empty `messages`, `n` other than 1 |
| 400 | `context_length_exceeded` | The conversation does not fit the model's context window |
| 400 | `upstream_rejected` | The language model rejected the request |
| 401 | `missing_api_key`, `invalid_api_key` | Token missing or wrong |
| 404 | `model_not_found` | `model` is not `diba-agent` or `diba-agent:<id>` |
| 404 | `unknown_url` | Endpoint not offered (only models and chat completions are) |
| 429 | `rate_limit_exceeded` | More than `MCP_RATE_LIMIT` requests per minute from one IP (default 120); see `Retry-After` |
| 429 | `upstream_rate_limit` | The language model is rate limited |
| 502 | `upstream_error` | The language model could not be reached or failed |
| 503 | `model_not_configured` | DibaRouter is not connected in the dashboard |

When an error happens after a stream has started, it is sent as a final `data: {"error": {...}}`
event and the stream ends.

## Using it from other tools

- **LangChain**: `ChatOpenAI(base_url="http://127.0.0.1:3790/v1", api_key=TOKEN, model="diba-agent")`
- **n8n / Flowise / Open WebUI**: add an "OpenAI-compatible" connection with the base URL and token above.
- **Vercel AI SDK**: `createOpenAI({ baseURL: "http://127.0.0.1:3790/v1", apiKey: TOKEN })("diba-agent")`

## Not supported

- Client-defined `tools` / function calling: the assistant uses its own server-side tools.
- `/v1/completions`, `/v1/responses`, `/v1/embeddings`, images and audio.
- More than one choice (`n > 1`).
