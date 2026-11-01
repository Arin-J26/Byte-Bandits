// Campaigns: bursts of near-identical pull requests in this project. Only the time window and the minimum cluster
// size are chosen; the project is already selected. Gemma gives a verdict and a summary for each cluster.

import { h, clear, errorBox, emptyState, pill, toast, skeleton } from '../dom.js';
import { api } from '../api.js';
import { aiVerdictStyle } from '../lib/decision.js';
import { fmtTime } from '../lib/format.js';
import { createRadar } from './campaignRadar.js';

export async function mount(root, ctx) {
  const windowSel = h('select', { class: 'input', id: 'cp-window', 'aria-label': 'Time window' },
    [[20, 'within 20 minutes'], [60, 'within 1 hour'], [240, 'within 4 hours'], [1440, 'within 1 day']]
      .map(([v, t]) => h('option', { value: String(v), selected: v === 240 }, t)));
  const sizeIn = h('input', { class: 'input mono', id: 'cp-size', type: 'number', min: '2', max: '200', value: '5', style: { width: '110px' } });
  const runBtn = h('button', { class: 'btn btn-primary', type: 'button' }, 'Find campaigns');
  const canvas = h('canvas', { class: 'radar-canvas', role: 'img', aria: { label: 'Radar of this project’s PRs over time' } });
  const cards = h('div', { class: 'campaign-cards', 'aria-live': 'polite' });
  const proposals = h('div', { class: 'stack' });
  const replayBtn = h('button', { class: 'btn', type: 'button', disabled: true }, '▶ Replay the first campaign');
  const caption = h('p', { class: 'radar-caption', 'aria-live': 'polite' }, 'Hover an account on the ring to see its PRs. Click it to open its records.');
  const radar = createRadar(canvas);
  radar.setOnNode((key, mode) => (mode === 'account' ? ctx.go(`records?handle=${encodeURIComponent(key)}`) : null));

  let allEvents = null;
  async function loadRadar(c) {
    try {
      allEvents ??= await api.events(ctx.id);
      const focus = c ? Math.max(...c.pr_events.map((e) => Date.parse(e.timestamp))) : null;
      radar.setData(allEvents, { focus, first: c ? c.handles : [] });
    } catch { /* radar stays empty */ }
  }

  function replay(c) {
    caption.textContent = `▶ Replaying ${c.id}: ${c.pr_events.length} PRs fly in from ${c.size} accounts…`;
    caption.className = 'radar-caption';
    return radar.playReplay(c, {
      onFlag: () => {
        const where = c.projects_hit > 1 ? ` across ${c.projects_hit} projects` : '';
        caption.textContent = `✕ ${c.id} flagged: ${c.size} accounts opened ${c.pr_events.length} PRs${where} in ${c.window_minutes} minutes.`;
        caption.className = 'radar-caption tone-bad';
      },
    });
  }

  function card(c) {
    const v = aiVerdictStyle(c.ai_verdict);
    return h('article', { class: 'panel campaign-card' },
      h('div', { class: 'row' }, h('h3', { class: 'mono' }, c.id), h('span', { class: 'spacer' }), pill(v)),
      h('p', {}, c.ai_reason ? h('span', {}, c.ai_reason) : ''),
      h('p', {}, c.evidence_summary),
      h('p', { class: 'hint' }, c.ai ? '✦ Verdict and summary written by Gemma.' : '≡ Template text: Gemma did not answer in time.'),
      h('dl', { class: 'stats', style: { gridTemplateColumns: 'repeat(2, 1fr)' } }, [
        ['PRs in the cluster', c.pr_events.length], ['Accounts', c.size], ['Youngest account (days)', c.accounts_min_age_days], ['Window (minutes)', c.window_minutes],
      ].map(([l, val]) => h('div', { class: 'stat' }, h('div', { class: 'stat-num' }, String(val)), h('div', { class: 'stat-label' }, l)))),
      h('details', {}, h('summary', {}, 'Sample titles and accounts'),
        h('ul', { class: 'stack' }, [...new Set(c.pr_events.map((e) => e.title))].slice(0, 4).map((t) => h('li', { class: 'mono' }, t))),
        h('p', { class: 'hint' }, c.handles.slice(0, 8).map((x) => `@${x}`).join('  '))),
      h('button', { class: 'btn btn-sm', type: 'button', on: { click: () => suggest(c) } }, '✎ Suggest denounce records'));
  }

  async function suggest(c) {
    clear(proposals, skeleton(3));
    try {
      const res = await api.suggest(ctx.id, c.id, Number(windowSel.value), Number(sizeIn.value));
      clear(proposals, h('div', { class: 'panel' },
        h('div', { class: 'row' }, h('h2', {}, `Proposed denounce records (${res.proposals.length})`), h('span', { class: 'spacer' }),
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', on: { click: () => clear(proposals) } }, '✕ Close')),
        h('p', { class: 'tone-warn' }, '! Proposals only. Nothing has been signed, stored or sent.'),
        h('pre', { class: 'code-block mono', tabindex: '0' }, JSON.stringify(res.proposals, null, 2))));
    } catch (err) {
      clear(proposals, errorBox(err.message));
    }
  }

  let current = [];
  let played = false;
  async function run() {
    const size = Number(sizeIn.value);
    if (!Number.isInteger(size) || size < 2) { toast('A campaign needs at least 2 PRs.', 'warn'); sizeIn.focus(); return; }
    runBtn.disabled = true;
    clear(cards, skeleton(4));
    try {
      current = await api.campaigns(ctx.id, Number(windowSel.value), size);
      replayBtn.disabled = !current.length;
      await loadRadar(current[0]);
      if (current[0] && !played) { played = true; replay(current[0]); }
      clear(cards, current.length ? current.map(card) : emptyState({ icon: '⌖', title: 'No campaigns', text: 'No burst of near-identical PRs matches these settings. Try a larger window or a smaller size.' }));
    } catch (err) {
      clear(cards, errorBox(err.message, run));
    } finally {
      runBtn.disabled = false;
    }
  }

  runBtn.addEventListener('click', run);
  replayBtn.addEventListener('click', () => current[0] && replay(current[0]));

  clear(root, h('section', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Campaigns'),
      h('p', {}, 'Near-identical pull requests opened in a short window from young accounts. Gemma reviews each cluster; detection itself is deterministic.'))),
    h('div', { class: 'panel row', role: 'search', aria: { label: 'Campaign settings' } },
      h('div', { class: 'field' }, h('label', { for: 'cp-window' }, 'Time window'), windowSel),
      h('div', { class: 'field' }, h('label', { for: 'cp-size' }, 'Minimum cluster size'), sizeIn),
      h('span', { class: 'spacer' }), replayBtn, runBtn),
    h('div', { class: 'panel' }, canvas, caption),
    cards, proposals));
  run();
}
