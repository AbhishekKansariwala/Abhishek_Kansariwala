import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handle, resetRouter } from '../src/index.mjs';
import { providersFromEnv } from '../src/config.mjs';

beforeEach(() => resetRouter());

const ENV = {
  DEVICE_TOKEN: 'secret-device-token',
  PROVIDER_ORDER: 'gemini,anthropic',
  GEMINI_API_KEYS: 'g1',
  ANTHROPIC_API_KEYS: 'a1',
};

const post = (body, token = ENV.DEVICE_TOKEN) =>
  new Request('http://gw/v1/ask', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

function withFetch(queue, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => {
    const [status, body] = queue.shift();
    return { ok: status < 300, status, headers: { get: () => null }, json: async () => body };
  };
  return fn().finally(() => { globalThis.fetch = real; });
}

test('rejects a wrong device token', async () => {
  const res = await handle(post({ prompt: 'hi' }, 'wrong'), ENV);
  assert.equal(res.status, 401);
});

test('rejects a missing prompt', async () => {
  const res = await handle(post({}), ENV);
  assert.equal(res.status, 400);
});

test('returns text from the first healthy provider', async () => {
  await withFetch([[200, { candidates: [{ content: { parts: [{ text: 'hi there' }] } }] }]], async () => {
    const res = await handle(post({ prompt: 'hello' }), ENV);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { text: 'hi there', provider: 'gemini' });
  });
});

test('503 with the attempt trail when every provider is exhausted', async () => {
  await withFetch([
    [429, { error: { status: 'RESOURCE_EXHAUSTED' } }],
    [429, { error: { type: 'rate_limit_error' } }],
  ], async () => {
    const res = await handle(post({ prompt: 'hello' }), ENV);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error, 'all providers unavailable');
    assert.equal(body.attempts.length, 2);
  });
});

test('health reports per-provider state', async () => {
  const req = new Request('http://gw/v1/health', { headers: { authorization: `Bearer ${ENV.DEVICE_TOKEN}` } });
  const body = await (await handle(req, ENV)).json();
  assert.deepEqual(body.providers.map((p) => p.provider), ['gemini', 'anthropic']);
  assert.equal(body.providers[0].liveKeys, 1);
});

test('config: providers without keys are dropped, not fatal', () => {
  const warnings = [];
  const p = providersFromEnv(
    { PROVIDER_ORDER: 'gemini,anthropic,groq', GEMINI_API_KEYS: 'g1' },
    (m) => warnings.push(m),
  );
  assert.deepEqual(p.map((x) => x.adapter.id), ['gemini']);
  assert.equal(warnings.length, 2);
});

test('config: an unknown provider name is skipped with a warning', () => {
  const warnings = [];
  const p = providersFromEnv({ PROVIDER_ORDER: 'nope,gemini', GEMINI_API_KEYS: 'g' }, (m) => warnings.push(m));
  assert.deepEqual(p.map((x) => x.adapter.id), ['gemini']);
  assert.match(warnings[0], /unknown provider/);
});

test('config: a custom OpenAI-compatible provider is wired up', () => {
  const p = providersFromEnv({
    PROVIDER_ORDER: 'custom:llama',
    CUSTOM_LLAMA_BASE_URL: 'https://openrouter.ai/api/v1',
    CUSTOM_LLAMA_API_KEYS: 'k1,k2',
    CUSTOM_LLAMA_MODEL: 'meta-llama/llama-3.3-70b',
  });
  assert.equal(p.length, 1);
  assert.equal(p[0].adapter.id, 'custom:llama');
  assert.equal(p[0].keys.length, 2);
});
