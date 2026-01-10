// src/ui/GlassButton.js
// Reusable glass button primitives (pill + icon) with a11y-first defaults.

export function createGlassButton({
  className,
  label,
  ariaLabel,
  onClick,
  disabled = false,
  type = 'button'
}) {
  const btn = document.createElement('button');
  btn.type = type;
  btn.className = `utt-glass-btn ${className ?? ''}`.trim();
  btn.textContent = label ?? '';
  if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
  btn.disabled = Boolean(disabled);

  if (onClick) {
    btn.addEventListener('click', (e) => {
      if (btn.disabled) return;
      onClick(e);
    });
  }

  // Space/Enter are handled by <button> automatically; keep it simple.
  return btn;
}

export function createIconButton({
  iconText,
  ariaLabel,
  tooltip,
  onClick,
  pressed = false
}) {
  // Wrap to allow tooltip positioning.
  const wrap = document.createElement('div');
  wrap.className = 'utt-tooltip-wrap';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'utt-glass-btn utt-icon-btn';
  btn.setAttribute('aria-label', ariaLabel);
  btn.setAttribute('aria-pressed', String(Boolean(pressed)));
  btn.textContent = iconText;

  btn.addEventListener('click', (e) => {
    onClick?.(e);
  });

  const tip = document.createElement('div');
  tip.className = 'utt-tooltip';
  tip.textContent = tooltip ?? '';

  wrap.appendChild(btn);
  wrap.appendChild(tip);

  return { wrap, button: btn, tooltip: tip };
}
