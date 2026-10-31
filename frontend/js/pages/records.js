// Records page: searchable, sortable, filterable, paginated table of signed vouch/denounce records.

import { h, clear, skeleton, errorBox, emptyState, pill, debounce, download, copyText, toast } from '../dom.js';
import { api, syncTrustSettings } from '../api.js';
import { prefs, trustOptions } from '../state.js';
import { filterRecords, sortRecords, paginate, toCSV, denounceCounts } from '../lib/recordFilter.js';
import { computeTrust } from '../lib/trustMath.js';
import { recordTypeStyle, signatureStyle } from '../lib/decision.js';
import { fmtTime } from '../lib/format.js';
import { openRecordDrawer, term } from '../ui.js';

const COLS = [
  ['issuer', 'Issuer'], ['subject_handle', 'Subject'], ['type', 'Type'], ['reason', 'Reason'],
  [null, 'Evidence'], ['timestamp', 'Timestamp'], ['signature_valid', 'Signature'],
];
const PAGE_SIZE = 10;

export async function mount(root) {
  clear(root, h('section', { class: 'page' }, skeleton(8)));
  let records, edges;
  try {
    [records, edges] = await Promise.all([api.records(), api.trustEdges(), syncTrustSettings(prefs.perspective)]);
  } catch (err) {
    clear(root, errorBox(`Could not load records: ${err.message}`, () => mount(root)));
    return null;
  }
  if (!records.length) {
    clear(root, h('section', { class: 'page' }, emptyState({ icon: '☰', title: 'No records yet', text: 'Load a synthetic network to see signed vouch and denounce records.', actionLabel: 'Go to Simulate', href: '#/simulate' })));
    return null;
  }
  const trusted = new Set(computeTrust(edges, prefs.perspective, trustOptions()).trust.keys());
  const denounced = denounceCounts(records, trusted);
  const state = { q: '', type: '', sig: '', issuer: '', sort: 'timestamp', dir: 'desc', page: 1 };

  const q = h('input', { class: 'input', type: 'search', placeholder: 'Search issuer, handle, reason, URL…', 'data-search': '', aria: { label: 'Search records' } });
  const typeSel = h('select', { class: 'input', aria: { label: 'Filter by type' } },
    [['', 'All types'], ['vouch', '✓ Vouches'], ['denounce', '✕ Denounces'], ['contest', '↩ Contests']].map(([v, t]) => h('option', { value: v }, t)));
  const sigSel = h('select', { class: 'input', aria: { label: 'Filter by signature' } },
    [['', 'Any signature'], ['valid', '✓ Valid'], ['invalid', '✕ Invalid']].map(([v, t]) => h('option', { value: v }, t)));
  const issuerSel = h('select', { class: 'input', aria: { label: 'Filter by issuer' } }, h('option', { value: '' }, 'All issuers'),
    [...new Set(records.map((r) => r.issuer))].sort().map((i) => h('option', { value: i }, i)));
  const exportJson = h('button', { class: 'btn btn-sm', type: 'button' }, '⇩ JSON');
  const exportCsv = h('button', { class: 'btn btn-sm', type: 'button' }, '⇩ CSV');
  const count = h('p', { class: 'hint', aria: { live: 'polite' } });
  const thead = h('thead');
  const tbody = h('tbody');
  const pager = h('nav', { class: 'row pager', aria: { label: 'Pagination' } });

  clear(root, h('section', { class: 'page page-records' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Signed records'),
      h('p', {}, 'Every ', term('vouch'), ' and ', term('denounce'), ' is signed by the issuing project. A single denounce is only a soft signal; FLAG needs at least two independent trusted projects.'))),
    h('div', { class: 'panel row filters' }, q, typeSel, sigSel, issuerSel, h('span', { style: { flex: 1 } }), exportJson, exportCsv),
    count,
    h('div', { class: 'table-wrap' }, h('table', {}, h('caption', { class: 'sr-only' }, 'Signed records. Activate a row to open details.'), thead, tbody)),
    pager));

  const filtered = () => sortRecords(filterRecords(records, state), state.sort, state.dir);

  function renderHead() {
    clear(thead, h('tr', {}, COLS.map(([key, label]) => {
      if (!key) return h('th', { scope: 'col' }, label);
      const active = state.sort === key;
      return h('th', { scope: 'col', 'aria-sort': active ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none' },
        h('button', { type: 'button', on: { click: () => { state.dir = active && state.dir === 'asc' ? 'desc' : 'asc'; state.sort = key; state.page = 1; render(); } } },
          label, h('span', { 'aria-hidden': 'true', class: 'dim' }, active ? (state.dir === 'asc' ? '▲' : '▼') : '↕')));
    })));
  }

  function row(r) {
    const n = denounced.get(String(r.subject_handle).toLowerCase()) || 0;
    const open = () => openRecordDrawer(r, { denouncers: n });
    const ev = r.evidence_urls || [];
    return h('tr', { tabindex: '0', aria: { label: `${r.type} of ${r.subject_handle} by ${r.issuer}. Open details.` }, on: { click: open, keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } } },
      h('td', { class: 'mono' }, r.issuer),
      h('td', { class: 'mono' }, `@${r.subject_handle}`,
        n ? h('div', { class: `hint ${n >= 2 ? 'tone-bad' : 'tone-warn'}` }, `denounced by ${n} independent trusted project${n === 1 ? '' : 's'}${n === 1 ? ' (soft signal)' : ''}`) : null),
      h('td', {}, pill(recordTypeStyle(r.type))),
      h('td', { class: 'reason' }, r.reason || '—'),
      h('td', {}, ev.length ? h('ul', { class: 'plain stack' }, ev.slice(0, 2).map((u) => h('li', { class: 'row nowrap' },
        h('code', { class: 'url' }, String(u)),
        h('button', { class: 'btn btn-sm btn-icon', type: 'button', aria: { label: `Copy ${u}` }, on: { click: (e) => { e.stopPropagation(); copyText(String(u)); } } }, '⧉'))))
        : h('span', { class: 'dim' }, '—'), ev.length > 2 ? h('span', { class: 'dim' }, `+${ev.length - 2} more`) : null),
      h('td', { class: 'mono nowrap' }, fmtTime(r.timestamp)),
      h('td', {}, pill(signatureStyle(r.signature_valid))));
  }

  function render() {
    const all = filtered();
    const pg = paginate(all, state.page, PAGE_SIZE);
    state.page = pg.page;
    renderHead();
    clear(tbody, pg.items.length ? pg.items.map(row)
      : h('tr', {}, h('td', { colspan: String(COLS.length) }, emptyState({ icon: '⌕', title: 'No records match', text: 'Try a different search or clear the filters.', actionLabel: 'Clear filters', onAction: reset }))));
    count.textContent = `${pg.total} of ${records.length} records · page ${pg.page} of ${pg.pages}`;
    exportJson.textContent = `⇩ JSON (${pg.total})`;
    exportCsv.textContent = `⇩ CSV (${pg.total})`;
    clear(pager,
      h('button', { class: 'btn btn-sm', type: 'button', disabled: pg.page <= 1, on: { click: () => { state.page--; render(); } } }, '← Prev'),
      h('span', { class: 'mono' }, `${pg.page} / ${pg.pages}`),
      h('button', { class: 'btn btn-sm', type: 'button', disabled: pg.page >= pg.pages, on: { click: () => { state.page++; render(); } } }, 'Next →'));
  }

  function reset() {
    Object.assign(state, { q: '', type: '', sig: '', issuer: '', page: 1 });
    q.value = ''; typeSel.value = ''; sigSel.value = ''; issuerSel.value = '';
    render();
  }

  q.addEventListener('input', debounce(() => { state.q = q.value; state.page = 1; render(); }, 150));
  typeSel.addEventListener('change', () => { state.type = typeSel.value; state.page = 1; render(); });
  sigSel.addEventListener('change', () => { state.sig = sigSel.value; state.page = 1; render(); });
  issuerSel.addEventListener('change', () => { state.issuer = issuerSel.value; state.page = 1; render(); });
  exportJson.addEventListener('click', () => { download('sniffer-records.json', JSON.stringify(filtered(), null, 2)); toast('Exported filtered records as JSON', 'ok'); });
  exportCsv.addEventListener('click', () => { download('sniffer-records.csv', toCSV(filtered()), 'text/csv'); toast('Exported filtered records as CSV', 'ok'); });
  render();
  return null;
}
