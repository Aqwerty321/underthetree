// src/ui/StartOverlay.js
// Accessible start CTA + progress + mute toggle.
// Keeps autoplay-compliant explicit gesture (button click/Enter/Space).

export class StartOverlay {
  constructor({ parent, runtime, copy, onToggleMute, onEnter, onInteractionFocusChange }) {
    this.parent = parent;
    this.runtime = runtime;
    this.copy = copy;
    this.onToggleMute = onToggleMute;
    this.onEnter = onEnter;
    this.onInteractionFocusChange = onInteractionFocusChange;

    this._ready = false;
    this._startHandlers = new Set();

    this.el = document.createElement('div');
    this.el.className = 'utt-overlay';

    this.card = document.createElement('div');
    this.card.className = 'utt-card';

    const title = document.createElement('h1');
    title.className = 'utt-title';
    title.textContent = copy.title;

    const subtitle = document.createElement('p');
    subtitle.className = 'utt-subtitle';
    subtitle.textContent = copy.subtitle;

    this.progressWrap = document.createElement('div');
    this.progressWrap.className = 'utt-progress';
    this.progressBar = document.createElement('div');
    this.progressWrap.appendChild(this.progressBar);

    this.errorEl = document.createElement('p');
    this.errorEl.className = 'utt-subtitle';
    this.errorEl.style.display = 'none';

    this.startBtn = document.createElement('button');
    this.startBtn.type = 'button';
    this.startBtn.className = 'utt-btn';
    this.startBtn.textContent = copy.startLabel;
    this.startBtn.disabled = true;

    // Mute toggle (persisted by entry.js)
    this.muteLabel = document.createElement('label');
    this.muteLabel.className = 'utt-toggle';

    this.muteCheckbox = document.createElement('input');
    this.muteCheckbox.type = 'checkbox';
    this.muteCheckbox.checked = runtime.muted;

    const muteText = document.createElement('span');
    muteText.textContent = copy.muteLabel;

    this.muteLabel.appendChild(this.muteCheckbox);
    this.muteLabel.appendChild(muteText);

    // Reduced motion indicator (not a toggle; follows OS pref)
    this.rmLabel = document.createElement('div');
    this.rmLabel.className = 'utt-toggle';
    this.rmLabel.style.opacity = runtime.prefersReducedMotion ? '0.95' : '0.65';
    this.rmLabel.textContent = runtime.prefersReducedMotion ? copy.reducedMotionLabel : '';

    const row1 = document.createElement('div');
    row1.className = 'utt-row';
    row1.appendChild(this.muteLabel);
    row1.appendChild(this.startBtn);

    const row2 = document.createElement('div');
    row2.className = 'utt-row';
    row2.style.justifyContent = 'flex-start';
    row2.appendChild(this.rmLabel);

    this.card.appendChild(title);
    this.card.appendChild(subtitle);
    this.card.appendChild(this.progressWrap);
    this.card.appendChild(this.errorEl);
    this.card.appendChild(row1);
    this.card.appendChild(row2);

    this.el.appendChild(this.card);
    parent.appendChild(this.el);

    this._wire();
  }

  _wire() {
    this._onMuteChange = () => {
      const muted = this.muteCheckbox.checked;
      this.setMuted(muted);
      this.onToggleMute?.(muted);
    };

    this._onStart = async () => {
      if (!this._ready) return;

      // Give consumers a hook to start transitions to future screens.
      await this.onEnter?.();

      for (const fn of this._startHandlers) fn();

      // Hide overlay after start; UI for later screens can replace it.
      this.el.style.display = 'none';
    };

    this.muteCheckbox.addEventListener('change', this._onMuteChange);
    this.startBtn.addEventListener('click', this._onStart);

    // Interaction focus (spec): hovering CTA or pointerdown briefly boosts parallax and reduces blur.
    // We forward this as a signal; the renderer performs the actual easing/tween.
    const focusOn = () => this.onInteractionFocusChange?.(true);
    const focusOff = () => this.onInteractionFocusChange?.(false);

    this.startBtn.addEventListener('pointerenter', focusOn);
    this.startBtn.addEventListener('pointerleave', focusOff);
    this.startBtn.addEventListener('focus', focusOn);
    this.startBtn.addEventListener('blur', focusOff);
    this.startBtn.addEventListener('pointerdown', focusOn);
    this.startBtn.addEventListener('pointerup', focusOff);

    // Ensure Enter/Space works (button already handles it) but keep explicit.
    this.startBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this._onStart();
      }
    });
  }

  onStart(fn) {
    this._startHandlers.add(fn);
  }

  setProgress(p) {
    const pct = Math.round((p ?? 0) * 100);
    this.progressBar.style.width = `${pct}%`;
  }

  setReady(ready) {
    this._ready = Boolean(ready);
    this.startBtn.disabled = !this._ready;
  }

  setMuted(muted) {
    this.runtime.muted = Boolean(muted);
    this.muteCheckbox.checked = this.runtime.muted;
  }

  setError(msg) {
    this.errorEl.style.display = 'block';
    this.errorEl.textContent = `Error: ${msg}`;
  }

  destroy() {
    this.muteCheckbox.removeEventListener('change', this._onMuteChange);
    this.startBtn.removeEventListener('click', this._onStart);
    this.el.remove();
  }
}
