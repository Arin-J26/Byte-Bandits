// Mini trust graph for the Evaluate page, drawn on a canvas.
// Glowing pulses travel hop by hop along each explanation path, with a rising ping per hop.
// Under reduced motion the final state is drawn immediately and silently.

import { reducedMotion, on } from '../state.js';
import { colors, rgba } from '../theme.js';
import { viaList, fmtWeight } from '../lib/format.js';
import * as sound from '../sound.js';

/** Palette resolved from CSS tokens (see theme.js). */
function pal() {
  const k = colors();
  return { cyan: k.accent, ok: k.ok, bad: k.bad, warn: k.warn, dim: k.dim, text: k.text, bg: k.node, rgb: k.accentRgb, dark: k.dark };
}
const HOP_MS = 520;
const MAX_PULSES = 24;

/** Build node/edge layout from an evaluate response. */
export function buildScene({ result, perspective, recordsById, maxDepth, edgeWeights = null, decay = 0.8 }) {
  const nodes = new Map();
  const edges = new Map();
  const addNode = (id, col, extra = {}) => {
    if (!nodes.has(id)) nodes.set(id, { id, col, state: 'idle', ...extra });
    else Object.assign(nodes.get(id), extra);
    return nodes.get(id);
  };
  addNode(perspective, 0, { me: true, state: 'lit' });
  const hops = [];
  for (const p of result.path || []) {
    const via = viaList(p.via);
    const chain = via.length ? via : [perspective, p.project];
    if (chain[0] !== perspective) chain.unshift(perspective);
    if (chain[chain.length - 1] !== p.project) chain.push(p.project);
    const steps = [];
    let trust = 1;
    chain.forEach((id, i) => {
      addNode(id, Math.min(i, maxDepth));
      if (i === 0) return;
      const key = `${chain[i - 1]}>${id}`;
      // Effective trust at this hop: exact from known edges, else interpolate toward the final weight.
      const ew = edgeWeights?.get(key);
      if (i === chain.length - 1) trust = Number(p.weight);
      else if (ew != null) trust = trust * ew * decay;
      else trust *= Math.pow(Number(p.weight) || 0, 1 / (chain.length - 1));
      if (!edges.has(key)) edges.set(key, { from: chain[i - 1], to: id, label: fmtWeight(trust) });
      steps.push({ from: chain[i - 1], to: id, hop: i });
    });
    hops.push({ steps, issuer: p.project, effect: Number(p.effect), type: p.type || (Number(p.effect) < 0 ? 'denounce' : 'vouch') });
  }
  for (const ig of result.ignored || []) {
    const rec = recordsById.get(ig.record_id);
    if (!rec || nodes.has(rec.issuer)) continue;
    const beyond = /depth/i.test(ig.reason);
    addNode(rec.issuer, maxDepth + 1, { state: 'ignored', reason: beyond ? 'beyond depth' : 'not trusted' });
  }
  return { nodes, edges: [...edges.values()], hops, maxDepth };
}

export function createEvalGraph(canvas) {
  const ctx = canvas.getContext('2d');
  let scene = null;
  let pulses = [];
  let queue = [];
  let raf = 0;
  let last = 0;
  let w = 0, hgt = 0;
  let onDone = null;

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.clientWidth || 600;
    hgt = canvas.clientHeight || 300;
    canvas.width = w * dpr; canvas.height = hgt * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (scene) place();
    draw();
  }

  function place() {
    const cols = scene.maxDepth + 2;
    // Leave room on both sides for centred labels like "ignored: beyond depth".
    const pad = Math.min(80, w / 8);
    const colW = (w - pad * 2) / (cols - 1);
    const byCol = new Map();
    for (const n of scene.nodes.values()) {
      if (!byCol.has(n.col)) byCol.set(n.col, []);
      byCol.get(n.col).push(n);
    }
    for (const [col, list] of byCol) {
      list.forEach((n, i) => { n.x = pad + col * colW; n.y = 10 + ((i + 1) * (hgt - 30)) / (list.length + 1); });
    }
    scene.cutX = pad + (scene.maxDepth + 0.5) * colW;
  }

  function draw() {
    ctx.clearRect(0, 0, w, hgt);
    if (!scene) return;
    const C = pal();
    // depth-limit cutoff
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = C.warn;
    ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.moveTo(scene.cutX, 18); ctx.lineTo(scene.cutX, hgt - 8); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = C.warn;
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`! depth limit (${scene.maxDepth})`, scene.cutX, 12);
    // edges
    for (const e of scene.edges) {
      const a = scene.nodes.get(e.from), b = scene.nodes.get(e.to);
      ctx.strokeStyle = rgba(C.rgb, 0.45);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.fillStyle = C.cyan;
      ctx.fillText(e.label, (a.x + b.x) / 2, (a.y + b.y) / 2 - 6);
    }
    // pulses
    for (const p of pulses) {
      const a = scene.nodes.get(p.from), b = scene.nodes.get(p.to);
      const x = a.x + (b.x - a.x) * p.t, y = a.y + (b.y - a.y) * p.t;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 14);
      g.addColorStop(0, C.dark ? 'rgba(180,250,255,1)' : rgba(C.rgb, 1));
      g.addColorStop(0.4, rgba(C.rgb, 0.6));
      g.addColorStop(1, rgba(C.rgb, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill();
    }
    // nodes
    for (const n of scene.nodes.values()) {
      const color = n.state === 'ignored' ? C.dim : n.state === 'vouch' ? C.ok : n.state === 'denounce' ? C.bad : C.cyan;
      ctx.globalAlpha = n.state === 'idle' ? 0.45 : 1;
      if (n.state !== 'ignored' && n.state !== 'idle') { ctx.shadowColor = color; ctx.shadowBlur = 14; }
      ctx.fillStyle = n.me ? color : C.bg;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.setLineDash(n.state === 'ignored' ? [3, 3] : []);
      ctx.beginPath(); ctx.arc(n.x, n.y, n.me ? 12 : 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0; ctx.setLineDash([]);
      // icon inside node so colour is not the only signal
      const icon = n.state === 'vouch' ? '✓' : n.state === 'denounce' ? '✕' : n.state === 'ignored' ? '–' : '';
      if (icon) { ctx.fillStyle = color; ctx.font = 'bold 11px system-ui'; ctx.fillText(icon, n.x, n.y + 4); }
      ctx.font = '11px ui-monospace, Menlo, monospace';
      ctx.fillStyle = n.state === 'ignored' ? C.dim : C.text;
      ctx.fillText(n.id.length > 16 ? `${n.id.slice(0, 15)}…` : n.id, n.x, n.y + 26);
      if (n.state === 'ignored') ctx.fillText(`ignored: ${n.reason}`, n.x, n.y + 39);
      ctx.globalAlpha = 1;
    }
  }

  function settle(hop) {
    const node = scene.nodes.get(hop.issuer);
    node.state = hop.type === 'denounce' ? 'denounce' : 'vouch';
  }

  function frame(ts) {
    const dt = Math.min(50, ts - (last || ts));
    last = ts;
    for (const p of pulses) {
      p.t += dt / p.ms;
      if (p.t >= 1 && !p.arrived) {
        p.arrived = true;
        scene.nodes.get(p.to).state = scene.nodes.get(p.to).state === 'idle' ? 'lit' : scene.nodes.get(p.to).state;
        if (!p.silent) sound.ping(440 * Math.pow(1.26, p.hop));
        p.next?.();
      }
    }
    pulses = pulses.filter((p) => p.t < 1);
    draw();
    if (pulses.length || queue.length) raf = requestAnimationFrame(frame);
    else { raf = 0; onDone?.(); onDone = null; }
  }

  /** Animate each explanation path one after another. Resolves when finished. */
  function play({ fast = false } = {}) {
    cancelAnimationFrame(raf);
    pulses = [];
    queue = scene.hops.slice();
    if (reducedMotion() || document.hidden) {
      for (const hop of scene.hops) {
        for (const s of hop.steps) { const n = scene.nodes.get(s.to); if (n.state === 'idle') n.state = 'lit'; }
        settle(hop);
      }
      queue = [];
      draw();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      onDone = resolve;
      const startHop = () => {
        const hop = queue.shift();
        if (!hop) return;
        const run = (i) => {
          const s = hop.steps[i];
          if (!s) { settle(hop); startHop(); return; }
          if (pulses.length >= MAX_PULSES) pulses.shift();
          pulses.push({ ...s, t: 0, ms: fast ? HOP_MS / 2.5 : HOP_MS, silent: fast, next: () => run(i + 1) });
        };
        run(0);
      };
      startHop();
      last = 0;
      raf = requestAnimationFrame(frame);
    });
  }

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  const offTheme = on('theme', () => draw());
  resize();

  return {
    show(newScene) { scene = newScene; place(); draw(); },
    play,
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); offTheme(); },
  };
}
