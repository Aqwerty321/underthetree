// src/three/GiftParallaxRenderer.js
// Fullscreen quad depth-parallax renderer for the gift scene.

import {
  ACESFilmicToneMapping,
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoColorSpace,
  NormalBlending,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  VideoTexture,
  WebGLRenderer
} from 'three';

import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { BlurPass } from '../postprocess/BlurPass.js';
import { BloomPass } from '../postprocess/BloomPass.js';

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
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

      uBreathAmp: { value: config.defaults.breathAmplitude },
      uBreathHz: { value: config.defaults.breathHz },
      uSwayAmp: { value: config.defaults.swayAmplitude },
      uSwaySpeed: { value: config.defaults.swaySpeed },

      uWarmup: { value: 1 },
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
        float breath = sin(uTime * 6.2831853 * uBreathHz);
        float scale = 1.0 + uBreathAmp * breath;
        vec2 uv = (vUv - 0.5) / scale + 0.5;

        float depth = depthAt(uv);

        vec2 autoOffset = vec2(
          uSwayAmp * sin(uTime * uSwaySpeed),
          uSwayAmp * cos(uTime * uSwaySpeed * 0.9)
        );

        float parallaxFactor = clamp(uParallaxStrength * (1.0 - depth), 0.0, 1.0);
        vec2 uvOffset = ((uMouse * uInputScale) + autoOffset) * parallaxFactor * uScreenScale;

        vec2 maxOffsetUv = vec2(uMaxOffsetPx) / uResolution;
        uvOffset = clamp(uvOffset, -maxOffsetUv, maxOffsetUv);

        vec2 uvParallax = uv + uvOffset;

        float n = noiseAt(uvParallax);
        float refr = (n - 0.5) * uNoiseStrength * (1.0 - depth);
        uvParallax += vec2(refr);

        vec2 px = 1.0 / uResolution;
        float dR = depthAt(clampUv(uv + vec2(px.x, 0.0)));
        float dL = depthAt(clampUv(uv - vec2(px.x, 0.0)));
        float dU = depthAt(clampUv(uv + vec2(0.0, px.y)));
        float dD = depthAt(clampUv(uv - vec2(0.0, px.y)));
        float grad = max(abs(dR - dL), abs(dU - dD));
        float edge = smoothstep(0.0, uDepthEdgeBlendRange, grad);

        vec2 uvFinal = mix(uv, uvParallax, uWarmup);
        uvFinal = mix(uvFinal, uv, edge);
        uvFinal = clampUv(uvFinal);

        vec3 col = texture2D(tColor, uvFinal).rgb;
        gl_FragColor = vec4(col * uOpacity, 1.0);
      }
    `
  });

export class GiftParallaxRenderer {
  constructor({ parent, config, runtime, textures, enablePost = true }) {
    this.parent = parent;
    this.config = config;
    this.runtime = runtime;
    this.textures = textures;
    this.enablePost = Boolean(enablePost);

    this._running = false;
    this._paused = false;
    this._raf = null;

    this._inputEnabled = true;
    this._mouseTarget = new Vector2(0, 0);
    this._mouseCurrent = new Vector2(0, 0);

    this._opacity = 0;
    this._blurBasePx = 0;

    this._videoLayers = {
      confetti: null,
      gift: null
    };

    this._initThree();
    this._initPost();
    this._wireInput();

    this._renderFrame(0, 0);
  }

  canUseWebGL() {
    return Boolean(this.renderer);
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
    this.material.uniforms.tColor.value = this.textures.color;
    this.material.uniforms.tDepth.value = this.textures.depth;
    this.material.uniforms.tNoise.value = this.textures.noise;

    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();

    const tColor = this.textures.color;
    tColor.colorSpace = SRGBColorSpace;
    tColor.wrapS = tColor.wrapT = ClampToEdgeWrapping;
    tColor.generateMipmaps = true;
    tColor.minFilter = LinearMipmapLinearFilter;
    tColor.magFilter = LinearFilter;
    tColor.anisotropy = maxAniso;

    const tDepth = this.textures.depth;
    tDepth.colorSpace = NoColorSpace;
    tDepth.wrapS = tDepth.wrapT = ClampToEdgeWrapping;
    tDepth.generateMipmaps = false;
    tDepth.minFilter = LinearFilter;
    tDepth.magFilter = LinearFilter;

    const tNoise = this.textures.noise;
    tNoise.colorSpace = NoColorSpace;
    tNoise.wrapS = tNoise.wrapT = RepeatWrapping;
    tNoise.generateMipmaps = true;
    tNoise.minFilter = LinearMipmapLinearFilter;
    tNoise.magFilter = LinearFilter;

    this.material.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);

    const geo = new PlaneGeometry(2, 2);
    this.mesh = new Mesh(geo, this.material);
    this.mesh.renderOrder = 0;
    this.scene.add(this.mesh);
  }

  _initPost() {
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.blur = new BlurPass({
      depthTexture: this.textures.depth,
      noiseTexture: this.textures.noise,
      config: this.config
    });
    this.blur.install(this.composer);

    this.bloom = new BloomPass({
      config: this.config,
      size: { w: window.innerWidth, h: window.innerHeight }
    });
    this.bloom.install(this.composer);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this._resize();
    this.syncFromConfig();
  }

  syncFromConfig() {
    this.material.uniforms.uParallaxStrength.value = this.config.getParallaxStrengthForDevice();
    this.material.uniforms.uScreenScale.value = this.config.defaults.screenScale;
    this.material.uniforms.uNoiseStrength.value = this.config.defaults.noiseStrength;
    this.material.uniforms.uNoiseScale.value = this.config.defaults.noiseScale;
    this.material.uniforms.uNoiseSpeed.value = this.config.defaults.noiseSpeed;
    this.material.uniforms.uMaxOffsetPx.value = this.config.defaults.maxOffsetPx;
    this.material.uniforms.uDepthEdgeBlendRange.value = this.config.defaults.depthEdgeBlendRange;

    this.renderer.toneMappingExposure = this.config.post.toneMapping.exposure;

    const pp = Boolean(this.config.flags?.postProcessing) && this.enablePost;
    this.blur.setEnabled(pp);
    this.bloom.setEnabled(pp);
    this.bloom.syncFromConfig();
  }

  setInputEnabled(enabled) {
    this._inputEnabled = Boolean(enabled);
    this.material.uniforms.uInputScale.value = this._inputEnabled ? 1 : 0;
  }

  setOpacity(opacity) {
    this._opacity = clamp(opacity, 0, 1);
  }

  setBlurRadiusPct(radiusPct) {
    const h = window.innerHeight;
    this._blurBasePx = Math.max(0, radiusPct) * h;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._paused = false;
    this._startPerfMs = performance.now();
    this._lastPerfMs = this._startPerfMs;
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

  _wireInput() {
    const onMouseMove = (e) => {
      if (!this._inputEnabled) return;
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
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

    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
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

  _tick() {
    if (!this._running) return;
    this._raf = requestAnimationFrame(() => this._tick());
    if (this._paused) return;

    const now = performance.now();
    const dtMs = Math.min(50, now - this._lastPerfMs);
    const dt = dtMs / 1000;
    this._lastPerfMs = now;

    const t = (now - this._startPerfMs) / 1000;

    const damping = this.config.input?.mouseDamping ?? 0.94;
    const alpha = 1 - Math.pow(damping, dt * 60);
    this._mouseCurrent.lerp(this._mouseTarget, alpha);

    this._renderFrame(t, dt);
  }

  _renderFrame(t, dt) {
    const reduced = Boolean(this.runtime.prefersReducedMotion);

    this.material.uniforms.uTime.value = t;
    this.material.uniforms.uOpacity.value = this._opacity;

    if (reduced) {
      this.material.uniforms.uMouse.value.set(0, 0);
      this.material.uniforms.uBreathAmp.value = 0;
      this.material.uniforms.uSwayAmp.value = 0;
    } else {
      this.material.uniforms.uMouse.value.copy(this._mouseCurrent);
      this.material.uniforms.uBreathAmp.value = this.config.defaults.breathAmplitude;
      this.material.uniforms.uSwayAmp.value = this.config.defaults.swayAmplitude;
    }

    // Blur radius (in px) and noise modulation.
    const noiseBlurAmountPx = this.config.post.blur.noiseBlurAmountPct * window.innerHeight;
    this.blur.update({
      time: t,
      baseBlurPx: this._blurBasePx,
      noiseBlurAmountPx
    });

    if (this.enablePost && this.config.flags?.postProcessing) {
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  // --- Video overlay layers (alpha WebM via Three.js VideoTexture) ---
  setConfettiVideo(videoEl) {
    this._setVideoLayer('confetti', videoEl, 1);
  }

  setGiftOpenVideo(videoEl) {
    this._setVideoLayer('gift', videoEl, 2);
  }

  clearVideoLayers() {
    this._clearVideoLayer('confetti');
    this._clearVideoLayer('gift');
  }

  _setVideoLayer(key, videoEl, renderOrder) {
    this._clearVideoLayer(key);
    if (!videoEl) return;

    const tex = new VideoTexture(videoEl);
    tex.colorSpace = SRGBColorSpace;
    tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
    // VP9 alpha frames are commonly premultiplied.
    tex.premultiplyAlpha = true;

    const mat = new ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: NormalBlending,
      uniforms: {
        tVideo: { value: tex },
        uOpacity: { value: 1 }
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
        uniform sampler2D tVideo;
        uniform float uOpacity;
        void main() {
          vec4 c = texture2D(tVideo, vUv);
          // Treat as premultiplied alpha.
          c.a *= uOpacity;
          c.rgb *= uOpacity;
          gl_FragColor = c;
        }
      `
    });

    const geo = new PlaneGeometry(2, 2);
    const mesh = new Mesh(geo, mat);
    mesh.renderOrder = renderOrder;
    this.scene.add(mesh);

    this._videoLayers[key] = { tex, mat, mesh };
  }

  setVideoOpacity(key, opacity) {
    const layer = this._videoLayers[key];
    if (!layer) return;
    layer.mat.uniforms.uOpacity.value = clamp(opacity, 0, 1);
  }

  _clearVideoLayer(key) {
    const layer = this._videoLayers[key];
    if (!layer) return;
    try {
      this.scene.remove(layer.mesh);
      layer.mesh.geometry.dispose();
      layer.mat.dispose();
      layer.tex.dispose();
    } catch {
      // ignore
    }
    this._videoLayers[key] = null;
  }
}
