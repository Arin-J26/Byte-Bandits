// Animated background, themed from CSS tokens: paper dot-grid with soft colour washes (light)
// or the neon grid (dark), plus a drifting constellation whose links brighten near the cursor.
// rAF only, capped particle count, paused while hidden, one static frame under reduced motion.

import { reducedMotion, on } from './state.js';
import { colors, rgba } from './theme.js';

const MAX_NODES = 60;
const LINK_DIST = 140;

export function startBackground(canvas) {
  const c = canvas.getContext('2d');
  let w = 0, h = 0, raf = 0, t = 0;
  let nodes = [];
  const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999 };

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.min(MAX_NODES, Math.floor((w * h) / 24000));
    nodes = Array.from({ length: count }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.16, vy: (Math.random() - 0.5) * 0.16,
      r: 0.9 + Math.random() * 1.6, alt: Math.random() < 0.25, ph: Math.random() * 6.28,
    }));
    draw();
  }

  function wash(x, y, r, rgb, a) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(rgb, a));
    g.addColorStop(1, rgba(rgb, 0));
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }

  function draw() {
    const k = colors();
    const strength = k.dark ? 1 : 0.75;
    c.fillStyle = k.bg;
    c.fillRect(0, 0, w, h);
    const big = Math.max(w, h);
    wash(w * (0.78 + 0.04 * Math.sin(t * 0.06)), h * 0.08, big * 0.55, k.accentRgb, (k.dark ? 0.07 : 0.07));
    wash(w * (0.1 + 0.04 * Math.cos(t * 0.05)), h * 0.9, big * 0.5, k.accent2Rgb, (k.dark ? 0.07 : 0.05));
    // grid: dots on paper, lines in the dark theme
    c.fillStyle = k.grid; c.strokeStyle = k.grid; c.lineWidth = 1;
    const gap = k.dark ? 56 : 26;
    if (k.dark) {
      c.beginPath();
      for (let x = 0.5; x < w; x += gap) { c.moveTo(x, 0); c.lineTo(x, h); }
      for (let y = 0.5; y < h; y += gap) { c.moveTo(0, y); c.lineTo(w, y); }
      c.stroke();
    } else {
      for (let x = gap / 2; x < w; x += gap) for (let y = gap / 2; y < h; y += gap) c.fillRect(x, y, 1.2, 1.2);
    }
    // constellation links
    c.lineWidth = 1;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > LINK_DIST * LINK_DIST) continue;
        const near = Math.hypot((a.x + b.x) / 2 - mouse.x, (a.y + b.y) / 2 - mouse.y) < 180 ? 2.4 : 1;
        c.strokeStyle = rgba(k.accentRgb, ((1 - Math.sqrt(d2) / LINK_DIST) * 0.13 * near * strength).toFixed(3));
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      }
    }
    for (const n of nodes) {
      const tw = (0.35 + 0.3 * Math.sin(n.ph + t * 1.4)) * (k.dark ? 1.3 : 0.9);
      c.fillStyle = rgba(n.alt ? k.accent2Rgb : k.accentRgb, tw.toFixed(3));
      c.beginPath(); c.arc(n.x, n.y, n.r, 0, Math.PI * 2); c.fill();
    }
    if (mouse.x > -999) wash(mouse.x, mouse.y, 240, k.accentRgb, k.dark ? 0.06 : 0.05);
  }

  function frame() {
    t += 1 / 60;
    mouse.x += (mouse.tx - mouse.x) * 0.12;
    mouse.y += (mouse.ty - mouse.y) * 0.12;
    for (const n of nodes) {
      const dx = n.x - mouse.x, dy = n.y - mouse.y;
      const d = Math.hypot(dx, dy);
      if (d < 120 && d > 0.1) { n.vx += (dx / d) * 0.02; n.vy += (dy / d) * 0.02; }
      n.vx *= 0.995; n.vy *= 0.995;
      n.x += n.vx; n.y += n.vy;
      if (n.x < -10) n.x = w + 10; else if (n.x > w + 10) n.x = -10;
      if (n.y < -10) n.y = h + 10; else if (n.y > h + 10) n.y = -10;
    }
    draw();
    raf = requestAnimationFrame(frame);
  }

  function start() {
    cancelAnimationFrame(raf);
    if (document.hidden || reducedMotion()) { draw(); return; }
    raf = requestAnimationFrame(frame);
  }

  window.addEventListener('pointermove', (e) => {
    mouse.tx = e.clientX; mouse.ty = e.clientY;
    if (mouse.x < -999) { mouse.x = e.clientX; mouse.y = e.clientY; }
  }, { passive: true });
  document.addEventListener('pointerleave', () => { mouse.tx = mouse.ty = -9999; mouse.x = mouse.y = -9999; });
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', start);
  on('motion', start);
  on('theme', draw);
  resize();
  start();
}
