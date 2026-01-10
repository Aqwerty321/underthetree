// src/ui/wish/PersistentQueueToast.js
// Persistent toast for failed queue items (Retry now / Discard / Copy text).

import { createGlassButton } from '../GlassButton.js';

export class PersistentQueueToast {
  constructor({ parent, queue, onRetryAll }) {
    this.parent = parent;
    this.queue = queue;
    this.onRetryAll = onRetryAll;

    this.el = document.createElement('div');
    this.el.className = 'utt-persist-toast utt-hidden';

    this.msg = document.createElement('div');
    this.msg.className = 'utt-persist-toast-msg';
    this.msg.textContent = '';

    this.actions = document.createElement('div');
    this.actions.className = 'utt-persist-toast-actions';

    this.retryBtn = createGlassButton({
      className: 'utt-pill',
      label: 'Retry now',
      ariaLabel: 'Retry now',
      onClick: () => this.onRetryAll?.()
    });

    this.copyBtn = createGlassButton({
      className: 'utt-pill',
      label: 'Copy text',
      ariaLabel: 'Copy wish text',
      onClick: async () => {
        const op = this._lastFailed;
        const t = String(op?.payload?.text || '');
        try {
          await navigator.clipboard.writeText(t);
        } catch {
          // ignore
        }
      }
    });

    this.discardBtn = createGlassButton({
      className: 'utt-pill',
      label: 'Discard',
      ariaLabel: 'Discard failed item',
      onClick: () => {
        if (this._lastFailed?.id) this.queue.discard(this._lastFailed.id);
        this.hide();
      }
    });

    this.actions.appendChild(this.retryBtn);
    this.actions.appendChild(this.copyBtn);
    this.actions.appendChild(this.discardBtn);

    this.el.appendChild(this.msg);
    this.el.appendChild(this.actions);

    parent.appendChild(this.el);

    this._lastFailed = null;
  }

  showFor(op) {
    this._lastFailed = op;
    this.msg.textContent = 'Failed to sync — keep a local copy or discard';
    this.el.classList.remove('utt-hidden');
  }

  hide() {
    this._lastFailed = null;
    this.el.classList.add('utt-hidden');
  }

  destroy() {
    this.el.remove();
  }
}
