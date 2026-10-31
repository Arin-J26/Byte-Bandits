// Command palette (Ctrl/Cmd+K): jump to pages, evaluate any handle, run actions.
// ARIA combobox + listbox with aria-activedescendant; arrows, Enter, Esc.

import { h, clear, trapFocus } from './dom.js';
import { api } from './api.js';
import { fuzzyFilter } from './lib/fuzzy.js';

let open = false;
export const isPaletteOpen = () => open;

/**
 * @param {{pages:{id,label,icon}[], actions:{label,icon,hint?,run:Function}[], go:Function}} cfg
 */
export async function openPalette({ pages, actions, go }) {
  if (open) return;
  open = true;
  const root = document.getElementById('overlay-root');
  const input = h('input', {
    class: 'palette-input', type: 'text', role: 'combobox', placeholder: 'Type a page, an action, or @handle to evaluate…',
    autocomplete: 'off', spellcheck: 'false', 'aria-expanded': 'true', aria: { controls: 'palette-list', autocomplete: 'list', label: 'Command palette' },
  });
  const list = h('ul', { class: 'palette-list', id: 'palette-list', role: 'listbox', aria: { label: 'Results' } });
  const box = h('div', { class: 'palette', role: 'dialog', 'aria-modal': 'true', aria: { label: 'Command palette' } },
    h('div', { class: 'palette-head' }, h('span', { 'aria-hidden': 'true', class: 'tone-cyan' }, '⌕'), input, h('kbd', {}, 'Esc')),
    list,
    h('div', { class: 'palette-foot hint' }, h('kbd', {}, '↑'), h('kbd', {}, '↓'), ' to move · ', h('kbd', {}, 'Enter'), ' to run'));
  const backdrop = h('div', { class: 'modal-backdrop palette-backdrop', on: { mousedown: (e) => { if (e.target === backdrop) close(); } } }, box);
  root.append(backdrop);
  const release = trapFocus(box, close);
  input.focus();

  const base = [
    ...pages.map((p) => ({ group: 'Pages', icon: p.icon, label: p.label, hint: `g ${p.key}`, run: () => go(p.id) })),
    ...actions.map((a) => ({ group: 'Actions', ...a })),
  ];
  let handles = [];
  api.records().then((rs) => {
    handles = [...new Set(rs.map((r) => r.subject_handle))].sort();
    render();
  }).catch(() => {});

  let items = [];
  let active = 0;

  function close() {
    if (!open) return;
    open = false;
    release();
    backdrop.remove();
  }

  function render() {
    const q = input.value.trim();
    const handleItems = fuzzyFilter(handles, q.replace(/^@/, ''), (x) => x, q ? 6 : 3)
      .map((x) => ({ group: 'Evaluate', icon: '⚖', label: `@${x}`, run: () => { location.hash = `#/evaluate?h=${encodeURIComponent(x)}`; } }));
    items = [...fuzzyFilter(base, q, (x) => x.label), ...handleItems];
    const typed = q.replace(/^@/, '');
    if (typed && /^[\w.-]{1,100}$/.test(typed) && !handles.includes(typed)) {
      items.push({ group: 'Evaluate', icon: '⚖', label: `Evaluate @${typed}`, run: () => { location.hash = `#/evaluate?h=${encodeURIComponent(typed)}`; } });
    }
    active = Math.min(active, Math.max(0, items.length - 1));
    let lastGroup = '';
    clear(list, items.length ? items.flatMap((it, i) => {
      const out = [];
      if (it.group !== lastGroup) { lastGroup = it.group; out.push(h('li', { class: 'palette-group', role: 'presentation' }, it.group)); }
      out.push(h('li', {
        id: `pal-${i}`, role: 'option', class: 'palette-item', 'aria-selected': String(i === active),
        on: { mousemove: () => { if (active !== i) { active = i; highlight(); } }, click: () => runItem(i) },
      }, h('span', { class: 'palette-icon', 'aria-hidden': 'true' }, it.icon || '›'), h('span', {}, it.label),
      it.hint ? h('kbd', {}, it.hint) : null));
      return out;
    }) : h('li', { class: 'palette-empty muted', role: 'presentation' }, 'No matches. Try a page name or a handle.'));
    highlight();
  }

  function highlight() {
    for (const el of list.querySelectorAll('[role="option"]')) el.setAttribute('aria-selected', String(el.id === `pal-${active}`));
    if (items.length) {
      input.setAttribute('aria-activedescendant', `pal-${active}`);
      document.getElementById(`pal-${active}`)?.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  function runItem(i) {
    const it = items[i];
    if (!it) return;
    close();
    it.run();
  }

  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % Math.max(1, items.length); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % Math.max(1, items.length); highlight(); }
    else if (e.key === 'Enter') { e.preventDefault(); runItem(active); }
  });
  render();
}
