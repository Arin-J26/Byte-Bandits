// Canvas radar + timeline for the Campaigns page, plus the "Replay spam wave" animation.
// rAF-driven, capped particle count, paused while the tab is hidden, static under reduced motion.

import { reducedMotion, on } from '../state.js';
import { colors, rgba } from '../theme.js';
import { binEvents, burstBins } from '../lib/campaignStats.js';
import * as sound from '../sound.js';

let C = {};
/** Refresh the palette from CSS tokens (see theme.js). */
function pal() {
  const k = colors();
  C = { cyan: k.accent, ok: k.ok, bad: k.bad, warn: k.warn, dim: k.dim, text: k.text, node: k.node, rgb: k.accentRgb };
}
const MAX_DOTS = 60;
const TIMELINE_H = 70;

export function createRadar(canvas) {
  const ctx = canvas.getContext('2d');
  let w = 0, hgt = 0, raf = 0, sweep = 0, last = 0;
  let events = [];
  let projects = [];
  let bins = [];
  let bursts = new Set();
  let replay = null; // { dots, phase, t, label, resolve }

  const ms = (t) => Date.parse(t);
  const geo = () => ({ cx: w / 2, cy: (hgt - TIMELINE_H) / 2 + 4, R: Math.max(40, Math.min(w / 2 - 70, (hgt - TIMELINE_H) / 2 - 26)) });
  const angleOf = (pid) => (projects.indexOf(pid) / Math.max(1, projects.length)) * Math.PI * 2 - Math.PI / 2;
  const nodePos = (pid) => { const { cx, cy, R } = geo(); const a = angleOf(pid); return { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R }; };

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.clientWidth || 600; hgt = canvas.clientHeight || 380;
    canvas.width = w * dpr; canvas.height = hgt * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function setData(evts) {
    events = evts.filter((e) => Number.isFinite(ms(e.timestamp)));
    projects = [...new Set(events.map((e) => e.project).filter(Boolean))].slice(0, 24);
    bins = binEvents(events, { binMinutes: 5 });
    bursts = new Set(burstBins(bins, 2));
    draw();
  }

  function isBurst(e) {
    if (!bins.length) return false;
    const i = Math.floor((ms(e.timestamp) - bins[0].start) / 300_000);
    return bursts.has(i);
  }

  function draw() {
    pal();
    ctx.clearRect(0, 0, w, hgt);
    const { cx, cy, R } = geo();
    // rings
    ctx.strokeStyle = rgba(C.rgb, 0.18);
    ctx.lineWidth = 1;
    for (const k of [0.33, 0.66, 1]) { ctx.beginPath(); ctx.arc(cx, cy, R * k, 0, Math.PI * 2); ctx.stroke(); }
    // sweep
    if (!reducedMotion()) {
      const g = ctx.createConicGradient ? ctx.createConicGradient(sweep - 0.6, cx, cy) : null;
      if (g) {
        g.addColorStop(0, rgba(C.rgb, 0));
        g.addColorStop(0.09, rgba(C.rgb, 0.16));
        g.addColorStop(0.1, rgba(C.rgb, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      }
    }
    // events as dots between centre (old) and project node (new)
    const tMin = events.length ? Math.min(...events.map((e) => ms(e.timestamp))) : 0;
    const tMax = events.length ? Math.max(...events.map((e) => ms(e.timestamp))) : 1;
    for (const e of events.slice(0, 200)) {
      const a = angleOf(e.project);
      if (!projects.includes(e.project)) continue;
      const f = 0.2 + 0.72 * ((ms(e.timestamp) - tMin) / Math.max(1, tMax - tMin));
      const burst = isBurst(e);
      ctx.fillStyle = e.kind === 'denounce' ? C.bad : e.kind === 'vouch' ? C.ok : burst ? C.bad : C.cyan;
      ctx.globalAlpha = burst ? 0.95 : 0.6;
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * R * f, cy + Math.sin(a) * R * f, burst ? 3.5 : 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // project nodes
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    for (const p of projects) {
      const { x, y } = nodePos(p);
      ctx.fillStyle = C.node; ctx.strokeStyle = C.cyan; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.text;
      const a = angleOf(p);
      ctx.fillText(p.length > 14 ? `${p.slice(0, 13)}…` : p, x + Math.cos(a) * 26, y + Math.sin(a) * 18 + 3);
    }
    drawReplay(cx, cy);
    drawTimeline();
  }

  function drawReplay(cx, cy) {
    if (!replay) return;
    for (const d of replay.dots) {
      ctx.fillStyle = replay.phase === 'flag' ? C.bad : C.warn;
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(d.x, d.y, 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;
    if (replay.phase === 'flag') {
      ctx.strokeStyle = C.bad; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, 44, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = C.bad;
      ctx.font = 'bold 13px ui-monospace, Menlo, monospace';
      ctx.fillText('✕ CAMPAIGN FLAGGED', cx, cy - 54);
      ctx.font = '11px ui-monospace, Menlo, monospace';
      ctx.fillText(replay.label, cx, cy + 62);
    }
  }

  function drawTimeline() {
    const top = hgt - TIMELINE_H + 10, bh = TIMELINE_H - 28;
    ctx.fillStyle = C.dim; ctx.textAlign = 'left'; ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.fillText('PR / record events per 5 min', 8, top - 2);
    if (!bins.length) return;
    const max = Math.max(...bins.map((b) => b.count), 1);
    const bw = (w - 16) / bins.length;
    bins.forEach((b, i) => {
      const bhh = (b.count / max) * bh;
      const burst = bursts.has(i);
      ctx.fillStyle = burst ? C.bad : rgba(C.rgb, 0.55);
      ctx.fillRect(8 + i * bw + 1, top + 6 + bh - bhh, Math.max(1, bw - 2), bhh);
      if (burst && !bursts.has(i - 1)) { ctx.fillStyle = C.bad; ctx.textAlign = 'center'; ctx.fillText('! burst', 8 + i * bw + bw / 2, top + 4 + bh - bhh); }
    });
  }

  function loop(ts) {
    const dt = Math.min(50, ts - (last || ts));
    last = ts;
    sweep = (sweep + dt * 0.0012) % (Math.PI * 2);
    if (replay) stepReplay(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }

  function start() {
    cancelAnimationFrame(raf);
    last = 0;
    if (document.hidden || reducedMotion()) { draw(); return; }
    raf = requestAnimationFrame(loop);
  }

  /* ----- replay ----- */
  function stepReplay(dt) {
    replay.t += dt;
    const { cx, cy } = geo();
    if (replay.phase === 'fly') {
      let arrived = 0;
      for (const d of replay.dots) {
        const k = Math.min(1, Math.max(0, (replay.t - d.delay) / 600));
        if (k > 0 && !d.ticked) { d.ticked = true; sound.tick(); }
        const target = nodePos(d.project);
        d.x = d.sx + (target.x - d.sx) * k; d.y = d.sy + (target.y - d.sy) * k;
        if (k >= 1) arrived++;
      }
      if (arrived === replay.dots.length) { replay.phase = 'gather'; replay.t = 0; for (const d of replay.dots) { d.sx = d.x; d.sy = d.y; } }
    } else if (replay.phase === 'gather') {
      const k = Math.min(1, replay.t / 900);
      const e = 1 - Math.pow(1 - k, 3);
      replay.dots.forEach((d, i) => {
        const a = (i / replay.dots.length) * Math.PI * 2;
        d.x = d.sx + (cx + Math.cos(a) * 28 - d.sx) * e; d.y = d.sy + (cy + Math.sin(a) * 28 - d.sy) * e;
      });
      if (k >= 1) { replay.phase = 'flag'; replay.t = 0; sound.alarm(); replay.onFlag?.(); }
    } else if (replay.phase === 'flag' && replay.t > 1600) {
      const r = replay.resolve;
      replay.resolve = null;
      r?.();
    }
  }

  /** Animate a campaign's PR events flying to project nodes, clustering, and flagging. */
  function playReplay(campaign, { onFlag } = {}) {
    const evts = (campaign.pr_events || []).slice(0, MAX_DOTS);
    for (const e of evts) if (!projects.includes(e.project) && projects.length < 24) projects.push(e.project);
    const { cx, cy } = geo();
    const label = `${campaign.id} · ${campaign.size} accounts · ${campaign.window_minutes} min`;
    const dots = evts.map((e, i) => {
      const a = Math.random() * Math.PI * 2;
      return { project: e.project, sx: cx + Math.cos(a) * 12, sy: cy + Math.sin(a) * 12, x: cx, y: cy, delay: i * 140 };
    });
    if (reducedMotion() || document.hidden) {
      replay = { dots: dots.map((d, i) => ({ ...d, x: cx + Math.cos((i / dots.length) * 6.283) * 28, y: cy + Math.sin((i / dots.length) * 6.283) * 28 })), phase: 'flag', t: 0, label };
      draw();
      onFlag?.();
      sound.alarm();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      replay = { dots, phase: 'fly', t: 0, label, resolve, onFlag };
      sound.whoosh();
    });
  }

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  document.addEventListener('visibilitychange', start);
  const offTheme = on('theme', draw);
  resize();
  start();

  return {
    setData,
    playReplay,
    restart: start,
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); offTheme(); document.removeEventListener('visibilitychange', start); },
  };
}
