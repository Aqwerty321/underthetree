// src/utils/pendingQueue.js
// Offline-friendly persistent queue with exponential backoff + jitter.

import { wait } from './syncUtils.js';

const STORAGE_KEY = 'underthetree.pendingQueue';

function nowMs() {
  return Date.now();
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function jitteredDelayMs(baseDelayMs, multiplier, attempts) {
  const exp = baseDelayMs * Math.pow(multiplier, Math.max(0, attempts));
  const jitter = exp * 0.25;
  const r = (Math.random() * 2 - 1) * jitter;
  return Math.max(0, exp + r);
}

function loadQueue() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveQueue(items) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

function makeId() {
  // Prefer crypto UUID; fallback to timestamp-based.
  try {
    return crypto.randomUUID();
  } catch {
    return `q_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

export class PendingQueue {
  constructor({
    baseDelayMs = 2000,
    multiplier = 2,
    maxAttempts = 6,
    onChange,
    onItemFailed,
    telemetry
  } = {}) {
    this.baseDelayMs = baseDelayMs;
    this.multiplier = multiplier;
    this.maxAttempts = maxAttempts;
    this.onChange = onChange;
    this.onItemFailed = onItemFailed;
    this.telemetry = telemetry;

    this._processing = false;
  }

  peek() {
    return loadQueue();
  }

  getCounts() {
    const items = loadQueue();
    const pending = items.filter((x) => !x.failed).length;
    const failed = items.filter((x) => x.failed).length;
    return { pending, failed, total: items.length };
  }

  enqueue({ opType, payload }) {
    const items = loadQueue();
    const op = {
      id: makeId(),
      opType,
      payload,
      attempts: 0,
      nextAttemptAt: 0,
      createdAt: new Date().toISOString(),
      failed: false,
      lastError: null
    };

    items.push(op);
    saveQueue(items);
    this.telemetry?.emit?.('queue_enqueue', { opType });
    this.onChange?.(this.getCounts());

    // Attempt immediately.
    this.process();

    return op;
  }

  discard(id) {
    const items = loadQueue().filter((x) => x.id !== id);
    saveQueue(items);
    this.onChange?.(this.getCounts());
  }

  async process({ handlers, force = false } = {}) {
    if (this._processing) return;
    this._processing = true;

    try {
      // Simple loop: run at most one full pass per call.
      let items = loadQueue();
      const start = nowMs();

      for (let i = 0; i < items.length; i++) {
        const op = items[i];
        if (!op || op.failed) continue;

        if (!force) {
          const t = Number(op.nextAttemptAt || 0);
          if (t > nowMs()) continue;
        }

        if (!navigator.onLine) {
          // Offline: schedule next attempt.
          op.attempts = Number(op.attempts || 0) + 1;
          const d = jitteredDelayMs(this.baseDelayMs, this.multiplier, op.attempts);
          op.nextAttemptAt = nowMs() + d;
          op.lastError = 'offline';
          this.telemetry?.emit?.('wish_synced', { success: false, attempts: op.attempts, reason: 'offline' });
          continue;
        }

        const handler = handlers?.[op.opType];
        if (typeof handler !== 'function') {
          op.failed = true;
          op.lastError = `Missing handler for ${op.opType}`;
          this.telemetry?.emit?.('queue_failed_item', { opType: op.opType, reason: 'missing_handler' });
          continue;
        }

        try {
          await handler(op.payload);

          // Success: remove item.
          items = loadQueue().filter((x) => x.id !== op.id);
          saveQueue(items);
          this.telemetry?.emit?.('queue_drain', { opType: op.opType, durationMs: nowMs() - start });
          this.telemetry?.emit?.('wish_synced', { success: true, attempts: op.attempts });
          this.onChange?.(this.getCounts());

          // Restart scan since list changed.
          i = -1;
        } catch (e) {
          const msg = String(e?.message || e || 'unknown_error');
          const isNonRetryable = msg.startsWith('non_retryable:');
          op.attempts = Number(op.attempts || 0) + 1;
          op.lastError = msg;

          if (isNonRetryable || op.attempts >= this.maxAttempts) {
            op.failed = true;
            op.nextAttemptAt = 0;
            if (isNonRetryable) op.attempts = this.maxAttempts;
            this.telemetry?.emit?.('queue_failed_item', { opType: op.opType, reason: 'max_attempts' });
            this.telemetry?.emit?.('wish_synced', { success: false, attempts: op.attempts, reason: 'max_attempts' });

            try {
              this.onItemFailed?.(op);
            } catch {
              // ignore
            }
          } else {
            const d = jitteredDelayMs(this.baseDelayMs, this.multiplier, op.attempts);
            op.nextAttemptAt = nowMs() + d;
            this.telemetry?.emit?.('wish_synced', { success: false, attempts: op.attempts, reason: 'retry' });
          }

          // Persist mutated op.
          const latest = loadQueue();
          const idx = latest.findIndex((x) => x.id === op.id);
          if (idx !== -1) latest[idx] = op;
          saveQueue(latest);
          this.onChange?.(this.getCounts());

          // Small delay between attempts to avoid tight loops.
          await wait(30);
        }
      }
    } finally {
      this._processing = false;
    }
  }
}

export const pendingQueueStorageKey = STORAGE_KEY;
