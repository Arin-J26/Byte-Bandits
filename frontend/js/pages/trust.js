// Trust: two full-width lists for this project, with each contributor's spam weight shown as a clear percentage.
// Trusted = a vouch from one of your projects. Not trusted = a denounce. Clicking a name opens its records.

import { h, clear, errorBox, emptyState } from '../dom.js';
import { api } from '../api.js';
import { decisionBadge } from '../widgets.js';

function weightCell(pct) {
  if (pct == null) return h('span', { class: 'muted' }, 'not classified');
  const tone = pct >= 50 ? 'bad' : pct >= 20 ? 'warn' : 'ok';
  return h('div', { class: 'weight', role: 'meter', aria: { label: 'Spam weight', valuemin: '0', valuemax: '100', valuenow: String(pct), valuetext: `${pct}% spam` } },
    h('strong', { class: `weight-value tone-${tone}` }, `${pct}% spam`),
    h('div', { class: 'bar-track' }, h('div', { class: `bar-fill tone-${tone}`, style: { width: `${pct}%` } })));
}

export async function mount(root, ctx) {
  let data;
  try {
    data = await api.trust(ctx.id);
  } catch (err) {
    clear(root, errorBox(err.message));
    return;
  }
  const open = (handle) => ctx.go(`records?handle=${encodeURIComponent(handle)}`);
  const table = (rows, columns, cells) => h('div', { class: 'table-wrap' }, h('table', { class: 'trust-table' },
    h('thead', {}, h('tr', {}, columns.map((c) => h('th', { scope: 'col' }, c)))),
    h('tbody', {}, rows.map((r) => h('tr', {
      tabindex: '0', on: { click: () => open(r.handle), keydown: (e) => { if (e.key === 'Enter') open(r.handle); } },
    }, cells(r))))));

  const trusted = table(data.trusted, ['Contributor', 'Trusted by (projects)', 'Genuine PRs', 'Spam weight', 'Your decision'],
    (r) => [
      h('td', { class: 'mono' }, r.handle),
      h('td', {}, String(r.trusted_by)),
      h('td', {}, String(r.genuine)),
      h('td', {}, weightCell(r.spam_weight)),
      h('td', {}, decisionBadge(r.decision)),
    ]);
  const notTrusted = table(data.not_trusted, ['Contributor', 'Not trusted by (projects)', 'Spam PRs', 'Spam weight', 'Your decision'],
    (r) => [
      h('td', { class: 'mono' }, r.handle),
      h('td', {}, String(r.not_trusted_by)),
      h('td', {}, String(r.spam)),
      h('td', {}, weightCell(r.spam_weight)),
      h('td', {}, decisionBadge(r.decision)),
    ]);

  const weights = [...data.trusted, ...data.not_trusted].map((r) => r.spam_weight).filter((w) => w != null);
  const average = weights.length ? Math.round(weights.reduce((a, b) => a + b, 0) / weights.length) : null;

  clear(root, h('section', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Trust'),
      h('p', {}, 'Trusted means a project in your portfolio has a vouch for this contributor. Not trusted means a denounce. The spam weight is the share of their classified PRs that are spam. Click a name to see its PRs.'))),
    h('div', { class: 'stats' },
      h('div', { class: 'stat ok' }, h('div', { class: 'stat-num' }, String(data.trusted.length)), h('div', { class: 'stat-label' }, 'Trusted')),
      h('div', { class: 'stat bad' }, h('div', { class: 'stat-num' }, String(data.not_trusted.length)), h('div', { class: 'stat-label' }, 'Not trusted')),
      h('div', { class: 'stat warn' }, h('div', { class: 'stat-num' }, average == null ? '—' : `${average}%`), h('div', { class: 'stat-label' }, 'Average spam weight'))),
    h('section', { class: 'stack' }, h('h2', {}, 'Trusted'),
      data.trusted.length ? trusted : emptyState({ icon: '✓', title: 'No trusted contributors yet', text: 'Classify this project’s PRs first.' })),
    h('section', { class: 'stack' }, h('h2', {}, 'Not trusted'),
      data.not_trusted.length ? notTrusted : emptyState({ icon: '✕', title: 'No one is denounced', text: 'Nobody has PRs classified as spam here.' }))));
}
