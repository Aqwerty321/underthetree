// src/ui/wish/WishModal.js
// Glass modal: "Write a wish for Santa" flow.

import { createGlassButton } from '../GlassButton.js';
import { sanitizeWishText } from '../../wish/sanitize.js';
import { getOrCreateAnonUserId } from '../../utils/anonUserId.js';
import { submitWishToToolhouseAgent } from '../../toolhouse/wishWriter.js';

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function transitionOpacity(el, to, ms, easing) {
  return new Promise((resolve) => {
    const done = () => {
      el.removeEventListener('transitionend', done);
      resolve();
    };
    el.addEventListener('transitionend', done);
    el.style.transition = `opacity ${ms}ms ${easing}`;
    void el.offsetWidth;
    el.style.opacity = String(to);
    setTimeout(done, ms + 50);
  });
}

function makeUuid() {
  try {
    return crypto.randomUUID();
  } catch {
    return `anon_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

function isToolhouseNotConfiguredError(err) {
  const msg = String(err?.message || err || '');
  return msg.includes('NOT_CONFIGURED') || msg.includes('toolhouse_agent_not_configured');
}

function isLikelyToolhouseDownError(err) {
  const msg = String(err?.message || err || '');
  return (
    msg.toLowerCase().includes('toolhouse') ||
    msg.includes('HTTP 5') ||
    msg.includes('HTTP 501') ||
    msg.includes('HTTP 502') ||
    msg.includes('HTTP 503') ||
    msg.includes('timeout') ||
    msg.includes('NETWORK')
  );
}

export class WishModal {
  constructor({ parent, config, runtime, modelClient, supabaseClient, queue, telemetry, toast }) {
    this.parent = parent;
    this.config = config;
    this.runtime = runtime;
    this.modelClient = modelClient;
    this.supabaseClient = supabaseClient;
    this.queue = queue;
    this.telemetry = telemetry;
    this.toast = toast;

    this._open = false;
    this._busy = false;
    this._timers = [];

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'utt-wish-modal-backdrop';
    this.backdrop.style.opacity = '0';

    this.modal = document.createElement('div');
    this.modal.className = 'utt-wish-modal';

    // Header
    this.header = document.createElement('div');
    this.header.className = 'utt-wish-header';

    this.title = document.createElement('div');
    this.title.className = 'utt-wish-title';
    this.title.textContent = 'Write a wish for Santa';

    this.headerRight = document.createElement('div');
    this.headerRight.className = 'utt-wish-header-right';

    this.closeBtn = createGlassButton({
      className: 'utt-pill',
      label: 'Close',
      ariaLabel: 'Close wish modal',
      onClick: () => this.close()
    });

    this.headerRight.appendChild(this.closeBtn);

    this.progressBar = document.createElement('div');
    this.progressBar.className = 'utt-wish-progress';

    this.progressFill = document.createElement('div');
    this.progressFill.className = 'utt-wish-progress-fill';
    this.progressBar.appendChild(this.progressFill);

    this.header.appendChild(this.title);
    this.header.appendChild(this.headerRight);

    // Body
    this.body = document.createElement('div');
    this.body.className = 'utt-wish-body';

    this.status = document.createElement('div');
    this.status.className = 'utt-wish-status';
    this.status.textContent = '';

    this.loadingDots = document.createElement('div');
    this.loadingDots.className = 'utt-wish-loading-dots utt-hidden';
    this.loadingDots.setAttribute('aria-hidden', 'true');
    this.loadingDots.innerHTML = '<span></span><span></span><span></span>';

    this.textarea = document.createElement('textarea');
    this.textarea.className = 'utt-wish-textarea';
    this.textarea.placeholder = 'Type the gift you want… (max 250 characters)';
    this.textarea.maxLength = 250;

    this.descTextarea = document.createElement('textarea');
    this.descTextarea.className = 'utt-wish-textarea utt-wish-desc';
    this.descTextarea.placeholder = 'Optional description (shown if your wish appears as your gift)';
    this.descTextarea.maxLength = 300;

    this.publicRow = document.createElement('label');
    this.publicRow.className = 'utt-wish-public-row';

    this.publicCheckbox = document.createElement('input');
    this.publicCheckbox.type = 'checkbox';
    this.publicCheckbox.checked = true;

    const publicText = document.createElement('span');
    publicText.textContent = 'Make this wish public';

    this.publicRow.appendChild(this.publicCheckbox);
    this.publicRow.appendChild(publicText);

    this.inlineError = document.createElement('div');
    this.inlineError.className = 'utt-wish-error utt-hidden';

    // Footer
    this.footer = document.createElement('div');
    this.footer.className = 'utt-wish-footer';

    this.sendBtn = createGlassButton({
      className: 'utt-cta',
      label: 'Send Wish',
      ariaLabel: 'Send Wish',
      onClick: () => this._onSend()
    });

    this.retryRow = document.createElement('div');
    this.retryRow.className = 'utt-wish-retry-row utt-hidden';

    this.retryBtn = createGlassButton({
      className: 'utt-pill',
      label: 'Retry now',
      ariaLabel: 'Retry now',
      onClick: () => this._retryNow()
    });

    this.dismissBtn = createGlassButton({
      className: 'utt-pill',
      label: 'Dismiss',
      ariaLabel: 'Dismiss',
      onClick: () => this._dismissRetryRow()
    });

    this.retryRow.appendChild(this.retryBtn);
    this.retryRow.appendChild(this.dismissBtn);

    this.footer.appendChild(this.sendBtn);
    this.footer.appendChild(this.retryRow);

    this.body.appendChild(this.status);
    this.body.appendChild(this.loadingDots);
    this.body.appendChild(this.textarea);
    this.body.appendChild(this.descTextarea);
    this.body.appendChild(this.publicRow);
    this.body.appendChild(this.inlineError);

    this.modal.appendChild(this.progressBar);
    this.modal.appendChild(this.header);
    this.modal.appendChild(this.body);
    this.modal.appendChild(this.footer);

    this.backdrop.appendChild(this.modal);
    this.parent.appendChild(this.backdrop);

    this._wire();
    this._setProgress({ mode: 'hidden' });
  }

  _wire() {
    this._onKeyDown = (e) => {
      if (!this._open) return;
      if (e.key === 'Escape') this.close();
    };

    this.backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === this.backdrop) this.close();
    });

    window.addEventListener('keydown', this._onKeyDown);
  }

  async open() {
    if (this._open) return;
    this._open = true;
    this._resetUI();

    this.backdrop.classList.add('utt-visible');
    await transitionOpacity(this.backdrop, 1, 260, this.config.easing.easeOutCubic);
    this.textarea.focus();
  }

  async close() {
    if (!this._open) return;
    if (this._busy) return; // avoid interrupting send

    this._open = false;
    await transitionOpacity(this.backdrop, 0, 220, this.config.easing.easeOutCubic);
    this.backdrop.classList.remove('utt-visible');
  }

  _resetUI() {
    this._busy = false;
    this._clearTimers();
    this._setDisabled(false);
    this.status.textContent = '';
    this.loadingDots.classList.add('utt-hidden');
    this.inlineError.textContent = '';
    this.inlineError.classList.add('utt-hidden');
    this.textarea.classList.remove('utt-invalid');
    this.retryRow.classList.add('utt-hidden');
    this._setProgress({ mode: 'hidden' });
  }

  _setDisabled(disabled) {
    const d = Boolean(disabled);
    this.textarea.disabled = d;
    this.descTextarea.disabled = d;
    this.publicCheckbox.disabled = d;
    this.sendBtn.disabled = d;
    this.closeBtn.disabled = d;
  }

  _setProgress({ mode, value }) {
    // mode: hidden | indeterminate | determinate | success
    this.progressBar.dataset.mode = mode;
    if (mode === 'determinate') {
      const v = Math.max(0, Math.min(1, Number(value || 0)));
      this.progressFill.style.transform = `scaleX(${v})`;
    } else if (mode === 'success') {
      this.progressFill.style.transform = 'scaleX(1)';
    } else {
      this.progressFill.style.transform = 'scaleX(0)';
    }
  }

  _clearTimers() {
    for (const t of this._timers) clearTimeout(t);
    this._timers = [];
  }

  _schedule(ms, fn) {
    const id = setTimeout(fn, ms);
    this._timers.push(id);
    return id;
  }

  _showInlineError(lines) {
    const arr = Array.isArray(lines) ? lines : [String(lines || '')];
    this.inlineError.textContent = arr.filter(Boolean).join('\n');
    this.inlineError.classList.remove('utt-hidden');
    this.textarea.classList.add('utt-invalid');
  }

  _setLoading(loading) {
    this.loadingDots.classList.toggle('utt-hidden', !loading);
  }

  _dismissRetryRow() {
    this.retryRow.classList.add('utt-hidden');
  }

  async _retryNow() {
    this.retryRow.classList.add('utt-hidden');
    await this.queue?.process?.({
      force: true,
      handlers: {
        CREATE_WISH: async (payload) => this.supabaseClient.createWishFromQueue(payload),
        SUBMIT_WISH: async (payload) => {
          const user_id = payload?.user_id ?? null;
          const text = String(payload?.text || '');
          const is_public = Boolean(payload?.is_public);
          const client_op_id = String(payload?.client_op_id || '');
          const gift_description = payload?.gift_description != null ? String(payload.gift_description) : '';

          if (!text.trim()) throw new Error('non_retryable:empty_text');
          if (!client_op_id) throw new Error('non_retryable:missing_client_op_id');

          let wishText = text;
          let dbPayload = {
            id: client_op_id,
            user_id,
            text: wishText,
            is_public,
            tags: [],
            summary: null
          };

          // Model is best-effort only; if Toolhouse chat is down, still submit.
          try {
            const v = (await this.modelClient.request(
              'VALIDATE_WISH',
              { text },
              { timeoutMs: 4000, stream: false, clientOpId: client_op_id }
            )).result;
            if (v?.ok && v?.valid) {
              wishText = v.sanitized_text || text;
              const created = (await this.modelClient.request(
                'CREATE_WISH_PAYLOAD',
                { user_id, text: wishText, is_public },
                { timeoutMs: 4000, stream: false, clientOpId: client_op_id }
              )).result;
              if (created?.ok && created.db_payload) dbPayload = { ...created.db_payload, id: client_op_id };
            }
          } catch {
            // ignore
          }

          // Primary path: Toolhouse Agent performs the DB write server-side.
          // If Toolhouse doesn't respond quickly, fall back to direct Supabase insert.
          try {
            await submitWishToToolhouseAgent({ db_payload: dbPayload, client_op_id, timeoutMs: 4000 });

            // Best-effort: store a wish-driven gift candidate.
            try {
              const found = await this.supabaseClient
                ?.findGiftByTitleCaseInsensitive?.({ title: wishText, timeoutMs: 2500 })
                .catch(() => ({ ok: false }));
              const candidate = {
                title: String(wishText || '').trim(),
                description: gift_description || null,
                supabaseGift: found?.ok ? found.gift : null,
                created_at: new Date().toISOString(),
                shown: false
              };
              window.localStorage.setItem('underthetree.wishGiftCandidate', JSON.stringify(candidate));
            } catch {
              // ignore
            }
            return;
          } catch (e) {
            if (isToolhouseNotConfiguredError(e) || isLikelyToolhouseDownError(e)) {
              await this.supabaseClient.createWishFromQueue({ ...dbPayload, id: client_op_id, synced: true });

              try {
                const found = await this.supabaseClient
                  ?.findGiftByTitleCaseInsensitive?.({ title: wishText, timeoutMs: 2500 })
                  .catch(() => ({ ok: false }));
                const candidate = {
                  title: String(wishText || '').trim(),
                  description: gift_description || null,
                  supabaseGift: found?.ok ? found.gift : null,
                  created_at: new Date().toISOString(),
                  shown: false
                };
                window.localStorage.setItem('underthetree.wishGiftCandidate', JSON.stringify(candidate));
              } catch {
                // ignore
              }
              return;
            }
            throw e;
          }
        }
      }
    });
  }

  async _onSend() {
    if (this._busy) return;

    const raw = this.textarea.value;
    const sanitized = sanitizeWishText(raw, { maxLen: 250 });
    const rawDesc = this.descTextarea.value;
    const desc = sanitizeWishText(rawDesc, { maxLen: 300 });

    if (!sanitized) {
      this._showInlineError(['Wish can\'t be empty.']);
      return;
    }

    this.textarea.value = sanitized;
    this.descTextarea.value = desc;

    const user_id = getOrCreateAnonUserId();
    const is_public = Boolean(this.publicCheckbox.checked);
    const client_op_id = makeUuid();

    const enqueueSubmitWish = () => {
      this.queue?.enqueue?.({
        opType: 'SUBMIT_WISH',
        payload: {
          client_op_id,
          user_id,
          text: sanitized,
          gift_description: desc,
          is_public
        }
      });
    };

    this._busy = true;
    this._setDisabled(true);
    this.textarea.classList.remove('utt-invalid');
    this.inlineError.classList.add('utt-hidden');

    if (!navigator.onLine) {
      // Offline-first: persist intent and exit quickly.
      enqueueSubmitWish();
      this._busy = false;
      this._setDisabled(false);
      this._setProgress({ mode: 'hidden' });
      this.status.textContent = 'Wish queued — will send when online';
      this.retryRow.classList.remove('utt-hidden');
      return;
    }

    const startMs = performance.now();
    const minBusyMs = 4000;

    // Progress messaging rules.
    this._setProgress({ mode: 'indeterminate' });
    this.status.textContent = 'Preparing your wish…';
    this._setLoading(true);

    this._schedule(1500, () => {
      if (!this._busy) return;
      this.status.textContent = 'Santa is composing a reply…';
    });

    this._schedule(4500, () => {
      if (!this._busy) return;
      this.status.textContent = 'Still working…';
    });

    try {
      // Model is best-effort; if Toolhouse chat is down (e.g. /api/toolhouse-chat 501),
      // fall back to a minimal DB payload and keep going.
      let wishText = sanitized;
      let modelOut = { ok: true, db_payload: { id: client_op_id, user_id, text: wishText, is_public, tags: [], summary: null } };

      try {
        const validateRes = await this.modelClient.request(
          'VALIDATE_WISH',
          { text: sanitized },
          {
            timeoutMs: 4000,
            stream: false,
            clientOpId: client_op_id
          }
        );

        const v = validateRes.result;
        if (v?.ok && v?.valid) {
          wishText = v.sanitized_text || sanitized;

          // Use streaming when available, but keep it short.
          let gotAnyProgress = false;
          const createRes = await this.modelClient.request(
            'CREATE_WISH_PAYLOAD',
            { user_id, text: wishText, is_public },
            {
              timeoutMs: 4000,
              stream: true,
              clientOpId: client_op_id,
              onProgress: ({ chunks }) => {
                gotAnyProgress = true;
                const p = Math.min(0.9, (Number(chunks || 0) / 28) || 0);
                this._setProgress({ mode: 'determinate', value: p });
              }
            }
          );

          if (!gotAnyProgress) this._setProgress({ mode: 'indeterminate' });
          if (createRes?.result?.ok && createRes.result.db_payload) {
            modelOut = createRes.result;
            modelOut.db_payload = { ...modelOut.db_payload, id: client_op_id };
          }
        }
      } catch {
        // ignore
      }

      // DB write: if it fails, enqueue and inform.
      try {
        let deliveredViaToolhouseAgent = false;
        try {
          this.telemetry?.emit?.('wish_toolhouse_write_start', { client_op_id, is_public });
          await submitWishToToolhouseAgent({ db_payload: modelOut.db_payload, client_op_id, timeoutMs: 4000 });
          deliveredViaToolhouseAgent = true;

          // Best-effort confirmation (may fail under RLS/no-auth).
          const confirm = await this.supabaseClient
            .waitForWishById({ id: client_op_id, timeoutMs: 3500 })
            .catch(() => ({ ok: false, reason: 'error' }));
          this.telemetry?.emit?.('wish_toolhouse_write_ok', {
            client_op_id,
            confirmed: Boolean(confirm?.ok),
            confirm_reason: confirm?.ok ? null : confirm?.reason || null
          });

          // UX: if confirmation is possible, show it briefly.
          if (confirm?.ok) {
            this.status.textContent = 'Wish recorded ✓';
          }
        } catch (e) {
          const msg = String(e?.message || e || 'toolhouse_failed');

          // Toolhouse can be down OR return non-executable results (e.g. UNKNOWN_COMMAND).
          // In all those cases, fall back to a direct Supabase write.
          this.telemetry?.emit?.('wish_toolhouse_write_fail', { client_op_id, error: msg });

          await this.supabaseClient.createWish(modelOut.db_payload, { clientOpId: client_op_id });

          const confirm = await this.supabaseClient
            .waitForWishById({ id: client_op_id, timeoutMs: 3500 })
            .catch(() => ({ ok: false, reason: 'error' }));
          this.telemetry?.emit?.('wish_supabase_write_ok', {
            client_op_id,
            confirmed: Boolean(confirm?.ok),
            confirm_reason: confirm?.ok ? null : confirm?.reason || null
          });

          if (confirm?.ok) {
            this.status.textContent = 'Wish recorded ✓';
          }
        }

        // Best-effort: store a wish-driven gift candidate for later reward injection.
        try {
          const title = String(wishText || sanitized).trim();
          const found = await this.supabaseClient
            ?.findGiftByTitleCaseInsensitive?.({ title, timeoutMs: 2500 })
            .catch(() => ({ ok: false }));
          const candidate = {
            title,
            description: desc || null,
            supabaseGift: found?.ok ? found.gift : null,
            created_at: new Date().toISOString(),
            shown: false
          };
          window.localStorage.setItem('underthetree.wishGiftCandidate', JSON.stringify(candidate));
        } catch {
          // ignore
        }

        // Ensure the "delivery" moment lasts at least 4 seconds.
        const elapsed = performance.now() - startMs;
        if (elapsed < minBusyMs) {
          this.status.textContent = 'Delivering your wish to Santa…';
          await wait(minBusyMs - elapsed);
        }

        if (deliveredViaToolhouseAgent) {
          this.status.textContent = 'Your wish has been delivered to Santa, through our Toolhouse agent';
        } else {
          this.status.textContent = 'Your wish has been delivered to Santa';
        }
      } catch (e) {
        const enqueueOp = e?.enqueueOp;
        if (enqueueOp) this.queue?.enqueue?.(enqueueOp);

        this._clearTimers();
        this._busy = false;
        this._setDisabled(false);
        this._setProgress({ mode: 'hidden' });
        this._setLoading(false);
        if (!enqueueOp) enqueueSubmitWish();
        this.status.textContent = 'Wish queued — will retry automatically';
        this.retryRow.classList.remove('utt-hidden');
        return;
      }

      // Success UX.
      this._clearTimers();
      this._setLoading(false);
      this._setProgress({ mode: 'success' });
      // If we already set a confirmation string above, keep it.
      if (!this.status.textContent) this.status.textContent = 'Wish sent!';

      // Let users read the status for a moment.
      await wait(500);

      this._schedule(900, async () => {
        this._busy = false;
        this._setDisabled(false);
        await this.close();
        });
      } catch {
        // Model failure (Ollama down / timeout / Toolhouse not configured): persist locally.
      this._clearTimers();
      this._busy = false;
      this._setDisabled(false);
      this._setProgress({ mode: 'hidden' });
        enqueueSubmitWish();
        this.status.textContent = 'Wish queued — will retry automatically';
        this.retryRow.classList.remove('utt-hidden');
    }
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    this.backdrop.remove();
  }
}
