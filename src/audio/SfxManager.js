// src/audio/SfxManager.js
// Lightweight HTMLAudio-based SFX (respects runtime.muted).

function safePlay(audioEl) {
  if (!audioEl) return;
  try {
    const p = audioEl.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    // ignore
  }
}

export class SfxManager {
  constructor({ config, runtime } = {}) {
    this.config = config;
    this.runtime = runtime;

    this._muted = Boolean(runtime?.muted);

    this._pools = new Map();
    this._poolIndex = new Map();

    this._fadeRafByAudio = new WeakMap();

    this._defs = {
      click: {
        url: config?.assets?.audio?.click ?? '/assets/audio/click.mp3',
        gain: config?.audio?.sfx?.clickGain ?? 0.9,
        poolSize: 6
      },
      fanfare: {
        url: config?.assets?.audio?.fanfare ?? '/assets/audio/fanfare.mp3',
        gain: config?.audio?.sfx?.fanfareGain ?? 1.0,
        poolSize: 2
      },
      gift_lid_off: {
        url: config?.assets?.audio?.giftLidOff ?? '/assets/audio/gift_lid_off.mp3',
        gain: config?.audio?.sfx?.giftLidOffGain ?? 1.0,
        poolSize: 2
      }
    };

    this._prewarm();
  }

  _prewarm() {
    for (const [name, def] of Object.entries(this._defs)) {
      const pool = [];
      for (let i = 0; i < def.poolSize; i++) {
        const a = new Audio();
        a.preload = 'auto';
        a.src = def.url;
        a.volume = this._muted ? 0 : def.gain;
        a.muted = this._muted;
        try {
          a.load();
        } catch {
          // ignore
        }
        pool.push(a);
      }
      this._pools.set(name, pool);
      this._poolIndex.set(name, 0);
    }
  }

  setMuted(muted) {
    this._muted = Boolean(muted);
    for (const [name, pool] of this._pools.entries()) {
      const def = this._defs[name];
      for (const a of pool) {
        const raf = this._fadeRafByAudio.get(a);
        if (raf) {
          cancelAnimationFrame(raf);
          this._fadeRafByAudio.delete(a);
        }
        a.muted = this._muted;
        a.volume = this._muted ? 0 : def.gain;
      }
    }
  }

  _playWithFadeIn(audioEl, { toVolume, fadeMs = 500 } = {}) {
    if (!audioEl) return;
    if (this.runtime?.muted ?? this._muted) return;

    const target = Math.max(0, Math.min(1, Number(toVolume) || 1));
    const durMs = Math.max(0, Number(fadeMs) || 0);

    const prior = this._fadeRafByAudio.get(audioEl);
    if (prior) {
      cancelAnimationFrame(prior);
      this._fadeRafByAudio.delete(audioEl);
    }

    try {
      audioEl.muted = this._muted;
      audioEl.volume = 0;
      audioEl.currentTime = 0;
    } catch {
      // ignore
    }

    safePlay(audioEl);

    if (durMs <= 0) {
      try {
        audioEl.volume = this._muted ? 0 : target;
      } catch {
        // ignore
      }
      return;
    }

    const start = performance.now();
    const step = () => {
      if (this.runtime?.muted ?? this._muted) {
        try {
          audioEl.volume = 0;
        } catch {
          // ignore
        }
        this._fadeRafByAudio.delete(audioEl);
        return;
      }

      const t = Math.min(1, Math.max(0, (performance.now() - start) / Math.max(1, durMs)));
      const v = target * t;
      try {
        audioEl.volume = v;
      } catch {
        // ignore
      }

      if (t >= 1) {
        this._fadeRafByAudio.delete(audioEl);
        return;
      }

      const raf = requestAnimationFrame(step);
      this._fadeRafByAudio.set(audioEl, raf);
    };

    const raf = requestAnimationFrame(step);
    this._fadeRafByAudio.set(audioEl, raf);
  }

  play(name) {
    if (!name) return;
    if (this.runtime?.muted ?? this._muted) return;

    const pool = this._pools.get(name);
    const def = this._defs[name];
    if (!pool || !def) return;

    const idx = this._poolIndex.get(name) ?? 0;
    const a = pool[idx % pool.length];
    this._poolIndex.set(name, (idx + 1) % pool.length);

    const prior = this._fadeRafByAudio.get(a);
    if (prior) {
      cancelAnimationFrame(prior);
      this._fadeRafByAudio.delete(a);
    }

    try {
      a.muted = this._muted;
      a.volume = this._muted ? 0 : def.gain;
      a.currentTime = 0;
    } catch {
      // ignore
    }

    safePlay(a);
  }

  playClick() {
    this.play('click');
  }

  playFanfare() {
    this.play('fanfare');
  }

  playGiftLidOff() {
    if (this.runtime?.muted ?? this._muted) return;

    const name = 'gift_lid_off';
    const pool = this._pools.get(name);
    const def = this._defs[name];
    if (!pool || !def) return;

    const idx = this._poolIndex.get(name) ?? 0;
    const a = pool[idx % pool.length];
    this._poolIndex.set(name, (idx + 1) % pool.length);

    this._playWithFadeIn(a, { toVolume: def.gain, fadeMs: 500 });
  }
}
