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

    this.text = document.createElement('div');
    this.text.className = 'utt-reward-text';
    this.text.textContent = '';

    this.card.appendChild(this.text);
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

  async show(itemLabel) {
    this.text.textContent = `You got an ${String(itemLabel || 'item')}!`;
    this._open = true;
    this.backdrop.classList.add('utt-visible');
    await transitionOpacity(this.backdrop, 1, 220, this.config.easing.easeOutCubic);
  }

  async close() {
    if (!this._open) return;
    this._open = false;
    await transitionOpacity(this.backdrop, 0, 180, this.config.easing.easeOutCubic);
    this.backdrop.classList.remove('utt-visible');
  }

  destroy() {
    this.backdrop.remove();
  }
}
