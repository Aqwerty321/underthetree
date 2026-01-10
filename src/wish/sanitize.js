// src/wish/sanitize.js

export function stripControlChars(text) {
  return String(text ?? '').replace(/[\u0000-\u001F\u007F]/g, '');
}

export function sanitizeWishText(text, { maxLen = 250 } = {}) {
  const cleaned = stripControlChars(text).trim();
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}
