// src/toolhouse/agentClient.js
// Calls the Toolhouse Agent via a same-origin proxy (/api/toolhouse-agent).

export class ToolhouseAgentError extends Error {
  constructor(message, { code, cause } = {}) {
    super(message);
    this.name = 'ToolhouseAgentError';
    this.code = code || 'AGENT_ERROR';
    this.cause = cause;
  }
}

async function readResponseText(res, { stream = false, onChunk } = {}) {
  const runId = res.headers.get('x-toolhouse-run-id') || null;

  if (!stream && typeof onChunk !== 'function') {
    const text = await res.text();
    return { text, runId };
  }

  const reader = res.body?.getReader?.();
  if (!reader) {
    const text = await res.text();
    return { text, runId };
  }

  const decoder = new TextDecoder('utf-8');
  let text = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    text += chunk;
    if (typeof onChunk === 'function') onChunk(chunk);
  }

  // Flush decoder.
  text += decoder.decode();
  return { text, runId };
}

export async function callToolhouseAgentRequest(
  {
    method = 'POST',
    runId = null,
    message,
    payload,
    stream = false,
    accept = null,
    timeoutMs = 15000,
    onChunk
  } = {}
) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL('/api/toolhouse-agent', window.location.origin);
    if (runId) url.searchParams.set('runId', runId);
    if (stream) url.searchParams.set('stream', '1');

    // Body rules:
    // - If payload is provided, send { payload }
    // - Else if message is provided, send { message }
    // - Else send an empty body (curl-style POST)
    const hasPayload = payload && typeof payload === 'object';
    const hasMessage = typeof message === 'string';
    const shouldSendJson = hasPayload || hasMessage || stream;

    const headers = {};
    if (accept) headers.accept = accept;
    if (shouldSendJson) headers['content-type'] = 'application/json';

    const body = shouldSendJson
      ? JSON.stringify(
          hasPayload ? { payload, stream } : hasMessage ? { message, stream } : { stream }
        )
      : undefined;

    const res = await fetch(url.toString(), {
      method,
      headers,
      body,
      signal: controller.signal
    });

    const { text, runId: returnedRunId } = await readResponseText(res, { stream, onChunk });

    if (!res.ok) {
      throw new ToolhouseAgentError(`Toolhouse agent HTTP ${res.status}`, {
        code: res.status === 501 ? 'NOT_CONFIGURED' : 'HTTP',
        cause: text
      });
    }

    return { text, runId: returnedRunId };
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw new ToolhouseAgentError('Toolhouse agent timeout', { code: 'TIMEOUT', cause: e });
    }
    if (e instanceof ToolhouseAgentError) throw e;
    throw new ToolhouseAgentError('Toolhouse agent request failed', { code: 'NETWORK', cause: e });
  } finally {
    clearTimeout(t);
  }
}

export async function callToolhouseAgent(message, { timeoutMs = 15000 } = {}) {
  const { text } = await callToolhouseAgentRequest({ method: 'POST', message, timeoutMs });
  return text;
}

export async function callToolhouseAgentPayload(payload, { timeoutMs = 15000 } = {}) {
  const { text } = await callToolhouseAgentRequest({ method: 'POST', payload, timeoutMs });
  return text;
}

// Convenience helper for the docs' curl-style public-agent call: POST with no body.
export async function callToolhouseAgentNoBody({ timeoutMs = 15000, stream = false, onChunk } = {}) {
  return callToolhouseAgentRequest({ method: 'POST', stream, timeoutMs, onChunk });
}

// Convenience helper for continuing a conversation: PUT with runId.
export async function continueToolhouseAgentRun(runId, {
  message,
  payload,
  timeoutMs = 15000,
  stream = false,
  onChunk
} = {}) {
  return callToolhouseAgentRequest({ method: 'PUT', runId, message, payload, stream, timeoutMs, onChunk });
}
