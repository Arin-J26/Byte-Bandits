// Campaigns page: radar/timeline of PR events, spam-wave replay, evidence cards, live ticker.

import { h, clear, skeleton, errorBox, emptyState, pill, toast } from '../dom.js';
import { api, status } from '../api.js';
import { prefs, reducedMotion, on } from '../state.js';
import { filterCampaigns, campaignFacts, burstScore, binEvents } from '../lib/campaignStats.js';
import { signatureStyle } from '../lib/decision.js';
import { fmtAgo, fmtTime } from '../lib/format.js';
import { createRadar } from './campaignRadar.js';

let current = null;

/** Demo hook: replay the largest visible campaign. */
export async function replay() {
  if (!current) throw new Error('Campaigns page is not mounted');
  return current.replay();
}

const KIND = {
  pr: { tone: 'cyan', icon: '⇡', label: 'PR' },
  vouch: { tone: 'ok', icon: '✓', label: 'Vouch' },
  denounce: { tone: 'bad', icon: '✕', label: 'Denounce' },
};

export async function mount(root) {
  clear(root, h('section', { class: 'page' }, skeleton(6)));
  let campaigns, events, projects;
  try {
    [campaigns, events, projects] = await Promise.all([api.campaigns(), api.events(), api.projects()]);
  } catch (err) {
    clear(root, errorBox(`Could not load campaigns: ${err.message}`, () => mount(root)));
    return null;
  }

  /* ----- filters ----- */
  const projSel = h('select', { class: 'input', id: 'cf-project' }, h('option', { value: '' }, 'All projects'),
    projects.map((p) => h('option', { value: p.id }, p.name || p.id)));
  const winSel = h('select', { class: 'input', id: 'cf-window' },
    [['0', 'Any window'], ['20', '≤ 20 minutes'], ['60', '≤ 1 hour'], ['360', '≤ 6 hours']].map(([v, t]) => h('option', { value: v }, t)));
  const sizeIn = h('input', { class: 'input mono', id: 'cf-size', type: 'number', min: '0', max: '500', value: '0', style: { width: '90px' } });
  const replayBtn = h('button', { class: 'btn btn-danger', type: 'button', id: 'replay-btn' }, '▶ Replay spam wave');
  const filters = h('div', { class: 'panel row filters', role: 'group', aria: { label: 'Campaign filters' } },
    h('div', { class: 'field' }, h('label', { for: 'cf-project' }, 'Project'), projSel),
    h('div', { class: 'field' }, h('label', { for: 'cf-window' }, 'Time window'), winSel),
    h('div', { class: 'field' }, h('label', { for: 'cf-size' }, 'Min cluster size'), sizeIn),
    h('span', { class: 'spacer', style: { flex: 1 } }), replayBtn);

  const canvas = h('canvas', { class: 'radar-canvas', role: 'img', aria: { label: 'Radar of recent PR events by project, with a timeline of event bursts below.' } });
  const flash = h('div', { class: 'flash-overlay', 'aria-hidden': 'true' });
  const radarStat = h('p', { class: 'hint', aria: { live: 'polite' } });
  const cards = h('div', { class: 'campaign-cards' });
  const proposals = h('div', { class: 'proposals', aria: { live: 'polite' } });
  const ticker = h('ol', { class: 'ticker', aria: { label: 'Recent events' } });

  clear(root, h('section', { class: 'page page-campaigns' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Coordinated campaigns'),
      h('p', {}, 'Bursts of near-identical PRs from young accounts across many projects. Sniffer clusters them and shows the evidence, so maintainers can decide.'))),
    filters,
    h('div', { class: 'camp-grid' },
      h('div', { class: 'panel radar-panel' }, h('div', { class: 'radar-wrap' }, canvas, flash), radarStat),
      h('div', { class: 'panel ticker-panel' }, h('div', { class: 'panel-title' }, h('h2', {}, 'Live ticker'),
        h('span', { class: 'hint' }, status.mode === 'live' ? 'From /api/events' : 'Mock: replaying sample events')), ticker)),
    h('h2', { style: { marginTop: '16px' } }, 'Evidence'),
    cards, proposals));

  const radar = createRadar(canvas);

  function visible() {
    const project = projSel.value;
    const windowMinutes = Number(winSel.value);
    const minSize = Number(sizeIn.value) || 0;
    const camps = filterCampaigns(campaigns, { project, windowMinutes, minSize }).sort((a, b) => b.size - a.size);
    let evts = project ? events.filter((e) => e.project === project) : events;
    if (windowMinutes && evts.length) {
      const latest = Math.max(...evts.map((e) => Date.parse(e.timestamp)));
      evts = evts.filter((e) => latest - Date.parse(e.timestamp) <= windowMinutes * 60_000);
    }
    return { camps, evts };
  }

  function render() {
    const { camps, evts } = visible();
    radar.setData(evts);
    radarStat.textContent = `${evts.length} events · burst score ${burstScore(binEvents(evts, { binMinutes: 5 }))} (how far the busiest 5-minute window stands above normal)`;
    replayBtn.disabled = !camps.length;
    clear(cards, camps.length ? camps.map(card) : emptyState({
      icon: '⌖', title: 'No campaigns match these filters', text: 'Loosen the filters, or generate a network with a spam campaign.',
      actionLabel: 'Go to Simulate', href: '#/simulate',
    }));
  }

  function card(c) {
    const f = campaignFacts(c);
    const fact = (label, value) => h('div', { class: 'fact' }, h('dt', {}, label), h('dd', { class: 'mono' }, String(value ?? '—')));
    return h('article', { class: 'panel campaign-card', aria: { labelledby: `cc-${c.id}` } },
      h('div', { class: 'panel-title' }, h('h3', { id: `cc-${c.id}`, class: 'mono' }, c.id), h('span', { class: 'spacer' }),
        pill({ tone: 'bad', icon: '✕', label: 'Coordinated' })),
      h('p', {}, c.evidence_summary || ''),
      h('dl', { class: 'facts' },
        fact('Near-identical PRs', f.prCount), fact('Accounts', f.accounts), fact('Min account age', `${f.minAge} days`),
        fact('Projects hit', f.projectsHit), fact('Time window', `${f.window} min`)),
      h('p', { class: 'hint' }, 'Similarity: ', h('span', { class: 'mono' }, f.method)),
      h('details', {}, h('summary', {}, 'Sample of clustered titles and handles'),
        h('h4', {}, 'Titles'), h('ul', {}, f.sampleTitles.map((t) => h('li', { class: 'mono' }, t))),
        h('h4', {}, 'Handles'), h('ul', { class: 'chips plain' }, f.sampleHandles.map((x) => h('li', { class: 'chip' }, `@${x}`)))),
      h('button', { class: 'btn btn-sm', type: 'button', on: { click: () => suggest(c) } }, '✎ Suggest denounce records'));
  }

  /** Only displays proposals. Nothing is signed or sent. */
  function suggest(c) {
    const me = prefs.perspective;
    const handles = [...new Set((c.pr_events || []).map((e) => e.handle))];
    const drafts = handles.map((handle) => ({
      issuer: me, subject_handle: handle, type: 'denounce',
      reason: `Part of coordinated campaign ${c.id}: ${c.size} accounts, ${c.window_minutes}-minute window`,
      evidence_urls: [],
    }));
    clear(proposals, h('div', { class: 'panel' },
      h('div', { class: 'panel-title' }, h('h2', {}, `Proposed denounce records (${drafts.length})`), h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', aria: { label: 'Close proposals' }, on: { click: () => clear(proposals) } }, '✕')),
      h('p', { class: 'tone-warn' }, '! Nothing has been sent or signed. These are drafts for a maintainer to review; each project decides on its own.'),
      h('pre', { class: 'mono code-block', tabindex: '0' }, JSON.stringify(drafts, null, 2))));
    proposals.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
  }

  /* ----- ticker ----- */
  const sorted = [...events].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  let shown = sorted.slice(0, 10);
  let pool = sorted.slice(10);
  function tickerItem(e, fresh = false) {
    const k = KIND[e.kind] || KIND.pr;
    return h('li', { class: `ticker-item${fresh ? ' fresh' : ''}` },
      pill(k), h('span', { class: 'mono' }, `@${e.handle}`), h('span', { class: 'dim' }, '→'), h('span', { class: 'mono' }, e.project),
      h('span', { class: 'ticker-title' }, e.title || ''),
      pill(signatureStyle(e.signature_valid), 'sig'),
      h('time', { class: 'dim mono', datetime: e.timestamp, title: fmtTime(e.timestamp) }, fmtAgo(e.timestamp, Date.parse(sorted[0]?.timestamp || Date.now()))));
  }
  const renderTicker = () => clear(ticker, shown.length ? shown.map((e, i) => tickerItem(e, i === 0 && e._fresh)) : h('li', { class: 'muted' }, 'No events yet.'));
  renderTicker();
  let tickTimer = 0;
  const startTicker = () => {
    clearInterval(tickTimer);
    if (reducedMotion() || status.mode === 'live' || !pool.length) return;
    tickTimer = setInterval(() => {
      if (document.hidden) return;
      const next = pool.shift();
      pool.push(shown.pop());
      shown = [{ ...next, _fresh: true }, ...shown];
      renderTicker();
    }, 4000);
  };
  startTicker();
  const offMotion = on('motion', () => { startTicker(); radar.restart(); });
  let liveTimer = 0;
  if (status.mode === 'live') {
    liveTimer = setInterval(async () => {
      if (document.hidden) return;
      try { events = await api.events(); shown = [...events].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)).slice(0, 10); renderTicker(); } catch { /* banner handles it */ }
    }, 10_000);
  }

  /* ----- replay ----- */
  let flashes = 0;
  function redFlash() {
    if (reducedMotion()) return;
    // Two flashes, 400 ms apart: max 2.5 per second (limit is 3).
    flashes = 0;
    const once = () => {
      flash.classList.remove('on');
      void flash.offsetWidth;
      flash.classList.add('on');
      if (++flashes < 2) setTimeout(once, 400);
    };
    once();
  }
  async function doReplay() {
    const { camps } = visible();
    const c = camps[0];
    if (!c) { toast('No campaign to replay with these filters.', 'warn'); return; }
    replayBtn.disabled = true;
    radarStat.textContent = `Replaying ${c.id}: ${c.pr_events?.length || 0} PR events…`;
    await radar.playReplay(c, {
      onFlag: () => {
        redFlash();
        radarStat.textContent = `✕ ${c.id} flagged: ${c.size} accounts hit ${c.projects_hit} projects in ${c.window_minutes} minutes.`;
      },
    });
    replayBtn.disabled = false;
  }
  replayBtn.addEventListener('click', doReplay);
  for (const el of [projSel, winSel, sizeIn]) el.addEventListener('change', render);
  sizeIn.addEventListener('input', render);
  render();

  current = { replay: doReplay };
  return () => { current = null; clearInterval(tickTimer); clearInterval(liveTimer); offMotion(); radar.destroy(); };
}
