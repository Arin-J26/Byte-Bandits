// Project overview: this project's numbers only. Tiles open the matching section, the spam weight is shown as a meter,
// the highest spam-weight contributors link to their records, and the Gemma classification runs from here.

import { h, clear, toast, countUp } from '../dom.js';
import { api } from '../api.js';
import { meter, decisionBadge } from '../widgets.js';
import { reducedMotion } from '../state.js';

const TILES = [
  ['Merged PRs', 'merged_prs', 'ok', 'graph'],
  ['Trust edges', 'trust_edges', 'cyan', 'trust'],
  ['Vouchers', 'vouchers', 'ok', 'trust'],
  ['Denounces', 'denounces', 'bad', 'trust'],
  ['Flagged accounts', 'flagged_accounts', 'bad', 'trust'],
  ['Campaigns', 'campaigns', 'warn', 'campaigns'],
];
let poll = 0;

export async function mount(root, ctx) {
  clearInterval(poll);
  const s = ctx.stats;
  const open = (tab, query = '') => ctx.go(tab + query);

  const tiles = TILES.map(([label, key, tone, tab]) => {
    const num = h('div', { class: 'stat-num' }, '0');
    countUp(num, s[key] ?? 0, { instant: reducedMotion() });
    return h('button', { class: `stat tile ${tone}`, type: 'button', aria: { label: `${label}: ${s[key] ?? 0}. Open ${tab}.` }, on: { click: () => open(tab) } },
      num, h('div', { class: 'stat-label' }, label), h('span', { class: 'tile-go', 'aria-hidden': 'true' }, '→'));
  });

  const search = h('input', { class: 'input mono', id: 'ov-search', list: 'ov-names', placeholder: 'Find a contributor…', maxlength: '39', 'data-search': '' });
  const names = h('datalist', { id: 'ov-names' });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && search.value.trim()) open('records', `?handle=${encodeURIComponent(search.value.trim().replace(/^@/, ''))}`);
  });
  api.contributors(ctx.id).then((list) => names.append(...list.map((n) => h('option', { value: n })))).catch(() => {});

  const topBox = h('div', { class: 'stack', 'aria-live': 'polite' }, h('div', { class: 'skeleton', style: { height: '90px' } }));
  api.trust(ctx.id).then((t) => {
    const rows = [...t.trusted, ...t.not_trusted]
      .filter((r) => r.spam_weight != null)
      .sort((a, b) => b.spam_weight - a.spam_weight || a.handle.localeCompare(b.handle))
      .slice(0, 5);
    clear(topBox, rows.length ? rows.map((r) => h('button', {
      class: 'row-card', type: 'button', on: { click: () => open('records', `?handle=${encodeURIComponent(r.handle)}`) },
    }, h('span', { class: 'mono' }, r.handle), h('span', { class: 'spacer' }), decisionBadge(r.decision),
    h('span', { class: 'mono tone-bad' }, `${r.spam_weight}%`)))
      : h('p', { class: 'hint' }, 'Classify the PRs to see who has the highest spam weight.'));
  }).catch(() => clear(topBox, h('p', { class: 'hint' }, 'Could not load contributors.')));

  const progress = h('div', { class: 'stack', 'aria-live': 'polite' });
  const button = h('button', { class: 'btn btn-primary', type: 'button' }, '✦ Classify PRs with Gemma');

  function paint(st) {
    const total = st.total || 0;
    const done = st.done || 0;
    const running = st.state === 'running';
    button.disabled = running || (s.unclassified === 0 && st.state !== 'failed');
    button.textContent = running ? `Classifying… ${done} / ${total}` : s.unclassified ? '✦ Classify PRs with Gemma' : 'All PRs classified';
    clear(progress,
      h('p', {}, `${s.classified} of ${s.prs_total} pull requests classified (${s.unclassified} pending).`),
      h('div', { class: 'bar-track', role: 'progressbar', aria: { valuemin: '0', valuemax: String(total || 1), valuenow: String(done) } },
        h('div', { class: 'bar-fill', style: { width: `${total ? Math.round((done / total) * 100) : 100}%` } })),
      st.state === 'failed' ? h('p', { class: 'tone-bad' }, '✕ Classification stopped with an error. Check the server log, then try again.') : null);
  }

  function track() {
    clearInterval(poll);
    poll = setInterval(async () => {
      try {
        const st = await api.classifyStatus(ctx.id);
        paint(st);
        if (st.state !== 'running') {
          clearInterval(poll);
          if (st.state === 'done') {
            toast('Classification finished.', 'ok');
            mount(root, { ...ctx, stats: await api.project(ctx.id) });
          }
        }
      } catch { clearInterval(poll); }
    }, 1500);
  }

  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      paint(await api.classify(ctx.id));
      track();
    } catch (err) {
      toast(err.message, 'bad', 5000);
      button.disabled = false;
    }
  });

  const links = [['graph', 'Graph', 'Genuine vs spam PRs by month'], ['evaluate', 'Evaluate', 'Decide on one contributor'],
    ['campaigns', 'Campaigns', 'Bursts of near-identical PRs'], ['records', 'Records', 'Each PR of one contributor'],
    ['trust', 'Trust', 'Trusted and not-trusted contributors']];

  clear(root, h('section', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', {}, h('p', { class: 'eyebrow' }, 'Project overview'), h('h1', {}, s.name),
        h('p', {}, h('span', { class: 'mono' }, s.github), ' on GitHub. Every number here belongs to this project only.'),
        s.source ? h('p', { class: 'hint' }, `Source: ${s.source}`) : null)),
    h('div', { class: 'stats' }, tiles),
    h('div', { class: 'grid-2' },
      h('div', { class: 'panel stack' }, h('h2', {}, 'Spam weight'),
        meter(s.spam_weight, { label: 'Share of classified PRs that are spam' }),
        h('p', { class: 'hint' }, 'Spam weight is the share of this project’s classified PRs that Gemma marked spam. It informs your decision; nothing is blocked automatically.')),
      h('div', { class: 'panel stack' }, h('h2', {}, 'Find a contributor'),
        h('div', { class: 'row' }, search, names, h('button', { class: 'btn', type: 'button', on: { click: () => search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })) } }, 'Open records')),
        h('h3', { style: { marginTop: '8px' } }, 'Highest spam weight'),
        topBox)),
    h('div', { class: 'panel stack' }, h('div', { class: 'row' }, h('h2', {}, 'Gemma classification'), h('span', { class: 'spacer' }), button), progress),
    h('div', { class: 'grid-2' }, links.map(([tab, label, desc]) => h('a', { class: 'panel nav-card', href: `#/p/${encodeURIComponent(ctx.id)}/${tab}` },
      h('h3', {}, `${label} →`), h('p', { class: 'hint' }, desc))))));

  paint({ state: 'idle', done: 0, total: s.unclassified });
  const st = await api.classifyStatus(ctx.id);
  paint(st);
  if (st.state === 'running') track();
}
