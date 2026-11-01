// Graph: genuine vs spam pull requests per month, as a bar chart (no web, no search, no node jumping).

import { h, clear, svg, emptyState, errorBox } from '../dom.js';
import { api } from '../api.js';

export async function mount(root, ctx) {
  clear(root, h('section', { class: 'page' }, h('div', { class: 'skeleton', style: { height: '320px' } })));
  let data;
  try {
    data = await api.graph(ctx.id);
  } catch (err) {
    clear(root, errorBox(err.message));
    return;
  }
  if (!data.months.length) {
    clear(root, emptyState({ icon: '▥', title: 'Nothing classified yet', text: 'Run the Gemma classification from the overview first.',
      actionLabel: 'Go to overview', onAction: () => ctx.go('overview') }));
    return;
  }
  const W = 760, H = 320, pad = { l: 48, r: 16, t: 16, b: 40 };
  const max = Math.max(1, ...data.months.flatMap((m) => [m.genuine, m.spam]));
  const slot = (W - pad.l - pad.r) / data.months.length;
  const bw = Math.min(28, slot * 0.36);
  const y = (v) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const bars = [];
  data.months.forEach((m, i) => {
    const cx = pad.l + slot * i + slot / 2;
    for (const [key, cls, dx] of [['genuine', 'bar-genuine', -bw / 2 - 2], ['spam', 'bar-spam', bw / 2 + 2]]) {
      const v = m[key];
      bars.push(svg('rect', { class: cls, x: cx + dx - bw / 2, y: y(v), width: bw, height: Math.max(0, H - pad.b - y(v)), rx: 3 }));
      bars.push(svg('text', { x: cx + dx, y: y(v) - 5, 'text-anchor': 'middle' }, String(v)));
    }
    bars.push(svg('text', { x: cx, y: H - 14, 'text-anchor': 'middle' }, m.month));
  });
  const ticks = [0, Math.round(max / 2), max].map((v) => svg('g', {},
    svg('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), stroke: 'currentColor', 'stroke-opacity': '.12' }),
    svg('text', { x: pad.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, String(v))));
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'bar-chart', role: 'img',
    'aria-label': `Bar chart: genuine and spam pull requests per month. ${data.months.map((m) => `${m.month}: ${m.genuine} genuine, ${m.spam} spam`).join('; ')}` },
    ...ticks, ...bars);
  const totals = data.stats;
  clear(root, h('section', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Genuine vs spam'),
      h('p', {}, `${totals.name}: each month shows how many pull requests Gemma marked genuine (green) and spam (red).`))),
    h('div', { class: 'panel' }, chart,
      h('div', { class: 'legend', style: { marginTop: '10px' } },
        h('span', {}, h('span', { class: 'swatch', style: { background: 'var(--ok)' }, 'aria-hidden': 'true' }), `Genuine: ${totals.vouchers}`),
        h('span', {}, h('span', { class: 'swatch', style: { background: 'var(--bad)' }, 'aria-hidden': 'true' }), `Spam: ${totals.denounces}`),
        h('span', { class: 'hint' }, `${totals.unclassified} pending`))),
  ));
}
