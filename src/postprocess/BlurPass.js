// src/postprocess/BlurPass.js
// Separable Gaussian blur (horizontal -> vertical) with per-pixel radius modulation.
// Spec requirements:
// - Two-pass separable Gaussian blur
// - Base radius: 0.6% of screen height
// - Loading radius: 1.8% of screen height
// - Modulate with glass noise: blurRadius = baseBlur + noise * blurAmount * (1 - depth)
// - Blur must happen AFTER parallax sampling (i.e., after scene render)

import { Vector2 } from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const BlurShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    tNoise: { value: null },

    uResolution: { value: new Vector2(1, 1) },
    uDirection: { value: new Vector2(1, 0) },

    uBaseBlurPx: { value: 0 },
    uNoiseBlurAmountPx: { value: 0 },

    uNoiseScale: { value: 1.8 },
    uNoiseSpeed: { value: 0.02 },
    uTime: { value: 0 }
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

    uniform vec2 uResolution;
    uniform vec2 uDirection;

    uniform float uBaseBlurPx;
    uniform float uNoiseBlurAmountPx;

    uniform float uNoiseScale;
    uniform float uNoiseSpeed;
    uniform float uTime;

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

    void main() {
      float depth = depthAt(vUv);
      float n = noiseAt(vUv);

      // Spec: blurRadius = baseBlur + noise * blurAmount * (1 - depth)
      float radiusPx = uBaseBlurPx + n * uNoiseBlurAmountPx * (1.0 - depth);

      // Convert to UV step. Divide by 4 so our 9-tap kernel spans roughly radiusPx.
      vec2 stepUv = (uDirection / uResolution) * (radiusPx / 4.0);

      // 9-tap symmetric weights (sum ~ 1). Conservative blur.
      vec4 c = vec4(0.0);
      c += texture2D(tDiffuse, vUv + stepUv * -4.0) * 0.05;
      c += texture2D(tDiffuse, vUv + stepUv * -3.0) * 0.09;
      c += texture2D(tDiffuse, vUv + stepUv * -2.0) * 0.12;
      c += texture2D(tDiffuse, vUv + stepUv * -1.0) * 0.15;
      c += texture2D(tDiffuse, vUv) * 0.18;
      c += texture2D(tDiffuse, vUv + stepUv * 1.0) * 0.15;
      c += texture2D(tDiffuse, vUv + stepUv * 2.0) * 0.12;
      c += texture2D(tDiffuse, vUv + stepUv * 3.0) * 0.09;
      c += texture2D(tDiffuse, vUv + stepUv * 4.0) * 0.05;

      gl_FragColor = c;
    }
  `
};

export class BlurPass {
  constructor({ depthTexture, noiseTexture, config }) {
    this.config = config;

    this.passH = new ShaderPass(BlurShader);
    this.passV = new ShaderPass(BlurShader);

    this.passH.material.uniforms.tDepth.value = depthTexture;
    this.passH.material.uniforms.tNoise.value = noiseTexture;
    this.passH.material.uniforms.uDirection.value.set(1, 0);

    this.passV.material.uniforms.tDepth.value = depthTexture;
    this.passV.material.uniforms.tNoise.value = noiseTexture;
    this.passV.material.uniforms.uDirection.value.set(0, 1);

    this.enabled = true;
  }

  install(composer) {
    composer.addPass(this.passH);
    composer.addPass(this.passV);
  }

  setSize(w, h) {
    this.passH.material.uniforms.uResolution.value.set(w, h);
    this.passV.material.uniforms.uResolution.value.set(w, h);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.passH.enabled = this.enabled;
    this.passV.enabled = this.enabled;
  }

  update({ time, baseBlurPx, noiseBlurAmountPx }) {
    this.passH.material.uniforms.uTime.value = time;
    this.passV.material.uniforms.uTime.value = time;

    this.passH.material.uniforms.uBaseBlurPx.value = baseBlurPx;
    this.passV.material.uniforms.uBaseBlurPx.value = baseBlurPx;

    this.passH.material.uniforms.uNoiseBlurAmountPx.value = noiseBlurAmountPx;
    this.passV.material.uniforms.uNoiseBlurAmountPx.value = noiseBlurAmountPx;

    this.passH.material.uniforms.uNoiseScale.value = this.config.defaults.noiseScale;
    this.passV.material.uniforms.uNoiseScale.value = this.config.defaults.noiseScale;

    this.passH.material.uniforms.uNoiseSpeed.value = this.config.defaults.noiseSpeed;
    this.passV.material.uniforms.uNoiseSpeed.value = this.config.defaults.noiseSpeed;
  }
}
