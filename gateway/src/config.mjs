import { ADAPTERS, openAICompatible } from './providers.mjs';

const list = (v) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/**
 * Builds the provider chain from environment variables.
 *
 *   PROVIDER_ORDER=gemini,anthropic,groq,openai,custom:llama
 *   GEMINI_API_KEYS=k1,k2          GEMINI_MODEL=gemini-2.0-flash
 *   ANTHROPIC_API_KEYS=k1          ANTHROPIC_MODEL=claude-opus-5-5
 *   GROQ_API_KEYS=k1               GROQ_MODEL=llama-3.3-70b-versatile
 *   OPENAI_API_KEYS=k1             OPENAI_MODEL=gpt-4o-mini
 *
 * Any other OpenAI-compatible endpoint (OpenRouter, Together, DeepSeek, a
 * self-hosted vLLM or Ollama) goes in as `custom:<name>`:
 *   CUSTOM_LLAMA_BASE_URL=https://openrouter.ai/api/v1
 *   CUSTOM_LLAMA_API_KEYS=k1       CUSTOM_LLAMA_MODEL=meta-llama/llama-3.3-70b
 *
 * Order is the failover order. Providers with no keys are dropped with a
 * warning rather than failing the boot, so losing one key does not take the
 * whole gateway down.
 */
export function providersFromEnv(env, log = console.warn) {
  const order = list(env.PROVIDER_ORDER).length
    ? list(env.PROVIDER_ORDER)
    : ['gemini', 'anthropic', 'groq', 'openai'];

  const out = [];
  for (const name of order) {
    if (name.startsWith('custom:')) {
      const slug = name.slice(7).toUpperCase().replace(/[^A-Z0-9]/g, '_');
      const baseUrl = env[`CUSTOM_${slug}_BASE_URL`];
      const keys = list(env[`CUSTOM_${slug}_API_KEYS`]);
      if (!baseUrl) { log(`config: ${name} has no CUSTOM_${slug}_BASE_URL, skipping`); continue; }
      if (!keys.length) { log(`config: ${name} has no keys, skipping`); continue; }
      out.push({
        adapter: openAICompatible({ id: name, baseUrl, defaultModel: env[`CUSTOM_${slug}_MODEL`] }),
        keys,
        model: env[`CUSTOM_${slug}_MODEL`],
      });
      continue;
    }

    const adapter = ADAPTERS[name];
    if (!adapter) { log(`config: unknown provider "${name}", skipping`); continue; }
    const keys = list(env[`${name.toUpperCase()}_API_KEYS`]);
    if (!keys.length) { log(`config: ${name} has no keys, skipping`); continue; }
    out.push({ adapter, keys, model: env[`${name.toUpperCase()}_MODEL`] });
  }
  return out;
}
