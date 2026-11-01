// Records: search one contributor and see each of their PRs as PR1, PR2, ... with a spam label, a type
// (denounced or voucher), and the reason, evidence and timestamp for spam PRs.

import { h, clear, pill, toast, errorBox, emptyState } from '../dom.js';
import { meter, decisionBadge, decisionControls } from '../widgets.js';
import { api } from '../api.js';

const SUBJECT = { spam: { tone: 'bad', icon: '✕', label: 'spam' }, 'not spam': { tone: 'ok', icon: '✓', label: 'not spam' }, pending: { tone: 'warn', icon: '…', label: 'pending' } };
const TYPE = { denounced: { tone: 'bad', icon: '✕', label: 'denounced' }, voucher: { tone: 'ok', icon: '✓', label: 'voucher' }, pending: { tone: 'warn', icon: '…', label: 'pending' } };

export async function mount(root, ctx) {
  const handleIn = h('input', { class: 'input mono', id: 'rec-handle', list: 'rec-handles', placeholder: 'GitHub username', maxlength: '39', autocomplete: 'off', 'data-search': '' });
  const datalist = h('datalist', { id: 'rec-handles' });
  const typeSel = h('select', { class: 'input', id: 'rec-type', 'aria-label': 'Filter by type' },
    [['', 'Denounced and voucher'], ['denounced', 'Denounced only'], ['voucher', 'Voucher only']].map(([v, t]) => h('option', { value: v }, t)));
  const subjSel = h('select', { class: 'input', id: 'rec-subject', 'aria-label': 'Filter by subject' },
    [['', 'Spam and not spam'], ['spam', 'Spam only'], ['not spam', 'Not spam only']].map(([v, t]) => h('option', { value: v }, t)));
  const result = h('div', { class: 'stack', 'aria-live': 'polite' });
  let rows = [];

  try {
    const names = await api.contributors(ctx.id);
    datalist.append(...names.map((n) => h('option', { value: n })));
  } catch { /* the search still works without suggestions */ }

  let meta = { spam_weight: null, decision: null };
  const summary = h('div', { class: 'panel stack', 'aria-live': 'polite' });
  function paintSummary(handle) {
    clear(summary,
      h('div', { class: 'row' }, h('h2', { class: 'mono' }, `@${handle}`), h('span', { class: 'spacer' }), decisionBadge(meta.decision)),
      meter(meta.spam_weight, { label: 'Spam weight (share of their classified PRs)' }),
      h('p', { class: 'hint' }, 'Your decision is yours: block or accept only when you choose. Nothing is blocked automatically.'),
      decisionControls(ctx.id, handle, meta.decision, (decision) => { meta.decision = decision; paintSummary(handle); }));
  }

  function paint() {
    const shown = rows.filter((r) => (!typeSel.value || r.type === typeSel.value) && (!subjSel.value || r.subject === subjSel.value));
    clear(result, shown.length ? h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['PR', 'Title', 'Subject', 'Type', 'Reason', 'Evidence', 'Timestamp'].map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', {}, shown.map((r) => h('tr', {},
        h('td', { class: 'mono nowrap' }, r.tag),
        h('td', {}, h('a', { class: 'link', href: r.url, target: '_blank', rel: 'noopener noreferrer' }, `#${r.number} ${r.title}`)),
        h('td', {}, pill(SUBJECT[r.subject] || SUBJECT.pending)),
        h('td', {}, pill(TYPE[r.type] || TYPE.pending)),
        h('td', { class: 'reason' }, r.reason || ''),
        h('td', {}, r.evidence ? h('a', { class: 'link mono', href: r.evidence, target: '_blank', rel: 'noopener noreferrer' }, r.evidence) : ''),
        h('td', { class: 'mono nowrap' }, r.timestamp || ''))))))
      : emptyState({ icon: '⌕', title: 'No pull requests to show', text: rows.length ? 'No PRs match these filters.' : 'Search a contributor, or classify the project first.' }));
  }

  async function search() {
    const handle = handleIn.value.trim().replace(/^@/, '');
    if (!handle) { handleIn.focus(); return; }
    clear(result, h('div', { class: 'skeleton', style: { height: '120px' } }));
    try {
      const data = await api.records(ctx.id, handle);
      rows = data.prs;
      meta = { spam_weight: data.spam_weight, decision: data.decision };
      paintSummary(data.handle);
      history.replaceState(null, '', `#/p/${encodeURIComponent(ctx.id)}/records?handle=${encodeURIComponent(handle)}`);
      paint();
      if (!rows.length) toast(`No PRs by @${handle} in this project.`, 'warn', 3500);
    } catch (err) {
      clear(result, errorBox(err.message));
    }
  }

  const form = h('form', { class: 'panel row', role: 'search', aria: { label: 'Search records' } },
    h('div', { class: 'field', style: { flex: '1 1 240px' } }, h('label', { for: 'rec-handle' }, 'Contributor handle'), handleIn, datalist),
    h('div', { class: 'field' }, h('label', { for: 'rec-type' }, 'Type'), typeSel),
    h('div', { class: 'field' }, h('label', { for: 'rec-subject' }, 'Subject'), subjSel),
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Search'));
  form.addEventListener('submit', (e) => { e.preventDefault(); search(); });
  typeSel.addEventListener('change', paint);
  subjSel.addEventListener('change', paint);

  clear(root, h('section', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Records'),
      h('p', {}, 'Each pull request by one contributor, numbered PR1, PR2, and so on. Spam PRs show the reason, evidence and time; not-spam PRs leave those blank.'))),
    form, summary, result));

  const preset = ctx.query.get('handle');
  if (preset) { handleIn.value = preset; search(); }
  else clear(result, emptyState({ icon: '⌕', title: 'Search a contributor', text: 'Type a GitHub username above to see their pull requests.' }));
}
