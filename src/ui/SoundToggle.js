// src/ui/SoundToggle.js
// Small icon button that toggles ambience mute.

import { createIconButton } from './GlassButton.js';

export class SoundToggle {
  constructor({
    initialMuted,
    onToggle
  }) {
    this.muted = Boolean(initialMuted);
    this.onToggle = onToggle;

    const { wrap, button } = createIconButton({
      iconText: this.muted ? '🔇' : '🔊',
      ariaLabel: this.muted ? 'Sound off' : 'Sound on',
      tooltip: this.muted ? 'Sound off' : 'Sound on',
      pressed: this.muted,
      onClick: () => this.toggle()
    });

    this.el = wrap;
    this.button = button;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    this.button.textContent = this.muted ? '🔇' : '🔊';
    this.button.setAttribute('aria-label', this.muted ? 'Sound off' : 'Sound on');
    this.button.setAttribute('aria-pressed', String(this.muted));
  }

  toggle() {
    this.setMuted(!this.muted);
    this.onToggle?.(this.muted);
  }
}
