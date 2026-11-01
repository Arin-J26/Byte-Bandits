// Shared UI helpers: banners, a side drawer, and the connection and AI badges.

import { h, clear, trapFocus } from './dom.js';

export function showBanner(message, { tone = 'warn', action } = {}) {
  const b = document.getElementById('banner');
  b.className = `banner ${tone === 'bad' ? 'bad' : ''}`;
  clear(b, h('span', { 'aria-hidden': 'true' }, tone === 'bad' ? '✕' : '!'), h('span', {}, message),
    action ? h('button', { class: 'btn btn-sm', type: 'button', style: { marginLeft: 'auto' }, on: { click: action.onClick } }, action.label) : null);
  b.hidden = false;
}

export function hideBanner() {
  document.getElementById('banner').hidden = true;
}

let closeDrawer = null;
export function openDrawer(title, body) {
  closeDrawer?.();
  const root = document.getElementById('overlay-root');
  const backdrop = h('div', { class: 'drawer-backdrop' });
  let release = () => {};
  const close = () => { release(); root.replaceChildren(); closeDrawer = null; };
  backdrop.addEventListener('click', close);
  const panel = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', aria: { label: title } },
    h('div', { class: 'row', style: { marginBottom: '14px' } }, h('h2', {}, title), h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-icon', type: 'button', aria: { label: 'Close' }, on: { click: close } }, '✕')),
    body);
  root.replaceChildren(backdrop, panel);
  release = trapFocus(panel, close);
  closeDrawer = close;
  return close;
}

export function setConnectionBadge(online) {
  const badge = document.getElementById('conn-badge');
  badge.hidden = online;
  badge.className = 'badge bad';
  clear(badge, h('span', { 'aria-hidden': 'true' }, '✕'), 'Backend offline');
}

export function setAiBadge(health) {
  const badge = document.getElementById('ai-badge');
  if (!health) { badge.hidden = true; return; }
  badge.hidden = false;
  const ready = Boolean(health.ollama_available);
  badge.className = `badge ${ready ? 'live' : 'warn'}`;
  const label = ready ? 'Gemma ready' : health.ollama_running ? 'Gemma not pulled' : 'Ollama off';
  clear(badge, h('span', { 'aria-hidden': 'true' }, ready ? '✦' : '!'), label);
  badge.title = ready ? `${health.model} via local Ollama` : `Run: ollama pull ${health.model}`;
}
