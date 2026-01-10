// src/ui/TransitionController.js
// Orchestrates: fade-to-black -> loading bar -> fade-in cinematic video.
// Designed to be modular and future-proof (hooks for extra scenes/screens).

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function nowMs() {
  return performance.now();
}

function cubicBezierString(nameOrString, config) {
  // Accept explicit strings or config easing names.
  if (!nameOrString) return config.easing.easeOutQuad;
  if (nameOrString.startsWith('cubic-bezier')) return nameOrString;
  return config.easing[nameOrString] ?? config.easing.easeOutQuad;
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function transitionOpacity(el, to, ms, easing) {
  return new Promise((resolve) => {
    const done = () => {
      el.removeEventListener('transitionend', done);
      resolve();
    };

    el.addEventListener('transitionend', done);
    el.style.transition = `opacity ${ms}ms ${easing}`;
    // Force layout to ensure transition applies.
    void el.offsetWidth;
    el.style.opacity = String(to);

    // Fallback in case transitionend doesn't fire.
    setTimeout(done, ms + 50);
  });
}

export class TransitionController {
  constructor({ parent, config, runtime, renderer, soundscape, heroCard, debugEnabled }) {
    this.parent = parent;
    this.config = config;
    this.runtime = runtime;
    this.renderer = renderer;
    this.soundscape = soundscape;
    this.heroCard = heroCard;
    this.debugEnabled = Boolean(debugEnabled);

    this._isTransitioning = false;

    // DOM nodes created lazily.
    this.blackout = null;
    this.loading = null;
    this.video = null;

    this._progressDisplayed = 0;
    this._progressRaw = 0;
    this._lastProgressUpdateMs = 0;
    this._hadAnyProgress = false;
    this._raf = null;

    this._onVideoEndedBound = null;
  }

  async startCinematic() {
    if (this._isTransitioning) return;
    this._isTransitioning = true;

    const reduced = Boolean(this.runtime.prefersReducedMotion);

    // Disable interactions immediately.
    this.heroCard?.setDisabled(true);

    // Pause/stop parallax input gracefully.
    this.renderer?.beginParallaxStop(reduced ? 0.0 : 0.20);
    this.renderer?.setInputEnabled(false);

    // Create blackout overlay.
    this._ensureBlackout();

    // Fade UI out + fade blackout in (0.00 -> 0.50, easeOutQuad)
    const easeOutQuad = cubicBezierString('easeOutQuad', this.config);
    const fadeMs = reduced ? 200 : 500;

    this.blackout.classList.add('utt-visible');
    this.blackout.style.transition = `opacity ${fadeMs}ms ${easeOutQuad}`;
    void this.blackout.offsetWidth;
    this.blackout.style.opacity = '1';

    this.heroCard?.fadeOut(fadeMs, easeOutQuad);

    // Audio crossfade out (0.00 -> 0.60): master gain current -> 0.05
    this.soundscape?.fadeMasterTo(0.05, reduced ? 0.2 : 0.6, 'easeOutQuad');

    await wait(fadeMs);

    // Video decode can stutter if the GPU is busy rendering postprocessing behind it.
    // Pause the hero renderer once the blackout fully covers the scene.
    this.renderer?.pause();

    // Black is now fully opaque: show loading bar and begin video preload.
    this._ensureLoading();
    this._showLoading(reduced);

    try {
      await this._preloadAndPlayVideo(reduced);
      await this._finalizeAndFadeInVideo(reduced);
    } catch (err) {
      this._showRetry(String(err?.message ?? err));
      // Allow user to cancel back to hero.
    }
  }

  _ensureBlackout() {
    if (this.blackout) return;
    const el = document.createElement('div');
    el.className = 'utt-blackout';
    el.style.opacity = '0';
    this.parent.appendChild(el);
    this.blackout = el;
  }

  _ensureLoading() {
    if (this.loading) return;

    const wrap = document.createElement('div');
    wrap.className = 'utt-loading';

    const bar = document.createElement('div');
    bar.className = 'utt-bar';

    const fill = document.createElement('div');
    fill.className = 'utt-bar-fill';

    bar.appendChild(fill);

    const pct = document.createElement('div');
    pct.className = 'utt-pct';
    pct.textContent = '0%';

    wrap.appendChild(bar);
    wrap.appendChild(pct);

    const retry = document.createElement('div');
    retry.className = 'utt-retry utt-hidden';

    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'utt-glass-btn utt-cta';
    retryBtn.style.height = '44px';
    retryBtn.style.padding = '0 16px';
    retryBtn.textContent = 'Retry';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'utt-glass-btn utt-icon-btn';
    cancelBtn.setAttribute('aria-label', 'Return home');
    cancelBtn.textContent = '↩';

    retryBtn.addEventListener('click', () => {
      retry.classList.add('utt-hidden');
      this._resetProgress();
      this.startCinematic();
    });

    cancelBtn.addEventListener('click', () => {
      this._cancelToHome();
    });

    retry.appendChild(retryBtn);
    retry.appendChild(cancelBtn);

    wrap.appendChild(retry);

    this.parent.appendChild(wrap);

    this.loading = { wrap, bar, fill, pct, retry };
  }

  _showLoading(reduced) {
    const wrap = this.loading.wrap;
    wrap.classList.add('utt-visible');
    if (!reduced) wrap.classList.add('utt-shimmer');
  }

  _resetProgress() {
    this._progressDisplayed = 0;
    this._progressRaw = 0;
    this._hadAnyProgress = false;
    this._lastProgressUpdateMs = nowMs();
    this._tickLastMs = undefined;
    if (this.loading) {
      this.loading.fill.style.transform = 'scaleX(0)';
      this.loading.pct.textContent = '0%';
    }
  }

  async _preloadAndPlayVideo(reduced) {
    const url = this.config.cinematic?.url;
    if (!url) throw new Error('Missing config.cinematic.url');

    // Create video element (opacity 0). We keep it muted and route audio via WebAudio for crossfades.
    if (!this.video) {
      const v = document.createElement('video');
      v.className = 'utt-video';
      v.playsInline = true;
      v.preload = 'auto';
      v.muted = true;
      v.loop = false;
      v.src = url;
      this.parent.appendChild(v);
      this.video = v;
    }

    const video = this.video;

    // Ensure we fade out to black once playback ends (play once; no replay).
    if (!this._onVideoEndedBound) {
      this._onVideoEndedBound = () => {
        this._handleVideoEnded();
      };
    }
    video.addEventListener('ended', this._onVideoEndedBound, { once: true });

    // Begin loading progress loop.
    this._resetProgress();
    const start = nowMs();
    const minLoadMs = reduced ? 200 : 600;

    // Listen for readiness/progress *before* calling play() so we don't miss early events.
    let canPlay = video.readyState >= 3;
    const markReady = () => {
      canPlay = true;
      this._hadAnyProgress = true;
      this._lastProgressUpdateMs = nowMs();
    };
    const onProgress = () => {
      this._hadAnyProgress = true;
      this._lastProgressUpdateMs = nowMs();
    };

    video.addEventListener('canplaythrough', markReady);
    video.addEventListener('canplay', markReady);
    video.addEventListener('loadeddata', markReady);
    video.addEventListener('loadedmetadata', onProgress);
    video.addEventListener('progress', onProgress);

    let errorOccurred = false;
    const onErrorWrapped = () => {
      errorOccurred = true;
    };
    video.addEventListener('error', onErrorWrapped);

    // Start playback within this user flow; if browser blocks, we'll handle error.
    // Some browsers will only resolve play() if called in a user-gesture; since CTA click calls startCinematic(),
    // we're still in that promise chain.
    const playPromise = video.play();
    if (playPromise && typeof playPromise.then === 'function') {
      await playPromise;
    }

    const stallTimeoutMs = 6000;

    await new Promise((resolve, reject) => {
      const tick = () => {
                if (errorOccurred) {
                  cancelAnimationFrame(this._raf);
                  reject(new Error('Video failed to load'));
                  return;
                }
        const t = nowMs();
        const dt = (t - (this._tickLastMs ?? t)) / 1000;
        this._tickLastMs = t;

        // Some debug scenarios want slower progress movement.
        const dtScaled = this.config.flags?.simulateSlowNet ? dt * 0.25 : dt;

        // progressRaw from buffered ratio (display clamp to 0.98)
        let bufferedRatio = 0;
        if (video.duration && video.duration > 0 && video.buffered && video.buffered.length > 0) {
          const end = video.buffered.end(video.buffered.length - 1);
          bufferedRatio = clamp01(end / video.duration);
        }
        this._progressRaw = Math.min(bufferedRatio, 0.98);

        // Spec smoothing: lerp(displayed, raw, 1 - pow(0.001, dt*60))
        const alpha = 1 - Math.pow(0.001, dtScaled * 60);
        this._progressDisplayed = Math.max(this._progressDisplayed, this._progressDisplayed + (this._progressRaw - this._progressDisplayed) * alpha);

        // Update DOM
        if (this.loading) {
          this.loading.fill.style.transform = `scaleX(${this._progressDisplayed})`;
          this.loading.pct.textContent = `${Math.round(this._progressDisplayed * 100)}%`;
        }

        const elapsed = t - start;
        const stalled = this._hadAnyProgress && (t - this._lastProgressUpdateMs) > stallTimeoutMs;

        // Many browsers won't reliably fire canplaythrough for MP4; and readyState may stabilize at 3.
        const haveEnough = video.readyState >= 3;
        const ready = (canPlay || haveEnough) && elapsed >= minLoadMs && this._hadAnyProgress && bufferedRatio >= 0.98;

        if (stalled) {
          cancelAnimationFrame(this._raf);
          reject(new Error('Loading stalled'));
          return;
        }

        if (ready) {
          cancelAnimationFrame(this._raf);
          resolve();
          return;
        }

        this._raf = requestAnimationFrame(tick);
      };

      this._raf = requestAnimationFrame(tick);
    });

    video.removeEventListener('canplaythrough', markReady);
    video.removeEventListener('canplay', markReady);
    video.removeEventListener('loadeddata', markReady);
    video.removeEventListener('loadedmetadata', onProgress);
    video.removeEventListener('progress', onProgress);
    video.removeEventListener('error', onErrorWrapped);

    // Smear final 100% for polish.
    this._progressDisplayed = 0.995;
    if (this.loading) {
      this.loading.fill.style.transform = `scaleX(${this._progressDisplayed})`;
      this.loading.pct.textContent = `99%`;
    }
  }

  async _finalizeAndFadeInVideo(reduced) {
    // Hold 120ms + shimmer 220ms (skipped/shortened on reduced motion)
    await wait(reduced ? 60 : 120);

    this._progressDisplayed = 1;
    if (this.loading) {
      this.loading.fill.style.transform = 'scaleX(1)';
      this.loading.pct.textContent = '100%';
    }

    await wait(reduced ? 80 : 220);

    // Fade OUT the loading UI completely before fading IN the video.
    if (this.loading?.wrap) {
      const easeOutQuad = cubicBezierString('easeOutQuad', this.config);
      const outMs = reduced ? 160 : 320;
      await transitionOpacity(this.loading.wrap, 0, outMs, easeOutQuad);
      this.loading.wrap.remove();
      this.loading = null;
    }

    // Prepare video audio via WebAudio
    const ctx = this.soundscape?.getAudioContext?.();
    if (ctx) {
      if (!this._videoAudioConnected) {
        // Create a media element source and gain for crossfade.
        this._videoGain = ctx.createGain();
        this._videoGain.gain.value = 0;

        const src = ctx.createMediaElementSource(this.video);
        src.connect(this._videoGain);
        this._videoGain.connect(ctx.destination);
        this._videoAudioConnected = true;
      }

      // Unmute now that playback has started and we control gain via WebAudio.
      this.video.muted = false;

      // Fade ambient to 0 and video to 1 over fade-in.
      this.soundscape?.fadeMasterTo(0.0, reduced ? 0.2 : 0.6, 'easeOutCubic');
      this._fadeGain(this._videoGain, 1.0, reduced ? 0.2 : 0.6, 'easeOutCubic');
    }

    // Fade video in (0.60s easeOutCubic)
    const easeOutCubic = cubicBezierString('easeOutCubic', this.config);
    const fadeMs = reduced ? 200 : 600;
    this.video.classList.add('utt-visible');
    this.video.style.transition = `opacity ${fadeMs}ms ${easeOutCubic}`;
    void this.video.offsetWidth;
    this.video.style.opacity = '1';

    await wait(fadeMs);

    // Keep blackout behind video; when video fades out you'll land on black.
  }

  async _handleVideoEnded() {
    // Fade video OUT to black, then pause on black.
    const reduced = Boolean(this.runtime.prefersReducedMotion);
    const easeOutCubic = cubicBezierString('easeOutCubic', this.config);
    const fadeMs = reduced ? 200 : 600;

    // Fade video audio down (keep ambient at 0; caller can decide what comes next).
    if (this._videoGain) {
      this._fadeGain(this._videoGain, 0.0, reduced ? 0.2 : 0.6, 'easeOutCubic');
    }

    if (this.video) {
      this.video.style.transition = `opacity ${fadeMs}ms ${easeOutCubic}`;
      void this.video.offsetWidth;
      this.video.style.opacity = '0';
      await wait(fadeMs);
      try {
        this.video.pause();
      } catch {
        // ignore
      }
    }

    this._isTransitioning = false;
  }

  _fadeGain(gainNode, target, durationSec, easingName) {
    const ease = easingName === 'easeOutCubic' ? (t) => 1 - Math.pow(1 - t, 3) : (t) => 1 - (1 - t) * (1 - t);

    const start = nowMs();
    const from = gainNode.gain.value;
    const durMs = Math.max(1, durationSec * 1000);

    const step = () => {
      const t = clamp01((nowMs() - start) / durMs);
      gainNode.gain.value = from + (target - from) * ease(t);
      if (t < 1) requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
  }

  _showRetry(reason) {
    if (!this.loading) return;
    this.loading.wrap.classList.remove('utt-shimmer');
    this.loading.retry.classList.remove('utt-hidden');
    this.loading.pct.textContent = '—';
    // eslint-disable-next-line no-console
    console.warn('Cinematic load failed:', reason);
  }

  _cancelToHome() {
    // Restore hero state.
    this._isTransitioning = false;

    this.video?.pause();
    this.video?.remove();
    this.video = null;

    this.loading?.wrap?.remove();
    this.loading = null;

    this.blackout?.remove();
    this.blackout = null;

    this.heroCard?.setDisabled(false);
    this.heroCard?.setVisible(true);
    this.heroCard.el.style.opacity = '1';

    this.renderer?.setInputEnabled(true);
    this.renderer?.cancelParallaxStop();
    this.renderer?.resume();

    this.soundscape?.fadeMasterTo(this.config.audio.masterGain, 0.35, 'easeOutCubic');
  }
}
