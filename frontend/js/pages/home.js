// Overview page: what Sniffer is, live network stats, quick evaluate, recent activity.

import { h, svg, clear, skeleton, errorBox, pill, countUp } from '../dom.js';
import { api } from '../api.js';
import { reducedMotion } from '../state.js';
import { summarizeNetwork } from '../lib/overview.js';
import { decisionStyle, recordTypeStyle } from '../lib/decision.js';
import { fmtAgo } from '../lib/format.js';
import { term } from '../ui.js';

const EXAMPLES = [
  ['ada-commits', 'ALLOW'], ['newbie-nora', 'UNKNOWN'], ['solo-denounce-sam', 'REVIEW'], ['spam-bot-7731', 'FLAG'],
];

function sparkline(values) {
  const W = 260, H = 54;
  if (values.length < 2) return h('p', { class: 'hint' }, 'Not enough activity yet.');
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - 4 - (v / max) * (H - 10)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'spark', role: 'img', 'aria-label': `Events per 30 minutes, peak ${max}` },
    svg('defs', {}, svg('linearGradient', { id: 'spark-g', x1: '0', y1: '0', x2: '0', y2: '1' },
      svg('stop', { offset: '0', class: 'spark-fill-top' }),
      svg('stop', { offset: '1', class: 'spark-fill-bottom' }))),
    svg('path', { d: `${line} L${W},${H} L0,${H} Z`, fill: 'url(#spark-g)' }),
    svg('path', { d: line, fill: 'none', 'stroke-width': '2', 'stroke-linejoin': 'round', class: 'spark-line' }));
}

export async function mount(root) {
  clear(root, h('section', { class: 'page' }, skeleton(6)));
  let n;
  try {
    n = await api.network();
  } catch (err) {
    clear(root, errorBox(`Could not load the network: ${err.message}`, () => mount(root)));
    return null;
  }
  const s = summarizeNetwork(n);
  const instant = reducedMotion();

  /* hero with quick evaluate */
  const handleIn = h('input', { class: 'input mono', type: 'search', placeholder: '@handle to check…', 'data-search': '', aria: { label: 'Contributor handle to evaluate' }, maxlength: '100' });
  const form = h('form', { class: 'hero-form', role: 'search' }, handleIn, h('button', { class: 'btn btn-primary', type: 'submit' }, '⚖ Evaluate'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = handleIn.value.trim().replace(/^@/, '');
    if (v) location.hash = `#/evaluate?h=${encodeURIComponent(v)}`;
    else handleIn.focus();
  });
  const examples = h('div', { class: 'row examples' }, h('span', { class: 'hint' }, 'Try:'),
    EXAMPLES.map(([handle, d]) => {
      const st = decisionStyle(d);
      return h('a', { class: `chip example tone-${st.tone}`, href: `#/evaluate?h=${handle}` },
        h('span', { 'aria-hidden': 'true' }, st.icon), `@${handle}`);
    }));

  const hero = h('div', { class: 'hero panel' },
    h('p', { class: 'eyebrow' }, 'Hacktoberfest 2026 · Decentralized trust'),
    h('h1', { class: 'hero-title' }, 'Who should you ', h('em', {}, 'trust'), ' to merge?'),
    h('p', { class: 'hero-sub' }, 'Projects publish signed ', term('vouch', 'vouches'), ' and ', term('denounce', 'denounces'),
      ', share them with projects they trust, and get an explainable decision. Newcomers are never blocked.'),
    form, examples,
    h('div', { class: 'row', style: { marginTop: '6px' } },
      h('button', { class: 'btn', type: 'button', on: { click: () => document.getElementById('demo-btn').click() } }, '▶ Take the 8-minute tour'),
      h('a', { class: 'btn btn-ghost', href: '#/graph' }, '◎ Explore the graph →')));

  /* KPI tiles */
  const tile = (icon, label, value, href, tone = 'cyan', note = '') => {
    const num = h('span', { class: 'kpi-num' }, '0');
    countUp(num, value, { instant });
    return h('a', { class: `kpi tone-${tone}`, href, aria: { label: `${label}: ${value}. ${note}` } },
      h('span', { class: 'kpi-icon', 'aria-hidden': 'true' }, icon), num,
      h('span', { class: 'kpi-label' }, label), note ? h('span', { class: 'kpi-note' }, note) : null);
  };
  const kpis = h('div', { class: 'kpis' },
    tile('◎', 'Projects', s.projects, '#/graph'),
    tile('⇄', 'Trust edges', s.edges, '#/trust', 'cyan', `avg weight ${s.avgWeight.toFixed(2)}`),
    tile('✓', 'Vouches', s.vouches, '#/records', 'ok'),
    tile('✕', 'Denounces', s.denounces, '#/records', 'bad'),
    tile('◆', 'Flagged accounts', s.flagged, '#/graph', 'bad'),
    tile('⌖', 'Campaigns', s.campaigns, '#/campaigns', 'warn', s.invalid ? `${s.invalid} invalid signature${s.invalid === 1 ? '' : 's'}` : ''));

  /* how it works */
  const step = (n1, icon, title, text) => h('li', { class: 'how-step' },
    h('span', { class: 'how-num', 'aria-hidden': 'true' }, n1), h('span', { class: 'how-icon', 'aria-hidden': 'true' }, icon),
    h('h3', {}, title), h('p', { class: 'muted' }, text));
  const how = h('div', { class: 'panel' }, h('h2', {}, 'How it works'),
    h('ol', { class: 'how plain' },
      step('1', '✍', 'Publish', 'Each project signs vouch and denounce records about contributors it has worked with.'),
      step('2', '⇄', 'Share', 'Projects choose whose records they trust. Trust flows a few hops and fades with each one.'),
      step('3', '⚖', 'Decide', 'Sniffer weighs only trusted, valid records and explains the result, record by record.')));

  /* decision legend */
  const legend = h('div', { class: 'panel' }, h('h2', {}, 'What the decisions mean'),
    h('ul', { class: 'plain stack' },
      [['ALLOW', 'Trusted projects vouch for them. Merge as usual.'],
        ['REVIEW', 'Weak or mixed signals, or a single denounce. Take a normal look.'],
        ['UNKNOWN', 'No history yet. Normal review, never blocked.'],
        ['FLAG', 'Denounced by two or more independent trusted projects.']]
        .map(([d, text]) => h('li', { class: 'row legend-row' }, pill({ ...decisionStyle(d), label: d }), h('span', {}, text)))));

  /* activity */
  const recent = h('ul', { class: 'plain stack' }, s.recent.length ? s.recent.map((e) => {
    const k = e.kind === 'pr' ? { tone: 'cyan', icon: '⇡', label: 'PR' } : recordTypeStyle(e.kind);
    return h('li', { class: 'activity-row' }, pill(k), h('span', { class: 'mono' }, `@${e.handle}`),
      h('span', { class: 'dim' }, '→'), h('span', { class: 'mono' }, e.project),
      h('time', { class: 'dim mono', datetime: e.timestamp }, fmtAgo(e.timestamp, Date.parse(s.recent[0].timestamp))));
  }) : h('li', { class: 'muted' }, 'No events yet.'));
  const activity = h('div', { class: 'panel' },
    h('div', { class: 'panel-title' }, h('h2', {}, 'Activity'), h('span', { class: 'spacer' }), h('a', { class: 'btn btn-sm btn-ghost', href: '#/campaigns' }, 'Campaigns →')),
    sparkline(s.activity), recent);

  const trusted = h('div', { class: 'panel' }, h('h2', {}, 'Most trusted projects'),
    h('ol', { class: 'plain stack' }, s.mostTrusted.map((p, i) => h('li', { class: 'row' },
      h('span', { class: 'rank mono' }, String(i + 1)), h('span', { class: 'mono' }, p.id),
      h('span', { class: 'spacer', style: { flex: 1 } }), h('span', { class: 'dim mono' }, `trusted by ${p.count}`)))));

  clear(root, h('section', { class: 'page page-home' },
    hero, kpis,
    h('div', { class: 'home-grid' }, how, legend),
    h('div', { class: 'home-grid' }, activity, trusted)));
  return null;
}
