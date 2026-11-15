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
