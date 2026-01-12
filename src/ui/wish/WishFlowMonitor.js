// src/ui/wish/WishFlowMonitor.js
// Debug-only on-screen monitor for wish flow.

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) el.appendChild(c);
  return el;
}

function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export class WishFlowMonitor {
  constructor({ parent, telemetry, queue, debugEnabled } = {}) {
    this.parent = parent || document.body;
    this.telemetry = telemetry;
    this.queue = queue;
    this.debugEnabled = Boolean(debugEnabled);

    this.el = h('div', { className: 'utt-wish-debug utt-hidden' });
    this.title = h('div', { className: 'utt-wish-debug-title', text: 'Wish monitor' });
    this.meta = h('div', { className: 'utt-wish-debug-meta', text: '' });
    this.pre = h('pre', { className: 'utt-wish-debug-log', text: '' });

    const actions = h('div', { className: 'utt-wish-debug-actions' });
    const clearBtn = h('button', { className: 'utt-wish-debug-btn', type: 'button', text: 'Clear logs' });
    const copyBtn = h('button', { className: 'utt-wish-debug-btn', type: 'button', text: 'Copy logs' });

    clearBtn.addEventListener('click', () => {
      try {
        window.localStorage.setItem('underthetree.telemetry', '[]');
      } catch {
        // ignore
      }
      this.update(true);
    });

    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(this.pre.textContent || '');
      } catch {
        // ignore
      }
    });

    actions.appendChild(clearBtn);
    actions.appendChild(copyBtn);

    this.el.appendChild(this.title);
    this.el.appendChild(this.meta);
    this.el.appendChild(actions);
    this.el.appendChild(this.pre);
    this.parent.appendChild(this.el);

    if (this.debugEnabled) this.el.classList.remove('utt-hidden');

    this._timer = setInterval(() => this.update(), 800);
    this.update(true);
  }

  update(force = false) {
    if (!this.debugEnabled) return;

    const events = this.telemetry?.peek?.() || [];

    // Show most recent wish-related events.
    const filtered = events
      .filter((e) => {
        const name = String(e?.event || '');
        return (
          name.startsWith('wish_') ||
          name === 'wish_submitted' ||
          name === 'model_provider_fallback' ||
          name.startsWith('queue_')
        );
      })
      .slice(-18);

    const last = filtered[filtered.length - 1] || null;
    const lastId = last?.props?.clientOpId || last?.props?.client_op_id || null;

    const counts = this.queue?.getCounts?.();
    const pending = counts ? counts.pending : null;
    const failed = counts ? counts.failed : null;

    const meta = [
      lastId ? `client_op_id: ${lastId}` : null,
      counts ? `queue: pending ${pending}, failed ${failed}` : null
    ]
      .filter(Boolean)
      .join(' • ');

    if (!force && meta === this._lastMeta && filtered.length === (this._lastLen || 0)) return;

    this._lastMeta = meta;
    this._lastLen = filtered.length;

    this.meta.textContent = meta;
    this.pre.textContent = filtered
      .map((e) => {
        const ts = String(e?.ts || '').split('T')[1]?.replace('Z', '') || '';
        const name = String(e?.event || '');
        const props = e?.props && Object.keys(e.props).length ? ` ${safeJson(e.props)}` : '';
        return `${ts}  ${name}${props}`;
      })
      .join('\n');
  }

  destroy() {
    clearInterval(this._timer);
    this.el.remove();
  }
}
