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

  // Manual fallback for gift opening when the Toolhouse agent fails/timeouts.
  // Uses the DB-side preference logic (RPC) to pick + record an open.
  async openGiftForUser({ user_id, client_op_id, timeoutMs = 8000 } = {}) {
    if (!this.client) throw new SupabaseWriteError('Supabase not configured', { code: 'NOT_CONFIGURED' });

    const uid = String(user_id || 'anonymous');
    const cop = client_op_id != null && String(client_op_id).trim() ? String(client_op_id).trim() : null;

    const startedAt = Date.now();
    const remainingMs = () => Math.max(1000, timeoutMs - (Date.now() - startedAt));

    const raceTimeout = (promise, ms, code) =>
      Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(code || 'timeout')), Math.max(1000, ms)))
      ]);

    const callRpc = async (args) => {
      const rpcPromise = this.client.rpc('open_gift_for_user', args);
      const res = await raceTimeout(rpcPromise, timeoutMs, 'supabase_rpc_timeout');
      return { data: res?.data, error: res?.error, status: res?.status, statusText: res?.statusText };
    };

    const directOpenFallback = async () => {
      // 1) If this client op id already exists, return it (idempotent behavior).
      if (cop) {
        try {
          const res = await raceTimeout(
            this.client
              .from('user_gift_opens')
              .select('id, opened_at, gift_id, client_op_id, gift:gifts!user_gift_opens_gift_id_fkey(title, description, meta)')
              .eq('client_op_id', cop)
              .order('opened_at', { ascending: false })
              .limit(1),
            Math.min(2500, remainingMs()),
            'supabase_select_timeout'
          );
          const row = res?.data?.[0];
          const gift = Array.isArray(row?.gift) ? row.gift[0] : row?.gift;
          if (row?.id) {
            return {
              ok: true,
              open_id: row?.id ?? null,
              gift_id: row?.gift_id ?? null,
              title: gift?.title ?? null,
              description: gift?.description ?? null,
              opened_at: row?.opened_at ?? null,
              reason: null
            };
          }
        } catch {
          // ignore
        }
      }

      // 2) Select a public gift client-side (simple + reliable) and insert an open row.
      const giftListRes = await raceTimeout(
        this.client.from('gifts').select('id, title, description').eq('public', true).limit(200),
        Math.min(3000, remainingMs()),
        'supabase_gifts_timeout'
      );
      const gifts = Array.isArray(giftListRes?.data) ? giftListRes.data : [];
      if (!gifts.length) throw new Error('no_gifts_available');
      const chosen = gifts[Math.floor(Math.random() * gifts.length)];

      const insertRes = await raceTimeout(
        this.client
          .from('user_gift_opens')
          .insert({ user_id: uid, gift_id: chosen.id, client_op_id: cop })
          .select('id, opened_at, gift_id')
          .limit(1),
        Math.min(3000, remainingMs()),
        'supabase_insert_timeout'
      );
      if (insertRes?.error) throw insertRes.error;
      const inserted = Array.isArray(insertRes?.data) ? insertRes.data[0] : insertRes?.data;

      return {
        ok: true,
        open_id: inserted?.id ?? null,
        gift_id: inserted?.gift_id ?? chosen.id ?? null,
        title: chosen?.title ?? null,
        description: chosen?.description ?? null,
        opened_at: inserted?.opened_at ?? null,
        reason: 'random'
      };
    };

    try {
      // Primary (newer) param names.
      let { data, error } = await callRpc({ p_user_id: uid, p_client_op_id: cop });

      // If the project DB has an older function signature, PostgREST often returns a 400/PGRST error.
      // Retry with alternate param keys.
      if (error) {
        const msg = String(error.message || '');
        const code = String(error.code || '');
        const looksLikeSignatureMismatch =
          code.startsWith('PGRST') ||
          /function.*open_gift_for_user/i.test(msg) ||
          /parameters/i.test(msg) ||
          /does not exist/i.test(msg);

        if (looksLikeSignatureMismatch) {
          ({ data, error } = await callRpc({ user_id: uid, client_op_id: cop }));
        }
      }

      // If the RPC route doesn't exist (function missing in this Supabase project), fall back.
      if (error) {
        const msg = String(error.message || '');
        const code = String(error.code || '');
        const notFound = code === '404' || /not found/i.test(msg);
        if (notFound) {
          return await directOpenFallback();
        }
      }

      if (error) {
        const code = String(error.code || 'SUPABASE_RPC_ERROR');
        throw new SupabaseWriteError(error.message || 'Supabase RPC failed', { code, cause: error });
      }

      const row = Array.isArray(data) ? data[0] : data;
      let result = {
        ok: true,
        open_id: row?.open_id ?? null,
        gift_id: row?.gift_id ?? null,
        title: row?.gift_title ?? null,
        description: row?.gift_description ?? null,
        opened_at: row?.opened_at ?? null,
        reason: row?.reason ?? null
      };

      // Best-effort: if the RPC response is missing title/description but we have a gift_id,
      // attempt to fetch the gift record directly (can help when RPC return shape differs).
      if ((!result.title || !result.description) && result.gift_id) {
        try {
          const elapsedMs = Date.now() - startedAt;
          const remainingMs = Math.max(1000, timeoutMs - elapsedMs);
          const selectPromise = this.client
            .from('gifts')
            .select('title, description')
            .eq('id', result.gift_id)
            .limit(1);

          const { data: giftRows } = await Promise.race([
            selectPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('supabase_select_timeout')), Math.min(2500, remainingMs)))
          ]);
          const gift = giftRows?.[0];
          if (!result.title && gift?.title) result.title = gift.title;
          if (!result.description && gift?.description) result.description = gift.description;
        } catch {
          // ignore
        }
      }

      return result;
    } catch (e) {
      if (e instanceof SupabaseWriteError) throw e;
      throw new SupabaseWriteError('Supabase RPC failed', { code: 'NETWORK_OR_UNKNOWN', cause: e });
    }
  }
}
