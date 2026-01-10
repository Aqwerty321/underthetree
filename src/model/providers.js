// src/model/providers.js

import { UNDERTHE_TREE_SYSTEM_PROMPT } from './systemPrompt.js';

function isObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

export class ProviderError extends Error {
  constructor(message, { code, provider, cause } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code || 'PROVIDER_ERROR';
    this.provider = provider || 'unknown';
    this.cause = cause;
  }
}

export async function callOllama({ operation, input, timeoutMs = 10000, stream = false, onStreamChunk } = {}) {
  // Dev default: use the Vite proxy (/ollama) to avoid browser CORS issues.
  // Production: Vercel (or any hosted frontend) cannot reach your laptop's Ollama.
  // If you want Ollama in production, set VITE_OLLAMA_URL to a reachable hosted endpoint.
  const configuredBase = String(import.meta.env.VITE_OLLAMA_URL || '').trim();
  const defaultBase = import.meta.env.DEV ? '/ollama' : '';
  const base = configuredBase || defaultBase;
  if (!base) {
    throw new ProviderError('Ollama not configured', { code: 'NOT_CONFIGURED', provider: 'ollama' });
  }
  const url = base.replace(/\/$/, '') + '/api/chat';
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  let inactivityTimer = null;
  const bumpInactivity = () => {
    if (!stream) return;
    if (inactivityTimer) clearTimeout(inactivityTimer);
    // Abort if no stream data arrives for 6s.
    inactivityTimer = setTimeout(() => controller.abort(), 6000);
  };

  const body = {
    model: import.meta.env.VITE_OLLAMA_MODEL || 'llama3.2:3b',
    stream: Boolean(stream),
    options: {
      temperature: 0.0,
      top_p: 1.0,
      num_predict: 256
    },
    messages: [
      { role: 'system', content: UNDERTHE_TREE_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify({ operation, ...input }) }
    ]
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!res.ok) {
      throw new ProviderError(`Ollama HTTP ${res.status}`, { code: 'HTTP', provider: 'ollama' });
    }

    if (!stream) {
      const json = await res.json();
      const content = json?.message?.content;
      if (typeof content !== 'string') throw new ProviderError('Ollama missing message.content', { code: 'MALFORMED', provider: 'ollama' });
      return { provider: 'ollama', text: content };
    }

    // Streaming: NDJSON lines.
    const reader = res.body?.getReader();
    if (!reader) throw new ProviderError('Ollama missing response body', { code: 'MALFORMED', provider: 'ollama' });

    const decoder = new TextDecoder();
    let buf = '';
    let full = '';
    let chunks = 0;

    bumpInactivity();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bumpInactivity();
      buf += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;

        let obj;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }

        const part = obj?.message?.content;
        if (typeof part === 'string' && part.length) {
          full += part;
          chunks += 1;
          onStreamChunk?.({ chunks, bytes: full.length });
        }

        if (obj?.done) {
          buf = '';
          break;
        }
      }
    }

    if (!full) throw new ProviderError('Ollama stream produced no content', { code: 'EMPTY', provider: 'ollama' });
    return { provider: 'ollama', text: full };
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    const msg = e?.name === 'AbortError' ? 'Ollama timeout' : 'Ollama request failed';
    throw new ProviderError(msg, { code: e?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', provider: 'ollama', cause: e });
  } finally {
    clearTimeout(t);
    if (inactivityTimer) clearTimeout(inactivityTimer);
  }
}

export async function callToolhouse({ operation, input, timeoutMs = 10000, stream = false, onStreamChunk } = {}) {
  // Toolhouse API details are intentionally configurable via env.
  // Expect an OpenAI-compatible chat completions endpoint.
  const endpoint = import.meta.env.VITE_TOOLHOUSE_URL;
  const apiKey = import.meta.env.VITE_TOOLHOUSE_API_KEY;

  if (!endpoint || !apiKey) {
    throw new ProviderError('Toolhouse not configured', { code: 'NOT_CONFIGURED', provider: 'toolhouse' });
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  let inactivityTimer = null;
  const bumpInactivity = () => {
    if (!stream) return;
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => controller.abort(), 6000);
  };

  const body = {
    model: import.meta.env.VITE_TOOLHOUSE_MODEL || 'gpt-4o-mini',
    stream: Boolean(stream),
    temperature: 0.0,
    top_p: 1.0,
    max_tokens: 256,
    messages: [
      { role: 'system', content: UNDERTHE_TREE_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify({ operation, ...input }) }
    ]
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!res.ok) {
      throw new ProviderError(`Toolhouse HTTP ${res.status}`, { code: 'HTTP', provider: 'toolhouse' });
    }

    if (!stream) {
      const json = await res.json();
      const content = json?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new ProviderError('Toolhouse missing choices[0].message.content', { code: 'MALFORMED', provider: 'toolhouse' });
      return { provider: 'toolhouse', text: content };
    }

    // Streaming: SSE (OpenAI style) preferred; tolerate plain text.
    const reader = res.body?.getReader();
    if (!reader) throw new ProviderError('Toolhouse missing response body', { code: 'MALFORMED', provider: 'toolhouse' });

    const decoder = new TextDecoder();
    let buf = '';
    let full = '';
    let chunks = 0;

    bumpInactivity();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bumpInactivity();
      buf += decoder.decode(value, { stream: true });

      // Parse SSE lines: data: {...}
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        if (line === 'data: [DONE]') {
          buf = '';
          break;
        }
        const payload = line.startsWith('data:') ? line.slice(5).trim() : line;
        let obj;
        try {
          obj = JSON.parse(payload);
        } catch {
          continue;
        }

        const part = obj?.choices?.[0]?.delta?.content;
        if (typeof part === 'string' && part.length) {
          full += part;
          chunks += 1;
          onStreamChunk?.({ chunks, bytes: full.length });
        }
      }
    }

    if (!full) throw new ProviderError('Toolhouse stream produced no content', { code: 'EMPTY', provider: 'toolhouse' });
    return { provider: 'toolhouse', text: full };
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    const msg = e?.name === 'AbortError' ? 'Toolhouse timeout' : 'Toolhouse request failed';
    throw new ProviderError(msg, { code: e?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', provider: 'toolhouse', cause: e });
  } finally {
    clearTimeout(t);
    if (inactivityTimer) clearTimeout(inactivityTimer);
  }
}

export function parseJsonStrict(text, provider) {
  // Must be strict JSON-only; reject leading/trailing noise.
  const trimmed = String(text ?? '').trim();
  try {
    const obj = JSON.parse(trimmed);
    if (!isObject(obj)) throw new Error('Not a JSON object');
    return obj;
  } catch (e) {
    throw new ProviderError('Malformed JSON from provider', { code: 'MALFORMED_JSON', provider, cause: e });
  }
}
