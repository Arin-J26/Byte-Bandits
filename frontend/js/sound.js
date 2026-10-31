// Web Audio synthesis only: no audio files. The AudioContext is created on the
// first user gesture (browsers block autoplay). Mute/volume persist via state.js.

import { prefs } from './state.js';

let ctx = null;
let master = null;

function unlock() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.connect(ctx.destination);
  syncVolume();
}
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, unlock, { once: true, capture: true });

export function syncVolume() {
  if (!master) return;
  const v = prefs.muted || prefs.quiet ? 0 : Math.min(1, Math.max(0, Number(prefs.volume) || 0));
  master.gain.setTargetAtTime(v * 0.6, ctx.currentTime, 0.02);
}

function ready() {
  if (!ctx || prefs.muted || prefs.quiet) return false;
  if (ctx.state === 'suspended') ctx.resume();
  return true;
}

/** One enveloped oscillator note. */
function tone({ freq = 440, to = null, type = 'sine', start = 0, dur = 0.15, gain = 0.3 }) {
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export function tick() { if (ready()) tone({ freq: 1800, type: 'square', dur: 0.03, gain: 0.05 }); }

export function whoosh() {
  if (!ready()) return;
  const len = Math.floor(ctx.sampleRate * 0.35);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const g = ctx.createGain();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(400, ctx.currentTime);
  filter.frequency.exponentialRampToValueAtTime(2400, ctx.currentTime + 0.3);
  g.gain.value = 0.18;
  src.buffer = buf;
  src.connect(filter).connect(g).connect(master);
  src.start();
}

export function ping(freq = 660) { if (ready()) tone({ freq, type: 'sine', dur: 0.22, gain: 0.18 }); }

/** Rising two-note chime. */
export function allow() {
  if (!ready()) return;
  tone({ freq: 660, dur: 0.18, gain: 0.22 });
  tone({ freq: 990, start: 0.12, dur: 0.32, gain: 0.22 });
}

/** Soft single tone. */
export function review() { if (ready()) tone({ freq: 520, type: 'triangle', dur: 0.4, gain: 0.16 }); }

/** Low buzz + descending sweep. */
export function flag() {
  if (!ready()) return;
  tone({ freq: 110, type: 'sawtooth', dur: 0.35, gain: 0.12 });
  tone({ freq: 700, to: 140, type: 'square', start: 0.08, dur: 0.45, gain: 0.07 });
}

export function alarm() {
  if (!ready()) return;
  for (let i = 0; i < 3; i++) tone({ freq: 880, to: 440, type: 'square', start: i * 0.28, dur: 0.24, gain: 0.07 });
}

export function playDecision(key) {
  ({ allow, review, flag }[key] || review)();
}
