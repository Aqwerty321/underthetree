// src/db/supabaseClient.js
// Thin wrapper around Supabase JS client with enqueueable errors.

import { createClient } from '@supabase/supabase-js';

function makeUuid() {
  try {
    return crypto.randomUUID();
  } catch {
    return `u_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

export class SupabaseWriteError extends Error {
  constructor(message, { code, enqueueOp, cause } = {}) {
    super(message);
    this.name = 'SupabaseWriteError';
    this.code = code || 'SUPABASE_WRITE_FAILED';
    this.enqueueOp = enqueueOp || null;
    this.cause = cause;
  }
}

export function createSupabaseClient() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey);
}

export class SupabaseClientWrapper {
  constructor({ telemetry } = {}) {
    this.telemetry = telemetry;
    this.client = createSupabaseClient();
  }

  isConfigured() {
    return Boolean(this.client);
  }

  // Accepts validated payload (user_id, text, is_public, tags, summary)
  // Adds a client-generated id to provide idempotency.
  async createWish(db_payload, { clientOpId } = {}) {
    const client_op_id = clientOpId || db_payload?.id || makeUuid();
    const payload = {
      id: client_op_id,
      user_id: db_payload.user_id ?? null,
      text: db_payload.text,
      summary: db_payload.summary ?? null,
      tags: db_payload.tags ?? [],
      is_public: Boolean(db_payload.is_public),
      // Client bookkeeping (optional field per spec)
      synced: true
    };

    const enqueueOp = {
      opType: 'CREATE_WISH',
      payload: {
        ...payload,
        synced: false
      }
    };

    if (!this.client) {
      throw new SupabaseWriteError('Supabase not configured', { code: 'NOT_CONFIGURED', enqueueOp });
    }

    try {
      const { error } = await this.client.from('wishes').insert(payload);
      if (error) {
        const code = String(error.code || 'SUPABASE_ERROR');
        throw new SupabaseWriteError(error.message || 'Supabase insert failed', { code, enqueueOp, cause: error });
      }
      return { ok: true, id: client_op_id };
    } catch (e) {
      if (e instanceof SupabaseWriteError) {
        this.telemetry?.emit?.('wish_synced', { success: false, attempts: 0, reason: e.code });
        throw e;
      }
      const err = new SupabaseWriteError('Supabase insert failed', { code: 'NETWORK_OR_UNKNOWN', enqueueOp, cause: e });
      this.telemetry?.emit?.('wish_synced', { success: false, attempts: 0, reason: err.code });
      throw err;
    }
  }

  // Used by queue handler.
  async createWishFromQueue(payload) {
    if (!this.client) throw new Error('Supabase not configured');
    const { error } = await this.client.from('wishes').insert({ ...payload, synced: true });
    if (error) throw new Error(error.message || 'Supabase insert failed');
    return true;
  }
}
