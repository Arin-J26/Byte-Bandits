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
  // Nodes on the ring are projects when the events span 3+ projects, otherwise the accounts of one project.
  let mode = 'project';
  let hover = null;
  let onNode = null;
  const keyOf = (e) => (mode === 'account' ? e.handle : e.project);

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

  /** focus: a timestamp the 12-hour timeline should end shortly after (a campaign's last PR).
      first: node keys placed on the ring first (a campaign's accounts). */
  function setData(evts, { focus = null, first = [] } = {}) {
    const valid = evts.filter((e) => Number.isFinite(ms(e.timestamp)));
    mode = new Set(valid.map((e) => e.project)).size >= 3 ? 'project' : 'account';
    // Only a 12-hour window: old records would otherwise stretch the timeline over months.
    const end = focus ? focus + 90 * 60_000 : null;
    const win = focus ? { start: end - 12 * 3600_000, end, binMinutes: 15 } : timelineWindow(valid);
    events = win ? valid.filter((e) => ms(e.timestamp) >= win.start && ms(e.timestamp) <= win.end) : [];
    const counts = new Map();
    for (const e of events) counts.set(keyOf(e), (counts.get(keyOf(e)) || 0) + 1);
    const ranked = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
    projects = [...new Set([...first, ...ranked])].filter(Boolean).slice(0, 24);
    replay = null;
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
      const key = keyOf(e);
      if (!projects.includes(key)) continue;
      const a = angleOf(key);
      const f = 0.2 + 0.72 * ((ms(e.timestamp) - tMin) / Math.max(1, tMax - tMin));
      const burst = isBurst(e);
      ctx.fillStyle = e.kind === 'denounce' ? C.bad : e.kind === 'vouch' ? C.ok : burst ? C.bad : C.cyan;
      ctx.globalAlpha = (burst ? 0.95 : 0.6) * (hover && hover !== key ? 0.25 : 1);
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * R * f, cy + Math.sin(a) * R * f, burst ? 3.5 : 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // project nodes
    for (const p of projects) {
      const { x, y } = nodePos(p);
      const on = p === hover;
      ctx.fillStyle = on ? C.cyan : C.node; ctx.strokeStyle = C.cyan; ctx.lineWidth = on ? 3 : 2;
      ctx.beginPath(); ctx.arc(x, y, on ? 9 : 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    drawLabels(cx, cy, R);
    drawReplay(cx, cy);
    drawTooltip();
    drawTimeline();
  }

  /** Hover card for a node: its PRs in the window and how many fall in a burst. */
  function drawTooltip() {
    if (!hover) return;
    const mine = events.filter((e) => keyOf(e) === hover);
    const inBurst = mine.filter(isBurst).length;
    const lines = [hover, `${mine.length} PR${mine.length === 1 ? '' : 's'} in this window`, `${inBurst} in a burst`];
    if (onNode) lines.push(mode === 'account' ? 'click: open records' : 'click: open project');
    ctx.font = '11px ui-monospace, Menlo, monospace';
    const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16, bh = lines.length * 15 + 10;
    const n = nodePos(hover);
    const x = Math.min(w - bw - 4, Math.max(4, n.x + 14)), y = Math.min(hgt - TIMELINE_H - bh, Math.max(4, n.y - bh / 2));
    ctx.fillStyle = C.node; ctx.strokeStyle = C.cyan; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, bw, bh, 6) : ctx.rect(x, y, bw, bh); ctx.fill(); ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    lines.forEach((l, i) => { ctx.fillStyle = i === 0 ? C.text : i === 2 && inBurst ? C.bad : C.dim; ctx.fillText(l, x + 8, y + 6 + i * 15); });
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center';
  }

  function nodeAt(x, y) {
    for (const p of projects) { const n = nodePos(p); if (Math.hypot(n.x - x, n.y - y) < 13) return p; }
    return null;
  }
  function onMove(ev) {
    const r = canvas.getBoundingClientRect();
    const k = nodeAt(ev.clientX - r.left, ev.clientY - r.top);
    if (k === hover) return;
    hover = k;
    canvas.style.cursor = k && onNode ? 'pointer' : 'default';
    if (k) sound.tick();
    draw();
  }
  function onLeave() { if (hover) { hover = null; draw(); } }
  function onClick() { if (hover && onNode) onNode(hover, mode); }
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  canvas.addEventListener('click', onClick);

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
      d.trail.forEach(([tx, ty], i) => {
        ctx.fillStyle = replay.phase === 'flag' ? C.bad : C.warn;
        ctx.globalAlpha = (i + 1) / (d.trail.length + 1) * 0.35;
        ctx.beginPath(); ctx.arc(tx, ty, 2.5, 0, Math.PI * 2); ctx.fill();
      });
    }
    ctx.globalAlpha = 1;
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

  /* ----- replay -----
     Each PR of the campaign is a ball that leaves its project node and flies to the centre, one after another in
     time order. Each arrival pings. When every ball has arrived they gather into a ring and the campaign is flagged. */
  const FLIGHT_MS = 720;   // time one ball takes to fly to the centre
  const LAUNCH_MS = 150;   // gap between one ball leaving and the next
  function stepReplay(dt) {
    replay.t += dt;
    const { cx, cy } = geo();
    if (replay.phase === 'fly') {
      let arrived = 0;
      for (const d of replay.dots) {
        const k = Math.min(1, Math.max(0, (replay.t - d.delay) / FLIGHT_MS));
        const from = nodePos(d.project);
        const ease = k * k * (3 - 2 * k);
        d.x = from.x + (cx - from.x) * ease;
        d.y = from.y + (cy - from.y) * ease;
        if (k > 0 && k < 1) { d.trail.push([d.x, d.y]); if (d.trail.length > 7) d.trail.shift(); }
        if (k >= 1) {
          arrived++;
          if (!d.arrived) { d.arrived = true; sound.ping(520 + (arrived % 12) * 40); }
        } else if (k > 0 && !d.launched) {
          d.launched = true; sound.tick();
        }
      }
      if (arrived === replay.dots.length) { replay.phase = 'gather'; replay.t = 0; for (const d of replay.dots) { d.sx = d.x; d.sy = d.y; d.trail = []; } }
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

  /** Animate a campaign: its PRs fly in one by one from their projects, gather, and flag. */
  function playReplay(campaign, { onFlag } = {}) {
    const evts = [...(campaign.pr_events || [])].sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1)).slice(0, MAX_DOTS);
    for (const e of evts) if (!projects.includes(keyOf(e)) && projects.length < 24) projects.push(keyOf(e));
    const { cx, cy } = geo();
    const label = `${campaign.id} · ${campaign.size} accounts · ${campaign.window_minutes} min`;
    const dots = evts.filter((e) => projects.includes(keyOf(e)))
      .map((e, i) => ({ project: keyOf(e), x: cx, y: cy, delay: i * LAUNCH_MS, trail: [] }));
    if (reducedMotion() || document.hidden) {
      replay = { dots: dots.map((d, i) => ({ ...d, x: cx + Math.cos((i / dots.length) * 6.283) * 28, y: cy + Math.sin((i / dots.length) * 6.283) * 28, trail: [] })), phase: 'flag', t: 0, label };
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
    /** fn(key, mode) runs when a node is clicked; mode is 'account' or 'project'. */
    setOnNode(fn) { onNode = fn; },
    restart: start,
    destroy() {
      cancelAnimationFrame(raf); ro.disconnect();
      canvas.removeEventListener('mousemove', onMove); canvas.removeEventListener('mouseleave', onLeave); canvas.removeEventListener('click', onClick); offTheme(); document.removeEventListener('visibilitychange', start); },
  };
}
