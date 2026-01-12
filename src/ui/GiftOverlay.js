// src/ui/GiftOverlay.js
// Post-cinematic gift scene UI overlay.

import { createGlassButton } from './GlassButton.js';
import { SoundToggle } from './SoundToggle.js';
import { withTimeout } from '../utils/syncUtils.js';

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

export class GiftOverlay {
  constructor({ parent, config, runtime, sfx, onOpenGift, onMoreGifts, onBackHome, onWriteWish, initialMuted, onMuteChange }) {
    this.parent = parent;
    this.config = config;
    this.runtime = runtime;
    this.sfx = sfx;

    this.onOpenGift = onOpenGift;
    this.onMoreGifts = onMoreGifts;
    this.onBackHome = onBackHome;
    this.onWriteWish = onWriteWish;
    this.onMuteChange = onMuteChange;

    this._mode = 'idle'; // 'idle' | 'reveal'

    this._giftEndedPromise = null;
    this._giftPlayToken = 0;
    this._giftLidTimeoutId = null;

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'utt-gift-ui';
    this.backdrop.style.opacity = '0';

    this.card = document.createElement('div');
    this.card.className = 'utt-gift-card';

    // Split the card into:
    // - a glass layer (provides blur/background/border)
    // - a fullscreen confetti mount (above glass, below content)
    // - a content layer (gift video + buttons)
    this.glass = document.createElement('div');
    this.glass.className = 'utt-gift-glass';

    this.confettiMount = document.createElement('div');
    this.confettiMount.className = 'utt-gift-confetti';

    this.content = document.createElement('div');
    this.content.className = 'utt-gift-content';

    const title = document.createElement('h2');
    title.className = 'utt-gift-title';
    title.textContent = 'A Gift Awaits';

    const subtitle = document.createElement('p');
    subtitle.className = 'utt-gift-subtitle';
    subtitle.textContent = 'Open it when you are ready.';

    this.preview = document.createElement('button');
    this.preview.type = 'button';
    this.preview.className = 'utt-gift-preview';
    this.preview.setAttribute('aria-label', 'Open gift');

    // Gift media: use the transparent WebM so the first frame matches the closed gift,
    // and the last frame matches the open gift static.
    this.giftVideo = document.createElement('video');
    this.giftVideo.className = 'utt-gift-video';
    this.giftVideo.playsInline = true;
    this.giftVideo.preload = 'auto';
    this.giftVideo.muted = true;
    this.giftVideo.loop = false;
    this.giftVideo.src = this.config.giftOpen?.url ?? '';
    this.giftVideo.setAttribute('playsinline', '');
    this.giftVideo.setAttribute('webkit-playsinline', '');
    this.giftVideo.setAttribute('crossorigin', 'anonymous');

    // Fallback static image if video fails.
    this.giftImg = document.createElement('img');
    this.giftImg.className = 'utt-gift-img utt-hidden';
    this.giftImg.alt = '';
    this.giftImg.src = this.config.assets.giftOverlay.giftClosed;

    // Static overlay used to lock the final open frame (prevents end-of-decode jank).
    this.giftOpenOverlay = document.createElement('img');
    this.giftOpenOverlay.className = 'utt-gift-open-overlay';
    this.giftOpenOverlay.alt = '';
    this.giftOpenOverlay.src = this.config.assets.giftOverlay.giftOpenStatic;
    this.giftOpenOverlay.style.opacity = '0';

    this.preview.appendChild(this.giftVideo);
    this.preview.appendChild(this.giftImg);
    this.preview.appendChild(this.giftOpenOverlay);

    this.primaryBtn = createGlassButton({
      className: 'utt-cta',
      label: 'Open Gift',
      ariaLabel: 'Open Gift',
      onClick: () => this._handleOpenGift()
    });

    this.soundToggle = new SoundToggle({
      initialMuted,
      onToggle: (muted) => this.onMuteChange?.(muted)
    });

    this.actions = document.createElement('div');
    this.actions.className = 'utt-gift-actions';

    this.actions.appendChild(this.primaryBtn);
    this.actions.appendChild(this.soundToggle.el);

    // Reveal actions
    this.revealActions = document.createElement('div');
    this.revealActions.className = 'utt-gift-reveal-actions utt-action-hidden';

    this.moreBtn = createGlassButton({
      className: 'utt-pill',
      label: 'More gifts',
      ariaLabel: 'Look for more gifts',
      onClick: () => this.onMoreGifts?.()
    });

    this.wishBtn = createGlassButton({
      className: 'utt-pill',
      label: 'Write a wish',
      ariaLabel: 'Write a wish for Santa',
      onClick: () => this.onWriteWish?.()
    });

    this.homeBtn = createGlassButton({
      className: 'utt-pill',
      label: 'Back to home',
      ariaLabel: 'Return to home',
      onClick: () => this.onBackHome?.()
    });

    this.revealActions.appendChild(this.moreBtn);
    this.revealActions.appendChild(this.wishBtn);
    this.revealActions.appendChild(this.homeBtn);

    this.actionSlot = document.createElement('div');
    this.actionSlot.className = 'utt-gift-action-slot';
    this.actionSlot.appendChild(this.actions);
    this.actionSlot.appendChild(this.revealActions);

    this.content.appendChild(title);
    this.content.appendChild(subtitle);
    this.content.appendChild(this.preview);
    this.content.appendChild(this.actionSlot);

    this.card.appendChild(this.glass);
    this.card.appendChild(this.confettiMount);
    this.card.appendChild(this.content);

    this.backdrop.appendChild(this.card);
    this.parent.appendChild(this.backdrop);

    this._wire();
  }

  _wire() {
    this._onKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (this._mode === 'reveal') {
          this.hideReveal();
        }
      }
    };

    this.preview.addEventListener('click', () => this._handleOpenGift());
    window.addEventListener('keydown', this._onKeyDown);
  }

  async show({ delayMs = 0 } = {}) {
    const easing = this.config.easing.easeOutCubic;
    const ms = (this.config.flow?.GIFT_UI_FADE_IN ?? 0.45) * 1000;
    await new Promise((r) => setTimeout(r, delayMs));

    // Ensure the first frame is visible as the "closed" state.
    await this._prepareGiftVideo();

    this.backdrop.classList.add('utt-visible');
    await transitionOpacity(this.backdrop, 1, ms, easing);
  }

  async hide() {
    const easing = this.config.easing.easeOutCubic;
    await transitionOpacity(this.backdrop, 0, 250, easing);
    this.backdrop.classList.remove('utt-visible');
  }

  setDisabled(disabled) {
    const d = Boolean(disabled);
    this.primaryBtn.disabled = d;
    this.preview.disabled = d;
    this.moreBtn.disabled = d;
    this.wishBtn.disabled = d;
    this.homeBtn.disabled = d;
    this.soundToggle.button.disabled = d;
    this.content.style.pointerEvents = d ? 'none' : 'auto';
    this.content.style.opacity = d ? '0.85' : '1';
  }

  setPreviewImage(url) {
    // Used for reduced-motion fallback: show a static image instead of the video.
    this.giftImg.src = url;
    this.giftImg.classList.remove('utt-hidden');
    this.giftVideo.classList.add('utt-hidden');
    this.giftOpenOverlay.style.opacity = '0';
  }

  getGiftVideoElement() {
    return this.giftVideo;
  }

  getConfettiMount() {
    return this.confettiMount;
  }

  waitForGiftEnded() {
    return this._giftEndedPromise ?? Promise.resolve();
  }

  showReveal() {
    this._mode = 'reveal';
    this.actions.classList.add('utt-action-hidden');
    this.revealActions.classList.remove('utt-action-hidden');
    this.backdrop.classList.add('utt-gift-reveal');
  }

  async hideReveal() {
    // 0.3s fade out
    const easing = this.config.easing.easeOutCubic;
    await transitionOpacity(this.backdrop, 0, 300, easing);
    this._mode = 'idle';
    this.actions.classList.remove('utt-action-hidden');
    this.revealActions.classList.add('utt-action-hidden');
    this.backdrop.classList.remove('utt-gift-reveal');
    // Fade back in
    await transitionOpacity(this.backdrop, 1, 250, easing);
  }

  async replayGiftOpen() {
    return this.replayGiftOpenWithOptions({ autoOpen: true });
  }

  async replayGiftOpenWithOptions({ autoOpen = true } = {}) {
    // Used by the "More gifts" flow.
    // When autoOpen=false, this simply returns to the closed state and waits for a user click.
    if (this._mode === 'reveal') {
      await this.hideReveal();
    }

    // Ensure the closed frame is visible.
    await this._prepareGiftVideo();
    try {
      this.giftOpenOverlay.style.opacity = '0';
      this.giftVideo.classList.remove('utt-hidden');
      this.giftImg.classList.add('utt-hidden');
      this.giftVideo.pause();
      this.giftVideo.currentTime = 0;
    } catch {
      // ignore
    }

    if (!autoOpen) {
      this.setDisabled(false);
      return;
    }

    await this._handleOpenGift();
  }

  async _handleOpenGift() {
    if (this._mode !== 'idle') return;
    if (this.runtime?.prefersReducedMotion) return;

    this.setDisabled(true);

    const playToken = ++this._giftPlayToken;

    await this._prepareGiftVideo();

    // Reset any end-state overlay.
    this.giftOpenOverlay.style.opacity = '0';
    this.giftVideo.classList.remove('utt-hidden');
    this.giftImg.classList.add('utt-hidden');

    // Start from the first frame (closed gift).
    try {
      this.giftVideo.currentTime = 0;
    } catch {
      // ignore
    }

    // Create a per-play "ended" promise. This is the simplest and most correct signal.
    // After ended, we wait a paint and lock the final look using the static overlay.
    this._giftEndedPromise = this._waitForGiftEnded({ playToken });

    // Cancel any prior scheduled SFX from older plays.
    if (this._giftLidTimeoutId) {
      window.clearTimeout(this._giftLidTimeoutId);
      this._giftLidTimeoutId = null;
    }

    try {
      const p = this.giftVideo.play();
      if (p && typeof p.then === 'function') await p;

      // SFX timing: play gift_lid_off.mp3 at 2.25s into gift_open.webm.
      // Use a token guard so replays don't double-fire.
      this._giftLidTimeoutId = window.setTimeout(() => {
        if (playToken !== this._giftPlayToken) return;
        this.sfx?.playGiftLidOff?.();
      }, 2250);
    } catch {
      // If play fails, fall back to static open frame.
      this.setPreviewImage(this.config.assets.giftOverlay.giftOpenStatic);
      this._giftEndedPromise = Promise.resolve();
    }

    this.onOpenGift?.();
  }

  async _waitForGiftEnded({ playToken }) {
    const video = this.giftVideo;

    // Wait for the real ended event, but guard against browser edge-cases.
    try {
      await withTimeout(
        new Promise((resolve) => video.addEventListener('ended', resolve, { once: true })),
        20000,
        'Timed out waiting for gift video ended'
      );
    } catch {
      // If ended doesn't fire, proceed anyway.
    }

    // If a newer play started, don't apply end-state UI.
    if (playToken !== this._giftPlayToken) return;

    // Let the final frame paint, then lock the final state with the static overlay.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    if (playToken !== this._giftPlayToken) return;

    try {
      this.giftOpenOverlay.style.transition = `opacity 200ms ${this.config.easing.easeOutCubic}`;
      this.giftOpenOverlay.style.opacity = '1';
    } catch {
      // ignore
    }
  }

  async _prepareGiftVideo() {
    if (!this.giftVideo || !this.giftVideo.src) return;
    if (this.giftVideo.readyState >= 2) return;

    await new Promise((resolve) => {
      const done = () => {
        this.giftVideo.removeEventListener('loadeddata', done);
        this.giftVideo.removeEventListener('canplay', done);
        resolve();
      };

      const onError = () => {
        this.giftVideo.removeEventListener('error', onError);
        this.giftImg.classList.remove('utt-hidden');
        this.giftVideo.classList.add('utt-hidden');
        resolve();
      };

      this.giftVideo.addEventListener('loadeddata', done);
      this.giftVideo.addEventListener('canplay', done);
      this.giftVideo.addEventListener('error', onError, { once: true });
      try {
        this.giftVideo.load();
      } catch {
        resolve();
      }
    });

    // Seek to first frame and pause so it visually matches the closed-gift art.
    try {
      this.giftVideo.pause();
      this.giftVideo.currentTime = 0;
    } catch {
      // ignore
    }
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    // (No click-outside handler; avoids accidental UI reset.)

    if (this._giftLidTimeoutId) {
      window.clearTimeout(this._giftLidTimeoutId);
      this._giftLidTimeoutId = null;
    }

    try {
      this.giftVideo?.pause();
    } catch {
      // ignore
    }

    this.backdrop.remove();
  }
}
