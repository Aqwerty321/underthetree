// src/pages/Landing.js
// Orchestrates landing -> cinematic -> gift parallax -> gift opening -> reveal.

import { config } from '../config.js';
import { loadManifest, loadGiftSceneTextures } from '../utils/assetLoader.js';
import { withTimeout } from '../utils/syncUtils.js';
import { HeroRenderer } from '../scene/HeroRenderer.js';
import { GiftParallaxRenderer } from '../three/GiftParallaxRenderer.js';
import { Soundscape } from '../audio/Soundscape.js';
import { StartOverlay } from '../ui/StartOverlay.js';
import { DebugPanel } from '../ui/DebugPanel.js';
import { HeroCard } from '../ui/HeroCard.js';
import { GiftOverlay } from '../ui/GiftOverlay.js';
import { CinematicPlayer } from '../components/CinematicPlayer.js';
import { VideoLayerManager } from '../video/VideoLayerManager.js';
import { Telemetry } from '../utils/telemetry.js';
import { PendingQueue } from '../utils/pendingQueue.js';
import { ModelClient } from '../model/modelClient.js';
import { SupabaseClientWrapper } from '../db/supabaseClient.js';
import { WishModal } from '../ui/wish/WishModal.js';
import { PendingIndicator } from '../ui/wish/PendingIndicator.js';
import { PersistentQueueToast } from '../ui/wish/PersistentQueueToast.js';
import { GiftRewardOverlay } from '../ui/GiftRewardOverlay.js';
import { callToolhouseAgentPayload, ToolhouseAgentError } from '../toolhouse/agentClient.js';
import { getOrCreateAnonUserId } from '../utils/anonUserId.js';

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function makeCubicBezier(p1x, p1y, p2x, p2y) {
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
  const m = /cubic-bezier\(([^)]+)\)/.exec(str);
  if (!m) return (t) => t;
  const [a, b, c, d] = m[1]
    .split(',')
    .map((s) => Number(s.trim()))
    .map((n) => (Number.isFinite(n) ? n : 0));
  return makeCubicBezier(a, b, c, d);
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

function ensureBottomLoader(parent) {
  const wrap = document.createElement('div');
  wrap.className = 'utt-loading utt-visible';
  wrap.style.opacity = '1';

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

  parent.appendChild(wrap);

  return {
    el: wrap,
    setProgress(p) {
      const x = clamp(p ?? 0, 0, 1);
      fill.style.transform = `scaleX(${x})`;
      pct.textContent = `${Math.round(x * 100)}%`;
    },
    setText(text) {
      pct.textContent = String(text ?? '');
    },
    setShimmer(enabled) {
      wrap.classList.toggle('utt-shimmer', Boolean(enabled));
    },
    remove() {
      wrap.remove();
    }
  };
}

function ensureToast(parent) {
  const el = document.createElement('div');
  el.className = 'utt-toast utt-hidden';
  parent.appendChild(el);

  return {
    show(msg) {
      el.textContent = msg;
      el.classList.remove('utt-hidden');
      el.style.opacity = '1';
      setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.classList.add('utt-hidden'), 300);
      }, 2600);
    }
  };
}

function safePauseResetVideo(videoEl) {
  if (!videoEl) return;
  try {
    videoEl.pause();
  } catch {
    // ignore
  }
  try {
    videoEl.currentTime = 0;
  } catch {
    // ignore
  }
  try {
    videoEl.load();
  } catch {
    // ignore
  }
}

export async function mountLanding() {
  const appEl = document.getElementById('app');
  const uiEl = document.getElementById('ui');

  const url = new URL(window.location.href);
  const debugEnabled = url.searchParams.get('debug') === 'true';

  const osReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const persistedReducedMotion = window.localStorage.getItem(config.storageKeys.reducedMotion);
  const userReducedMotion = persistedReducedMotion === 'true';

  const runtime = {
    started: false,
    isLowPower: false,
    prefersReducedMotion: osReducedMotion || userReducedMotion,
    userReducedMotion,
    muted: false,
    progress: 0,
    state: 'idle'
  };

  runtime.isLowPower = config.detectLowPower();

  const persistedMute = window.localStorage.getItem(config.storageKeys.muted);
  if (persistedMute != null) runtime.muted = persistedMute === 'true';

  let heroRenderer = null;
  let giftRenderer = null;
  let soundscape = null;
  let heroCard = null;
  let giftOverlay = null;
  let videoLayers = null;
  let heroCardShowTimeoutId = null;

  const telemetry = new Telemetry({ endpoint: import.meta.env.VITE_TELEMETRY_ENDPOINT || null });
  const modelClient = new ModelClient({ telemetry });
  const supabaseClient = new SupabaseClientWrapper({ telemetry });

  let pendingQueue = null;
  let pendingIndicator = null;
  let persistentQueueToast = null;
  let wishModal = null;
  let rewardOverlay = null;

  const cinematic = new CinematicPlayer({ parent: document.body, config, runtime, debugEnabled });

  function ensureBlackout() {
    if (cinematic.blackout) return cinematic.blackout;
    const el = document.createElement('div');
    el.className = 'utt-blackout utt-visible';
    el.style.opacity = '0';
    document.body.appendChild(el);
    cinematic.blackout = el;
    return el;
  }

  const toast = ensureToast(document.body);

  async function requestGiftOpen({ user_id, client_op_id, timeoutMs = 9000 } = {}) {
    const uid = String(user_id || 'anonymous');
    const cop = client_op_id != null && String(client_op_id).trim() ? String(client_op_id).trim() : null;
    const startedAt = Date.now();

    // 1) Prefer manual Supabase RPC (fastest + most reliable path). Silent on failure.
    try {
      const elapsedMs = Date.now() - startedAt;
      const remainingMs = Math.max(1000, Number(timeoutMs || 0) - elapsedMs);
      const r = await supabaseClient?.openGiftForUser?.({
        user_id: uid,
        client_op_id: cop,
        timeoutMs: Math.min(8000, remainingMs)
      });

      if (r && (r.title || r.description || r.open_id || r.gift_id)) {
        return {
          source: 'supabase',
          title: r?.title || null,
          description: r?.description || null,
          opened_at: r?.opened_at || null,
          reason: r?.reason || null,
          open_id: r?.open_id || null,
          gift_id: r?.gift_id || null,
          client_op_id: cop,
          meta: null
        };
      }
    } catch {
      // ignore
    }

    // 2) Fallback: Toolhouse agent (bounty flow). Silent on failure.
    try {
      const raw = await callToolhouseAgentPayload(
        {
          command: 'OPEN_GIFT',
          user_id: uid,
          client_op_id: cop
        },
        { timeoutMs }
      );

      // Best-effort parse for title + structured errors.
      try {
        const parsed = JSON.parse(String(raw || ''));
        if (parsed && parsed.ok === false) {
          const code = parsed?.error?.code || 'AGENT_ERROR';
          const msg = parsed?.error?.message || 'Agent returned ok=false';
          throw new Error(`agent:${code}:${msg}`);
        }

        const open = parsed?.result?.open || parsed?.open || null;
        const title = open?.title || open?.gift_title || null;
        const description = open?.description || open?.gift_description || null;
        const opened_at = open?.opened_at || null;
        const reason = open?.reason || null;
        const open_id = open?.open_id || open?.id || null;
        const gift_id = open?.gift_id || null;
        const meta = open?.meta || null;

        return { source: 'toolhouse', title, description, opened_at, reason, open_id, gift_id, client_op_id: cop, meta };
      } catch {
        // If it's not JSON, still treat the request as successful (agent may have written to DB).
        return { source: 'toolhouse', title: null, description: null };
      }
    } catch {
      // Intentionally silent: do not toast specific Toolhouse timeout messages.
    }

    return { source: 'none', title: null, description: null };
  }

  const overlay = new StartOverlay({
    parent: uiEl,
    runtime,
    copy: config.ui,
    onToggleMute: (muted) => {
      runtime.muted = muted;
      window.localStorage.setItem(config.storageKeys.muted, String(muted));
      soundscape?.setMuted(muted);
    },
    onInteractionFocusChange: (isFocused) => {
      heroRenderer?.setInteractionFocus(isFocused);
    },
    onEnter: async () => {
      await config.onEnter?.();
    }
  });

  const manifest = loadManifest(config);

  try {
    const assets = await manifest.load({
      onProgress: (p) => {
        runtime.progress = p;
        overlay.setProgress(p);
      }
    });

    const canUseWebGL = HeroRenderer.canUseWebGL();
    const allowWebGL = canUseWebGL && !runtime.isLowPower;

    if (allowWebGL) {
      heroRenderer = new HeroRenderer({ parent: appEl, config, runtime, assets });
    } else {
      document.body.classList.add('is-fallback');
    }

    soundscape = new Soundscape({ config, runtime });
    await soundscape.preload(assets.audio);

    overlay.setReady(true);

    const uiLayer = document.createElement('div');
    uiLayer.className = 'utt-ui-layer';
    uiEl.appendChild(uiLayer);

    rewardOverlay = new GiftRewardOverlay({ parent: document.body, config });

    // The gift open animation is replayed by the "More gifts" flow.
    // During that replay, the DB write + reward overlay is handled by onMoreGifts,
    // so we suppress the next startGiftOpenFlow from doing duplicate work.
    let skipNextGiftAgentRequest = false;
    let skipNextGiftRewardOverlay = false;

    const processPendingQueue = async ({ force = false } = {}) => {
      const before = pendingQueue?.getCounts?.()?.total ?? 0;
      await pendingQueue?.process?.({
        force,
        handlers: {
          CREATE_WISH: async (payload) => supabaseClient.createWishFromQueue(payload),
          SUBMIT_WISH: async (payload) => {
            const user_id = payload?.user_id ?? null;
            const text = String(payload?.text || '');
            const is_public = Boolean(payload?.is_public);
            const client_op_id = String(payload?.client_op_id || '');

            if (!text.trim()) throw new Error('non_retryable:empty_text');
            if (!client_op_id) throw new Error('non_retryable:missing_client_op_id');

            const v = (await modelClient.request('VALIDATE_WISH', { text }, { timeoutMs: 10000, stream: false, clientOpId: client_op_id })).result;
            if (!v.ok || !v.valid) {
              const reason = Array.isArray(v.reasons) && v.reasons.length ? v.reasons.join('; ') : 'invalid';
              throw new Error(`non_retryable:invalid_wish:${reason}`);
            }

            const wishText = v.sanitized_text || text;
            const created = (await modelClient.request(
              'CREATE_WISH_PAYLOAD',
              { user_id, text: wishText, is_public },
              { timeoutMs: 10000, stream: false, clientOpId: client_op_id }
            )).result;

            if (!created.ok) {
              const code = created.error_code || 'MODEL_ERROR';
              const msg = created.error_msg || 'Model rejected payload';
              throw new Error(`non_retryable:${code}:${msg}`);
            }

            await supabaseClient.createWishFromQueue({ ...created.db_payload, id: client_op_id, synced: true });
          }
        }
      });
      const after = pendingQueue?.getCounts?.()?.total ?? 0;
      const drained = Math.max(0, before - after);
      if (drained > 0) toast.show(`Synced ${drained} wish${drained === 1 ? '' : 'es'}`);
    };

    // Pending queue + indicator (always mounted; hidden unless needed).
    persistentQueueToast = new PersistentQueueToast({
      parent: document.body,
      queue: null,
      onRetryAll: async () => {
        await processPendingQueue({ force: true });
      }
    });

    pendingQueue = new PendingQueue({
      telemetry,
      onChange: () => {
        pendingIndicator?.update();
      },
      onItemFailed: (op) => {
        // Persistent remediation required by spec.
        persistentQueueToast?.showFor(op);
      }
    });

    // Patch the toast's queue reference now that pendingQueue exists.
    persistentQueueToast.queue = pendingQueue;

    pendingIndicator = new PendingIndicator({
      parent: uiLayer,
      queue: pendingQueue,
      onRetryAll: async () => {
        await processPendingQueue({ force: true });
      }
    });

    // Process queue on start and on reconnect.
    processPendingQueue();
    window.addEventListener('online', () => {
      processPendingQueue();
    });

    // Wish modal
    wishModal = new WishModal({
      parent: document.body,
      config,
      runtime,
      modelClient,
      supabaseClient,
      queue: pendingQueue,
      telemetry,
      toast
    });

    heroCard = new HeroCard({
      parent: uiLayer,
      title: config.ui.title,
      subtitle: 'Open a present to begin.',
      ctaLabel: 'Open a Present',
      onPrimary: async () => {
        await startCinematicFlow();
      },
      initialMuted: runtime.muted,
      initialReducedMotion: runtime.userReducedMotion,
      onMuteChange: (muted) => {
        runtime.muted = muted;
        window.localStorage.setItem(config.storageKeys.muted, String(muted));
        soundscape?.setMuted(muted);
      },
      onReducedMotionChange: (enabled) => {
        runtime.userReducedMotion = enabled;
        window.localStorage.setItem(config.storageKeys.reducedMotion, String(enabled));
        const osRM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        runtime.prefersReducedMotion = osRM || enabled;
        heroRenderer?.syncFromConfig();
      },
      onCtaFocusChange: (isFocused) => {
        heroRenderer?.setInteractionFocus(isFocused);
      }
    });
    heroCard.setVisible(false);

    overlay.onStart(async () => {
      runtime.started = true;
      runtime.state = 'idle';
      document.body.classList.add('is-running');

      heroRenderer?.start();
      await soundscape.start();

      if (runtime.prefersReducedMotion && config.accessibility.defaultAudioOffOnReducedMotion) {
        runtime.muted = true;
        window.localStorage.setItem(config.storageKeys.muted, 'true');
        overlay.setMuted(true);
        soundscape.setMuted(true);
      } else {
        soundscape.setMuted(runtime.muted);
      }

      const heroFadeEndSec = config.timeline?.heroFade?.end ?? 0;
      const uiDelayMs = Math.max(0, (heroFadeEndSec + 0.25) * 1000);
      if (heroCardShowTimeoutId) {
        window.clearTimeout(heroCardShowTimeoutId);
        heroCardShowTimeoutId = null;
      }

      heroCardShowTimeoutId = window.setTimeout(() => {
        // Only show the home hero card if we are still on the home state.
        if (runtime.state === 'idle') heroCard?.setVisible(true);
      }, uiDelayMs);
    });

    if (debugEnabled) {
      new DebugPanel({
        parent: uiEl,
        config,
        runtime,
        onChange: (patch) => {
          config.applyDebugPatch(patch);
          heroRenderer?.syncFromConfig();
          giftRenderer?.syncFromConfig();
          soundscape?.syncFromConfig();
        }
      });
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        heroRenderer?.pause();
        giftRenderer?.pause();
        soundscape?.pause();
      } else {
        heroRenderer?.resume();
        giftRenderer?.resume();
        soundscape?.resume();
      }
    });

    async function startCinematicFlow() {
      if (!runtime.started) return;
      if (runtime.state !== 'idle') return;

      runtime.state = 'cinematicLoading';

      // Cancel any pending delayed hero-card reveal from Start.
      if (heroCardShowTimeoutId) {
        window.clearTimeout(heroCardShowTimeoutId);
        heroCardShowTimeoutId = null;
      }

      heroCard?.setDisabled(true);
      heroCard?.setVisible(false);
      heroCard?.el?.classList.add('utt-hidden');
      heroRenderer?.pause();

      await cinematic.play();

      runtime.state = 'loadingParallax';

      // Load gift scene textures on black.
      const loader = ensureBottomLoader(document.body);
      try {
        const giftTex = await loadGiftSceneTextures(config, {
          onProgress: (p) => loader.setProgress(p)
        });

        // Create gift renderer using gift textures + existing noise.
        giftRenderer = new GiftParallaxRenderer({
          parent: appEl,
          config,
          runtime,
          textures: {
            color: giftTex.textures.color,
            depth: giftTex.textures.depth,
            noise: assets.textures.noise
          },
          enablePost: true
        });
        giftRenderer.setOpacity(0);
        giftRenderer.setBlurRadiusPct(config.post.blur.loadingRadiusPct);
        giftRenderer.start();

        // Crossfade black -> gift scene and blur ramp.
        const easeScene = parseBezierString(config.easing.easeOutCubic);
        const easeBlur = parseBezierString(config.easing.blurRamp);

        const fadeMs = (config.flow?.GIFT_SCENE_CROSSFADE ?? 0.6) * 1000;
        const blurMs = 650;
        const maxMs = Math.max(fadeMs, blurMs) + 1200;

        const t0 = performance.now();
        const crossfade = new Promise((resolve) => {
          const step = () => {
            try {
              const now = performance.now();
              const u = clamp((now - t0) / Math.max(1, fadeMs), 0, 1);
              const b = clamp((now - t0) / Math.max(1, blurMs), 0, 1);

              giftRenderer?.setOpacity(easeScene(u));
              giftRenderer?.setBlurRadiusPct(
                lerp(config.post.blur.loadingRadiusPct, config.post.blur.baseRadiusPct, easeBlur(b))
              );

              // Fade blackout out as scene fades in.
              if (cinematic.blackout) {
                cinematic.blackout.style.opacity = String(1 - easeScene(u));
              }

              if (u >= 1 && b >= 1) {
                resolve();
                return;
              }
              requestAnimationFrame(step);
            } catch {
              resolve();
            }
          };
          requestAnimationFrame(step);
        });

        try {
          await withTimeout(crossfade, maxMs, 'Gift scene crossfade timed out');
        } catch {
          // Fail-safe: show scene and clear blackout.
          giftRenderer?.setOpacity(1);
          giftRenderer?.setBlurRadiusPct(config.post.blur.baseRadiusPct);
          if (cinematic.blackout) cinematic.blackout.style.opacity = '0';
        }
      } finally {
        // Always remove loader even if something stalls.
        try {
          loader.remove();
        } catch {
          // ignore
        }
      }

      runtime.state = 'parallaxShown';

      // Show gift UI after +0.2s.
      if (!giftOverlay) {
        giftOverlay = new GiftOverlay({
          parent: document.body,
          config,
          runtime,
          initialMuted: runtime.muted,
          onMuteChange: (muted) => {
            runtime.muted = muted;
            window.localStorage.setItem(config.storageKeys.muted, String(muted));
            soundscape?.setMuted(muted);
          },
          onOpenGift: async () => {
            await startGiftOpenFlow();
          },
          onMoreGifts: async () => {
            if (runtime.state !== 'reveal') return;

            // 1) Ask Toolhouse agent (linked to Supabase) to create a new gift + open record.
            // The agent is expected to perform the CRUD operations using the Toolhouse→Supabase linker.
            const user_id = getOrCreateAnonUserId();

            let client_op_id = '';
            try {
              client_op_id = crypto.randomUUID();
            } catch {
              client_op_id = `op_${Date.now()}_${Math.random().toString(16).slice(2)}`;
            }

            let lastSeenId = null;
            try {
              lastSeenId = await fetchLatestGiftOpenId({ user_id, supabaseClient });
            } catch {
              // ignore
            }

            giftOverlay.setDisabled(true);
            toast.show('Looking for more gifts…');

            // Start the DB write now, but do not allow it to stall the UX for long.
            const opened = await withTimeout(
              Promise.resolve(requestGiftOpen({ user_id, client_op_id, timeoutMs: 9000 })),
              9500,
              'open_gift_timeout'
            ).catch(() => null);

            // 2) Replay the full gift opening animation.
            runtime.state = 'giftOverlayShown';

            // startGiftOpenFlow is triggered by GiftOverlay's onOpenGift callback during replay.
            // We already created the gift open record above, and we want to keep the UI disabled
            // until we show the reward, so suppress duplicate work.
            skipNextGiftAgentRequest = true;
            skipNextGiftRewardOverlay = true;
            await giftOverlay.replayGiftOpen();

            // 3) After animation completes (reveal), show the reward immediately.
            try {
              await waitForRuntimeState(runtime, 'reveal', 25000);

              // Show container immediately; update as soon as we have data.
              await rewardOverlay?.show?.({ loading: true });

              // Preferred: show from RPC/agent return (fast, reliable).
              if (opened && typeof opened === 'object' && (opened.title || opened.description || opened.open_id || opened.gift_id)) {
                rewardOverlay?.update?.({
                  title: opened.title || 'gift',
                  description: opened.description || null,
                  meta: opened.meta || null,
                  opened_at: opened.opened_at || null,
                  open_id: opened.open_id || null,
                  gift_id: opened.gift_id || null,
                  client_op_id,
                  reason: opened.reason || null,
                  show_debug: false
                });
                if (opened.title || opened.description) return;
              }

              // Fallback: short poll to enrich, but never block the celebration.
              const gift =
                (await waitForNewGiftByClientOpId({ client_op_id, supabaseClient, timeoutMs: 4000 }).catch(() => null)) ||
                (await waitForNewGift({ user_id, supabaseClient, lastSeenId, timeoutMs: 4000 }).catch(() => null));

              rewardOverlay?.update?.({
                title: gift?.title || 'gift',
                description: gift?.description || null,
                meta: gift?.meta || null,
                opened_at: gift?.opened_at || null,
                open_id: gift?.open_id || null,
                gift_id: gift?.gift_id || null,
                client_op_id,
                reason: gift?.reason || null,
                show_debug: false
              });
            } catch {
              // Best-effort: no reward.
            } finally {
              giftOverlay.setDisabled(false);
            }
          },
          onWriteWish: async () => {
            await wishModal?.open();
          },
          onBackHome: async () => {
            await returnToHome();
          }
        });
      }

      await giftOverlay.show({ delayMs: (config.flow?.GIFT_UI_DELAY_AFTER_SCENE ?? 0.2) * 1000 });
      runtime.state = 'giftOverlayShown';

      // Keep hero paused behind gift scene.
    }

    async function startGiftOpenFlow() {
      if (runtime.state !== 'giftOverlayShown') return;
      runtime.state = 'openingGift';

      const skipAgentRequest = skipNextGiftAgentRequest;
      const skipRewardOverlay = skipNextGiftRewardOverlay;
      skipNextGiftAgentRequest = false;
      skipNextGiftRewardOverlay = false;

      const user_id = getOrCreateAnonUserId();
      let client_op_id = null;
      let lastSeenId = null;

      if (!skipAgentRequest) {
        try {
          client_op_id = crypto.randomUUID();
        } catch {
          client_op_id = `op_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        }

        try {
          lastSeenId = await fetchLatestGiftOpenId({ user_id, supabaseClient });
        } catch {
          // ignore
        }
      }

      // Kick off the agent request in parallel with the animation (best-effort).
      const agentGiftPromise = (async () => {
        if (skipAgentRequest) return null;
        toast.show('Opening your gift…');
        // Cap total wait so the UI can't stall for minutes.
        const opened = await withTimeout(
          Promise.resolve(requestGiftOpen({ user_id, client_op_id, timeoutMs: 9000 })),
          9500,
          'open_gift_timeout'
        ).catch(() => null);
        return opened || null;
      })().catch(() => null);

      // Start an enrich poll in parallel so we can show the real gift title immediately at reveal.
      // (Does not block; we only consume it later.)
      const enrichGiftPromise =
        !skipAgentRequest && client_op_id
          ? waitForNewGiftByClientOpId({ client_op_id, supabaseClient, timeoutMs: 12000 }).catch(() => null)
          : Promise.resolve(null);

      // Show the reward container early while the gift is opening.
      if (!skipRewardOverlay) {
        rewardOverlay?.show?.({ loading: true }).catch(() => {});
      }

      const showRewardFromResult = async ({ opened, assumeVisible = false }) => {
        if (!assumeVisible) {
          // Always show a celebratory container immediately; update when data arrives.
          await rewardOverlay?.show?.({ loading: true });
        }

        // Preferred: show from RPC/agent return (fast, reliable).
        if (opened && typeof opened === 'object' && (opened.title || opened.description || opened.open_id || opened.gift_id)) {
          rewardOverlay?.update?.({
            title: opened.title || 'gift',
            description: opened.description || null,
            meta: opened.meta || null,
            opened_at: opened.opened_at || null,
            open_id: opened.open_id || null,
            gift_id: opened.gift_id || null,
            client_op_id,
            reason: opened.reason || null,
            show_debug: false
          });
          // If we still don't have a real title, try a short enrich poll.
          if (opened.title || opened.description) return;
        }

        // Fallback: short poll to enrich, but never block the celebration.
        const gift =
          (client_op_id
            ? await waitForNewGiftByClientOpId({ client_op_id, supabaseClient, timeoutMs: 4000 }).catch(() => null)
            : null) || (await waitForNewGift({ user_id, supabaseClient, lastSeenId, timeoutMs: 4000 }).catch(() => null));

        rewardOverlay?.update?.({
          title: gift?.title || 'gift',
          description: gift?.description || null,
          meta: gift?.meta || null,
          opened_at: gift?.opened_at || null,
          open_id: gift?.open_id || null,
          gift_id: gift?.gift_id || null,
          client_op_id,
          reason: gift?.reason || null,
          show_debug: false
        });
      };

      if (runtime.prefersReducedMotion) {
        giftOverlay.setPreviewImage(config.assets.giftOverlay.giftOpenStatic);
        giftOverlay.showReveal();
        runtime.state = 'reveal';

        if (!skipRewardOverlay) {
          try {
            const opened = await agentGiftPromise;
            // If the open result lacks a title, use the parallel enrich poll if ready.
            const enrich = await Promise.race([
              enrichGiftPromise,
              new Promise((r) => setTimeout(() => r(null), 2500))
            ]);
            await showRewardFromResult({ opened: opened?.title || opened?.description ? opened : enrich || opened, assumeVisible: true });
          } catch {
            // Best-effort only.
          }
        }

        if (!skipRewardOverlay) giftOverlay.setDisabled(false);
        return;
      }

      videoLayers =
        videoLayers ??
        new VideoLayerManager({
          parent: giftOverlay.getConfettiMount(),
          config,
          runtime,
          giftRenderer,
          className: 'utt-video-layers'
        });

      try {
        const giftVideoEl = giftOverlay.getGiftVideoElement();
        const confettiEnded = await videoLayers.playConfettiSyncedToGift({ giftVideoEl });

        runtime.state = 'confettiPlaying';

        // Reveal once both: gift has reached its final frame, and confetti has ended.
        await Promise.all([
          giftOverlay.waitForGiftEnded().catch(() => {}),
          confettiEnded.catch(() => {})
        ]);

        await videoLayers.fadeOutConfetti();

        runtime.state = 'reveal';
        giftOverlay.showReveal();

        if (!skipRewardOverlay) {
          try {
            const opened = await agentGiftPromise;
            const enrich = await Promise.race([
              enrichGiftPromise,
              new Promise((r) => setTimeout(() => r(null), 2500))
            ]);
            await showRewardFromResult({ opened: opened?.title || opened?.description ? opened : enrich || opened, assumeVisible: true });
          } catch {
            // Best-effort: no reward.
          }
        }

        if (!skipRewardOverlay) giftOverlay.setDisabled(false);
      } catch {
        // Fallback: show static open frame.
        giftOverlay.setPreviewImage(config.assets.giftOverlay.giftOpenStatic);
        giftOverlay.showReveal();
        runtime.state = 'reveal';

        if (!skipRewardOverlay) {
          try {
            const opened = await agentGiftPromise;
            const enrich = await Promise.race([
              enrichGiftPromise,
              new Promise((r) => setTimeout(() => r(null), 2500))
            ]);
            await showRewardFromResult({ opened: opened?.title || opened?.description ? opened : enrich || opened, assumeVisible: true });
          } catch {
            // Best-effort only.
          }
        }

        if (!skipRewardOverlay) giftOverlay.setDisabled(false);
      }
    }

    async function returnToHome() {
      if (runtime.state === 'returningHome') return;
      runtime.state = 'returningHome';

      // Prevent spam clicks while transitioning.
      try {
        giftOverlay?.setDisabled(true);
      } catch {
        // ignore
      }

      // Fade to black with a small loading indicator to hide teardown.
      const blackout = ensureBlackout();
      const loader = ensureBottomLoader(document.body);
      loader.setShimmer(true);
      loader.setProgress(0.12);
      loader.setText('Loading');

      const FADE_TO_BLACK_MS = 420;
      const FADE_FROM_BLACK_MS = 520;
      const RETURN_HOME_TIMEOUT_MS = 3800;

      const finalizeHome = async () => {
        // Restore hero UI state.
        heroRenderer?.resume();
        heroCard?.setDisabled(false);
        heroCard?.el?.classList.remove('utt-hidden');
        heroCard?.setMuted(runtime.muted);
        heroCard?.setReducedMotion(runtime.userReducedMotion);

        // Fade back in from black.
        heroCard?.setVisible(false);
        try {
          await transitionOpacity(blackout, 0, FADE_FROM_BLACK_MS, config.easing.easeOutCubic);
        } catch {
          blackout.style.opacity = '0';
        }

        // Show home UI after fade.
        heroCard?.setVisible(true);
        runtime.state = 'idle';

        // Cleanup blackout element to keep DOM tidy.
        try {
          blackout.remove();
        } catch {
          // ignore
        }
        cinematic.blackout = null;
      };

      try {
        await withTimeout(
          (async () => {
            // Fade to black first (hides any teardown flashes).
            try {
              await transitionOpacity(blackout, 1, FADE_TO_BLACK_MS, config.easing.easeOutCubic);
            } catch {
              blackout.style.opacity = '1';
            }

            loader.setProgress(0.28);

            // Stop any in-flight gift media right away.
            try {
              safePauseResetVideo(giftOverlay?.getGiftVideoElement?.());
            } catch {
              // ignore
            }

            // Tear down gift UI and layers while black.
            try {
              await giftOverlay?.hide();
            } catch {
              // ignore
            }

            loader.setProgress(0.55);

            try {
              giftOverlay?.destroy();
            } catch {
              // ignore
            }
            giftOverlay = null;

            try {
              videoLayers?.destroy();
            } catch {
              // ignore
            }
            videoLayers = null;

            loader.setProgress(0.78);

            try {
              giftRenderer?.stop();
            } catch {
              // ignore
            }
            giftRenderer = null;

            // Ensure soundscape matches current mute state.
            try {
              soundscape?.setMuted(runtime.muted);
            } catch {
              // ignore
            }

            loader.setProgress(0.92);

            await finalizeHome();
          })(),
          RETURN_HOME_TIMEOUT_MS,
          'Return-to-home transition timed out'
        );
      } catch {
        // Fail-safe: force home visible even if something stalls.
        try {
          blackout.style.opacity = '1';
        } catch {
          // ignore
        }

        try {
          giftOverlay?.destroy();
        } catch {
          // ignore
        }
        giftOverlay = null;

        try {
          videoLayers?.destroy();
        } catch {
          // ignore
        }
        videoLayers = null;

        try {
          giftRenderer?.stop();
        } catch {
          // ignore
        }
        giftRenderer = null;

        await finalizeHome().catch(() => {});
      } finally {
        // Always remove loader even on failure.
        try {
          loader.remove();
        } catch {
          // ignore
        }
      }
    }

    async function fetchLatestGiftOpenId({ user_id, supabaseClient }) {
      if (!supabaseClient?.client) return null;
      if (!user_id) return null;
      const { data, error } = await supabaseClient.client
        .from('user_gift_opens')
        .select('id')
        .eq('user_id', user_id)
        .order('opened_at', { ascending: false })
        .limit(1);
      if (error) return null;
      return data?.[0]?.id ?? null;
    }

    async function waitForNewGift({ user_id, supabaseClient, lastSeenId, timeoutMs = 15000 }) {
      if (!supabaseClient?.client) throw new Error('supabase_not_configured');
      if (!user_id) throw new Error('missing_user_id');

      const getEmbeddedGift = (row) => {
        const g = row?.gift ?? row?.gifts;
        if (!g) return null;
        if (Array.isArray(g)) return g[0] || null;
        return g;
      };

      const start = performance.now();
      while (performance.now() - start < timeoutMs) {
        const { data, error } = await supabaseClient.client
          .from('user_gift_opens')
          .select('id, opened_at, gift_id, client_op_id, gift:public.gifts!user_gift_opens_gift_id_fkey(title, description, meta)')
          .eq('user_id', user_id)
          .order('opened_at', { ascending: false })
          .limit(1);

        if (!error) {
          const row = data?.[0];
          if (row?.id && row.id !== lastSeenId) {
            const gift = getEmbeddedGift(row);
            return {
              title: gift?.title || 'gift',
              description: gift?.description || null,
              meta: gift?.meta || null,
              opened_at: row?.opened_at || null,
              open_id: row?.id || null,
              gift_id: row?.gift_id || null,
              client_op_id: row?.client_op_id || null,
              reason: null
            };
          }
        }

        await new Promise((r) => setTimeout(r, 900));
      }
      throw new Error('timeout');
    }

    async function waitForNewGiftByClientOpId({ client_op_id, supabaseClient, timeoutMs = 15000 }) {
      if (!supabaseClient?.client) throw new Error('supabase_not_configured');
      if (!client_op_id) throw new Error('missing_client_op_id');

      const getEmbeddedGift = (row) => {
        const g = row?.gift ?? row?.gifts;
        if (!g) return null;
        if (Array.isArray(g)) return g[0] || null;
        return g;
      };

      const start = performance.now();
      while (performance.now() - start < timeoutMs) {
        const { data, error } = await supabaseClient.client
          .from('user_gift_opens')
          .select('id, opened_at, gift_id, client_op_id, gift:public.gifts!user_gift_opens_gift_id_fkey(title, description, meta)')
          .eq('client_op_id', client_op_id)
          .order('opened_at', { ascending: false })
          .limit(1);

        if (!error) {
          const row = data?.[0];
          if (row?.id) {
            const gift = getEmbeddedGift(row);
            return {
              title: gift?.title || 'gift',
              description: gift?.description || null,
              meta: gift?.meta || null,
              opened_at: row?.opened_at || null,
              open_id: row?.id || null,
              gift_id: row?.gift_id || null,
              client_op_id: row?.client_op_id || null,
              reason: null
            };
          }
        }

        await new Promise((r) => setTimeout(r, 700));
      }
      throw new Error('timeout');
    }

    async function waitForRuntimeState(runtime, state, timeoutMs) {
      const start = performance.now();
      while (performance.now() - start < timeoutMs) {
        if (runtime.state === state) return;
        await new Promise((r) => setTimeout(r, 60));
      }
      throw new Error('state_timeout');
    }

    window.__uttTeardown = async () => {
      await soundscape?.stop();
      heroRenderer?.stop();
      giftRenderer?.stop();
      overlay.destroy();
      heroCard?.el?.remove();
      giftOverlay?.destroy();
      videoLayers?.destroy();
      wishModal?.destroy();
      pendingIndicator?.destroy();
      persistentQueueToast?.destroy();
    };
  } catch (err) {
    overlay.setError(String(err?.message ?? err));
    console.error(err);
  }
}
