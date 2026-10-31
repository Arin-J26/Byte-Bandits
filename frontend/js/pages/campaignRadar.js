// Canvas radar + timeline for the Campaigns page, plus the "Replay spam wave" animation.
// rAF-driven, capped particle count, paused while the tab is hidden, static under reduced motion.

import { reducedMotion, on } from '../state.js';
import { colors, rgba } from '../theme.js';
import { binEvents, burstBins, timelineWindow } from '../lib/campaignStats.js';
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
  let binMs = 300_000;
  let binLabel = '5 min';
  let replay = null; // { dots, phase, t, label, resolve }

  const ms = (t) => Date.parse(t);
  // Leave room around the ring for project labels (up to ~14 monospace characters).
  const geo = () => ({ cx: w / 2, cy: (hgt - TIMELINE_H) / 2 + 4, R: Math.max(40, Math.min(w / 2 - 110, (hgt - TIMELINE_H) / 2 - 34)) });
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
    // Only the recent window: old records would otherwise stretch the timeline over months.
    const win = timelineWindow(evts.filter((e) => Number.isFinite(ms(e.timestamp))));
    events = win ? evts.filter((e) => ms(e.timestamp) >= win.start && ms(e.timestamp) <= win.end) : [];
    projects = [...new Set(events.map((e) => e.project).filter(Boolean))].slice(0, 24);
    bins = win ? binEvents(events, { binMinutes: win.binMinutes, start: win.start, end: win.end }) : [];
    binMs = (win?.binMinutes || 5) * 60_000;
    binLabel = win && win.binMinutes >= 60 ? `${win.binMinutes / 60} h` : `${win?.binMinutes || 5} min`;
    bursts = new Set(burstBins(bins, 2, 3));
    draw();
  }

  function isBurst(e) {
    if (!bins.length) return false;
    const i = Math.floor((ms(e.timestamp) - bins[0].start) / binMs);
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
    for (const p of projects) {
      const { x, y } = nodePos(p);
      ctx.fillStyle = C.node; ctx.strokeStyle = C.cyan; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    drawLabels(cx, cy, R);
    drawReplay(cx, cy);
    drawTimeline();
  }

  /**
   * Project labels placed radially outside the ring, aligned away from the centre, and pushed
   * further out when they would overlap a label already placed (greedy collision avoidance).
   */
  function drawLabels(cx, cy, R) {
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = C.text;
    const placed = [];
    const hit = (b) => placed.some((o) => b.x < o.x + o.w + 4 && b.x + b.w + 4 > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
    for (const p of projects) {
      const a = angleOf(p);
      const cos = Math.cos(a), sin = Math.sin(a);
      const text = p.length > 14 ? `${p.slice(0, 13)}…` : p;
      const tw = ctx.measureText(text).width, th = 13;
      const align = cos > 0.25 ? 'left' : cos < -0.25 ? 'right' : 'center';
      let box = null;
      for (let step = 0; step < 6; step++) {
        const r = R + 14 + step * 13;
        const ax = cx + cos * r, ay = cy + sin * r + (align === 'center' ? Math.sign(sin) * 4 : 0);
        const x0 = align === 'left' ? ax : align === 'right' ? ax - tw : ax - tw / 2;
        box = { x: x0, y: ay - th / 2, w: tw, h: th, ax, ay, step };
        if (!hit(box)) break;
      }
      placed.push(box);
      if (box.step) { // thin leader line when a label had to move out
        ctx.strokeStyle = rgba(C.rgb, 0.35); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx + cos * (R + 8), cy + sin * (R + 8)); ctx.lineTo(cx + cos * (R + 8 + box.step * 13), cy + sin * (R + 8 + box.step * 13)); ctx.stroke();
      }
      ctx.textAlign = align;
      ctx.fillText(text, box.ax, box.ay);
    }
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
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
    ctx.fillText(`PR / record events per ${binLabel} (last ${bins.length ? Math.round((bins.length * binMs) / 3600_000) || 1 : 0} h)`, 8, top - 2);
    if (!bins.length) return;
    const max = Math.max(...bins.map((b) => b.count), 1);
    const bw = (w - 16) / bins.length;
    bins.forEach((b, i) => {
      const bhh = (b.count / max) * bh;
      ctx.fillStyle = bursts.has(i) ? C.bad : rgba(C.rgb, 0.55);
      ctx.fillRect(8 + i * bw + 1, top + 6 + bh - bhh, Math.max(1, bw - 2), bhh);
    });
    // One "! burst" label per run of burst bins, over its tallest bar, never overlapping another label.
    ctx.fillStyle = C.bad;
    let lastRight = -Infinity;
    for (let i = 0; i < bins.length; i++) {
      if (!bursts.has(i) || bursts.has(i - 1)) continue;
      let peak = i;
      for (let j = i; bursts.has(j); j++) if (bins[j].count > bins[peak].count) peak = j;
      const label = `! burst · ${bins[peak].count}`;
      const lw = ctx.measureText(label).width;
      const x = Math.min(w - 8 - lw / 2, Math.max(8 + lw / 2, 8 + peak * bw + bw / 2));
      if (x - lw / 2 < lastRight + 8) continue;
      ctx.textAlign = 'center';
      ctx.fillText(label, x, top + 2 + bh - (bins[peak].count / max) * bh);
      lastRight = x + lw / 2;
    }
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
