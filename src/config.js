// src/config.js
// Single configuration object: all tuning parameters live here.
// Debug UI mutates this object at runtime via applyDebugPatch().

export const config = {
  // Assets (EXACT paths; do not invent new ones)
  assets: {
    audio: {
      fire: '/assets/audio/fire_cackle_loop.mp3',
      room: '/assets/audio/room_ambience_loop.mp3',
      click: '/assets/audio/click.mp3',
      fanfare: '/assets/audio/fanfare.mp3',
      giftLidOff: '/assets/audio/gift_lid_off.mp3'
    },
    hero: {
      color2k: '/assets/visuals/hero/color/hero_bg_2k.webp',
      color4k: '/assets/visuals/hero/color/hero_bg_4k.webp',
      depth2k: '/assets/visuals/hero/depth/hero_depth_2k_16bit.png',
      depth4k: '/assets/visuals/hero/depth/hero_depth_4k_16bit.png'
    },
    ui: {
      glassNoise: '/assets/visuals/ui/glass_noise.jpg',
      effects: {
        confettiBurst: '/assets/ui/effects/confetti_burst.webm'
      }
    },

    giftScene: {
      color2k: '/assets/visuals/gifts_scene/color/gifts_bg_2k.png',
      color4k: '/assets/visuals/gifts_scene/color/gifts_bg_4k.png',
      depth2k: '/assets/visuals/gifts_scene/depth/gifts_depth_2k_16bit.png',
      depth4k: '/assets/visuals/gifts_scene/depth/gifts_depth_4k_16bit.png'
    },

    giftOverlay: {
      giftClosed: '/assets/visuals/gifts_scene/gift_overlay/gift_closed.png',
      giftOpenStatic: '/assets/visuals/gifts_scene/gift_overlay/gift_open_static.png'
    }
  },

  // Storage keys
  storageKeys: {
    muted: 'utt_muted',
    reducedMotion: 'utt_reduced_motion'
  },

  // UX copy / CTA
  ui: {
    title: 'Under the Tree',
    subtitle:
      'A quiet landing scene. Click Start to enable motion and audio (required by browser autoplay rules).',
    startLabel: 'Start',
    muteLabel: 'Sound off',
    reducedMotionLabel: 'Reduced motion'
  },

  // Spec-defined easing curves (strings used for CSS transitions)
  easing: {
    easeOutQuad: 'cubic-bezier(.25,.46,.45,.94)',
    easeOutCubic: 'cubic-bezier(.215,.61,.355,1)',
    easeOutExpo: 'cubic-bezier(.19,1,.22,1)',
    easeInOutSine: 'cubic-bezier(.445,.05,.55,.95)',

    // Specific blur ease requested for 0.10–0.75s ramp
    blurRamp: 'cubic-bezier(0.22, 1.0, 0.36, 1.0)'
  },

  // Spec timing plan (seconds)
  timeline: {
    heroFade: { start: 0.0, end: 0.6 },
    blurRamp: { start: 0.1, end: 0.75 },
    // Slightly longer warmup feels smoother and less "snappy".
    parallaxWarmup: { start: 0.35, end: 1.8 },
    audioStartAt: 0.4,
    audioFade: 0.6
  },

  // Feature toggles (debug can override)
  flags: {
    postProcessing: true,
    use4k: null, // null = auto (decision logic), boolean = force
    simulateLowPower: false,
    simulateSlowNet: false
  },

  // Cinematic
  cinematic: {
    url: '/assets/video/cinematic_tree_revolve.mp4'
  },

  // Gift open video (transparent)
  giftOpen: {
    url: '/assets/visuals/gifts_scene/gift_overlay/gift_open.webm'
  },

  // Flow constants (seconds)
  flow: {
    GIFT_OPEN_CONFETTI_OFFSET: 1.75,
    GIFT_OPEN_FADE_OUT: 0.6,
    CINEMATIC_FADE_IN: 0.6,
    CINEMATIC_FADE_OUT: 0.5,
    GIFT_SCENE_CROSSFADE: 0.6,
    GIFT_UI_DELAY_AFTER_SCENE: 0.2,
    GIFT_UI_FADE_IN: 0.45
  },

  // Rendering defaults (spec)
  defaults: {
    parallaxStrength_desktop: 0.24,
    parallaxStrength_tablet: 0.15,
    parallaxStrength_mobile: 0.06,

    screenScale: 0.04,
    // Increased so stronger parallax can actually move further.
    maxOffsetPx: 160,
    depthEdgeBlendRange: 0.02,

    noiseStrength: 0.003,
    // 2x tiling (less noticeable pattern scale)
    noiseScale: 3.6,
    noiseSpeed: 0.02,

    chromaticShift: 0.002,

    swayAmplitude: 0.006,
    swaySpeed: 0.2,

    breathAmplitude: 0.0005, // ±0.05%
    breathHz: 0.08
  },

  // Input tuning
  input: {
    // Mouse smoothing (higher = slower/smoother).
    // alpha = 1 - pow(damping, dt*60)
    // A value around 0.92 yields ~0.08 per-frame alpha at 60fps.
    mouseDamping: 0.94
  },

  // Postprocessing parameters (spec)
  post: {
    blur: {
      // Radius is defined as percentage of screen height.
      baseRadiusPct: 0.006, // 0.6%
      loadingRadiusPct: 0.018, // 1.8%
      // Additional blur modulation driven by noise*(1-depth)
      // Kept intentionally small; the per-pixel blur is subtle.
      noiseBlurAmountPct: 0.004
    },
    bloom: {
      strength: 0.6,
      radius: 0.85,
      threshold: 0.85
    },
    vignette: {
      strength: 0.1,
      exponent: 2.2
    },
    toneMapping: {
      // We apply ACES via renderer.toneMapping (Three.js) and keep this for exposure tuning.
      exposure: 1.12
    },
    glassOverlay: {
      // Slightly more transparent.
      baseOpacity: 0.012,
      noiseOpacity: 0.009
    }
  },

  // Audio defaults (spec)
  audio: {
    masterGain: 0.9,
    roomTargetGain: 0.6,
    fireTargetGain: 0.8,
    fireModDepth: 0.03,

    // SFX (HTMLAudio). Separate from the WebAudio soundscape gains.
    sfx: {
      clickGain: 0.75,
      fanfareGain: 1.0,
      giftLidOffGain: 1.0
    }
  },

  // Accessibility
  accessibility: {
    defaultAudioOffOnReducedMotion: true
  },

  // Hook for future screens: entry.js calls this on successful Start.
  onEnter: null,

  // --- Derived decisions / helpers ---
  shouldUse4k() {
    if (this.flags.use4k === true) return true;
    if (this.flags.use4k === false) return false;

    // Decision logic (spec):
    // If devicePixelRatio >= 2 AND innerWidth >= 1440 -> 4k, else 2k.
    return window.devicePixelRatio >= 2 && window.innerWidth >= 1440;
  },

  // Device/perf heuristic (spec): if WebGL unavailable OR memory/core low -> fallback.
  detectLowPower() {
    if (this.flags.simulateLowPower) return true;

    const deviceMemory = navigator.deviceMemory ?? null;
    const cores = navigator.hardwareConcurrency ?? null;

    if (deviceMemory != null && deviceMemory <= 2) return true;
    if (cores != null && cores <= 2) return true;

    return false;
  },

  // Convenience: choose parallax strength based on viewport.
  getParallaxStrengthForDevice() {
    const w = window.innerWidth;
    if (w <= 720) return this.defaults.parallaxStrength_mobile;
    if (w <= 1024) return this.defaults.parallaxStrength_tablet;
    return this.defaults.parallaxStrength_desktop;
  },

  // Debug UI uses this to mutate config at runtime without scattering state.
  applyDebugPatch(patch) {
    // Patch format is intentionally shallow and explicit.
    // Example: { flags: { postProcessing: false }, defaults: { noiseStrength: 0.002 } }
    for (const [topKey, topValue] of Object.entries(patch ?? {})) {
      if (topValue && typeof topValue === 'object' && this[topKey] && typeof this[topKey] === 'object') {
        Object.assign(this[topKey], topValue);
      } else {
        this[topKey] = topValue;
      }
    }
  }
};
