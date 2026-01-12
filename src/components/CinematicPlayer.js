// src/components/CinematicPlayer.js
// Plays the cinematic MP4 with a loading bar, respecting autoplay rules.

import { wait } from '../utils/syncUtils.js';

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

export class CinematicPlayer {
  constructor({ parent, config, runtime, debugEnabled }) {
    this.parent = parent;
    this.config = config;
    this.runtime = runtime;
    this.debugEnabled = Boolean(debugEnabled);

    this.blackout = null;
    this.loading = null;
    this.video = null;

    this._raf = null;
    this._playing = false;
  }

  async play() {
    if (this._playing) return;
    this._playing = true;

    const reduced = Boolean(this.runtime.prefersReducedMotion);

    this._ensureBlackout();
    this.blackout.style.opacity = '1';

    this._ensureLoading();
    this._showLoading();

    await this._preloadVideoWithProgress(reduced);

    // Fade out loading completely first.
    await transitionOpacity(this.loading.wrap, 0, reduced ? 160 : 320, cubicBezierString('easeOutQuad', this.config));
    this.loading.wrap.remove();
    this.loading = null;

    // Start playback only after the loading UI is gone.
    // (Fixes cases where the video finishes behind the loading overlay.)
    try {
      this.video.currentTime = 0;
    } catch {
      // ignore
    }

    // Attach ended listener before play() so we don't miss short videos.
    const ended = new Promise((resolve) => {
      this.video.addEventListener('ended', resolve, { once: true });
    });

    try {
      const playPromise = this.video.play();
      if (playPromise && typeof playPromise.then === 'function') await playPromise;
    } catch {
      // If play() fails (rare since video is muted), just proceed; the fade will show first frame if available.
    }

    // Fade in video from black.
    const fadeInMs = (this.config.flow?.CINEMATIC_FADE_IN ?? 0.6) * 1000;
    const easeOutQuad = cubicBezierString('easeOutQuad', this.config);

    this.video.style.opacity = '0';
    this.video.classList.add('utt-visible');

    // Keep blackout until video has faded in; then fade blackout out.
    const videoFade = transitionOpacity(this.video, 1, reduced ? 200 : fadeInMs, easeOutQuad);
    const blackFade = transitionOpacity(this.blackout, 0, reduced ? 200 : fadeInMs, easeOutQuad);

    await Promise.all([videoFade, blackFade]);

    await ended;

    // Fade to black on end.
    await this.fadeToBlack();

    this._playing = false;
  }

  async fadeToBlack() {
    const reduced = Boolean(this.runtime.prefersReducedMotion);

    const fadeOutMs = (this.config.flow?.CINEMATIC_FADE_OUT ?? 0.5) * 1000;
    const easeOutCubic = cubicBezierString('easeOutCubic', this.config);

    if (!this.blackout) this._ensureBlackout();
    this.blackout.style.opacity = String(this.blackout.style.opacity || 0);

    // Fade video out + blackout in.
    await Promise.all([
      this.video ? transitionOpacity(this.video, 0, reduced ? 200 : fadeOutMs, easeOutCubic) : Promise.resolve(),
      transitionOpacity(this.blackout, 1, reduced ? 200 : fadeOutMs, easeOutCubic)
    ]);

    try {
      this.video?.pause();
    } catch {
      // ignore
    }

    // Remove video element to free decoder resources.
    if (this.video) {
      try {
        this.video.removeAttribute('src');
        this.video.load();
      } catch {
        // ignore
      }
      this.video.remove();
      this.video = null;
    }
  }

  skip() {
    if (!this._playing) return;
    try {
      this.video.currentTime = this.video.duration || this.video.currentTime;
    } catch {
      // ignore
    }
    this.video?.dispatchEvent(new Event('ended'));
  }

  _ensureBlackout() {
    if (this.blackout) return;
    const el = document.createElement('div');
    el.className = 'utt-blackout utt-visible';
    el.style.opacity = '1';
    this.parent.appendChild(el);
    this.blackout = el;
  }

  _ensureLoading() {
    if (this.loading) return;

    const wrap = document.createElement('div');
    wrap.className = 'utt-loading utt-loader utt-fancy utt-visible utt-shimmer';

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

    this.parent.appendChild(wrap);

    this.loading = { wrap, fill, pct };
  }

  _showLoading() {
    if (!this.loading) return;
    this.loading.wrap.style.opacity = '1';
  }

  async _preloadVideoWithProgress(reduced) {
    const url = this.config.cinematic?.url;
    if (!url) throw new Error('Missing config.cinematic.url');

    if (!this.video) {
      const v = document.createElement('video');
      v.className = 'utt-video';
      v.playsInline = true;
      v.preload = 'auto';
      v.muted = true;
      v.loop = false;
      v.src = url;
      v.setAttribute('playsinline', '');
      v.setAttribute('webkit-playsinline', '');
      this.parent.appendChild(v);
      this.video = v;
    }

    const video = this.video;

    // Ensure we are NOT playing while the loading UI is visible.
    try {
      video.pause();
    } catch {
      // ignore
    }
    try {
      if (!Number.isFinite(video.currentTime) || video.currentTime !== 0) video.currentTime = 0;
    } catch {
      // ignore
    }

    // Attach readiness listeners before play() to avoid missing early events.
    let canPlay = video.readyState >= 3;
    const markReady = () => {
      canPlay = true;
    };

    video.addEventListener('canplay', markReady);
    video.addEventListener('loadeddata', markReady);

    // Kick off buffering without starting playback.
    try {
      video.load();
    } catch {
      // ignore
    }

    const start = performance.now();
    const minLoadMs = 2000;

    await new Promise((resolve, reject) => {
      const tick = () => {
        const t = performance.now();
        const dt = (t - (this._tickLastMs ?? t)) / 1000;
        this._tickLastMs = t;

        const dtScaled = this.config.flags?.simulateSlowNet ? dt * 0.25 : dt;

        let bufferedRatio = 0;
        if (video.duration && video.duration > 0 && video.buffered && video.buffered.length > 0) {
          const end = video.buffered.end(video.buffered.length - 1);
          bufferedRatio = clamp01(end / video.duration);
        }

        const rawDisplay = Math.min(bufferedRatio, 0.98);
        const alpha = 1 - Math.pow(0.001, dtScaled * 60);
        this._progressDisplayed = Math.max(this._progressDisplayed ?? 0, (this._progressDisplayed ?? 0) + (rawDisplay - (this._progressDisplayed ?? 0)) * alpha);

        if (this.loading) {
          this.loading.fill.style.transform = `scaleX(${this._progressDisplayed})`;
          this.loading.pct.textContent = `${Math.round(this._progressDisplayed * 100)}%`;
        }

        const elapsed = t - start;
        const haveEnough = video.readyState >= 3;
        const ready = (canPlay || haveEnough) && bufferedRatio >= 0.98 && elapsed >= minLoadMs;

        if (ready) {
          this._progressDisplayed = 1;
          if (this.loading) {
            this.loading.fill.style.transform = 'scaleX(1)';
            this.loading.pct.textContent = '100%';
          }
          resolve();
          return;
        }

        this._raf = requestAnimationFrame(tick);
      };

      this._raf = requestAnimationFrame(tick);

      // Hard safety timeout.
      setTimeout(() => reject(new Error('Cinematic load timed out')), 12000);
    });

    video.removeEventListener('canplay', markReady);
    video.removeEventListener('loadeddata', markReady);

    await wait(reduced ? 60 : 120);
  }
}
