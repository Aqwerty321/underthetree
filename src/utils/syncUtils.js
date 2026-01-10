// src/utils/syncUtils.js
// Helpers for synchronizing media playback against real video time.

function nowMs() {
  return performance.now();
}

export function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function withTimeout(promise, timeoutMs, message = 'Timed out') {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(t);
        reject(e);
      });
  });
}

export function canUseRVFC(videoEl) {
  return Boolean(videoEl && typeof videoEl.requestVideoFrameCallback === 'function');
}

// Wait until video.currentTime >= targetSec (within tolerance).
// Uses requestVideoFrameCallback when available; falls back to 16ms polling.
export function waitForVideoTime(videoEl, targetSec, { toleranceSec = 1 / 60, timeoutMs = 8000 } = {}) {
  const start = nowMs();

  return new Promise((resolve, reject) => {
    const done = () => resolve();

    const check = () => {
      if (!videoEl) {
        reject(new Error('Missing video element'));
        return true;
      }
      const t = videoEl.currentTime || 0;
      if (t + toleranceSec >= targetSec) {
        done();
        return true;
      }
      if (nowMs() - start > timeoutMs) {
        reject(new Error(`waitForVideoTime timeout at ${t.toFixed(3)}s (target ${targetSec}s)`));
        return true;
      }
      return false;
    };

    if (check()) return;

    if (canUseRVFC(videoEl)) {
      const step = () => {
        if (check()) return;
        videoEl.requestVideoFrameCallback(step);
      };
      videoEl.requestVideoFrameCallback(step);
      return;
    }

    const id = setInterval(() => {
      if (check()) clearInterval(id);
    }, 16);
  });
}
