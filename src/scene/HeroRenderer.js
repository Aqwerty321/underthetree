// src/scene/HeroRenderer.js
// Three.js fullscreen quad + depth-based parallax shader + postprocessing.
//
// Rendering approach (spec):
// - Single orthographic full-screen quad (plane fills clipspace)
// - Parallax done in fragment shader using depth map (no geometry displacement)
// - EffectComposer chain: Render -> Separable Blur -> UnrealBloomPass -> Tone mapping -> Final composite
// - UI overlays live in HTML/CSS above canvas

import {
  ACESFilmicToneMapping,
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer
} from 'three';

import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { BlurPass } from '../postprocess/BlurPass.js';
import { BloomPass } from '../postprocess/BloomPass.js';

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Cubic-bezier evaluation for exact spec strings.
function makeCubicBezier(p1x, p1y, p2x, p2y) {
  // Adapted from standard CSS cubic-bezier sampling: solve x(t) then return y(t).
  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;

  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;

  const sampleCurveX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleCurveY = (t) => ((ay * t + by) * t + cy) * t;
  const sampleCurveDerivativeX = (t) => (3 * ax * t + 2 * bx) * t + cx;

  const solveCurveX = (x) => {
    // Newton-Raphson first; fallback to binary subdivision.
    let t = x;
    for (let i = 0; i < 8; i++) {
      const x2 = sampleCurveX(t) - x;
      const d2 = sampleCurveDerivativeX(t);
      if (Math.abs(x2) < 1e-6) return t;
      if (Math.abs(d2) < 1e-6) break;
      t = t - x2 / d2;
    }

    let t0 = 0;
    let t1 = 1;
    t = x;
    while (t0 < t1) {
      const x2 = sampleCurveX(t);
      if (Math.abs(x2 - x) < 1e-6) return t;
      if (x > x2) t0 = t;
      else t1 = t;
      t = (t1 - t0) * 0.5 + t0;
    }
    return t;
  };

  return (x) => {
    const t = solveCurveX(clamp(x, 0, 1));
    return sampleCurveY(t);
  };
}

function parseBezierString(str) {
  // Expects 'cubic-bezier(a,b,c,d)'
  const m = /cubic-bezier\(([^)]+)\)/.exec(str);
  if (!m) return (t) => t;
  const [a, b, c, d] = m[1]
    .split(',')
    .map((s) => Number(s.trim()))
    .map((n) => (Number.isFinite(n) ? n : 0));
  return makeCubicBezier(a, b, c, d);
}

const ParallaxMaterial = (config) =>
  new ShaderMaterial({
    transparent: false,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tColor: { value: null },
      tDepth: { value: null },
      tNoise: { value: null },

      uMouse: { value: new Vector2(0, 0) },
      uInputScale: { value: 1 },
      uResolution: { value: new Vector2(1, 1) },
      uTime: { value: 0 },

      uParallaxStrength: { value: config.getParallaxStrengthForDevice() },
      uScreenScale: { value: config.defaults.screenScale },
      uNoiseStrength: { value: config.defaults.noiseStrength },
      uNoiseScale: { value: config.defaults.noiseScale },
      uNoiseSpeed: { value: config.defaults.noiseSpeed },

      uMaxOffsetPx: { value: config.defaults.maxOffsetPx },
      uDepthEdgeBlendRange: { value: config.defaults.depthEdgeBlendRange },

      uChromaShift: { value: config.defaults.chromaticShift },

      uBreathAmp: { value: config.defaults.breathAmplitude },
      uBreathHz: { value: config.defaults.breathHz },
      uSwayAmp: { value: config.defaults.swayAmplitude },
      uSwaySpeed: { value: config.defaults.swaySpeed },

      uWarmup: { value: 0 },
      uOpacity: { value: 0 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      varying vec2 vUv;

      uniform sampler2D tColor;
      uniform sampler2D tDepth;
      uniform sampler2D tNoise;

      uniform vec2 uMouse;
      uniform float uInputScale;
      uniform vec2 uResolution;
      uniform float uTime;

      uniform float uParallaxStrength;
      uniform float uScreenScale;
      uniform float uNoiseStrength;
      uniform float uNoiseScale;
      uniform float uNoiseSpeed;

      uniform float uMaxOffsetPx;
      uniform float uDepthEdgeBlendRange;

      uniform float uChromaShift;

      uniform float uBreathAmp;
      uniform float uBreathHz;
      uniform float uSwayAmp;
      uniform float uSwaySpeed;

      uniform float uWarmup;
      uniform float uOpacity;

      float depthAt(vec2 uv) {
        return texture2D(tDepth, uv).r;
      }

      float noiseAt(vec2 uv) {
        // Animate noise without a steady directional drift:
        // use a slow looping offset so the pattern evolves but doesn't "crawl" across the frame.
        vec2 nOff = vec2(
          sin(uTime * 0.07),
          cos(uTime * 0.05)
        ) * (uNoiseSpeed * 0.75);
        vec2 nUv = uv * uNoiseScale + nOff;
        return texture2D(tNoise, nUv).r;
      }

      vec2 clampUv(vec2 uv) {
        return clamp(uv, vec2(0.0), vec2(1.0));
      }

      void main() {
        // Breath (spec): tiny scale modulation ±0.05% at 0.08 Hz.
        float breath = sin(uTime * 6.2831853 * uBreathHz);
        float scale = 1.0 + uBreathAmp * breath;
        vec2 uv = (vUv - 0.5) / scale + 0.5;

        float depth = depthAt(uv);

        // Sway (spec): low-frequency auto offset.
        vec2 autoOffset = vec2(uSwayAmp * sin(uTime * uSwaySpeed), uSwayAmp * cos(uTime * uSwaySpeed * 0.9));

        // Parallax (spec): foreground moves more (1-depth)
        float parallaxFactor = clamp(uParallaxStrength * (1.0 - depth), 0.0, 1.0);
        vec2 uvOffset = ((uMouse * uInputScale) + autoOffset) * parallaxFactor * uScreenScale;

        // Safety clamp in pixels (spec): maxOffsetPx
        vec2 maxOffsetUv = vec2(uMaxOffsetPx) / uResolution;
        uvOffset = clamp(uvOffset, -maxOffsetUv, maxOffsetUv);

        vec2 uvParallax = uv + uvOffset;

        // Glass refraction (spec)
        float n = noiseAt(uvParallax);
        float refr = (n - 0.5) * uNoiseStrength * (1.0 - depth);
        uvParallax += vec2(refr);

        // Edge blending (spec): reduce silhouette tearing.
        vec2 px = 1.0 / uResolution;
        float dR = depthAt(clampUv(uv + vec2(px.x, 0.0)));
        float dL = depthAt(clampUv(uv - vec2(px.x, 0.0)));
        float dU = depthAt(clampUv(uv + vec2(0.0, px.y)));
        float dD = depthAt(clampUv(uv - vec2(0.0, px.y)));
        float grad = max(abs(dR - dL), abs(dU - dD));
        float edge = smoothstep(0.0, uDepthEdgeBlendRange, grad);

        // Warmup: smoothly fade in the offset amount after entry.
        vec2 uvFinal = mix(uv, uvParallax, uWarmup);
        uvFinal = mix(uvFinal, uv, edge);
        uvFinal = clampUv(uvFinal);

        // Chromatic aberration (spec): subtle, only near foreground.
        float chroma = uChromaShift * (1.0 - depth);
        vec2 chromaOff = vec2(chroma, 0.0);

        vec3 col;
        col.r = texture2D(tColor, clampUv(uvFinal + chromaOff)).r;
        col.g = texture2D(tColor, uvFinal).g;
        col.b = texture2D(tColor, clampUv(uvFinal - chromaOff)).b;

        gl_FragColor = vec4(col * uOpacity, 1.0);
      }
    `
  });

const FinalCompositeShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    tNoise: { value: null },
    uTime: { value: 0 },
    uNoiseScale: { value: 1.8 },
    uNoiseSpeed: { value: 0.02 },
    uVignetteStrength: { value: 0.1 },
    uVignetteExponent: { value: 2.2 },
    uOverlayBase: { value: 0.02 },
    uOverlayNoise: { value: 0.015 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;

    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform sampler2D tNoise;

    uniform float uTime;
    uniform float uNoiseScale;
    uniform float uNoiseSpeed;

    uniform float uVignetteStrength;
    uniform float uVignetteExponent;

    uniform float uOverlayBase;
    uniform float uOverlayNoise;

    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;

      float depth = texture2D(tDepth, vUv).r;
      vec2 nOff = vec2(
        sin(uTime * 0.07),
        cos(uTime * 0.05)
      ) * (uNoiseSpeed * 0.75);
      vec2 nUv = vUv * uNoiseScale + nOff;
      float n = texture2D(tNoise, nUv).r;

      // Vignette (spec): outer darkening ~0.1
      vec2 p = vUv - 0.5;
      float r = length(p) * 1.2;
      float vig = pow(clamp(r, 0.0, 1.0), uVignetteExponent);
      col *= 1.0 - uVignetteStrength * vig;

      // Glass overlay luminance (spec): 0.02 + noise * 0.015
      float overlay = uOverlayBase + n * uOverlayNoise;
      // Slightly stronger in foreground where refraction is visible.
      overlay *= (0.5 + 0.5 * (1.0 - depth));

      col += (n - 0.5) * overlay;

      gl_FragColor = vec4(col, 1.0);
    }
  `
};

export class HeroRenderer {
  static canUseWebGL() {
    try {
      const c = document.createElement('canvas');
      return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      return false;
    }
  }

  constructor({ parent, config, runtime, assets }) {
    this.parent = parent;
    this.config = config;
    this.runtime = runtime;
    this.assets = assets;

    this._running = false;
    this._paused = false;
    this._raf = null;

    this._interactionFocus = false;
    this._focusAnim = {
      value: 0,
      from: 0,
      to: 0,
      t0: 0,
      dur: 0.001,
      ease: (x) => x
    };

    this._mouseTarget = new Vector2(0, 0);
    this._mouseCurrent = new Vector2(0, 0);

    this._inputEnabled = true;
    this._inputScaleAnim = null;

    this._startPerfMs = 0;
    this._lastPerfMs = 0;

    this._eHeroFade = parseBezierString(config.easing.easeOutQuad);
    this._eBlurRamp = parseBezierString(config.easing.blurRamp);
    this._eWarmup = parseBezierString(config.easing.easeOutExpo);
    this._eFocusIn = parseBezierString(config.easing.easeOutCubic);
    this._eFocusOut = parseBezierString(config.easing.easeOutExpo);

    this._initThree();
    this._initPost();
    this._wireInput();

    // Render once so the GPU pipeline warms up behind the CSS fallback.
    this._renderFrame(0, 0);
  }

  _initThree() {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.config.post.toneMapping.exposure;

    this.canvas = this.renderer.domElement;
    this.canvas.style.position = 'absolute';
    this.canvas.style.inset = '0';

    this.parent.appendChild(this.canvas);

    this.scene = new Scene();
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.material = ParallaxMaterial(this.config);
    this.material.uniforms.tColor.value = this.assets.textures.color;
    this.material.uniforms.tDepth.value = this.assets.textures.depth;
    this.material.uniforms.tNoise.value = this.assets.textures.noise;

    // Texture settings (spec)
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();

    const tColor = this.assets.textures.color;
    tColor.colorSpace = SRGBColorSpace;
    tColor.wrapS = tColor.wrapT = ClampToEdgeWrapping;
    tColor.generateMipmaps = true;
    tColor.minFilter = LinearMipmapLinearFilter;
    tColor.magFilter = LinearFilter;
    tColor.anisotropy = maxAniso;

    const tDepth = this.assets.textures.depth;
    tDepth.colorSpace = NoColorSpace;
    tDepth.wrapS = tDepth.wrapT = ClampToEdgeWrapping;
    tDepth.generateMipmaps = false;
    tDepth.minFilter = LinearFilter;
    tDepth.magFilter = LinearFilter;

    const tNoise = this.assets.textures.noise;
    tNoise.colorSpace = NoColorSpace;
    // Glass noise must tile (spec): avoid stretching/banding artifacts at edges.
    tNoise.wrapS = tNoise.wrapT = RepeatWrapping;
    tNoise.generateMipmaps = true;
    tNoise.minFilter = LinearMipmapLinearFilter;
    tNoise.magFilter = LinearFilter;

    this.material.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);

    const geo = new PlaneGeometry(2, 2);
    this.mesh = new Mesh(geo, this.material);
    this.scene.add(this.mesh);
  }

  _initPost() {
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.blur = new BlurPass({
      depthTexture: this.assets.textures.depth,
      noiseTexture: this.assets.textures.noise,
      config: this.config
    });
    this.blur.install(this.composer);

    this.bloom = new BloomPass({
      config: this.config,
      size: { w: window.innerWidth, h: window.innerHeight }
    });
    this.bloom.install(this.composer);

    this.finalPass = new ShaderPass(FinalCompositeShader);
    this.finalPass.material.uniforms.tDepth.value = this.assets.textures.depth;
    this.finalPass.material.uniforms.tNoise.value = this.assets.textures.noise;
    this.composer.addPass(this.finalPass);

    // Ensures correct output transform (tone mapping + sRGB encoding) when using EffectComposer.
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this._resize();
    this.syncFromConfig();
  }

  _wireInput() {
    const onMouseMove = (e) => {
      if (!this._inputEnabled) return;
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      // Spec normalization (y inverted so up = positive)
      this._mouseTarget.set((x - 0.5) * 2.0, (y - 0.5) * -2.0);
    };

    const onTouchMove = (e) => {
      if (!this._inputEnabled) return;
      const t = e.touches?.[0];
      if (!t) return;
      const x = t.clientX / window.innerWidth;
      const y = t.clientY / window.innerHeight;
      this._mouseTarget.set((x - 0.5) * 2.0, (y - 0.5) * -2.0);
    };

    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });

    // DeviceOrientation is permission-gated on some platforms (notably iOS).
    // We request permission on start() (user gesture) and only then attach listeners.
    this._onDeviceOrientation = (e) => {
      if (!this._inputEnabled) return;
      // gamma: left/right tilt [-90..90], beta: front/back [-180..180]
      const gamma = (e.gamma ?? 0) / 45; // normalize-ish
      const beta = (e.beta ?? 0) / 45;
      // Map to our mouse space [-1,1]. Keep conservative to avoid nausea.
      this._mouseTarget.set(clamp(gamma, -1, 1) * 0.35, clamp(-beta, -1, 1) * 0.35);
    };

    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
  }

  async _enableDeviceOrientationIfAvailable() {
    const isLikelyMobile = window.matchMedia('(pointer: coarse)').matches;
    if (!isLikelyMobile) return;

    // Respect reduced motion: no motion sensors.
    if (this.runtime.prefersReducedMotion) return;

    if (typeof window.DeviceOrientationEvent === 'undefined') return;

    // iOS 13+ requires explicit permission.
    // eslint-disable-next-line no-undef
    const req = window.DeviceOrientationEvent.requestPermission;
    if (typeof req === 'function') {
      try {
        const res = await req.call(window.DeviceOrientationEvent);
        if (res !== 'granted') return;
      } catch {
        return;
      }
    }

    window.addEventListener('deviceorientation', this._onDeviceOrientation, { passive: true });
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.blur.setSize(w, h);
    this.bloom.setSize(w, h);

    this.material.uniforms.uResolution.value.set(w, h);
  }

  syncFromConfig() {
    // Update uniforms / toggles based on config.
    this.material.uniforms.uParallaxStrength.value = this.config.getParallaxStrengthForDevice();
    this.material.uniforms.uScreenScale.value = this.config.defaults.screenScale;
    this.material.uniforms.uNoiseStrength.value = this.config.defaults.noiseStrength;
    this.material.uniforms.uNoiseScale.value = this.config.defaults.noiseScale;
    this.material.uniforms.uNoiseSpeed.value = this.config.defaults.noiseSpeed;
    this.material.uniforms.uMaxOffsetPx.value = this.config.defaults.maxOffsetPx;
    this.material.uniforms.uDepthEdgeBlendRange.value = this.config.defaults.depthEdgeBlendRange;
    this.material.uniforms.uChromaShift.value = this.config.defaults.chromaticShift;
    this.material.uniforms.uInputScale.value = this.material.uniforms.uInputScale.value ?? 1;

    this.renderer.toneMappingExposure = this.config.post.toneMapping.exposure;

    const postEnabled = Boolean(this.config.flags.postProcessing);
    this.blur.setEnabled(postEnabled);
    this.bloom.setEnabled(postEnabled);
    this.finalPass.enabled = postEnabled;
    this.outputPass.enabled = postEnabled;
    this.bloom.syncFromConfig();

    this.finalPass.material.uniforms.uVignetteStrength.value = this.config.post.vignette.strength;
    this.finalPass.material.uniforms.uVignetteExponent.value = this.config.post.vignette.exponent;
    this.finalPass.material.uniforms.uOverlayBase.value = this.config.post.glassOverlay.baseOpacity;
    this.finalPass.material.uniforms.uOverlayNoise.value = this.config.post.glassOverlay.noiseOpacity;
  }

  setInteractionFocus(isFocused) {
    this._interactionFocus = Boolean(isFocused);

    const now = performance.now();
    const current = this._focusAnim.value;

    if (this._interactionFocus) {
      this._focusAnim = {
        value: current,
        from: current,
        to: 1,
        t0: now,
        dur: 250,
        ease: this._eFocusIn
      };
    } else {
      this._focusAnim = {
        value: current,
        from: current,
        to: 0,
        t0: now,
        dur: 600,
        ease: this._eFocusOut
      };
    }
  }

  setInputEnabled(enabled) {
    this._inputEnabled = Boolean(enabled);
  }

  beginParallaxStop(durationSec = 0.2) {
    const durMs = Math.max(0, durationSec) * 1000;
    const start = performance.now();
    const from = this.material.uniforms.uInputScale.value;
    const to = 0;
    const easeOutCubic = this._eFocusIn; // same curve shape

    this._inputScaleAnim = () => {
      const t = durMs <= 0 ? 1 : clamp((performance.now() - start) / durMs, 0, 1);
      const e = easeOutCubic(t);
      this.material.uniforms.uInputScale.value = lerp(from, to, e);
      if (t >= 1) this._inputScaleAnim = null;
    };
  }

  cancelParallaxStop() {
    this._inputScaleAnim = null;
    this.material.uniforms.uInputScale.value = 1;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._paused = false;
    this._startPerfMs = performance.now();
    this._lastPerfMs = this._startPerfMs;

    // Request motion-sensor permission on the explicit Start gesture.
    this._enableDeviceOrientationIfAvailable();

    this._tick();
  }

  pause() {
    this._paused = true;
  }

  resume() {
    if (!this._running) return;
    this._paused = false;
    this._lastPerfMs = performance.now();
  }

  stop() {
    this._running = false;
    cancelAnimationFrame(this._raf);
    this.canvas?.remove();
    this.renderer?.dispose();
  }

  _tick() {
    if (!this._running) return;
    this._raf = requestAnimationFrame(() => this._tick());
    if (this._paused) return;

    const now = performance.now();
    const dtMs = Math.min(50, now - this._lastPerfMs);
    const dt = dtMs / 1000;
    this._lastPerfMs = now;

    const t = (now - this._startPerfMs) / 1000;

    // Mouse smoothing (spec)
    const damping = this.config.input?.mouseDamping ?? 0.94;
    const alpha = 1 - Math.pow(damping, dt * 60);
    this._mouseCurrent.lerp(this._mouseTarget, alpha);

    // Focus tween
    {
      const a = this._focusAnim;
      const u = clamp((now - a.t0) / a.dur, 0, 1);
      a.value = lerp(a.from, a.to, a.ease(u));
      this._focusAnim.value = a.value;
    }

    // Parallax stop tween (used during cinematic transitions)
    this._inputScaleAnim?.();

    this._renderFrame(t, dt);
  }

  _renderFrame(t, dt) {
    // Reduced motion: disable parallax + automated motion.
    const reduced = Boolean(this.runtime.prefersReducedMotion);

    // Entry timeline (spec)
    const fadeT = clamp((t - this.config.timeline.heroFade.start) / (this.config.timeline.heroFade.end - this.config.timeline.heroFade.start), 0, 1);
    const heroOpacity = this._eHeroFade(fadeT);

    const warmT = clamp((t - this.config.timeline.parallaxWarmup.start) / (this.config.timeline.parallaxWarmup.end - this.config.timeline.parallaxWarmup.start), 0, 1);
    const warmup = this._eWarmup(warmT);

    const blurT = clamp((t - this.config.timeline.blurRamp.start) / (this.config.timeline.blurRamp.end - this.config.timeline.blurRamp.start), 0, 1);
    const blurLerp = this._eBlurRamp(blurT);

    const h = window.innerHeight;
    const loadingBlurPx = this.config.post.blur.loadingRadiusPct * h;
    const baseBlurPx = this.config.post.blur.baseRadiusPct * h;
    const baseBlurNow = lerp(loadingBlurPx, baseBlurPx, blurLerp);

    // Interaction focus (spec): +40% parallax strength, -20% blur.
    const focus = this._focusAnim.value;
    const parallaxBoost = lerp(1.0, 1.4, focus);
    const blurBoost = lerp(1.0, 0.8, focus);

    const time = t;

    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uOpacity.value = heroOpacity;
    this.material.uniforms.uWarmup.value = reduced ? 0 : warmup;

    // Mouse input off if reduced motion.
    if (reduced) {
      this.material.uniforms.uMouse.value.set(0, 0);
      this.material.uniforms.uBreathAmp.value = 0;
      this.material.uniforms.uSwayAmp.value = 0;
    } else {
      this.material.uniforms.uMouse.value.copy(this._mouseCurrent);
      this.material.uniforms.uBreathAmp.value = this.config.defaults.breathAmplitude;
      this.material.uniforms.uSwayAmp.value = this.config.defaults.swayAmplitude;
    }

    this.material.uniforms.uParallaxStrength.value = this.config.getParallaxStrengthForDevice() * parallaxBoost;

    const postEnabled = Boolean(this.config.flags.postProcessing);
    if (postEnabled) {
      const noiseBlurAmountPx = this.config.post.blur.noiseBlurAmountPct * h;
      this.blur.update({
        time,
        baseBlurPx: baseBlurNow * blurBoost,
        noiseBlurAmountPx
      });

      this.finalPass.material.uniforms.uTime.value = time;
      this.finalPass.material.uniforms.uNoiseScale.value = this.config.defaults.noiseScale;
      this.finalPass.material.uniforms.uNoiseSpeed.value = this.config.defaults.noiseSpeed;

      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}
