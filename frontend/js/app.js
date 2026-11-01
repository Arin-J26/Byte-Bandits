// App entry: sign-in gate, router, header, and the project tabs.
// Routes: #/login, #/dashboard, #/p/<project>/<tab>. Project tabs exist only inside a selected project.

import { h, clear, errorBox, skeleton, toast } from './dom.js';
import { api, ApiError } from './api.js';
import { on, applyMotionAttr, prefs, setPref } from './state.js';
import { applyTheme, toggleTheme, currentTheme } from './theme.js';
import { startBackground } from './background.js';
import { showBanner, hideBanner, setConnectionBadge, setAiBadge } from './ui.js';
import * as login from './pages/login.js';
import * as dashboard from './pages/dashboard.js';
import * as project from './pages/project.js';

export const TABS = [
  ['overview', 'Overview', project],
  ['graph', 'Graph', null],
  ['evaluate', 'Evaluate', null],
  ['campaigns', 'Campaigns', null],
  ['records', 'Records', null],
  ['trust', 'Trust', null],
];
const main = document.getElementById('main');
const tabsNav = document.getElementById('tabs');
let token = 0;
let me = null;

function parse() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').map(decodeURIComponent);
  const q = new URLSearchParams(query);
  if (parts[0] === 'p' && parts[1]) return { name: 'project', id: parts[1], tab: parts[2] || 'overview', query: q };
  if (parts[0] === 'login') return { name: 'login', query: q };
  return { name: 'dashboard', query: q };
}

export function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

async function render() {
  const my = ++token;
  const route = parse();
  if (!me && route.name !== 'login') return go('#/login');
  if (me && route.name === 'login') return go('#/dashboard');
  document.title = route.name === 'project' ? `${route.id} · Sniffer` : 'Sniffer';
  clear(main, skeleton(6));
  renderTabs(route);
  try {
    if (route.name === 'login') await login.mount(main, { onSignedIn: setSignedIn });
    else if (route.name === 'dashboard') await dashboard.mount(main);
    else await renderProject(route, my);
  } catch (err) {
    if (my !== token) return;
    if (err instanceof ApiError && err.status === 401) return go('#/login');
    clear(main, errorBox(err.message, () => render()));
  }
}

async function renderProject(route, my) {
  const tab = TABS.find(([key]) => key === route.tab);
  if (!tab) return go(`#/p/${encodeURIComponent(route.id)}/overview`);
  const stats = await api.project(route.id); // 404 when the signed-in maintainer is not on this project
  if (my !== token) return;
  const ctx = { id: route.id, stats, query: route.query, go: (path) => go(`#/p/${encodeURIComponent(route.id)}/${path}`) };
  clear(main);
  const page = await loadTab(route.tab);
  if (my !== token) return;
  await page.mount(main, ctx);
}

async function loadTab(key) {
  switch (key) {
    case 'overview': return project;
    case 'graph': return import('./pages/graph.js');
    case 'evaluate': return import('./pages/evaluate.js');
    case 'campaigns': return import('./pages/campaigns.js');
    case 'records': return import('./pages/records.js');
    case 'trust': return import('./pages/trust.js');
    default: throw new Error(`Unknown section ${key}`);
  }
}

function renderTabs(route) {
  if (route.name !== 'project') { tabsNav.hidden = true; clear(tabsNav); return; }
  tabsNav.hidden = false;
  clear(tabsNav, TABS.map(([key, label]) => h('a', {
    href: `#/p/${encodeURIComponent(route.id)}/${key}`, aria: route.tab === key ? { current: 'page' } : {},
  }, label)));
}

function header(user) {
  const whoami = document.getElementById('whoami');
  whoami.textContent = user ? `Signed in as ${user}` : '';
  document.getElementById('signout-btn').hidden = !user;
}

async function refreshHealth() {
  try { setAiBadge(await api.health()); } catch { setAiBadge(null); }
}

async function signOut() {
  try { await api.signOut(); } catch { /* already gone */ }
  me = null;
  header(null);
  toast('Signed out.', 'cyan', 2000);
  go('#/login');
}

async function setSignedIn(login) {
  me = login;
  header(login);
  go('#/dashboard');
}

function init() {
  applyTheme();
  applyMotionAttr();
  startBackground(document.getElementById('bg-canvas'));
  const themeBtn = document.getElementById('theme-btn');
  const syncTheme = () => {
    const dark = currentTheme() === 'dark';
    themeBtn.textContent = dark ? '☀' : '☾';
    themeBtn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    themeBtn.setAttribute('aria-pressed', String(dark));
  };
  themeBtn.addEventListener('click', toggleTheme);
  const quietBtn = document.getElementById('quiet-btn');
  const syncQuiet = () => {
    quietBtn.setAttribute('aria-pressed', String(prefs.quiet));
    quietBtn.textContent = prefs.quiet ? 'Quiet: on' : 'Quiet mode';
  };
  quietBtn.addEventListener('click', () => setPref('quiet', !prefs.quiet));
  on('prefs', syncQuiet);
  syncQuiet();
  on('prefs', syncTheme);
  syncTheme();
  document.getElementById('signout-btn').addEventListener('click', signOut);
  on('signed-out', () => { me = null; header(null); go('#/login'); showBanner('Your session ended. Sign in again.', { tone: 'warn' }); });
  on('connection', (ok) => {
    setConnectionBadge(ok);
    if (!ok) showBanner('Cannot reach the Sniffer backend. Start it, then retry.', { tone: 'bad', action: { label: 'Retry', onClick: () => render() } });
    else hideBanner();
  });
  window.addEventListener('hashchange', () => render());
}

async function boot() {
  init();
  refreshHealth();
  setInterval(() => { if (!document.hidden && me) refreshHealth(); }, 30_000);
  try {
    const who = await api.me();
    me = who.login;
    header(me);
  } catch {
    me = null;
    header(null);
  }
  render();
}

boot();
