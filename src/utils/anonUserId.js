// src/utils/anonUserId.js
// Creates a stable per-device anonymous user id stored in localStorage.

function makeUuid() {
  try {
    return crypto.randomUUID();
  } catch {
    return `anon_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

export function getOrCreateAnonUserId() {
  const key = 'underthetree.anonUserId';
  let v = null;
  try {
    v = window.localStorage.getItem(key);
  } catch {
    // ignore
  }
  if (!v) {
    v = makeUuid();
    try {
      window.localStorage.setItem(key, v);
    } catch {
      // ignore
    }
  }
  return v;
}
