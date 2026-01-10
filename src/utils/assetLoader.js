// src/utils/assetLoader.js
// Promise-based asset loader with progress.
// We load:
// - chosen hero color (2k/4k)
// - matching depth
// - glass noise
// - audio arraybuffers (decode happens later on gesture)

import { TextureLoader } from 'three';

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

async function fetchArrayBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch: ${url} (${res.status})`);
  return await res.arrayBuffer();
}

export function loadManifest(config) {
  const textureLoader = new TextureLoader();

  return {
    async load({ onProgress } = {}) {
      const use4k = config.shouldUse4k();

      const colorUrl = use4k ? config.assets.hero.color4k : config.assets.hero.color2k;
      const depthUrl = use4k ? config.assets.hero.depth4k : config.assets.hero.depth2k;
      const noiseUrl = config.assets.ui.glassNoise;

      const tasks = [
        { key: 'tex:color', run: () => textureLoader.loadAsync(colorUrl) },
        { key: 'tex:depth', run: () => textureLoader.loadAsync(depthUrl) },
        { key: 'tex:noise', run: () => textureLoader.loadAsync(noiseUrl) },
        { key: 'audio:room', run: () => fetchArrayBuffer(config.assets.audio.room) },
        { key: 'audio:fire', run: () => fetchArrayBuffer(config.assets.audio.fire) }
      ];

      let done = 0;
      const total = tasks.length;
      const bump = () => {
        done += 1;
        onProgress?.(clamp01(done / total));
      };

      onProgress?.(0);

      const [tColor, tDepth, tNoise, roomArrayBuffer, fireArrayBuffer] = await Promise.all(
        tasks.map(async (t) => {
          try {
            const v = await t.run();
            bump();
            return v;
          } catch (e) {
            // Bump so the UI doesn't hang at some percentage.
            bump();
            throw e;
          }
        })
      );

      return {
        meta: {
          use4k,
          colorUrl,
          depthUrl
        },
        textures: {
          color: tColor,
          depth: tDepth,
          noise: tNoise
        },
        audio: {
          roomArrayBuffer,
          fireArrayBuffer
        }
      };
    }
  };
}

export async function loadGiftSceneTextures(config, { onProgress } = {}) {
  const textureLoader = new TextureLoader();
  const use4k = config.shouldUse4k();

  const colorUrl = use4k ? config.assets.giftScene.color4k : config.assets.giftScene.color2k;
  const depthUrl = use4k ? config.assets.giftScene.depth4k : config.assets.giftScene.depth2k;

  const tasks = [
    { key: 'tex:gifts:color', run: () => textureLoader.loadAsync(colorUrl) },
    { key: 'tex:gifts:depth', run: () => textureLoader.loadAsync(depthUrl) }
  ];

  let done = 0;
  const total = tasks.length;
  const bump = () => {
    done += 1;
    onProgress?.(clamp01(done / total));
  };

  onProgress?.(0);

  const [tColor, tDepth] = await Promise.all(
    tasks.map(async (t) => {
      try {
        const v = await t.run();
        bump();
        return v;
      } catch (e) {
        bump();
        throw e;
      }
    })
  );

  return {
    meta: { use4k, colorUrl, depthUrl },
    textures: { color: tColor, depth: tDepth }
  };
}
