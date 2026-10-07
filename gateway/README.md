# Dasai Mochi LLM gateway

One endpoint for the robot, many AI providers behind it. When a provider runs
out of quota the gateway moves to the next one; the ESP32 never knows.

Zero dependencies. Runs on Cloudflare Workers, Deno, or plain Node.

## Why not call the providers from the ESP32 directly

The ESP32-C3 has ~400 KB of RAM and a TLS session alone eats 40 KB+. Doing it
on-device would mean every provider's root CA, every provider's JSON shape,
and every API key sitting in flash where anyone holding the robot can dump
them. Adding a provider or rotating a key would mean reflashing.

Here the device holds one URL and one revocable device token.

## API

```
POST /v1/ask      Authorization: Bearer <DEVICE_TOKEN>
{ "prompt": "what's the weather like", "system": "optional", "maxTokens": 300 }
-> 200 { "text": "...", "provider": "gemini" }
-> 400 bad request (NOT retried across providers -- see below)
-> 503 { "error": "all providers unavailable", "attempts": [...] }

GET  /v1/health   -> per-provider live keys and cooldown state
```

## Failover rules

| Failure | What happens |
|---|---|
| Quota / rate limit | Provider cooled down (honours `Retry-After`), move to the next |
| Bad key | That **key** marked dead, try the provider's next key, then the next provider |
| 5xx, overloaded, timeout | Try the next key, then the next provider |
| Malformed request | **Stop.** Retrying our own bad request on every provider just burns quota to fail N times |

### The classification trap

Failover cannot be driven by HTTP status alone. Verified against the live APIs:

```
Anthropic, bad key -> HTTP 401   {"error":{"type":"authentication_error"}}
Gemini,    bad key -> HTTP 400   {"error":{"details":[{"reason":"API_KEY_INVALID"}]}}
```

Gemini answers **400** for a dead key. A rule that only fails over on 429/5xx
would treat that as a malformed request and never switch providers — the robot
would go silent with three healthy providers sitting unused. So each adapter
classifies on the structured error fields, and there is a test pinning exactly
this case.

## Providers

`gemini`, `anthropic`, `openai`, `groq` are built in. Anything else speaking
the OpenAI `/chat/completions` shape — OpenRouter, Together, DeepSeek, vLLM,
Ollama — goes in as `custom:<name>`:

```
PROVIDER_ORDER=gemini,custom:llama,anthropic
CUSTOM_LLAMA_BASE_URL=https://openrouter.ai/api/v1
CUSTOM_LLAMA_API_KEYS=k1,k2
CUSTOM_LLAMA_MODEL=meta-llama/llama-3.3-70b
```

Order is failover order. Multiple comma-separated keys per provider rotate
within that provider before moving on. A provider with no keys is skipped with
a warning rather than failing startup.

The Claude adapter uses raw HTTP rather than `@anthropic-ai/sdk` so all four
adapters share one shape; one SDK beside three fetch adapters would make the
failover path inconsistent. Its default model is `claude-opus-5-5` at `effort:
low`, tuned for short spoken replies — change `ANTHROPIC_MODEL` if you want
something cheaper.

## Run and test

```sh
npm test                     # 17 tests, no network needed
cp .dev.vars.example .dev.vars && npm start     # :8787
npx wrangler deploy                             # Cloudflare
```

## Still to do

Audio. Gemini accepts audio inline, so the robot's recording can go straight
to it without a separate speech-to-text step — but `/v1/ask` is text-only for
now, and providers that cannot take audio will need a transcription step in
front of them.
