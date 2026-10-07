import { ProviderError } from './providers.mjs';

export class AllProvidersFailed extends Error {
  constructor(attempts) {
    super('every provider failed');
    this.name = 'AllProvidersFailed';
    this.attempts = attempts;
  }
}

const DEFAULT_COOLDOWN_MS = 60_000;

/**
 * Ordered provider rotation with per-key and per-provider state.
 *
 * Rules, by failure kind:
 *   exhausted   -> this provider is out of quota: cool it down (honouring
 *                  Retry-After) and move to the next provider.
 *   auth        -> this *key* is bad: mark it dead, try the provider's next
 *                  key, then the next provider.
 *   server      -> transient: try the next key, then the next provider.
 *   bad_request -> our request is malformed. Stop. Retrying it on every
 *                  provider in turn would just burn quota to fail N times.
 */
export function createRouter({
  providers,
  now = () => Date.now(),
  fetchImpl = fetch,
  cooldownMs = DEFAULT_COOLDOWN_MS,
  timeoutMs = 20_000,
}) {
  if (!providers?.length) throw new Error('createRouter: no providers configured');

  const state = providers.map((p) => ({
    ...p,
    cooldownUntil: 0,
    deadKeys: new Set(),
  }));

  async function callOnce(entry, key, req) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await entry.adapter.call({
        key,
        model: entry.model,
        system: req.system,
        prompt: req.prompt,
        maxTokens: req.maxTokens ?? 300,
        signal: controller.signal,
        fetchImpl,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    /** Exposed for health endpoints and tests. */
    status() {
      const t = now();
      return state.map((e) => ({
        provider: e.adapter.id,
        coolingDown: e.cooldownUntil > t,
        cooldownRemainingMs: Math.max(0, e.cooldownUntil - t),
        liveKeys: e.keys.length - e.deadKeys.size,
        totalKeys: e.keys.length,
      }));
    },

    async ask(req) {
      const attempts = [];

      for (const entry of state) {
        const id = entry.adapter.id;

        if (entry.cooldownUntil > now()) {
          attempts.push({ provider: id, skipped: 'cooling_down' });
          continue;
        }
        if (entry.deadKeys.size >= entry.keys.length) {
          attempts.push({ provider: id, skipped: 'no_live_keys' });
          continue;
        }

        for (let i = 0; i < entry.keys.length; i++) {
          if (entry.deadKeys.has(i)) continue;

          try {
            const text = await callOnce(entry, entry.keys[i], req);
            attempts.push({ provider: id, keyIndex: i, ok: true });
            return { text, provider: id, keyIndex: i, attempts };
          } catch (err) {
            const kind =
              err instanceof ProviderError ? err.kind
              : err?.name === 'AbortError' ? 'server'
              : 'server';
            attempts.push({ provider: id, keyIndex: i, kind, message: err.message });

            if (kind === 'bad_request') throw err;        // ours, not theirs
            if (kind === 'auth') { entry.deadKeys.add(i); continue; }
            if (kind === 'exhausted') {
              entry.cooldownUntil = now() + (err.retryAfterMs || cooldownMs);
              break;                                       // next provider
            }
            // server: fall through to this provider's next key
          }
        }
      }

      throw new AllProvidersFailed(attempts);
    },
  };
}
