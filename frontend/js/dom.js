// Safe DOM helpers. Everything goes through createElement + textContent;
// attacker-controlled strings (handles, reasons, titles) are never parsed as HTML.

/**
 * h('button', {class:'btn', on:{click:fn}, aria:{label:'x'}}, 'text', childNode)
 * Strings become text nodes. Event handlers only via `on`.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'aria') for (const [a, av] of Object.entries(v)) { if (av != null) el.setAttribute(`aria-${a}`, String(av)); }
    else if (k === 'data') for (const [d, dv] of Object.entries(v)) el.dataset[d] = String(dv);
    else if (k === 'style') Object.assign(el.style, v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = v;
    else if (k.startsWith('on')) throw new Error('Use the `on` option for event handlers');
    else if (k === 'href') el.setAttribute('href', safeHref(v));
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

/** SVG element helper (attributes only, no markup parsing). */
export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  return append(el, children);
}

/** Animate a number into an element's text (instant under reduced motion). */
export function countUp(el, to, { ms = 900, format = (v) => String(Math.round(v)), instant = false } = {}) {
  if (instant || !Number.isFinite(to)) { el.textContent = format(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = format(to * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Replace all children safely (no innerHTML). */
export function clear(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

/** Only internal hash links and http(s) URLs are allowed as href values. */
export function safeHref(url) {
  const s = String(url || '');
  if (s.startsWith('#')) return s;
  try {
    const u = new URL(s, location.href);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '#';
  } catch { return '#'; }
}
export const isHttpUrl = (url) => /^https?:\/\//i.test(String(url || '')) && safeHref(url) !== '#';

/** Status pill: icon + text + tone, so colour is never the only signal. */
export function pill({ tone, icon, label }, extraClass = '') {
  return h('span', { class: `badge tone-${tone} ${extraClass}` }, h('span', { 'aria-hidden': 'true' }, icon), label);
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function skeleton(lines = 3) {
  return h('div', { class: 'stack', aria: { busy: 'true', label: 'Loading' } },
    Array.from({ length: lines }, (_, i) => h('div', { class: 'skeleton', style: { width: `${90 - i * 12}%` } })));
}

/** Empty state with a clear call to action. */
export function emptyState({ icon = '◌', title, text, actionLabel, href, onAction }) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-icon', 'aria-hidden': 'true' }, icon),
    h('h2', {}, title),
    text ? h('p', {}, text) : null,
    actionLabel ? (href
      ? h('a', { class: 'btn btn-primary', href }, actionLabel)
      : h('button', { class: 'btn btn-primary', type: 'button', on: { click: onAction } }, actionLabel)) : null);
}

export function errorBox(message, onRetry) {
  return h('div', { class: 'error-box', role: 'alert' },
    h('strong', {}, '✕ Something went wrong. '), message,
    onRetry ? h('div', { style: { marginTop: '8px' } }, h('button', { class: 'btn btn-sm', type: 'button', on: { click: onRetry } }, 'Try again')) : null);
}

/* ---------- toasts ---------- */
export function toast(message, tone = 'cyan', ms = 3800) {
  const root = document.getElementById('toasts');
  if (!root) return;
  const icon = { ok: '✓', warn: '!', bad: '✕' }[tone] || 'ℹ';
  const t = h('div', { class: `toast tone-${tone}` }, h('span', { 'aria-hidden': 'true', class: `tone-${tone}` }, icon), h('span', {}, message),
    h('span', { class: `toast-bar tone-${tone}`, 'aria-hidden': 'true', style: { animationDuration: `${ms}ms` } }));
  root.append(t);
  while (root.children.length > 4) root.firstElementChild.remove();
  setTimeout(() => t.remove(), ms);
}

/* ---------- download a generated file client-side ---------- */
export function download(filename, text, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = h('a', { download: filename });
  a.href = url; // blob: URL created by us, not user input
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard', 'ok', 1800);
  } catch {
    toast('Copy failed. Select the text and copy it manually.', 'warn');
  }
}

/* ---------- focus trap for dialogs/drawers ---------- */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';
export function trapFocus(container, onEscape) {
  const prev = document.activeElement;
  const handler = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onEscape?.(); return; }
    if (e.key !== 'Tab') return;
    const items = [...container.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  container.addEventListener('keydown', handler);
  requestAnimationFrame(() => (container.querySelector('[autofocus]') || container.querySelector(FOCUSABLE))?.focus());
  return () => { container.removeEventListener('keydown', handler); if (prev && prev.focus) prev.focus(); };
}
