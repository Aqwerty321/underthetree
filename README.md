# Under the Tree (landing prototype)

Single-screen landing experience using a **hero color image + matching linear depth map** to drive a subtle parallax shader, with ambient audio and runtime post-processing.

The experience now includes a short **cinematic video** and a second **gift parallax scene** with optional **alpha WebM overlays** (gift opening + confetti).

This repo is intentionally modular and “open-ended”: it’s meant to be iterated on (future screens/transitions), not treated as a final product.

## Quick start

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

## Deploy (GitHub + Vercel)

### 1) Push to GitHub

- Ensure `.env*` files are not committed (this repo includes `.gitignore`).
- Create a new GitHub repo, then from this folder:
	- `git init`
	- `git add .`
	- `git commit -m "Initial commit"`
	- `git branch -M main`
	- `git remote add origin <YOUR_GITHUB_REPO_URL>`
	- `git push -u origin main`

### 2) Import into Vercel

- In Vercel: **Add New → Project → Import** your GitHub repo.
- Framework preset: **Vite**
- Build command: `npm run build`
- Output directory: `dist`

This repo includes `vercel.json` to rewrite all routes to `index.html` (SPA behavior).

### 3) Set Vercel environment variables

Add the variables from `.env.example` in Vercel Project Settings → Environment Variables.

Important:

- Vercel cannot reach Ollama running on your laptop. For production you must either:
	- Configure `VITE_TOOLHOUSE_*` (recommended), or
	- Set `VITE_OLLAMA_URL` to a hosted Ollama-compatible endpoint that the browser can reach.

## Assets (do not rename)

All current content is driven by the existing files under `public/assets`:

- `audio/fire_cackle_loop.mp3`
- `audio/room_ambience_loop.mp3`
- `visuals/hero/color/hero_bg_2k.webp`
- `visuals/hero/color/hero_bg_4k.webp`
- `visuals/hero/depth/hero_depth_2k_16bit.png`
- `visuals/hero/depth/hero_depth_4k_16bit.png`
- `visuals/ui/glass_noise.jpg`

Additional required assets for the cinematic + gift scene:

- Cinematic:
	- `video/cinematic.mp4`
- Gift scene parallax:
	- `visuals/gifts_scene/color/gifts_bg_2k.png`
	- `visuals/gifts_scene/color/gifts_bg_4k.png`
	- `visuals/gifts_scene/depth/gifts_depth_2k_16bit.png`
	- `visuals/gifts_scene/depth/gifts_depth_4k_16bit.png`
- Gift UI overlay images:
	- `visuals/gifts_scene/gift_overlay/gift_closed.png`
	- `visuals/gifts_scene/gift_overlay/gift_open_static.png`
- Gift effects (alpha video overlays):
	- `visuals/gifts_scene/gift_overlay/gift_open.webm`
	- `ui/effects/confetti_burst.webm`

Depth maps are treated as **linear normalized depth in [0..1]** (0 = near, 1 = far), as exported from Blender.

Alpha WebM notes:

- The confetti overlay expects an alpha-capable codec (commonly VP9 with alpha). Browser/driver support varies.
- The code prefers WebGL composition via `VideoTexture` when possible; it has a DOM/CSS fallback layer for cases where WebGL video texturing is not viable.

## Resolution switching (2k vs 4k)

Decision logic (default):

- If `devicePixelRatio >= 2` **and** `innerWidth >= 1440` → use **4k** color + depth
- Else → use **2k**

Override options:

- Runtime: add `?debug=true` and toggle **use4k** (reload required)
- Code: set `config.flags.use4k` in [src/config.js](src/config.js)

While assets load, a CSS placeholder shows `hero_bg_2k.webp` with a blur filter.

## Accessibility + autoplay rules

- The experience requires an explicit user gesture via the **Start** button.
- Audio starts only after Start (autoplay compliance).
- `prefers-reduced-motion` disables parallax and automated motion, and defaults audio to off.
- A **Sound off** toggle is provided and persisted to `localStorage`.

## Debug panel

Open: `http://localhost:5173/?debug=true`

Required controls included:

- `parallaxStrength` (slider)
- `blurRadiusPct` (slider)
- `noiseStrength`, `noiseScale`, `noiseSpeed`
- `use4k` toggle (reload required)
- `postProcessing` on/off
- `simulateLowPower` toggle

Note: gift-scene-specific debug controls are not exposed yet; most tuning is in [src/config.js](src/config.js).

## Architecture

Suggested modular structure (implemented):

- [src/entry.js](src/entry.js) — bootstrap, start gesture, lifecycle
- [src/config.js](src/config.js) — **single config object** (all tuning params)
- [src/utils/assetLoader.js](src/utils/assetLoader.js) — promise loader + progress
- [src/scene/HeroRenderer.js](src/scene/HeroRenderer.js) — fullscreen quad + shader + composer
- [src/postprocess/BlurPass.js](src/postprocess/BlurPass.js) — separable blur w/ noise+depth modulation
- [src/postprocess/BloomPass.js](src/postprocess/BloomPass.js) — UnrealBloom wrapper
- [src/audio/Soundscape.js](src/audio/Soundscape.js) — Web Audio preload + crossfade + modulation
- [src/ui/StartOverlay.js](src/ui/StartOverlay.js) — accessible CTA + progress + mute
- [src/ui/DebugPanel.js](src/ui/DebugPanel.js) — `?debug=true` QA panel

Additional modules for the cinematic + gift flow:

- [src/pages/Landing.js](src/pages/Landing.js) — orchestrates the full flow (hero → cinematic → gift → back home)
- [src/components/CinematicPlayer.js](src/components/CinematicPlayer.js) — cinematic video player (loader + fades + cleanup)
- [src/three/GiftParallaxRenderer.js](src/three/GiftParallaxRenderer.js) — gift scene fullscreen quad + postprocessing + optional video overlays
- [src/video/VideoLayerManager.js](src/video/VideoLayerManager.js) — manages `gift_open` + `confetti` playback and sync (+1.0s)
- [src/ui/GiftOverlay.js](src/ui/GiftOverlay.js) — gift UI overlay (Open Gift → reveal actions)
- [src/utils/syncUtils.js](src/utils/syncUtils.js) — video time sync helpers (rvfc + polling fallback)

## Wish from Santa (offline-friendly)

This repo includes a Supabase-backed “Wish from Santa” flow with an offline queue and a provider-agnostic model client.

### UX

- Open the gift, then in the reveal actions click **Write a wish**.
- A glass modal opens titled **“Write a wish for Santa”**.
- On **Send Wish**:
	- Inputs disable immediately.
	- A modal header progress bar appears (8px):
		- Streaming model calls show determinate progress (by chunk count).
		- Non-streaming falls back to an indeterminate bar with timed status messages.
	- If the DB write fails or you are offline: the wish is saved locally and queued for background sync.
	- If the model call fails (Ollama not running, timeout, or no fallback configured): the wish is saved locally and queued; it will run the model + DB write later.

### Local storage (data safety)

- `underthetree.pendingQueue` — persistent offline queue (NOT secure storage; payload is minimal, no secret tokens).
- `underthetree.anonUserId` — opaque identifier used when not authenticated.
- `underthetree.telemetry` — minimal local telemetry buffer (no raw wish text).

### Model providers

The model client is deterministic and strict JSON-only:

- Primary: local Ollama (`llama3.2:3b`)
- Fallback: Toolhouse (OpenAI-compatible endpoint) **once** per action, only on timeout/malformed JSON.

#### Local Ollama (runs on your laptop)

- Install Ollama and make sure the service is running.
- Pull the model once:
	- `ollama pull llama3.2:3b`

By default, the app calls Ollama through the Vite dev proxy at `/ollama` (so the browser doesn’t hit CORS issues). If you want to bypass the proxy, set `VITE_OLLAMA_URL=http://localhost:11434`.

### Environment variables

Create a `.env.local` with:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_OLLAMA_URL` (optional; if unset the app uses the Vite proxy `/ollama` → `http://localhost:11434`)
- `VITE_OLLAMA_MODEL` (optional, default `llama3.2:3b`)
- `VITE_TOOLHOUSE_URL` (Toolhouse chat completions endpoint URL)
- `VITE_TOOLHOUSE_API_KEY`
- `VITE_TOOLHOUSE_MODEL` (optional)
- `VITE_TELEMETRY_ENDPOINT` (optional; if unset telemetry is buffered locally only)

### Supabase schema / server-side requirements

SQL migration files live in:

- [supabase/migrations/001_init.sql](supabase/migrations/001_init.sql)

It creates tables `gifts`, `user_gift_opens`, and `wishes` (including `moderated`/`moderated_at` and an optional `synced` boolean for client bookkeeping), plus RLS policies and a simple “5 per hour” rate-limit trigger.

Moderation is stubbed as an Edge Function:

- [supabase/functions/moderate-wish/index.ts](supabase/functions/moderate-wish/index.ts)

You must wire moderation so that public wishes are not exposed until approved (`moderated=true`).

## Shader uniforms (what to tune)

The parallax shader lives in [src/scene/HeroRenderer.js](src/scene/HeroRenderer.js) and uses:

- `tColor` — sRGB hero texture
- `tDepth` — linear normalized depth texture
- `tNoise` — glass noise grayscale
- `uMouse` — normalized mouse in [-1, 1] (Y inverted)
- `uParallaxStrength` — base strength (device + interaction focus)
- `uScreenScale` — baseline scale (spec default 0.04)
- `uNoiseStrength`, `uNoiseScale`, `uNoiseSpeed` — glass refraction controls
- `uMaxOffsetPx` — safety clamp (spec default 60)
- `uDepthEdgeBlendRange` — blends back to unshifted UV at depth edges
- `uWarmup` — 0→1 warmup after Start
- `uOpacity` — fade-in after Start

Notes:

- Sampling is clamped to `[0,1]` to prevent black borders.
- No pixels are discarded; there are no alpha holes.

## Post-processing chain

Order (as implemented):

1. Fullscreen quad render
2. Separable blur (horizontal → vertical), **modulated by noise*(1-depth)**
3. UnrealBloomPass (conservative defaults)
4. Tone mapping (ACES via Three renderer)
5. Final composite (vignette + subtle glass luminance overlay)

## QA / acceptance checklist

Visual

- Foreground moves noticeably more than background when moving mouse.
- No visible holes or black borders when parallax offset is applied.
- Depth-edge blend reduces tearing at silhouettes.

Performance

- Desktop Chrome: ~60fps with postprocessing on (mid-range GPU).
- Low-power fallback: if `deviceMemory <= 2` or `hardwareConcurrency <= 2`, stays stable and shows static hero.

Audio

- Audio starts only after Start.
- Room ambience steady at lower gain.
- Fire louder with slow modulation.

Debug

- `?debug=true` shows the required controls and changes affect the scene live.

Gift flow

- Start → hero renders and UI fades in.
- CTA → cinematic plays once; on end it fades to black.
- Gift scene loads and fades in.
- Open Gift:
	- Plays `gift_open.webm`
	- Starts `confetti_burst.webm` at exactly +1.0s into `gift_open` (time-based sync)
	- When confetti ends, gift overlay fades out and reveal CTAs appear.
- Reduced motion skips the heavy video effect path and reveals the “opened” state via static imagery.

## Known pitfalls / tuning notes

- Depth mismatch: this assumes the depth PNG is already linear+normalized. If it isn’t, the shader needs a linearize path using near/far.
- UV edge artifacts: clamping + depth-edge blending are the primary mitigations; increase `depthEdgeBlendRange` if silhouettes tear.
- Glass shimmer: keep `noiseStrength` small (recommended < 0.006).
- Blur ordering: blur is applied after parallax sampling; moving blur earlier will increase edge artifacts.

