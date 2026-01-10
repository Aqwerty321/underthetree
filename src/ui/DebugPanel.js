// src/ui/DebugPanel.js
// Query-param gated QA panel: ?debug=true
// Lets you tune key parameters live.

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

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export class DebugPanel {
  constructor({ parent, config, runtime, onChange }) {
    this.parent = parent;
    this.config = config;
    this.runtime = runtime;
    this.onChange = onChange;

    this.el = h('div', { className: 'utt-debug', role: 'region', 'aria-label': 'Debug panel' });
    this.el.appendChild(h('h2', { text: 'Debug' }));

    // Sliders
    this._addSlider('parallaxStrength', 0, 0.6, 0.001, () => config.getParallaxStrengthForDevice(), (v) => {
      // Patch the desktop default (keeps device selection simple for now).
      this.onChange?.({ defaults: { parallaxStrength_desktop: v } });
    });

    this._addSlider('blurRadiusPct', 0, 0.03, 0.0005, () => config.post.blur.baseRadiusPct, (v) => {
      this.onChange?.({ post: { blur: { baseRadiusPct: v } } });
    });

    this._addSlider('noiseStrength', 0, 0.01, 0.0001, () => config.defaults.noiseStrength, (v) => {
      this.onChange?.({ defaults: { noiseStrength: v } });
    });

    this._addSlider('noiseScale', 0.5, 5, 0.05, () => config.defaults.noiseScale, (v) => {
      this.onChange?.({ defaults: { noiseScale: v } });
    });

    this._addSlider('noiseSpeed', 0, 0.2, 0.001, () => config.defaults.noiseSpeed, (v) => {
      this.onChange?.({ defaults: { noiseSpeed: v } });
    });

    // Toggles
    this._addCheckbox('use4k', () => config.flags.use4k === true, (checked) => {
      this.onChange?.({ flags: { use4k: checked ? true : null } });
      // Note: switching resolution requires a reload to re-fetch correct textures.
    });

    this._addCheckbox('postProcessing', () => config.flags.postProcessing, (checked) => {
      this.onChange?.({ flags: { postProcessing: checked } });
    });

    this._addCheckbox('simulateLowPower', () => config.flags.simulateLowPower, (checked) => {
      this.onChange?.({ flags: { simulateLowPower: checked } });
      this.runtime.isLowPower = config.detectLowPower();
    });

    this._addCheckbox('simulateSlowNet', () => config.flags.simulateSlowNet, (checked) => {
      this.onChange?.({ flags: { simulateSlowNet: checked } });
    });

    parent.appendChild(this.el);

    this._addHint();
  }

  _addHint() {
    const hint = h('div', { className: 'utt-debug-row' }, [
      h('span', { text: 'Resolution changes:' }),
      h('span', { text: 'reload page' })
    ]);
    hint.style.opacity = '0.75';
    this.el.appendChild(hint);
  }

  _addSlider(name, min, max, step, getValue, onInput) {
    const value = getValue();

    const label = document.createElement('label');
    const text = document.createElement('span');
    text.textContent = `${name}: ${value.toFixed(4)}`;

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);

    input.addEventListener('input', () => {
      const v = toNum(input.value);
      text.textContent = `${name}: ${v.toFixed(4)}`;
      onInput(v);
    });

    label.appendChild(text);
    label.appendChild(input);
    this.el.appendChild(label);
  }

  _addCheckbox(name, getChecked, onChange) {
    const row = h('div', { className: 'utt-debug-row' });
    const label = h('span', { text: name });
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(getChecked());

    input.addEventListener('change', () => onChange(Boolean(input.checked)));

    row.appendChild(label);
    row.appendChild(input);
    this.el.appendChild(row);
  }
}
