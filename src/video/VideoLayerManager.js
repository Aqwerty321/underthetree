// src/video/VideoLayerManager.js
// Manages alpha video overlays (gift_open + confetti) with robust sync.

import { waitForVideoTime, wait, withTimeout } from '../utils/syncUtils.js';

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function cubicBezierString(nameOrString, config) {
  if (!nameOrString) return config.easing.easeOutQuad;
  if (nameOrString.startsWith('cubic-bezier')) return nameOrString;
  return config.easing[nameOrString] ?? config.easing.easeOutQuad;
}

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

function makeVideo({ url, className }) {
  const v = document.createElement('video');
  v.className = className;
  v.playsInline = true;
  v.preload = 'auto';
  v.muted = true;
  v.loop = false;
  v.src = url;
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  v.setAttribute('crossorigin', 'anonymous');
  return v;
}

export class VideoLayerManager {
  constructor({ parent, config, runtime, giftRenderer, className } = {}) {
    this.parent = parent;
    this.config = config;
    this.runtime = runtime;
    this.giftRenderer = giftRenderer;

    this._domRoot = document.createElement('div');
    this._domRoot.className = className || 'utt-video-layers';
    this.parent.appendChild(this._domRoot);

    // Confetti must not be affected by WebGL postprocessing blur/bloom and should not be blurred by the glass.
    // We always compose confetti as a DOM fullscreen layer.
    this._usingWebGL = false;

    this._confetti = null;
    this._gift = null;
    this._ownsGift = true;

    this._confettiStarted = false;
  }

  destroy() {
    this._cleanupVideo(this._confetti);
    if (this._ownsGift) this._cleanupVideo(this._gift);
    this._gift = null;
    this._confetti = null;

    if (this.giftRenderer) {
      this.giftRenderer.clearVideoLayers();
    }

    this._domRoot.remove();
  }

  // Starts confetti at +offset seconds into the provided gift video.
  // The gift video itself is expected to be embedded in the GiftOverlay (DOM) and already playing.
  async playConfettiSyncedToGift({ giftVideoEl } = {}) {
    const reduced = Boolean(this.runtime.prefersReducedMotion);
    if (reduced) {
      // Reduced motion: no confetti/videos.
      return Promise.resolve();
    }

    this._confettiStarted = false;

    const confettiUrl = this.config.assets?.ui?.effects?.confettiBurst;
    if (!confettiUrl) throw new Error('Missing config.assets.ui.effects.confettiBurst');

    if (!giftVideoEl) throw new Error('Missing giftVideoEl');

    this._gift = giftVideoEl;
    this._ownsGift = false;

    this._confetti = this._confetti ?? makeVideo({ url: confettiUrl, className: 'utt-alpha-video utt-confetti' });

    // Ensure initial opacity states.
    this._confetti.style.opacity = '0';

    // Mount for playback.
    this._mountLayers();

    // Start confetti at gift.currentTime >= 1.0s (± frame tolerance).
    const offset = this.config.flow?.GIFT_OPEN_CONFETTI_OFFSET ?? 1.0;
    try {
      await withTimeout(
        waitForVideoTime(this._gift, Math.max(0, offset - 1 / 60), { toleranceSec: 1 / 60, timeoutMs: 8000 }),
        8500,
        'Gift video did not reach sync time'
      );
    } catch {
      // If sync fails, we still try to start confetti to preserve UX.
    }

    await this._safePlay(this._confetti);
    this._confettiStarted = true;

    // Fade confetti in quickly.
    if (this._usingWebGL && this.giftRenderer) {
      this.giftRenderer.setVideoOpacity('confetti', 0);
      const start = performance.now();
      const ms = 220;
      await new Promise((resolve) => {
        const step = () => {
          const t = clamp01((performance.now() - start) / Math.max(1, ms));
          this.giftRenderer.setVideoOpacity('confetti', t);
          if (t >= 1) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    } else {
      await transitionOpacity(this._confetti, 1, 220, cubicBezierString('easeOutCubic', this.config));
    }

    const confettiTimeoutFallback = async () => {
      const d = this._confetti?.duration;
      const guess = Number.isFinite(d) && d > 0 ? Math.min(d, 8) + 0.5 : 6.5;
      await wait(guess * 1000);
      return;
    };

    const endedPromise = new Promise((resolve) => {
      const onEnded = () => {
        this._confetti?.removeEventListener('ended', onEnded);
        resolve();
      };
      this._confetti?.addEventListener('ended', onEnded);
    });

    // Safety guard in case ended never fires.
    return Promise.race([endedPromise, confettiTimeoutFallback()]);
  }

  // Standalone confetti: plays immediately, intended to be triggered when the reward card appears.
  // Supports a linear playbackRate ramp (e.g., 1.0 -> 0.5 over the duration).
  async playConfetti({ playbackRateStart = 1.0, playbackRateEnd = 0.5 } = {}) {
    const reduced = Boolean(this.runtime.prefersReducedMotion);
    if (reduced) return Promise.resolve();

    this._confettiStarted = false;

    const confettiUrl = this.config.assets?.ui?.effects?.confettiBurst;
    if (!confettiUrl) throw new Error('Missing config.assets.ui.effects.confettiBurst');

    this._confetti = this._confetti ?? makeVideo({ url: confettiUrl, className: 'utt-alpha-video utt-confetti' });

    // Ensure initial opacity state.
    this._confetti.style.opacity = '0';

    // Mount for playback.
    this._mountLayers();

    // Start from the beginning.
    try {
      this._confetti.currentTime = 0;
    } catch {
      // ignore
    }

    try {
      this._confetti.playbackRate = Number(playbackRateStart) || 1.0;
    } catch {
      // ignore
    }

    await this._safePlay(this._confetti);
    this._confettiStarted = true;

    // Playback rate ramp: linear from start -> end until the video ends.
    try {
      const v = this._confetti;
      const startRate = Math.max(0.1, Number(playbackRateStart) || 1.0);
      const endRate = Math.max(0.1, Number(playbackRateEnd) || 0.5);
      const duration = Number.isFinite(v?.duration) && v.duration > 0 ? v.duration : 6.5;

      const tick = () => {
        if (!this._confettiStarted || !v) return;
        if (v.ended) return;
        const t = clamp01((Number(v.currentTime) || 0) / Math.max(0.001, duration));
        const r = startRate + (endRate - startRate) * t;
        try {
          v.playbackRate = r;
        } catch {
          // ignore
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      // ignore
    }

    // Fade confetti in quickly.
    await transitionOpacity(this._confetti, 1, 220, cubicBezierString('easeOutCubic', this.config));

    const confettiTimeoutFallback = async () => {
      const d = this._confetti?.duration;
      const guess = Number.isFinite(d) && d > 0 ? Math.min(d, 8) + 0.5 : 6.5;
      await wait(guess * 1000);
      return;
    };

    const endedPromise = new Promise((resolve) => {
      const onEnded = () => {
        this._confetti?.removeEventListener('ended', onEnded);
        resolve();
      };
      this._confetti?.addEventListener('ended', onEnded);
    });

    return Promise.race([endedPromise, confettiTimeoutFallback()]);
  }

  // Standalone confetti that persists until an external signal completes (e.g., the gift-open video ended).
  // If confetti ends before `untilPromise` resolves, it will restart from the beginning.
  async playConfettiUntil({ untilPromise, playbackRateStart = 1.0, playbackRateEnd = 0.5 } = {}) {
    const reduced = Boolean(this.runtime.prefersReducedMotion);
    if (reduced) return Promise.resolve();

    const untilP = Promise.resolve(untilPromise).catch(() => {});

    // If the target is already finished, fall back to a single confetti play.
    // (Preserves the celebratory moment even if the gift video ended early.)
    let alreadyDone = false;
    await Promise.race([
      untilP.then(() => {
        alreadyDone = true;
      }),
      Promise.resolve()
    ]);
    if (alreadyDone) {
      return this.playConfetti({ playbackRateStart, playbackRateEnd });
    }

    this._confettiStarted = false;

    const confettiUrl = this.config.assets?.ui?.effects?.confettiBurst;
    if (!confettiUrl) throw new Error('Missing config.assets.ui.effects.confettiBurst');

    this._confetti = this._confetti ?? makeVideo({ url: confettiUrl, className: 'utt-alpha-video utt-confetti' });

    // Ensure initial opacity state.
    this._confetti.style.opacity = '0';

    // Mount for playback.
    this._mountLayers();

    const startOne = async () => {
      // Restart from the beginning.
      try {
        this._confetti.currentTime = 0;
      } catch {
        // ignore
      }

      try {
        this._confetti.playbackRate = Number(playbackRateStart) || 1.0;
      } catch {
        // ignore
      }

      await this._safePlay(this._confetti);
    };

    await startOne();
    this._confettiStarted = true;

    // Playback rate ramp: linear from start -> end until the video ends.
    try {
      const v = this._confetti;
      const startRate = Math.max(0.1, Number(playbackRateStart) || 1.0);
      const endRate = Math.max(0.1, Number(playbackRateEnd) || 0.5);
      const duration = Number.isFinite(v?.duration) && v.duration > 0 ? v.duration : 6.5;

      const tick = () => {
        if (!this._confettiStarted || !v) return;
        if (v.ended) return;
        const t = clamp01((Number(v.currentTime) || 0) / Math.max(0.001, duration));
        const r = startRate + (endRate - startRate) * t;
        try {
          v.playbackRate = r;
        } catch {
          // ignore
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      // ignore
    }

    // Fade confetti in quickly.
    await transitionOpacity(this._confetti, 1, 220, cubicBezierString('easeOutCubic', this.config));

    const endedOrTimeoutOnce = () => {
      const confettiTimeoutFallback = async () => {
        const d = this._confetti?.duration;
        const guess = Number.isFinite(d) && d > 0 ? Math.min(d, 8) + 0.5 : 6.5;
        await wait(guess * 1000);
        return;
      };

      const endedPromise = new Promise((resolve) => {
        const onEnded = () => {
          this._confetti?.removeEventListener('ended', onEnded);
          resolve('ended');
        };
        this._confetti?.addEventListener('ended', onEnded);
      });

      return Promise.race([endedPromise, confettiTimeoutFallback().then(() => 'timeout')]);
    };

    // Loop confetti until the external promise resolves.
    // If the confetti ends first, restart it.
    while (true) {
      const winner = await Promise.race([untilP.then(() => 'until'), endedOrTimeoutOnce()]);
      if (winner === 'until') break;
      if (!this._confettiStarted || !this._confetti) break;
      // If the target is done by the time we reach here, don't restart.
      let doneNow = false;
      await Promise.race([
        untilP.then(() => {
          doneNow = true;
        }),
        Promise.resolve()
      ]);
      if (doneNow) break;
      try {
        await startOne();
      } catch {
        // If restart fails, stop looping and let the caller fade out.
        break;
      }
    }

    return;
  }

  async fadeOutConfetti() {
    const reduced = Boolean(this.runtime.prefersReducedMotion);
    const easing = cubicBezierString('easeOutCubic', this.config);
    const ms = (this.config.flow?.GIFT_OPEN_FADE_OUT ?? 0.6) * 1000;

    if (!this._confettiStarted) return;

    if (this._usingWebGL && this.giftRenderer) {
      const start = performance.now();
      await new Promise((resolve) => {
        const step = () => {
          const t = clamp01((performance.now() - start) / Math.max(1, ms));
          const e = 1 - Math.pow(1 - t, 3);
          this.giftRenderer.setVideoOpacity('confetti', 1 - e);
          if (t >= 1) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      this.giftRenderer.setConfettiVideo(null);
    } else if (this._confetti) {
      await transitionOpacity(this._confetti, 0, reduced ? 200 : ms, easing);
    }

    this._cleanupVideo(this._confetti);
    this._confetti = null;
    this._confettiStarted = false;
  }

  _mountLayers() {
    // Layer order (bottom -> top): giftRenderer canvas (already in DOM), then confetti.
    if (this._usingWebGL && this.giftRenderer) {
      this.giftRenderer.setConfettiVideo(this._confetti);
      // Gift video is embedded in the overlay container (DOM).
      this.giftRenderer.setGiftOpenVideo(null);
      return;
    }

    // DOM fallback.
    this._domRoot.innerHTML = '';
    if (this._confetti) this._domRoot.appendChild(this._confetti);
  }

  async _safePlay(videoEl) {
    if (!videoEl) return;
    // Ensure we start from the beginning.
    try {
      videoEl.currentTime = 0;
    } catch {
      // ignore
    }

    const p = videoEl.play();
    if (p && typeof p.then === 'function') await p;
  }

  _cleanupVideo(videoEl) {
    if (!videoEl) return;
    try {
      videoEl.pause();
    } catch {
      // ignore
    }

    try {
      videoEl.removeAttribute('src');
      videoEl.load();
    } catch {
      // ignore
    }

    try {
      videoEl.remove();
    } catch {
      // ignore
    }
  }
}
