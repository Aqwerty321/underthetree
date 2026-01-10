// src/ui/HeroCard.js
// Centered glass card overlay with primary CTA + icon buttons.

import { createGlassButton } from './GlassButton.js';
import { SoundToggle } from './SoundToggle.js';
import { ReducedMotionToggle } from './ReducedMotionToggle.js';

export class HeroCard {
  constructor({
    parent,
    title,
    subtitle,
    ctaLabel,
    onPrimary,
    onMuteChange,
    onReducedMotionChange,
    initialMuted,
    initialReducedMotion,
    onCtaFocusChange
  }) {
    this.el = document.createElement('div');
    this.el.className = 'utt-hero-card';

    const h1 = document.createElement('h1');
    h1.className = 'utt-hero-title';
    h1.textContent = title;

    const p = document.createElement('p');
    p.className = 'utt-hero-subtitle';
    p.textContent = subtitle;

    const actions = document.createElement('div');
    actions.className = 'utt-hero-actions';

    const ctaRow = document.createElement('div');
    ctaRow.className = 'utt-hero-cta-row';

    const controlsRow = document.createElement('div');
    controlsRow.className = 'utt-hero-controls-row';

    this.soundToggle = new SoundToggle({
      initialMuted,
      onToggle: (muted) => onMuteChange?.(muted)
    });

    this.rmToggle = new ReducedMotionToggle({
      initialEnabled: initialReducedMotion,
      onToggle: (enabled) => onReducedMotionChange?.(enabled)
    });

    const cta = createGlassButton({
      className: 'utt-cta',
      label: ctaLabel,
      ariaLabel: ctaLabel,
      onClick: () => onPrimary?.()
    });

    const icon = document.createElement('span');
    icon.className = 'utt-cta-icon';
    icon.textContent = '🎁';
    cta.appendChild(icon);

    const focusOn = () => {
      this.el.classList.add('utt-cta-focus');
      onCtaFocusChange?.(true);
    };
    const focusOff = () => {
      this.el.classList.remove('utt-cta-focus');
      onCtaFocusChange?.(false);
    };

    cta.addEventListener('pointerenter', focusOn);
    cta.addEventListener('pointerleave', focusOff);
    cta.addEventListener('focus', focusOn);
    cta.addEventListener('blur', focusOff);

    ctaRow.appendChild(cta);

    controlsRow.appendChild(this.soundToggle.el);
    controlsRow.appendChild(this.rmToggle.el);

    actions.appendChild(ctaRow);
    actions.appendChild(controlsRow);

    this.el.appendChild(h1);
    this.el.appendChild(p);
    this.el.appendChild(actions);

    parent.appendChild(this.el);

    this._cta = cta;
  }

  setDisabled(disabled) {
    const d = Boolean(disabled);
    this.el.style.pointerEvents = d ? 'none' : 'auto';
    this.el.style.opacity = d ? '0.85' : '1';
    this._cta.disabled = d;
    this.soundToggle.button.disabled = d;
    this.rmToggle.button.disabled = d;
  }

  setVisible(visible) {
    this.el.classList.toggle('utt-hero-hidden', !visible);
  }

  setMuted(muted) {
    this.soundToggle.setMuted(muted);
  }

  setReducedMotion(enabled) {
    this.rmToggle.setEnabled(enabled);
  }

  fadeOut(durationMs, easing) {
    this.el.style.transition = `opacity ${durationMs}ms ${easing}`;
    this.el.style.opacity = '0';
  }
}
