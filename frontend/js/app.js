// App entry: router, header controls, keyboard shortcuts, live/mock badge.

import { h, clear, toast, errorBox } from './dom.js';
import { prefs, setPref, on, applyMotionAttr } from './state.js';
import { init as initApi, status, api, backendUp } from './api.js';
import * as sound from './sound.js';
import { startBackground } from './background.js';
import { applyTheme, toggleTheme, currentTheme } from './theme.js';
import { initTooltips, showBanner, hideBanner, openShortcuts, showWelcome } from './ui.js';
import { startDemo, isDemoRunning } from './demo.js';
import { openPalette, isPaletteOpen } from './palette.js';
import * as home from './pages/home.js';
import * as graph from './pages/graph.js';
import * as evaluate from './pages/evaluate.js';
import * as campaigns from './pages/campaigns.js';
import * as records from './pages/records.js';
import * as trust from './pages/trust.js';
import * as simulate from './pages/simulate.js';

const ROUTES = { home, graph, evaluate, campaigns, records, trust, simulate };
const TITLES = { home: 'Overview', graph: 'Graph', evaluate: 'Evaluate', campaigns: 'Campaigns', records: 'Records', trust: 'Trust', simulate: 'Simulate' };
const main = document.getElementById('main');
const progress = document.getElementById('route-progress');

const PALETTE_PAGES = [
  { id: 'home', key: 'h', icon: '⌂', label: 'Overview' }, { id: 'graph', key: 'g', icon: '◎', label: 'Graph' },
  { id: 'evaluate', key: 'e', icon: '⚖', label: 'Evaluate a contributor' }, { id: 'campaigns', key: 'c', icon: '⌖', label: 'Campaigns' },
  { id: 'records', key: 'r', icon: '☰', label: 'Records' }, { id: 'trust', key: 't', icon: '⇄', label: 'Trust settings' },
  { id: 'simulate', key: 's', icon: '⚙', label: 'Simulate a network' },
];

function showPalette() {
  openPalette({
    go,
    pages: PALETTE_PAGES,
    actions: [
      { icon: '▶', label: 'Start guided demo', run: () => startDemo({ go, pages: ROUTES }) },
      { icon: '◐', label: prefs.quiet ? 'Turn quiet mode off' : 'Turn quiet mode on', run: () => document.getElementById('quiet-btn').click() },
      { icon: '🔈', label: prefs.muted ? 'Unmute sound' : 'Mute sound', run: () => setPref('muted', !prefs.muted) },
      { icon: '★', label: 'Load demo network', run: async () => { await go('simulate'); simulate.loadDemoNetwork(); } },
      { icon: '☾', label: 'Toggle light / dark theme', run: toggleTheme },
      { icon: '?', label: 'Keyboard shortcuts', hint: '?', run: openShortcuts },
    ],
  });
}

/* ---------- router ---------- */
let rendered = null; // full hash last rendered, e.g. "#/evaluate?h=ada"
let cleanup = null;
let token = 0;
let renderPromise = Promise.resolve();

const parse = () => {
  const name = (location.hash.match(/^#\/(\w+)/) || [])[1];
  return ROUTES[name] ? name : 'home';
};

function render({ focus = false } = {}) {
  const name = parse();
  rendered = location.hash;
  const my = ++token;
  renderPromise = (async () => {
    try { cleanup?.(); } catch (e) { console.error(e); }
    cleanup = null;
    clear(main);
    progress.classList.add('loading');
    document.title = `${TITLES[name]} · Sniffer`;
    for (const a of document.querySelectorAll('.sidebar a')) {
      if (a.dataset.route === name) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    if (focus) main.focus({ preventScroll: true });
    if (status.mode === 'offline') { renderOffline(); return; }
    try {
      const fn = await ROUTES[name].mount(main);
      if (my !== token) fn?.(); // navigated away while loading
      else cleanup = fn || null;
    } catch (err) {
      console.error(err);
      if (my === token) clear(main, errorBox(`The ${TITLES[name]} page failed to load: ${err.message}`, () => render()));
    }
    if (my === token) progress.classList.remove('loading');
  })();
  return renderPromise;
}

/** Navigate and resolve once the page has mounted. Used by the guided demo. */
export function go(name) {
  if (parse() === name) return renderPromise;
  location.hash = `#/${name}`;
  return render({ focus: true });
}

window.addEventListener('hashchange', () => { if (location.hash !== rendered) render({ focus: true }); });

/* ---------- header controls ---------- */
function initHeader() {
  const mute = document.getElementById('mute-btn');
  const vol = document.getElementById('volume');
  const quiet = document.getElementById('quiet-btn');
  const themeBtn = document.getElementById('theme-btn');
  themeBtn.addEventListener('click', toggleTheme);
  const syncHeader = () => {
    const dark = currentTheme() === 'dark';
    themeBtn.firstElementChild.textContent = dark ? '☀' : '☾';
    themeBtn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    themeBtn.setAttribute('aria-pressed', String(dark));
    mute.setAttribute('aria-pressed', String(prefs.muted));
    mute.setAttribute('aria-label', prefs.muted ? 'Unmute sound' : 'Mute sound');
    mute.firstElementChild.textContent = prefs.muted || prefs.quiet ? '🔇' : '🔊';
    vol.value = String(prefs.volume);
    vol.disabled = prefs.quiet;
    quiet.setAttribute('aria-pressed', String(prefs.quiet));
    sound.syncVolume();
  };
  mute.addEventListener('click', () => setPref('muted', !prefs.muted));
  vol.addEventListener('input', () => { setPref('volume', Number(vol.value)); sound.tick(); });
  quiet.addEventListener('click', () => {
    setPref('quiet', !prefs.quiet);
    toast(prefs.quiet ? 'Quiet mode on: no sound, reduced motion.' : 'Quiet mode off.', 'cyan', 2200);
  });
  document.getElementById('help-btn').addEventListener('click', openShortcuts);
  document.getElementById('palette-btn').addEventListener('click', showPalette);
  document.getElementById('demo-btn').addEventListener('click', () => {
    if (status.mode === 'offline') { toast('Start the backend first: the demo runs on live data.', 'warn'); return; }
    startDemo({ go, pages: ROUTES });
  });
  on('prefs', syncHeader);
  syncHeader();
}

function renderBadge() {
  const badge = document.getElementById('mode-badge');
  const mode = status.mode === 'live' && !status.connected ? 'offline' : status.mode;
  badge.className = `badge badge-mode ${mode === 'live' ? 'live' : mode === 'offline' ? 'offline' : 'mock'}`;
  if (mode === 'live') {
    clear(badge, h('span', { 'aria-hidden': 'true' }, '●'), 'Live');
    badge.title = 'Connected to the Sniffer backend';
  } else if (mode === 'offline') {
    clear(badge, h('span', { 'aria-hidden': 'true' }, '✕'), status.mode === 'live' ? 'Reconnecting' : 'Offline');
    badge.title = 'The Sniffer backend is not reachable';
  } else {
    clear(badge, h('span', { 'aria-hidden': 'true' }, '◐'), 'Demo data');
    badge.title = 'Synthetic demo data in this browser (?mock=1): no backend, no Gemma';
  }
}

/** Header chip: is the local Gemma model ready in Ollama? Live mode only. */
async function renderAiBadge() {
  const chip = document.getElementById('ai-badge');
  if (status.mode !== 'live') { chip.hidden = true; return; }
  let hlt;
  try { hlt = await api.health(); } catch { hlt = null; }
  if (status.mode !== 'live') { chip.hidden = true; return; } // mode changed while waiting
  const ready = Boolean(hlt?.ollama_available);
  const running = hlt ? hlt.ollama_running !== false : false;
  chip.className = `badge badge-mode ${ready ? 'live' : 'mock'}`;
  const label = !hlt ? 'Gemma ?' : ready ? 'Gemma' : running ? 'Gemma not pulled' : 'Ollama off';
  clear(chip, h('span', { 'aria-hidden': 'true' }, ready ? '✦' : '!'), label);
  chip.title = ready ? `Local model ${hlt.model} via Ollama: writes summaries and campaign verdicts`
    : running ? `Ollama is running but ${hlt.model} is not installed. Run: ollama pull ${hlt.model}`
      : 'Ollama is not running. Start the Ollama app (or run: ollama serve). Until then summaries use templates.';
  chip.setAttribute('aria-label', chip.title);
  chip.hidden = false;
  if (hlt && !ready) showBanner(chip.title, { label: 'Check again', onClick: () => renderAiBadge() });
  else if (ready && document.getElementById('banner').dataset.kind === 'ai') hideBanner();
}

/** Full-page screen when the backend is not running at startup. Polls and reloads when it comes up. */
let offlinePoll = 0;
function renderOffline() {
  const cmd = (text) => h('pre', { class: 'code-block mono', tabindex: '0' }, text);
  clear(main, h('section', { class: 'page' }, h('div', { class: 'panel offline-panel' },
    h('p', { class: 'eyebrow' }, 'Backend not running'),
    h('h1', {}, 'Start Sniffer to continue'),
    h('p', { class: 'muted' }, 'Sniffer runs on its local backend with the Gemma model in Ollama. Start them from the repository root:'),
    h('ol', { class: 'stack offline-steps' },
      h('li', {}, 'Start Ollama (open the Ollama app, or run ', h('code', {}, 'ollama serve'), ') and pull the model once:', cmd('ollama pull gemma4:e2b')),
      h('li', {}, 'Start the backend, which also serves this page:', cmd('backend/.venv/bin/uvicorn app.main:app --app-dir backend --port 8000')),
      h('li', {}, 'Open ', h('code', {}, 'http://localhost:8000'), '. This page reconnects automatically.')),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-primary', type: 'button', on: { click: () => location.reload() } }, '↻ Retry now'),
      h('a', { class: 'btn btn-ghost', href: '?mock=1' }, 'Explore with demo data instead')))));
  clearInterval(offlinePoll);
  offlinePoll = setInterval(async () => { if (await backendUp()) location.reload(); }, 3000);
}

function onMode() {
  renderBadge();
  renderAiBadge();
  if (status.mode === 'mock') {
    showBanner('Demo data mode: synthetic data in this browser, no backend and no Gemma. Nothing is sent anywhere.', {
      label: 'Switch to live', onClick: () => { location.href = location.pathname + location.hash; },
    });
  }
}

function onConnection(ok) {
  renderBadge();
  if (ok) {
    hideBanner();
    toast('Reconnected to the Sniffer backend.', 'ok');
    renderAiBadge();
    render();
  } else {
    showBanner('Lost the connection to the Sniffer backend. Reconnecting automatically…', { label: 'Retry now', onClick: () => location.reload() });
  }
}

/* ---------- keyboard shortcuts ---------- */
function initKeys() {
  const map = { h: 'home', g: 'graph', e: 'evaluate', c: 'campaigns', r: 'records', t: 'trust', s: 'simulate' };
  let pendingG = 0;
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !isDemoRunning()) { e.preventDefault(); showPalette(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey || isDemoRunning() || isPaletteOpen()) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
    if (document.getElementById('overlay-root').firstChild) return;
    if (e.key === '?') { e.preventDefault(); openShortcuts(); return; }
    if (e.key === '/') {
      const search = main.querySelector('[data-search]');
      if (search) { e.preventDefault(); search.focus(); search.select?.(); }
      return;
    }
    if (pendingG && Date.now() - pendingG < 1200 && map[e.key]) {
      e.preventDefault();
      pendingG = 0;
      sound.tick();
      go(map[e.key]);
      return;
    }
    pendingG = e.key === 'g' ? Date.now() : 0;
  });
}

/* ---------- boot ---------- */
async function boot() {
  applyTheme();
  applyMotionAttr();
  startBackground(document.getElementById('bg-canvas'));
  initTooltips();
  initHeader();
  initKeys();
  on('mode', onMode);
  on('connection', onConnection);
  await initApi();
  onMode();
  setInterval(() => { if (!document.hidden) renderAiBadge(); }, 30_000);
  await render();
  if (status.mode !== 'offline') showWelcome(() => startDemo({ go, pages: ROUTES }));
}

boot().catch((err) => {
  console.error(err);
  clear(main, errorBox(`Sniffer failed to start: ${err.message}`, () => location.reload()));
});
