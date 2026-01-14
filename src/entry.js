import './style.css';
import './styles/hero-ui.css';

import { mountLanding } from './pages/Landing.js';

function clamp(n, min, max) {
	return Math.max(min, Math.min(max, n));
}

function applyUiScale() {
	// Reference viewport: the experience is tuned for 2560x1600 (16:10).
	// We scale UI down on smaller screens so 1080p doesn't feel "chonky".
	const REF_W = 2560;
	const REF_H = 1600;
	const REF_ASPECT = REF_W / REF_H; // 1.6

	const w = Math.max(320, window.innerWidth || REF_W);
	const h = Math.max(320, window.innerHeight || REF_H);

	// Aspect correction: treat wider-than-16:10 viewports as if they were 16:10
	// for the purpose of UI sizing (e.g. 1920x1080 behaves like 1728x1080).
	const effectiveW = Math.min(w, h * REF_ASPECT);

	const scale = Math.min(effectiveW / REF_W, h / REF_H);
	const clamped = clamp(scale, 0.6, 1);

	document.documentElement.style.setProperty('--utt-ui-scale', clamped.toFixed(4));
}

applyUiScale();

let resizeTimer = null;
window.addEventListener('resize', () => {
	if (resizeTimer) window.clearTimeout(resizeTimer);
	resizeTimer = window.setTimeout(() => {
		resizeTimer = null;
		applyUiScale();
	}, 120);
});

mountLanding();