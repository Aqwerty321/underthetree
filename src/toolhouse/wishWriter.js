// src/toolhouse/wishWriter.js
// Best-effort wish persistence via Toolhouse Agent (server-side write).

import { callToolhouseAgentPayload, ToolhouseAgentError } from './agentClient.js';

function extractFirstJson(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  if (start === -1) return null;

  // Very small, safe JSON object extractor (balanced braces, ignoring strings).
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') depth++;
    if (ch === '}') depth--;

    if (depth === 0) {
      const candidate = s.slice(start, i + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        return null;
      }
    }
  }

  return null;
}

export async function submitWishToToolhouseAgent({ db_payload, client_op_id, timeoutMs = 15000 } = {}) {
  const id = String(client_op_id || db_payload?.id || '').trim();
  if (!id) throw new Error('missing_client_op_id');

  // Keep the record simple and explicit.
  const record = {
    id,
    user_id: db_payload?.user_id ?? null,
    text: db_payload?.text ?? null,
    summary: db_payload?.summary ?? null,
    tags: Array.isArray(db_payload?.tags) ? db_payload.tags : [],
    is_public: Boolean(db_payload?.is_public),
    synced: true
  };

  // Strict command envelope (preferred): reduces agent ambiguity and avoids UNKNOWN_COMMAND.
  const payload = {
    command: 'UPSERT_WISH',
    record
  };

  let text;
  try {
    text = await callToolhouseAgentPayload(payload, { timeoutMs });
  } catch (e) {
    if (e instanceof ToolhouseAgentError) throw e;
    throw new Error(String(e?.message || e));
  }

  const obj = extractFirstJson(text);
  if (obj && typeof obj === 'object') {
    if (obj.ok === true) return { ok: true, id: obj.id || id };
    if (obj.ok === false) throw new Error(String(obj.error || 'toolhouse_wish_failed'));
  }

  // If the agent didn't return structured JSON, treat it as failure.
  throw new Error('toolhouse_wish_malformed_response');
}
