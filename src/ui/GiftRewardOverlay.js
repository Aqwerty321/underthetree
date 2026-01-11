// src/ui/GiftRewardOverlay.js
// Simple centered overlay: "You got an <item>".

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

function formatIso(ts) {
  if (!ts) return null;
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts);
    return d.toLocaleString();
  } catch {
    return String(ts);
  }
}

function safeStringify(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function extractMetaFields(meta) {
  const m = meta && typeof meta === 'object' ? meta : null;
  const tags = Array.isArray(m?.tags) ? m.tags.filter(Boolean).map(String) : null;
  const rarity = m?.rarity != null ? String(m.rarity) : null;
  return { tags, rarity, meta: m };
}

function flattenMetaToLines(meta) {
  const out = [];
  const seen = new Set();

  function walk(v, prefix) {
    if (v == null) return;
    if (typeof v !== 'object') {
      out.push(`${prefix}: ${String(v)}`);
      return;
    }

    if (seen.has(v)) return;
    seen.add(v);

    if (Array.isArray(v)) {
      const items = v.filter((x) => x != null).map((x) => String(x));
      if (items.length) out.push(`${prefix}: ${items.join(', ')}`);
      return;
    }

    const keys = Object.keys(v);
    if (!keys.length) return;
    for (const k of keys) {
      const next = v[k];
      const nextPrefix = prefix ? `${prefix}.${k}` : k;
      if (next == null) continue;
      if (typeof next === 'object') {
        walk(next, nextPrefix);
      } else {
        out.push(`${nextPrefix}: ${String(next)}`);
      }
    }
  }

  walk(meta, '');
  return out;
}

function buildDetailRows(item) {
  const rows = [];

  const openedAt = formatIso(item?.opened_at);
  if (openedAt) rows.push({ label: 'Opened', value: openedAt });

  const reason = item?.reason != null ? String(item.reason) : null;
  if (reason) rows.push({ label: 'Reason', value: reason });

  const { tags, rarity, meta } = extractMetaFields(item?.meta);
  if (rarity) rows.push({ label: 'Rarity', value: rarity });
  if (tags && tags.length) rows.push({ label: 'Tags', value: tags.join(', ') });

  const openId = item?.open_id || item?.id;
  if (openId) rows.push({ label: 'Open ID', value: String(openId) });

  const giftId = item?.gift_id;
  if (giftId) rows.push({ label: 'Gift ID', value: String(giftId) });

  // Client op id is useful for debugging, but not celebratory.
  // Only show it when explicitly requested.
  const showDebug = Boolean(item?.show_debug);
  const clientOpId = item?.client_op_id;
  if (showDebug && clientOpId) rows.push({ label: 'Client Op', value: String(clientOpId) });

  // Meta: include any extra meta keys as readable lines (no JSON output).
  const metaLines = meta ? flattenMetaToLines(meta) : [];
  const filtered = metaLines
    .filter((line) => line && typeof line === 'string')
    // Avoid repeating tags/rarity which we already show prominently.
    .filter((line) => !/^tags:\s*/i.test(line) && !/^rarity:\s*/i.test(line));
  if (filtered.length) rows.push({ label: 'Meta', value: filtered.join(' · ') });

  return rows;
}

export class GiftRewardOverlay {
  constructor({ parent, config }) {
    this.parent = parent;
    this.config = config;
    this._open = false;

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'utt-reward-backdrop';
    this.backdrop.style.opacity = '0';

    this.card = document.createElement('div');
    this.card.className = 'utt-reward-card';

    this.header = document.createElement('div');
    this.header.className = 'utt-reward-header';

    this.kicker = document.createElement('div');
    this.kicker.className = 'utt-reward-kicker';
    this.kicker.textContent = 'Congratulations!';

    this.text = document.createElement('div');
    this.text.className = 'utt-reward-text';
    this.text.textContent = '';

    this.desc = document.createElement('div');
    this.desc.className = 'utt-reward-desc utt-hidden';
    this.desc.textContent = '';

    this.details = document.createElement('div');
    this.details.className = 'utt-reward-details utt-hidden';

    this.detailsText = document.createElement('div');
    this.detailsText.className = 'utt-reward-details-text';
    this.detailsText.textContent = '';

    this.header.appendChild(this.text);
    this.header.appendChild(this.desc);

    this.header.prepend(this.kicker);

    this.card.appendChild(this.header);
    this.card.appendChild(this.details);
    this.backdrop.appendChild(this.card);
    this.parent.appendChild(this.backdrop);

    this._wire();
  }

  _wire() {
    this.backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === this.backdrop) this.close();
    });

    window.addEventListener('keydown', (e) => {
      if (!this._open) return;
      if (e.key === 'Escape') this.close();
    });
  }

  async show(item) {
    const title = typeof item === 'string' ? item : item?.title;
    const description = typeof item === 'string' ? null : item?.description;

    const t = String(title || 'gift');
    const article = /^[aeiou]/i.test(t.trim()) ? 'an' : 'a';
    this.text.textContent = `You got ${article} ${t}!`;
    this.desc.textContent = description ? String(description) : '';
    this.desc.classList.toggle('utt-hidden', !description);

    // Details block (best-effort). Hide when empty.
    this.details.innerHTML = '';
    if (item && typeof item === 'object') {
      const rows = buildDetailRows(item);

      // Build a readable multi-line block (no raw JSON).
      const lines = rows.map((r) => `${r.label}: ${r.value}`);
      this.detailsText.textContent = lines.join('\n');
      this.details.appendChild(this.detailsText);
      this.details.classList.toggle('utt-hidden', lines.length === 0);
    } else {
      this.details.classList.add('utt-hidden');
    }

    this._open = true;

    // Force-visible regardless of CSS load/order.
    this.backdrop.style.display = 'flex';
    this.backdrop.style.pointerEvents = 'auto';
    this.backdrop.classList.add('utt-visible');
    await transitionOpacity(this.backdrop, 1, 220, this.config.easing.easeOutCubic);
  }

  async close() {
    if (!this._open) return;
    this._open = false;
    await transitionOpacity(this.backdrop, 0, 180, this.config.easing.easeOutCubic);
    this.backdrop.classList.remove('utt-visible');

    // Mirror show() forcing.
    this.backdrop.style.display = 'none';
    this.backdrop.style.pointerEvents = 'none';
  }

  destroy() {
    this.backdrop.remove();
  }
}
