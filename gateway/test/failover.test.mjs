import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter, AllProvidersFailed } from '../src/failover.mjs';
import { ADAPTERS, gemini, anthropic } from '../src/providers.mjs';

// Minimal fetch stub: a queue of [status, bodyObject, headers] per URL match.
function stubFetch(handlers) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    const h = handlers.shift();
    if (!h) throw new Error('stubFetch: unexpected extra call to ' + url);
    const [status, body, headers = {}] = h;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k) => headers[k.toLowerCase()] ?? null },
      json: async () => body,
    };
  };
  impl.calls = calls;
  return impl;
}

const geminiOk = (t) => [200, { candidates: [{ content: { parts: [{ text: t }] } }] }];
const claudeOk = (t) => [200, { content: [{ type: 'text', text: t }] }];

test('falls over to the next provider when the first is rate limited', async () => {
  const f = stubFetch([
    [429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'quota' } }],
    claudeOk('hello from claude'),
  ]);
  const r = createRouter({
    providers: [
      { adapter: gemini, keys: ['g1'] },
      { adapter: anthropic, keys: ['a1'] },
    ],
    fetchImpl: f,
  });
  const out = await r.ask({ prompt: 'hi' });
  assert.equal(out.text, 'hello from claude');
  assert.equal(out.provider, 'anthropic');
  assert.equal(f.calls.length, 2);
});

test("Gemini's 400-for-a-bad-key is treated as auth, so it still fails over", async () => {
  // The trap: HTTP 400 looks like a malformed request, but the reason field
  // says the key is bad. Status-code-only logic would stop here.
  const f = stubFetch([
    [400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid.',
                     details: [{ reason: 'API_KEY_INVALID' }] } }],
    claudeOk('rescued'),
  ]);
  const r = createRouter({
    providers: [{ adapter: gemini, keys: ['bad'] }, { adapter: anthropic, keys: ['a1'] }],
    fetchImpl: f,
  });
  const out = await r.ask({ prompt: 'hi' });
  assert.equal(out.provider, 'anthropic');
  assert.equal(out.text, 'rescued');
});

test('a genuinely malformed request does NOT burn every provider', async () => {
  const f = stubFetch([[400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'bad field' } }]]);
  const r = createRouter({
    providers: [{ adapter: gemini, keys: ['g1'] }, { adapter: anthropic, keys: ['a1'] }],
    fetchImpl: f,
  });
  await assert.rejects(() => r.ask({ prompt: 'hi' }), /bad field/);
  assert.equal(f.calls.length, 1, 'should stop after the first provider');
});

test('rotates to the second key of the same provider when the first key is dead', async () => {
  const f = stubFetch([
    [401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }],
    claudeOk('second key worked'),
  ]);
  const r = createRouter({ providers: [{ adapter: anthropic, keys: ['dead', 'good'] }], fetchImpl: f });
  const out = await r.ask({ prompt: 'hi' });
  assert.equal(out.keyIndex, 1);
  assert.equal(out.text, 'second key worked');
});

test('a dead key is not retried on the next request', async () => {
  const f = stubFetch([
    [401, { error: { type: 'authentication_error' } }],
    claudeOk('one'),
    claudeOk('two'),
  ]);
  const r = createRouter({ providers: [{ adapter: anthropic, keys: ['dead', 'good'] }], fetchImpl: f });
  await r.ask({ prompt: 'a' });
  await r.ask({ prompt: 'b' });
  assert.equal(f.calls.length, 3, 'the dead key should be skipped the second time');
  assert.equal(r.status()[0].liveKeys, 1);
});

test('an exhausted provider stays cooled down, then recovers', async () => {
  let clock = 1_000_000;
  const f = stubFetch([
    [429, { error: { status: 'RESOURCE_EXHAUSTED' } }, { 'retry-after': '30' }],
    claudeOk('claude covers'),
    claudeOk('still claude'),
    geminiOk('gemini is back'),
  ]);
  const r = createRouter({
    providers: [{ adapter: gemini, keys: ['g1'] }, { adapter: anthropic, keys: ['a1'] }],
    fetchImpl: f,
    now: () => clock,
  });

  assert.equal((await r.ask({ prompt: '1' })).provider, 'anthropic');
  clock += 10_000;                       // inside the 30s Retry-After
  const second = await r.ask({ prompt: '2' });
  assert.equal(second.provider, 'anthropic');
  assert.ok(second.attempts.some((a) => a.skipped === 'cooling_down'), 'gemini should be skipped, not called');

  clock += 30_000;                       // past it
  assert.equal((await r.ask({ prompt: '3' })).provider, 'gemini');
});

test('reports AllProvidersFailed with the attempt trail when everything is out', async () => {
  const f = stubFetch([
    [429, { error: { status: 'RESOURCE_EXHAUSTED' } }],
    [429, { error: { type: 'rate_limit_error' } }],
  ]);
  const r = createRouter({
    providers: [{ adapter: gemini, keys: ['g1'] }, { adapter: anthropic, keys: ['a1'] }],
    fetchImpl: f,
  });
  await assert.rejects(
    () => r.ask({ prompt: 'hi' }),
    (e) => e instanceof AllProvidersFailed && e.attempts.length === 2,
  );
});

test('an OpenAI-compatible provider (groq) works through the same path', async () => {
  const f = stubFetch([[200, { choices: [{ message: { content: 'groq says hi' } }] }]]);
  const r = createRouter({ providers: [{ adapter: ADAPTERS.groq, keys: ['k'] }], fetchImpl: f });
  const out = await r.ask({ prompt: 'hi' });
  assert.equal(out.text, 'groq says hi');
  assert.match(f.calls[0].url, /api\.groq\.com.*\/chat\/completions$/);
});

test('a request timeout is treated as transient and fails over', async () => {
  const slow = async (url, init) => {
    if (String(url).includes('googleapis')) {
      await new Promise((_, rej) =>
        init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    }
    return { ok: true, status: 200, headers: { get: () => null },
             json: async () => ({ content: [{ type: 'text', text: 'claude after timeout' }] }) };
  };
  const r = createRouter({
    providers: [{ adapter: gemini, keys: ['g1'] }, { adapter: anthropic, keys: ['a1'] }],
    fetchImpl: slow,
    timeoutMs: 50,
  });
  const out = await r.ask({ prompt: 'hi' });
  assert.equal(out.provider, 'anthropic');
});
