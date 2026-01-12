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
        a.muted = this._muted;
        a.volume = this._muted ? 0 : def.gain;
      }
    }
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
    this.play('gift_lid_off');
  }
}
