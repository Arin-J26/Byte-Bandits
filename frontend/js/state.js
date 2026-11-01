// User preferences + a tiny event bus. Preferences persist in localStorage
// (wrapped in try/catch: storage can be blocked in private windows).

const KEY = 'sniffer.prefs.v1';
const listeners = new Map();

const defaults = { muted: false, volume: 0.25, quiet: false, welcomed: false, theme: 'light' };

function load() {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...defaults }; }
}

export const prefs = load();

export function setPref(key, value) {
  prefs[key] = value;
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
  emit('prefs', { key, value });
  if (key === 'quiet') applyMotionAttr();
}

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}

export function emit(event, payload) {
  for (const fn of listeners.get(event) || []) {
    try { fn(payload); } catch (e) { console.error(e); }
  }
}

const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/** True when the OS asks for reduced motion OR quiet mode is on. */
export function reducedMotion() {
  return Boolean(prefs.quiet || (mq && mq.matches));
}

export function applyMotionAttr() {
  document.documentElement.dataset.reducedMotion = String(reducedMotion());
  emit('motion', reducedMotion());
}
mq?.addEventListener?.('change', applyMotionAttr);

/** Trust options for local computation (mock mode / previews). */
export function trustOptions() {
  return { maxDepth: Number(prefs.maxDepth) || 3, decay: Number(prefs.decay) || 0.8 };
}
