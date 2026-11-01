// Shared UI pieces: glossary tooltips, record drawer, shortcut dialog, banner, external links.

import { h, clear, pill, trapFocus, copyText, isHttpUrl } from './dom.js';
import { recordTypeStyle, signatureStyle } from './lib/decision.js';
import { fmtTime } from './lib/format.js';
import { prefs, setPref } from './state.js';

export const GLOSSARY = {
  vouch: 'A signed record where a project says “this contributor did good work here”. Adds trust.',
  denounce: 'A signed record where a project reports bad behaviour (spam, abuse). One denounce alone is only a soft signal.',
  edge: 'Trust edge: “project A trusts project B’s records”. Directional. You only see records from projects in your trust graph.',
  weight: 'How much you trust a peer, from 0 (ignore) to 1 (full trust).',
  decay: 'How much trust fades with every hop. With decay 0.8, a fully trusted peer counts 0.8 and their peer counts 0.64.',
  depth: 'Maximum hops to follow through the trust graph. Projects further away are ignored.',
};

/* ---------- tooltips: any [data-term] or [data-tip] element ---------- */
export function initTooltips() {
  const tip = document.getElementById('tooltip');
  const show = (target, title, text) => {
    clear(tip, title ? h('strong', {}, title) : null, text);
    tip.hidden = false;
    const r = target.getBoundingClientRect();
    const tw = Math.min(280, window.innerWidth - 16);
    tip.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - tw - 8))}px`;
    tip.style.top = `${Math.min(r.bottom + 8, window.innerHeight - 80)}px`;
  };
  const resolve = (el) => {
    const t = el.closest?.('[data-term],[data-tip]');
    if (!t) return null;
    if (t.dataset.term) return { t, title: t.textContent, text: GLOSSARY[t.dataset.term] || '' };
    return { t, title: '', text: t.dataset.tip };
  };
  const enter = (e) => { const r = resolve(e.target); if (r) { show(r.t, r.title, r.text); r.t.setAttribute('aria-describedby', 'tooltip'); } };
  const leave = (e) => { const r = resolve(e.target); if (r) { tip.hidden = true; r.t.removeAttribute('aria-describedby'); } };
  document.addEventListener('mouseover', enter);
  document.addEventListener('mouseout', leave);
  document.addEventListener('focusin', enter);
  document.addEventListener('focusout', leave);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') tip.hidden = true; });
}

/** Inline glossary term usable anywhere. */
export function term(key, label = key) {
  return h('span', { class: 'term', tabindex: '0', data: { term: key } }, label);
}

/* ---------- banner ---------- */
export function hideBanner() {
  const b = document.getElementById('banner');
  b.hidden = true;
  delete b.dataset.kind;
}

export function showBanner(message, action) {
  const b = document.getElementById('banner');
  b.dataset.kind = /Ollama|Gemma|gemma/.test(message) ? 'ai' : 'other';
  clear(b, h('span', { 'aria-hidden': 'true', class: 'tone-warn' }, '!'), h('span', {}, message),
    action ? h('button', { class: 'btn btn-sm', type: 'button', style: { marginLeft: 'auto' }, on: { click: action.onClick } }, action.label) : null,
    h('button', { class: 'btn btn-sm btn-ghost', type: 'button', aria: { label: 'Dismiss banner' }, on: { click: () => { b.hidden = true; } } }, '✕'));
  b.hidden = false;
}

/* ---------- external links ---------- */
/** Evidence link: plain text + copy button + an opt-in link that warns before leaving. */
export function evidenceItem(url) {
  const text = String(url);
  const parts = [h('code', { class: 'mono', style: { wordBreak: 'break-all' } }, text),
    h('button', { class: 'btn btn-sm', type: 'button', aria: { label: `Copy ${text}` }, on: { click: (e) => { e.stopPropagation(); copyText(text); } } }, '⧉ Copy')];
  if (isHttpUrl(text)) {
    parts.push(h('a', {
      class: 'btn btn-sm btn-ghost', href: text, target: '_blank', rel: 'noopener noreferrer',
      aria: { label: `Open external link ${text} (leaves Sniffer)` },
      on: {
        click: (e) => {
          e.stopPropagation();
          // eslint-disable-next-line no-alert
          if (!window.confirm(`You are about to open an external site:\n\n${text}\n\nThis link came from a record and could be unsafe. Continue?`)) e.preventDefault();
        },
      },
    }, '↗ Open'));
  } else {
    parts.push(h('span', { class: 'badge tone-warn' }, h('span', { 'aria-hidden': 'true' }, '!'), 'not a web link'));
  }
  return h('li', { class: 'row' }, parts);
}

/* ---------- drawer ---------- */
let closeCurrent = null;
export function openDrawer(title, body) {
  closeCurrent?.();
  const root = document.getElementById('drawer-root');
  const backdrop = h('div', { class: 'drawer-backdrop' });
  const panel = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', aria: { labelledby: 'drawer-title' } },
    h('div', { class: 'panel-title' }, h('h2', { id: 'drawer-title' }, title), h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-icon', type: 'button', aria: { label: 'Close' }, autofocus: true, on: { click: () => close() } }, '✕')),
    body);
  let release;
  function close() {
    release?.();
    root.replaceChildren();
    closeCurrent = null;
  }
  backdrop.addEventListener('click', close);
  root.replaceChildren(backdrop, panel);
  release = trapFocus(panel, close);
  closeCurrent = close;
  return close;
}

/**
 * Record detail drawer.
 * @param {object} r record
 * @param {{denouncers?:number}} ctx independent trusted denouncers of this subject
 */
export function openRecordDrawer(r, ctx = {}) {
  if (!r) return;
  const type = recordTypeStyle(r.type);
  const sig = signatureStyle(r.signature_valid);
  const evidence = r.evidence_urls || [];
  const body = h('div', { class: 'stack' },
    h('div', { class: 'row' }, pill(type), pill(sig)),
    h('dl', {},
      h('dt', {}, 'Record'), h('dd', { class: 'mono' }, r.id),
      h('dt', {}, 'Issuer'), h('dd', { class: 'mono' }, r.issuer),
      h('dt', {}, 'Subject'), h('dd', { class: 'mono' }, `@${r.subject_handle}`),
      h('dt', {}, 'When'), h('dd', { class: 'mono' }, fmtTime(r.timestamp)),
      h('dt', {}, 'Reason'), h('dd', {}, r.reason || '—')),
    h('h3', {}, `Evidence (${evidence.length})`),
    evidence.length ? h('ul', { class: 'stack', style: { listStyle: 'none', padding: 0 } }, evidence.map(evidenceItem)) : h('p', { class: 'muted' }, 'No evidence links attached.'),
    r.signature_valid === false
      ? h('p', { class: 'tone-bad' }, '✕ The signature does not verify. Sniffer ignores this record in every decision.')
      : null,
    ctx.denouncers != null
      ? h('p', { class: 'muted' }, `@${r.subject_handle} is denounced by ${ctx.denouncers} independent trusted project${ctx.denouncers === 1 ? '' : 's'}. ` +
        'A single denounce is only a soft signal: FLAG needs at least two independent trusted projects.')
      : null);
  openDrawer(`Record ${r.id}`, body);
}

/* ---------- shortcuts dialog ---------- */
export function openShortcuts() {
  const root = document.getElementById('overlay-root');
  if (root.firstChild) return;
  const rows = [['Ctrl/⌘ K', 'Command palette: pages, actions, evaluate a handle'], ['g h', 'Overview'], ['g g', 'Graph'], ['g e', 'Evaluate'], ['g c', 'Campaigns'], ['g r', 'Records'], ['g t', 'Trust'], ['g s', 'Simulate'],
    ['/', 'Focus search on this page'], ['?', 'Show this help'], ['Esc', 'Close dialogs, drawers and the demo']];
  const close = () => { release(); root.replaceChildren(); };
  const modal = h('div', { class: 'modal panel', role: 'dialog', 'aria-modal': 'true', aria: { labelledby: 'sc-title' } },
    h('div', { class: 'panel-title' }, h('h2', { id: 'sc-title' }, 'Keyboard shortcuts'), h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-icon', type: 'button', aria: { label: 'Close' }, on: { click: close } }, '✕')),
    h('dl', {}, rows.flatMap(([k, d]) => [h('dt', {}, h('kbd', {}, k)), h('dd', {}, d)])));
  const backdrop = h('div', { class: 'modal-backdrop', on: { click: (e) => { if (e.target === backdrop) close(); } } }, modal);
  root.append(backdrop);
  const release = trapFocus(modal, close);
}

/* ---------- first-visit welcome card (non-modal) ---------- */
export function showWelcome(onTour) {
  if (prefs.welcomed) return;
  const close = () => { setPref('welcomed', true); card.remove(); };
  const card = h('aside', { class: 'welcome panel', role: 'region', aria: { label: 'Welcome' } },
    h('div', { class: 'panel-title' }, h('h2', {}, '👋 Welcome to Sniffer'), h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-icon btn-ghost', type: 'button', aria: { label: 'Dismiss welcome' }, on: { click: close } }, '✕')),
    h('p', { class: 'muted' }, 'A trust network for open-source maintainers. See who to trust, why, and spot spam waves across projects.'),
    h('ul', { class: 'plain stack welcome-tips' },
      h('li', {}, h('kbd', {}, 'Ctrl/⌘ K'), ' jump anywhere or evaluate a handle'),
      h('li', {}, h('kbd', {}, '?'), ' see all keyboard shortcuts'),
      h('li', {}, h('span', { class: 'tone-cyan' }, 'Quiet mode'), ' turns off sound and motion')),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-primary', type: 'button', on: { click: () => { close(); onTour(); } } }, '▶ Take the tour'),
      h('button', { class: 'btn btn-ghost', type: 'button', on: { click: close } }, 'Explore on my own')));
  document.body.append(card);
}
