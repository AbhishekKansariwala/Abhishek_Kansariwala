// Provider adapters. Each one turns a prompt into text and, crucially,
// classifies failures into a shared vocabulary the failover engine understands.
//
// Classification matters more than it looks. Verified against the live APIs:
//   - Anthropic answers 401 for a bad key.
//   - Gemini answers *400* for a bad key, with details[].reason=API_KEY_INVALID.
// So a failover rule written against HTTP status alone would treat a dead
// Gemini key as a malformed request and never switch providers.

/** @typedef {'exhausted'|'auth'|'server'|'bad_request'} FailKind */

export class ProviderError extends Error {
  /** @param {FailKind} kind */
  constructor(kind, message, { status = 0, retryAfterMs = 0 } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

const retryAfterMs = (headers) => {
  const v = headers?.get?.('retry-after');
  if (!v) return 0;
  const secs = Number(v);
  return Number.isFinite(secs) ? secs * 1000 : 0;
};

// --------------------------------------------------------------- Gemini ---
export const gemini = {
  id: 'gemini',
  defaultModel: 'gemini-2.0-flash',
  endpoint: (model) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,

  async call({ key, model, system, prompt, maxTokens, signal, fetchImpl = fetch }) {
    const res = await fetchImpl(this.endpoint(model || this.defaultModel), {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw this.classify(res, body);

    const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
    if (!text) throw new ProviderError('server', 'gemini returned no text');
    return text;
  },

  classify(res, body) {
    const err = body?.error ?? {};
    const reason = err?.details?.find?.((d) => d.reason)?.reason ?? '';
    const status = err?.status ?? '';
    const wait = retryAfterMs(res.headers);

    if (res.status === 429 || status === 'RESOURCE_EXHAUSTED')
      return new ProviderError('exhausted', err.message || 'gemini quota', { status: res.status, retryAfterMs: wait });
    // A bad key comes back as 400, not 401 -- match on the reason, not the code.
    if (reason === 'API_KEY_INVALID' || res.status === 401 || res.status === 403)
      return new ProviderError('auth', err.message || 'gemini auth', { status: res.status });
    if (res.status >= 500)
      return new ProviderError('server', err.message || 'gemini server', { status: res.status });
    return new ProviderError('bad_request', err.message || 'gemini bad request', { status: res.status });
  },
};

// ------------------------------------------------------------ Anthropic ---
// Raw HTTP rather than @anthropic-ai/sdk so every provider here shares one
// adapter shape; pulling one SDK in beside three fetch adapters would make the
// failover path inconsistent.
export const anthropic = {
  id: 'anthropic',
  defaultModel: 'claude-opus-5-5',
  endpoint: 'https://api.anthropic.com/v1/messages',

  async call({ key, model, system, prompt, maxTokens, signal, fetchImpl = fetch }) {
    const res = await fetchImpl(this.endpoint, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || this.defaultModel,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        // Short spoken replies: keep effort low so the robot answers quickly.
        // Thinking cannot be disabled on this model; effort is the control.
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw this.classify(res, body);

    if (body?.stop_reason === 'refusal')
      throw new ProviderError('bad_request', 'claude declined this request');

    const text = (body?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (!text) throw new ProviderError('server', 'anthropic returned no text');
    return text;
  },

  classify(res, body) {
    const t = body?.error?.type ?? '';
    const msg = body?.error?.message ?? 'anthropic error';
    const wait = retryAfterMs(res.headers);

    if (res.status === 429 || t === 'rate_limit_error')
      return new ProviderError('exhausted', msg, { status: res.status, retryAfterMs: wait });
    if (res.status === 401 || res.status === 403 || t === 'authentication_error' || t === 'permission_error')
      return new ProviderError('auth', msg, { status: res.status });
    // 529 is Anthropic's "overloaded" -- worth trying someone else.
    if (res.status >= 500 || t === 'overloaded_error')
      return new ProviderError('server', msg, { status: res.status });
    return new ProviderError('bad_request', msg, { status: res.status });
  },
};

// --------------------------------------------- OpenAI-compatible family ---
// Covers OpenAI, Groq, OpenRouter, Together, DeepSeek, Ollama and anything
// else exposing /chat/completions -- point baseUrl at it.
export function openAICompatible({ id, baseUrl, defaultModel }) {
  return {
    id,
    defaultModel,

    async call({ key, model, system, prompt, maxTokens, signal, fetchImpl = fetch }) {
      const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: model || defaultModel,
          max_tokens: maxTokens,
          messages: [
            ...(system ? [{ role: 'system', content: system }] : []),
            { role: 'user', content: prompt },
          ],
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw this.classify(res, body);

      const text = body?.choices?.[0]?.message?.content ?? '';
      if (!text) throw new ProviderError('server', `${id} returned no text`);
      return text;
    },

    classify(res, body) {
      const code = body?.error?.code ?? '';
      const type = body?.error?.type ?? '';
      const msg = body?.error?.message ?? `${id} error`;
      const wait = retryAfterMs(res.headers);

      // insufficient_quota arrives as 429 on OpenAI but 403 on some clones.
      if (res.status === 429 || code === 'insufficient_quota' || type === 'insufficient_quota')
        return new ProviderError('exhausted', msg, { status: res.status, retryAfterMs: wait });
      if (res.status === 401 || res.status === 403 || code === 'invalid_api_key')
        return new ProviderError('auth', msg, { status: res.status });
      if (res.status >= 500)
        return new ProviderError('server', msg, { status: res.status });
      return new ProviderError('bad_request', msg, { status: res.status });
    },
  };
}

export const ADAPTERS = {
  gemini,
  anthropic,
  openai: openAICompatible({ id: 'openai', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' }),
  groq: openAICompatible({ id: 'groq', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile' }),
};
