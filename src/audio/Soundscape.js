// src/audio/Soundscape.js
// Web Audio soundscape:
// - two looped sources (room + fire)
// - starts only on user gesture
// - crossfades in over 0.6s
// - slow fire modulation

export class Soundscape {
  constructor({ config, runtime }) {
    this.config = config;
    this.runtime = runtime;

    this._ctx = null;
    this._master = null;
    this._roomGain = null;
    this._fireGain = null;
    this._roomSrc = null;
    this._fireSrc = null;

    this._buffers = null;
    this._started = false;
    this._muted = Boolean(runtime.muted);

    this._firePhase = Math.random() * Math.PI * 2;
    this._raf = null;
  }

  async preload(audioAssets) {
    // We accept arraybuffers from assetLoader; decoding is deferred until start() when we can create AudioContext.
    this._buffers = audioAssets;
  }

  syncFromConfig() {
    // No-op for now; debug panel mainly affects renderer.
  }

  getAudioContext() {
    return this._ctx;
  }

  _ease(name, t) {
    // Minimal easing set for audio ramps (kept intentionally small).
    // We use these to produce nicer subjective fades than linear.
    switch (name) {
      case 'easeOutCubic':
        return 1 - Math.pow(1 - t, 3);
      case 'easeOutQuad':
      default:
        return 1 - (1 - t) * (1 - t);
    }
  }

  fadeMasterTo(targetGain, durationSec, easingName = 'easeOutQuad') {
    if (!this._ctx || !this._master) return;
    if (this._muted) return; // muted overrides fades

    const start = performance.now();
    const from = this._master.gain.value;
    const to = targetGain;
    const durMs = Math.max(1, (durationSec ?? 0.3) * 1000);

    const step = () => {
      if (!this._ctx || !this._master) return;
      const t = Math.min(1, Math.max(0, (performance.now() - start) / durMs));
      const e = this._ease(easingName, t);
      this._master.gain.value = from + (to - from) * e;
      if (t < 1) requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
  }

  setMuted(muted) {
    this._muted = Boolean(muted);
    if (this._master) {
      this._master.gain.setTargetAtTime(this._muted ? 0 : this.config.audio.masterGain, this._ctx.currentTime, 0.02);
    }
  }

  async start() {
    if (this._started) return;

    // Creating AudioContext on user gesture keeps autoplay policies happy.
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();

    this._master = this._ctx.createGain();
    this._master.gain.value = this._muted ? 0 : this.config.audio.masterGain;
    this._master.connect(this._ctx.destination);

    this._roomGain = this._ctx.createGain();
    this._fireGain = this._ctx.createGain();

    // Start silent; we ramp in per spec timeline.
    this._roomGain.gain.value = 0;
    this._fireGain.gain.value = 0;

    this._roomGain.connect(this._master);
    this._fireGain.connect(this._master);

    const [roomBuf, fireBuf] = await Promise.all([
      this._ctx.decodeAudioData(this._buffers.roomArrayBuffer.slice(0)),
      this._ctx.decodeAudioData(this._buffers.fireArrayBuffer.slice(0))
    ]);

    this._roomSrc = this._ctx.createBufferSource();
    this._roomSrc.buffer = roomBuf;
    this._roomSrc.loop = true;
    this._roomSrc.connect(this._roomGain);

    this._fireSrc = this._ctx.createBufferSource();
    this._fireSrc.buffer = fireBuf;
    this._fireSrc.loop = true;
    this._fireSrc.connect(this._fireGain);

    const now = this._ctx.currentTime;
    const startAt = now + this.config.timeline.audioStartAt;
    const fade = this.config.timeline.audioFade;

    // Start sources at the same time for stable phase.
    this._roomSrc.start(startAt);
    this._fireSrc.start(startAt);

    // Crossfade in (spec): room->0.6, fire->0.8 over 0.6s.
    this._roomGain.gain.setValueAtTime(0, startAt);
    this._fireGain.gain.setValueAtTime(0, startAt);

    this._roomGain.gain.linearRampToValueAtTime(this.config.audio.roomTargetGain, startAt + fade);
    this._fireGain.gain.linearRampToValueAtTime(this.config.audio.fireTargetGain, startAt + fade);

    this._started = true;
    this._tick();
  }

  _tick() {
    if (!this._started || !this._ctx) return;

    const t = this._ctx.currentTime;

    // Fire modulation: base*(1 + 0.03*sin(t*(0.9 + randPhase)))
    const base = this.config.audio.fireTargetGain;
    const mod = 1 + this.config.audio.fireModDepth * Math.sin(t * (0.9 + this._firePhase));

    // Small smoothing via setTargetAtTime to avoid zipper noise.
    this._fireGain.gain.setTargetAtTime(base * mod, t, 0.08);

    this._raf = requestAnimationFrame(() => this._tick());
  }

  pause() {
    if (!this._ctx) return;
    this._ctx.suspend();
  }

  resume() {
    if (!this._ctx) return;
    this._ctx.resume();
  }

  async stop() {
    if (!this._ctx) return;

    cancelAnimationFrame(this._raf);

    const now = this._ctx.currentTime;

    // Gentle ramp down for transitions to future screens.
    this._master.gain.cancelScheduledValues(now);
    this._master.gain.setTargetAtTime(0, now, 0.08);

    await new Promise((r) => setTimeout(r, 250));

    try {
      this._roomSrc?.stop();
      this._fireSrc?.stop();
    } catch {
      // ignore
    }

    await this._ctx.close();

    this._ctx = null;
    this._started = false;
  }
}
