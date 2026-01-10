// src/postprocess/BloomPass.js
// Thin wrapper around UnrealBloomPass with spec-default parameters.

import { Vector2 } from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export class BloomPass {
  constructor({ config, size }) {
    this.config = config;
    this.pass = new UnrealBloomPass(new Vector2(size.w, size.h), 1.0, 0.4, 0.85);
    this.syncFromConfig();
  }

  install(composer) {
    composer.addPass(this.pass);
  }

  setSize(w, h) {
    this.pass.setSize(w, h);
  }

  setEnabled(enabled) {
    this.pass.enabled = Boolean(enabled);
  }

  syncFromConfig() {
    this.pass.strength = this.config.post.bloom.strength;
    this.pass.radius = this.config.post.bloom.radius;
    this.pass.threshold = this.config.post.bloom.threshold;
  }
}
