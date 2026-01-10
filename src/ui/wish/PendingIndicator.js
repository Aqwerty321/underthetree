// src/ui/wish/PendingIndicator.js
// Small “Pending actions: N” indicator + debug details.

import { createGlassButton } from '../GlassButton.js';

export class PendingIndicator {
  constructor({ parent, queue, onRetryAll }) {
    this.parent = parent;
    this.queue = queue;
    this.onRetryAll = onRetryAll;

    this.el = document.createElement('div');
    this.el.className = 'utt-pending-indicator utt-hidden';

    this.label = document.createElement('button');
    this.label.type = 'button';
    this.label.className = 'utt-pending-label';
    this.label.textContent = 'Pending actions: 0';

    this.panel = document.createElement('div');
    this.panel.className = 'utt-pending-panel utt-hidden';

    this.panelTitle = document.createElement('div');
    this.panelTitle.className = 'utt-pending-panel-title';
    this.panelTitle.textContent = 'Pending queue';

    this.panelList = document.createElement('div');
    this.panelList.className = 'utt-pending-list';

    this.panelActions = document.createElement('div');
    this.panelActions.className = 'utt-pending-actions';

    this.retryAllBtn = createGlassButton({
      className: 'utt-pill',
      label: 'Retry now',
      ariaLabel: 'Retry queued actions now',
      onClick: () => this.onRetryAll?.()
    });

    this.closeBtn = createGlassButton({
      className: 'utt-pill',
      label: 'Close',
      ariaLabel: 'Close queue details',
      onClick: () => this._setPanelOpen(false)
    });

    this.panelActions.appendChild(this.retryAllBtn);
    this.panelActions.appendChild(this.closeBtn);

    this.panel.appendChild(this.panelTitle);
    this.panel.appendChild(this.panelList);
    this.panel.appendChild(this.panelActions);

    this.el.appendChild(this.label);
    this.el.appendChild(this.panel);

    parent.appendChild(this.el);

    this._wire();
    this.update();
  }

  _wire() {
    this.label.addEventListener('click', () => {
      const open = !this.panel.classList.contains('utt-hidden');
      this._setPanelOpen(!open);
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._setPanelOpen(false);
    });
  }

  _setPanelOpen(open) {
    this.panel.classList.toggle('utt-hidden', !open);
    if (open) this._renderList();
  }

  update() {
    const { pending, failed } = this.queue.getCounts();
    const total = pending + failed;
    this.label.textContent = `Pending actions: ${total}`;
    this.el.classList.toggle('utt-hidden', total <= 0);
    if (!this.panel.classList.contains('utt-hidden')) this._renderList();
  }

  _renderList() {
    const items = this.queue.peek();
    this.panelList.innerHTML = '';

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'utt-pending-item';
      empty.textContent = 'No pending actions.';
      this.panelList.appendChild(empty);
      return;
    }

    for (const op of items) {
      const row = document.createElement('div');
      row.className = 'utt-pending-item';

      const meta = document.createElement('div');
      meta.className = 'utt-pending-meta';
      meta.textContent = `${op.opType} • attempts ${op.attempts}/${6}${op.failed ? ' • FAILED' : ''}`;

      row.appendChild(meta);

      if (op.opType === 'CREATE_WISH' || op.opType === 'SUBMIT_WISH') {
        const preview = document.createElement('div');
        preview.className = 'utt-pending-preview';
        preview.textContent = String(op.payload?.text || '').slice(0, 120);
        row.appendChild(preview);
      }

      if (op.failed) {
        const actions = document.createElement('div');
        actions.className = 'utt-pending-row-actions';

        const retry = createGlassButton({
          className: 'utt-pill',
          label: 'Retry now',
          ariaLabel: 'Retry this item',
          onClick: () => this.onRetryAll?.()
        });

        const copy = createGlassButton({
          className: 'utt-pill',
          label: 'Copy text',
          ariaLabel: 'Copy wish text',
          onClick: async () => {
            const t = String(op.payload?.text || '');
            try {
              await navigator.clipboard.writeText(t);
            } catch {
              // ignore
            }
          }
        });

        const discard = createGlassButton({
          className: 'utt-pill',
          label: 'Discard',
          ariaLabel: 'Discard this item',
          onClick: () => {
            this.queue.discard(op.id);
            this.update();
          }
        });

        actions.appendChild(retry);
        actions.appendChild(copy);
        actions.appendChild(discard);
        row.appendChild(actions);
      }

      this.panelList.appendChild(row);
    }
  }

  destroy() {
    this.el.remove();
  }
}
