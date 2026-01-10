// src/utils/telemetry.js
// Privacy-safe minimal telemetry emitter.

const STORAGE_KEY = 'underthetree.telemetry';

function nowIso() {
  return new Date().toISOString();
}

function safeString(v, maxLen = 120) {
  const s = String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function loadEvents() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveEvents(events) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-200)));
  } catch {
    // ignore
  }
}

export class Telemetry {
  constructor({ endpoint } = {}) {
    this.endpoint = endpoint || null;
  }

  emit(event, props = {}) {
    // Never include raw wishes; callers must pass metadata only.
    const payload = {
      ts: nowIso(),
      event: safeString(event, 64),
      props: {
        ...props
      }
    };

    const events = loadEvents();
    events.push(payload);
    saveEvents(events);

    if (!this.endpoint) return;

    try {
      const body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(this.endpoint, body);
        return;
      }
      fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true
      }).catch(() => {});
    } catch {
      // ignore
    }
  }

  peek() {
    return loadEvents();
  }
}

export const telemetryStorageKey = STORAGE_KEY;
