# DibaRouter connector

DibaRouter is Dibachain's OpenAI-compatible AI gateway.

- Base URL: `https://dibarouter.ir/api/v1`
- Docs: https://dibarouter.ir/docs
- API keys: https://dibarouter.ir/keys
- Default free model: `dibachain/diba-router-free`
- Discovery: `GET https://dibarouter.ir/api/v1/discovery`

## Dashboard

Open **دیبا روتر** in the sidebar:

1. Paste an API key created at https://dibarouter.ir/keys.
2. Keep the default base URL, or change it if DibaRouter discovery returns another base.
3. Choose a model. `dibachain/diba-router-free` is the free auto-routing model. The picker loads the chat/vision list automatically: search by name or id, filter by free / tool-calling / vision, or type a custom model id.
4. Save, then use **تست اتصال**.

The key is stored server-side in `data/config.json` and is never returned to the browser; the API only returns a masked value.

## Agent chat

The left-side **دستیار دیبا** panel uses the same connection. It receives a server-side system prompt containing the current provider/readiness/inbox state, so it can answer questions such as:

- why a provider is not ready
- how to log in with a phone number
- how to enable receiving
- where to find the MCP token
- what the current models/tools are

The API is `POST /api/agent/chat` (dashboard session required):

```json
{ "messages": [{ "role": "user", "content": "چرا ایتا آماده نیست؟" }] }
```

While a reply is streaming, the panel shows a **stop** button (Esc also works). Stopping aborts the browser request, and the server closes the upstream model call and halts the remaining tool loop, so no tokens are spent after the stop. The partial answer stays in the transcript with a «پاسخ متوقف شد» marker.

## OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://dibarouter.ir/api/v1",
    api_key="sk-dc-v1-...",
)

r = client.chat.completions.create(
    model="dibachain/diba-router-free",
    messages=[{"role": "user", "content": "سلام!"}],
)
print(r.choices[0].message.content)
```

```js
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://dibarouter.ir/api/v1",
  apiKey: process.env.DIBAROUTER_API_KEY,
});

const r = await client.chat.completions.create({
  model: "dibachain/diba-router-free",
  messages: [{ role: "user", content: "سلام!" }],
});
```

## Environment

```env
DIBAROUTER_API_KEY=sk-dc-v1-...
DIBAROUTER_BASE_URL=https://dibarouter.ir/api/v1
DIBAROUTER_MODEL=dibachain/diba-router-free
```

Environment variables take precedence over dashboard values.

## Connectivity and proxies

The proxy configured for the messengers (`SOCKS_PROXY` / `HTTPS_PROXY` or the dashboard network settings) is not
always able to reach DibaRouter, and DibaRouter is usually reachable without it. When a proxy is active, every
DibaRouter request is tried through the proxy and directly; the route that worked is remembered for five minutes.

| `DIBAROUTER_ROUTE` | Behaviour |
| :-- | :-- |
| `auto` (default) | Proxy first, then direct (or the last route that worked) |
| `direct` | Never use the proxy for DibaRouter |
| `proxy` | Always use the proxy |

The base URL is normalised, so `https://dibarouter.ir`, `https://dibarouter.ir/api` and a pasted
`…/api/v1/chat/completions` all resolve to `https://dibarouter.ir/api/v1`.

## Small-context models

The assistant sizes every request from the selected model's context window (read from `/models`):

| Context window | Input budget | Reply | Tools | Notes |
| --: | --: | --: | --: | :-- |
| 2,048 | ~1,350 | ~400 | none | Text answers only |
| 4,096 | ~2,700 | ~800 | up to 8 | Compact system prompt |
| 8,192 | ~6,000 | 1,000 | up to 19 | Compact system prompt |
| 32,768+ | up to 24,000 | 1,000 | up to 28 | Full system prompt |

If a model rejects a request with a "context size" error, the limit it reports is remembered for that model and the
request is retried with a smaller plan, so a server that offers less than it advertises only fails once.

