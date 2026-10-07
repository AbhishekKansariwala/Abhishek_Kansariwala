import { createRouter, AllProvidersFailed } from './failover.mjs';
import { providersFromEnv } from './config.mjs';
import { ProviderError } from './providers.mjs';

let router = null;

/** Test seam: the router is cached per isolate, so tests must clear it. */
export function resetRouter() { router = null; }

function getRouter(env) {
  // Built once per isolate so cooldowns and dead-key state survive requests.
  if (!router) {
    const providers = providersFromEnv(env);
    if (!providers.length) throw new Error('no usable providers configured');
    router = createRouter({ providers, cooldownMs: Number(env.COOLDOWN_MS) || 60_000 });
  }
  return router;
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

// Length-independent comparison so the token can't be guessed a byte at a time.
function tokenMatches(given, expected) {
  if (!expected) return false;
  const a = new TextEncoder().encode(given ?? '');
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function handle(request, env) {
  const url = new URL(request.url);

  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!tokenMatches(bearer, env.DEVICE_TOKEN)) return json({ error: 'unauthorized' }, 401);

  if (url.pathname === '/v1/health') {
    return json({ ok: true, providers: getRouter(env).status() });
  }

  if (url.pathname === '/v1/ask' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
    if (!body?.prompt || typeof body.prompt !== 'string')
      return json({ error: 'prompt is required' }, 400);

    try {
      const r = await getRouter(env).ask({
        prompt: body.prompt,
        system: body.system ?? env.SYSTEM_PROMPT,
        maxTokens: Math.min(Number(body.maxTokens) || 300, 1000),
      });
      // The device only needs the text; provider is handy when debugging.
      return json({ text: r.text, provider: r.provider });
    } catch (err) {
      if (err instanceof AllProvidersFailed)
        return json({ error: 'all providers unavailable', attempts: err.attempts }, 503);
      if (err instanceof ProviderError && err.kind === 'bad_request')
        return json({ error: err.message }, 400);
      return json({ error: 'gateway error' }, 500);
    }
  }

  return json({ error: 'not found' }, 404);
}

// Cloudflare Workers / Deno
export default { fetch: (request, env) => handle(request, env) };

// Node: `node src/index.mjs`
if (globalThis.process?.argv?.[1]?.endsWith('index.mjs')) {
  const { createServer } = await import('node:http');
  const port = Number(process.env.PORT) || 8787;
  createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const out = await handle(request, process.env);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(await out.text());
  }).listen(port, () => console.log(`gateway listening on :${port}`));
}
