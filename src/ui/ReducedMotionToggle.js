// src/ui/ReducedMotionToggle.js
// User-controlled reduced-motion toggle (persists to localStorage).

import { createIconButton } from './GlassButton.js';

export class ReducedMotionToggle {
  constructor({ initialEnabled, onToggle }) {
    this.enabled = Boolean(initialEnabled);
    this.onToggle = onToggle;

    const { wrap, button } = createIconButton({
      iconText: this.enabled ? '⏸' : '▶',
      ariaLabel: this.enabled ? 'Reduced motion on' : 'Reduced motion off',
      tooltip: this.enabled ? 'Reduced motion on' : 'Reduced motion off',
      pressed: this.enabled,
      onClick: () => this.toggle()
    });

    this.el = wrap;
    this.button = button;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.button.textContent = this.enabled ? '⏸' : '▶';
    this.button.setAttribute('aria-label', this.enabled ? 'Reduced motion on' : 'Reduced motion off');
    this.button.setAttribute('aria-pressed', String(this.enabled));
  }

  toggle() {
    this.setEnabled(!this.enabled);
    this.onToggle?.(this.enabled);
  }
}
