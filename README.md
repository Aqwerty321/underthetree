# Under the Tree

A cinematic, single-page “gift opening” experience built with Vite + Three.js.

Highlights:

- WebGL parallax hero and a second parallax gift scene (color + depth maps)
- A cinematic interstitial video and an alpha WebM gift-open overlay
- Confetti overlay that persists until the gift-open video ends
- Ambient soundscape (Web Audio) + UX SFX (HTMLAudio)
- Supabase-backed gifting + an offline-friendly “Wish from Santa” flow
- Toolhouse integration for LLM tasks (validation/payload shaping) and optional server-side DB writes

This repo is intentionally modular: it’s designed to be iterated on (more scenes, transitions, data sources) rather than a one-off prototype.

---

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

---

## Architecture (high level)

The app is a single-page UI with three major subsystems: rendering, media (video/audio), and data/AI.

```text
Browser (Vite SPA)
  ├─ Rendering (Three.js)
  │   ├─ HeroRenderer (hero parallax)
  │   └─ GiftParallaxRenderer (gift scene parallax + post FX)
  ├─ Media
  │   ├─ CinematicPlayer (mp4)
  │   ├─ GiftOverlay (gift_open.webm)
  │   ├─ VideoLayerManager (confetti_burst.webm layering + sync)
  │   ├─ Soundscape (Web Audio ambient loops)
  │   └─ SfxManager (UI click / fanfare / lid-off)
  └─ Data + AI
      ├─ SupabaseClientWrapper (reads + optional writes)
      ├─ PendingQueue (offline-first retries)
      └─ ModelClient (Ollama in dev, Toolhouse via server proxy in prod)

Vercel serverless (optional, for production)
  ├─ /api/toolhouse-chat   (OpenAI-compatible chat.completions proxy)
  └─ /api/toolhouse-agent  (Toolhouse Agent proxy; used for server-side writes)
```

Entry point: [src/pages/Landing.js](src/pages/Landing.js) orchestrates the whole flow.

---

## Runtime flow (gift experience)

1) **Start gesture**

- The landing screen requires an explicit Start click (autoplay compliance).
- Asset preloading occurs with progress feedback.

2) **Hero scene**

- A fullscreen quad uses the hero color texture + depth map to create subtle parallax.
- Post-processing is optional and tunable.

3) **Cinematic interstitial**

- [src/components/CinematicPlayer.js](src/components/CinematicPlayer.js) plays the cinematic video with a minimum loader duration.

4) **Gift scene + gift UI**

- Gift parallax textures load on black, then crossfade into the gift scene.
- [src/ui/GiftOverlay.js](src/ui/GiftOverlay.js) presents the “Open Gift” UI.

5) **Open gift + reward moment**

- `gift_open.webm` plays inside the GiftOverlay.
- Confetti starts at the configured offset and persists until the gift-open video ends.
- A reward overlay shows the selected gift title/description (“You got <item>!”).

---

## Audio system

There are two audio layers:

### Ambient (Web Audio)

- [src/audio/Soundscape.js](src/audio/Soundscape.js) loads two looping buffers (room + fire).
- Starts only after Start and respects mute.

### SFX (HTMLAudio)

- [src/audio/SfxManager.js](src/audio/SfxManager.js) pre-warms small audio pools to reduce click-to-sound latency.
- Triggers:
	- `click.mp3`: plays on every UI `<button>` click (global event delegation)
	- `fanfare.mp3`: plays when `confetti_burst.webm` starts
	- `gift_lid_off.mp3`: plays at 2.25s into `gift_open.webm` with a 0.5s fade-in ramp

Mute behavior:

- The “Sound off” toggle mutes both the ambient soundscape and SFX.

---

## Data + reliability

### Supabase gifting

- The app can read from Supabase to pick a public gift.
- If the DB request fails, the UX falls back to a local gift list so the experience never hard-breaks.

### Wishes (offline-first)

The wish flow is designed to succeed under flaky networks and strict permissions:

- Wishes are submitted through an offline-capable queue (persisted in `localStorage`).
- A model step validates and sanitizes text before creating a DB payload.
- The DB write is attempted via a server-side Toolhouse Agent (recommended) and can fall back to a client-side insert if configured to allow it.

Local storage keys:

- `underthetree.pendingQueue` — offline queue
- `underthetree.anonUserId` — anonymous user identifier (no auth required)
- `underthetree.telemetry` — minimal telemetry buffer (no raw wish text)

---

## Toolhouse integration (accurate wiring)

This project uses Toolhouse in two ways:

1) **LLM operations (validation + payload generation)**

- Implemented in [src/model/modelClient.js](src/model/modelClient.js) + [src/model/providers.js](src/model/providers.js).
- In production, Toolhouse is called through a Vercel proxy so API keys never ship to the browser:
	- [api/toolhouse-chat.js](api/toolhouse-chat.js)

2) **Server-side DB writes via Toolhouse Agent**

- Wishes can be written using a Toolhouse Agent through:
	- [api/toolhouse-agent.js](api/toolhouse-agent.js)
	- [src/toolhouse/wishWriter.js](src/toolhouse/wishWriter.js)

Important note:

- If your Supabase RLS policies do not allow anonymous inserts/reads, you will not be able to reliably write/confirm wishes directly from the browser.
- The server-side agent path exists to support deployments where you want “no user auth” UX but still need controlled server-side writes.

---

## Debugging

Open with debug tools enabled:

`http://localhost:5173/?debug=true`

Includes:

- Performance/visual tuning panel (parallax/blur/post-processing)
- Wish flow monitor overlay (queue status + telemetry events)

---

## Assets (do not rename)

All content is driven by files under `public/assets`.

Audio:

- `audio/fire_cackle_loop.mp3`
- `audio/room_ambience_loop.mp3`
- `audio/click.mp3`
- `audio/fanfare.mp3`
- `audio/gift_lid_off.mp3`

Hero:

- `visuals/hero/color/hero_bg_2k.webp`
- `visuals/hero/color/hero_bg_4k.webp`
- `visuals/hero/depth/hero_depth_2k_16bit.png`
- `visuals/hero/depth/hero_depth_4k_16bit.png`

UI:

- `visuals/ui/glass_noise.jpg`

Gift scene:

- `visuals/gifts_scene/color/gifts_bg_2k.png`
- `visuals/gifts_scene/color/gifts_bg_4k.png`
- `visuals/gifts_scene/depth/gifts_depth_2k_16bit.png`
- `visuals/gifts_scene/depth/gifts_depth_4k_16bit.png`

Gift overlay:

- `visuals/gifts_scene/gift_overlay/gift_closed.png`
- `visuals/gifts_scene/gift_overlay/gift_open_static.png`
- `visuals/gifts_scene/gift_overlay/gift_open.webm`

Effects:

- `ui/effects/confetti_burst.webm`

Depth maps are treated as linear normalized depth in [0..1] (0 = near, 1 = far), as exported from Blender.

---

## Environment variables

Copy `.env.example` to `.env.local`.

Client (browser) variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_TELEMETRY_ENDPOINT` (optional)

Dev-only model options:

- `VITE_OLLAMA_URL` (optional; default uses the Vite proxy `/ollama`)
- `VITE_OLLAMA_MODEL` (optional)
- `VITE_TOOLHOUSE_URL` / `VITE_TOOLHOUSE_API_KEY` / `VITE_TOOLHOUSE_MODEL` (optional; dev-only direct Toolhouse calls)

Production (server-side on Vercel):

- `TOOLHOUSE_URL` / `TOOLHOUSE_API_KEY` / `TOOLHOUSE_MODEL` (for `/api/toolhouse-chat`)
- `TOOLHOUSE_AGENT_URL` / `TOOLHOUSE_AGENT_API_KEY` (for `/api/toolhouse-agent`)

---

## Deploy (GitHub + Vercel)

1) Push to GitHub

- Ensure `.env*` files are not committed.

2) Import into Vercel

- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`

This repo includes [vercel.json](vercel.json) to rewrite all routes to `index.html` (SPA behavior).

3) Configure environment variables

- Add values from `.env.example` into Vercel Project Settings → Environment Variables.

Important:

- Vercel cannot reach Ollama running on your laptop. For production, either use Toolhouse via `/api/toolhouse-chat` or host an Ollama-compatible endpoint.

---

## Supabase schema

SQL migration files live in:

- [supabase/migrations/001_init.sql](supabase/migrations/001_init.sql)

There is also a stub Edge Function intended for moderation workflows:

- [supabase/functions/moderate-wish/index.ts](supabase/functions/moderate-wish/index.ts)

---

## Roadmap / planned improvements

- Authenticated users (optional) for stronger RLS + cross-device persistence
- Server-side “confirm wish exists” endpoint for guaranteed write confirmation even under strict RLS
- Real moderation pipeline (Edge Function + review UI)
- Bundle splitting / perf work for the main JS chunk

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

