// Guided demo: spotlight overlay that drives the real UI through an 8-minute pitch.
// Next/Back/Esc, keyboard accessible, works in mock and live mode.

import { h, clear, trapFocus, toast } from './dom.js';

const ME = 'lumen-ui';

const STEPS = [
  {
    title: 'Load the network', time: '0:00 – 1:00', route: 'simulate', spot: '.sim-grid',
    text: '25 open-source projects, each publishing signed vouch and denounce records, and choosing which other projects they trust. No central authority.',
    run: ({ pages }) => pages.simulate.loadDemoNetwork(),
  },
  {
    title: 'A vouched contributor: ALLOW', time: '1:00 – 2:30', route: 'evaluate', spot: '.ev-grid',
    text: 'From Lumen UI\'s point of view, @ada-commits is vouched for by Nebula DB (1 hop, 0.80) and quasar-cli (2 hops, 0.64). Shadow Registry denounced her, but Lumen UI does not trust Shadow Registry, so that record is ignored.',
    run: ({ pages }) => pages.evaluate.run(ME, 'ada-commits'),
  },
  {
    title: 'An honest newcomer: UNKNOWN', time: '2:30 – 3:30', route: 'evaluate', spot: '.verdict',
    text: '@newbie-nora has no history anywhere. Sniffer says UNKNOWN: normal review, never blocked. Newcomers are not punished for being new.',
    run: ({ pages }) => pages.evaluate.run(ME, 'newbie-nora'),
  },
  {
    title: 'A coordinated spam wave', time: '3:30 – 5:00', route: 'campaigns', spot: '.radar-panel',
    text: '12 accounts, the oldest 2 days old, open near-identical README typo PRs on 9 projects in 18 minutes. Sniffer clusters them and flags the campaign, with the evidence below.',
    run: ({ pages }) => pages.campaigns.replay(),
  },
  {
    title: 'Trust is yours to tune', time: '5:00 – 6:30', route: 'evaluate', spot: '.ev-grid2',
    text: '@borderline-ben is vouched for only by PyForge. Lowering Lumen UI\'s trust in PyForge from 0.80 to 0.50 drops his score below the ALLOW line, and the decision changes to REVIEW, live.',
    run: async ({ pages, state }) => {
      await pages.evaluate.run(ME, 'borderline-ben');
      await new Promise((r) => setTimeout(r, 900));
      state.restorePyforge = true;
      await pages.evaluate.setPeerWeight('pyforge', 0.5);
    },
  },
  {
    title: 'One denounce is not a verdict', time: '6:30 – 8:00', route: 'evaluate', spot: '.ev-grid',
    text: '@solo-denounce-sam was denounced by one trusted project. That is a soft signal: REVIEW, not FLAG. FLAG needs at least two independent trusted projects, so one grudge cannot block anyone.',
    run: ({ pages }) => pages.evaluate.run(ME, 'solo-denounce-sam'),
  },
];

let running = false;
export const isDemoRunning = () => running;

export function startDemo({ go, pages }) {
  if (running) return;
  running = true;
  const root = document.getElementById('overlay-root');
  const spot = h('div', { class: 'demo-spot', 'aria-hidden': 'true' });
  const title = h('h2', { id: 'demo-title' });
  const time = h('p', { class: 'timing' });
  const body = h('p');
  const stat = h('p', { class: 'hint', aria: { live: 'polite' } });
  const bar = h('div');
  const back = h('button', { class: 'btn btn-sm', type: 'button' }, '← Back');
  const next = h('button', { class: 'btn btn-sm btn-primary', type: 'button' }, 'Next →');
  const exit = h('button', { class: 'btn btn-sm btn-ghost', type: 'button' }, 'Exit (Esc)');
  const card = h('div', { class: 'demo-card', role: 'dialog', 'aria-modal': 'false', aria: { labelledby: 'demo-title' } },
    time, title, h('div', { class: 'progress', 'aria-hidden': 'true' }, bar), body, stat, h('div', { class: 'row' }, back, next, exit));
  clear(root, spot, card);

  const state = { restorePyforge: false };
  let i = 0;
  let token = 0;

  function place() {
    const el = document.querySelector(STEPS[i].spot);
    if (!el) { spot.style.opacity = '0'; return; }
    const r = el.getBoundingClientRect();
    Object.assign(spot.style, { opacity: '1', left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
  }

  async function show(n) {
    i = Math.max(0, Math.min(STEPS.length - 1, n));
    const step = STEPS[i];
    const my = ++token;
    title.textContent = `${i + 1}/${STEPS.length} · ${step.title}`;
    time.textContent = `⏱ ${step.time}`;
    body.textContent = step.text;
    bar.style.width = `${((i + 1) / STEPS.length) * 100}%`;
    back.disabled = i === 0;
    next.textContent = i === STEPS.length - 1 ? 'Finish ✓' : 'Next →';
    stat.textContent = 'Running…';
    try {
      await go(step.route);
      if (my !== token) return;
      document.querySelector(step.spot)?.scrollIntoView({ block: 'center' });
      place();
      await step.run({ pages, state });
      if (my !== token) return;
      stat.textContent = 'Done. Press Next when ready.';
    } catch (err) {
      if (my === token) stat.textContent = `This step could not run: ${err.message}`;
    }
    place();
    if (my === token) next.focus(); // pages may have moved focus while running
  }
  const onEsc = (e) => { if (e.key === 'Escape') { e.preventDefault(); end(); } };

  async function end() {
    if (!running) return;
    running = false;
    token++;
    release();
    document.removeEventListener('keydown', onEsc);
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place, true);
    root.replaceChildren();
    if (state.restorePyforge) {
      try {
        await go('evaluate');
        await pages.evaluate.setPeerWeight('pyforge', 0.8);
        toast('Demo finished. PyForge trust restored to 0.80.', 'ok');
      } catch { /* page may have changed */ }
    }
  }

  back.addEventListener('click', () => show(i - 1));
  next.addEventListener('click', () => (i === STEPS.length - 1 ? end() : show(i + 1)));
  exit.addEventListener('click', end);
  const release = trapFocus(card, end);
  document.addEventListener('keydown', onEsc);
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);
  show(0);
}
