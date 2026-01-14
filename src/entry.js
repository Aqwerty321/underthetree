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

	const w = Math.max(320, window.innerWidth || REF_W);
	const h = Math.max(320, window.innerHeight || REF_H);

	const scale = Math.min(w / REF_W, h / REF_H);
	const clamped = clamp(scale, 0.75, 1);

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
