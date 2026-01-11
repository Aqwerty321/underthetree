// src/model/modelClient.js
// Provider-agnostic model client: Ollama primary, Toolhouse fallback.

import { callOllama, callToolhouse, parseJsonStrict, ProviderError } from './providers.js';
import { validateModelResponse } from './schemas.js';

const DEFAULT_TIMEOUT_MS = 10000;

export class ModelClient {
  constructor({ telemetry } = {}) {
    this.telemetry = telemetry;
  }

  async request(operation, payload, { timeoutMs = DEFAULT_TIMEOUT_MS, stream = false, onProgress, clientOpId } = {}) {
    const start = performance.now();

    const toolhouseConfigured = import.meta.env.PROD
      ? true
      : Boolean(import.meta.env.VITE_TOOLHOUSE_URL && import.meta.env.VITE_TOOLHOUSE_API_KEY);
    const primary = import.meta.env.PROD && toolhouseConfigured ? 'toolhouse' : 'ollama';
    const secondary = primary === 'ollama' ? 'toolhouse' : 'ollama';

    const attempt = async (providerName) => {
      const fn = providerName === 'ollama' ? callOllama : callToolhouse;
      const { provider, text } = await fn({
        operation,
        input: payload,
        timeoutMs,
        stream,
        onStreamChunk: (p) => onProgress?.({ provider: providerName, ...p })
      });

      const obj = parseJsonStrict(text, provider);
      const validated = validateModelResponse(operation, obj);
      return { provider, validated };
    };

    // Primary provider.
    try {
      const { provider, validated } = await attempt(primary);
      const durationMs = Math.round(performance.now() - start);
      this.telemetry?.emit?.('wish_submitted', {
        clientOpId: clientOpId || null,
        providerUsed: provider,
        durationMs,
        textLength: typeof payload?.text === 'string' ? payload.text.length : null,
        operation
      });
      return { ok: true, operation, result: validated, meta: { providerUsed: provider, durationMs, fallback: false } };
    } catch (e) {
      const err = e;
      const reason = err instanceof ProviderError ? err.code : 'UNKNOWN';

      // Fallback exactly once.
      this.telemetry?.emit?.('model_provider_fallback', {
        clientOpId: clientOpId || null,
        from: primary,
        to: secondary,
        reason,
        operation
      });

      try {
        const { provider, validated } = await attempt(secondary);
        const durationMs = Math.round(performance.now() - start);
        this.telemetry?.emit?.('wish_submitted', {
          clientOpId: clientOpId || null,
          providerUsed: provider,
          durationMs,
          textLength: typeof payload?.text === 'string' ? payload.text.length : null,
          operation
        });
        return { ok: true, operation, result: validated, meta: { providerUsed: provider, durationMs, fallback: true, fallbackFrom: reason } };
      } catch (e2) {
        const durationMs = Math.round(performance.now() - start);
        const code = e2 instanceof ProviderError ? e2.code : 'UNKNOWN';
        const final = new Error('Model request failed');
        final.name = 'ModelRequestError';
        final.operation = operation;
        final.code = code;
        final.durationMs = durationMs;
        throw final;
      }
    }
  }
}
