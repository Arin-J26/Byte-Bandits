// Evaluate: one contributor, decided from this maintainer's classified PRs with the same trust rules as before.
// The animated path, verdict card and explanation work as before; the contributor's GitHub record is checked on demand.

import { h, clear, errorBox, toast } from '../dom.js';
import { api } from '../api.js';
import { decisionStyle } from '../lib/decision.js';
import { fmtSigned } from '../lib/format.js';
import { buildScene, createEvalGraph } from './evalGraph.js';
import { meter, decisionBadge, decisionControls } from '../widgets.js';
import * as sound from '../sound.js';

export async function mount(root, ctx) {
  const handleIn = h('input', { class: 'input mono', id: 'ev-handle', list: 'ev-handles', placeholder: 'GitHub username to evaluate', maxlength: '39', autocomplete: 'off', required: true });
  const datalist = h('datalist', { id: 'ev-handles' });
  const goBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, '⚖ Evaluate');
  const canvas = h('canvas', { class: 'ev-canvas', role: 'img', aria: { label: 'Trust path animation for the evaluated contributor' } });
  const verdict = h('div', { class: 'panel', 'aria-live': 'polite' }, h('p', { class: 'muted' }, 'Choose a contributor to see the decision.'));
  const why = h('div', { class: 'panel' });
  const github = h('div', { class: 'panel', 'aria-live': 'polite' });
  const graph = createEvalGraph(canvas);

  try {
    datalist.append(...(await api.contributors(ctx.id)).map((n) => h('option', { value: n })));
  } catch { /* typing still works */ }

  async function evaluate(handle) {
    goBtn.disabled = true;
    clear(verdict, h('div', { class: 'skeleton', style: { height: '140px' } }));
    try {
      const res = await api.evaluate(ctx.id, handle);
      const st = decisionStyle(res.decision);
      const scene = buildScene({ result: res, perspective: ctx.id, recordsById: new Map(), maxDepth: 3, edgeWeights: null, decay: 0.8 });
      graph.show(scene);
      clear(verdict,
        h('div', { class: `verdict-card tone-${st.tone}`, data: { decision: st.key } },
          h('div', { class: 'verdict-icon', 'aria-hidden': 'true' }, st.icon),
          h('div', {}, h('div', { class: 'verdict-label' }, st.key), h('div', { class: 'muted' }, 'Score ', h('span', { class: 'mono' }, fmtSigned(res.score)), ' (−1 … +1)'))),
        h('p', { class: 'verdict-summary' }, res.summary),
        meter(res.spam_weight, { label: 'Spam weight (share of their classified PRs)' }),
        h('div', { class: 'row' }, decisionBadge(res.maintainer_decision),
          decisionControls(ctx.id, handle, res.maintainer_decision, (d) => { res.maintainer_decision = d; evaluate(handle); })),
        h('p', { class: 'hint' }, res.ai ? '✦ Summary written by Gemma (local model). The decision comes from the trust rules.'
          : '≡ Template summary: Gemma did not answer in time or is offline. The decision is unchanged.'));
      clear(why, h('h2', {}, 'Why'),
        res.path.length ? h('ul', { class: 'stack plain' }, res.path.map((p) => h('li', { class: 'mono' },
          `${p.type === 'denounce' ? '✕' : '✓'} ${p.project}: ${p.type === 'denounce' ? 'denounce' : 'vouch'} (effect ${fmtSigned(p.effect)})`)))
          : h('p', { class: 'muted' }, 'No classified PRs for this contributor in this project yet.'),
        res.ignored.length ? h('p', { class: 'hint' }, `Ignored: ${res.ignored.map((i) => i.reason).join('; ')}`) : null);
      await graph.play({ fast: false });
      sound.playDecision(st.sound);
      toast(`${handle}: ${st.key}`, st.tone === 'ok' ? 'ok' : st.tone === 'bad' ? 'bad' : 'warn', 3000);
    } catch (err) {
      clear(verdict, errorBox(err.message, () => evaluate(handle)));
    } finally {
      goBtn.disabled = false;
    }
  }

  async function checkGithub(handle) {
    clear(github, h('div', { class: 'skeleton', style: { height: '90px' } }));
    try {
      const g = await api.github(ctx.id, handle);
      clear(github,
        h('h2', {}, 'On GitHub'),
        h('p', {}, g.summary),
        h('dl', { class: 'stats', style: { marginTop: '10px' } }, [
          ['Other repos with merged PRs', g.repos_with_merged_prs, 'cyan'],
          ['Merged PRs found', g.merged_prs_found + (g.search_capped ? '+' : ''), ''],
          ['Account age (days)', g.account_age_days, ''],
          ['Public repos', g.public_repos, ''],
        ].map(([label, value, tone]) => h('div', { class: `stat ${tone}` }, h('div', { class: 'stat-num' }, String(value)), h('div', { class: 'stat-label' }, label)))),
        h('p', { class: 'hint' }, 'GitHub publishes no vouch or denounce feature. These are the public facts it does show, read live (cached 12 hours).'),
        g.top_repos.length ? h('p', { class: 'hint mono' }, g.top_repos.join(', ')) : null);
    } catch (err) {
      clear(github, errorBox(`GitHub check failed: ${err.message}`, () => checkGithub(handle)));
    }
  }

  const form = h('form', { class: 'panel row', role: 'search', aria: { label: 'Evaluate a contributor' } },
    h('div', { class: 'field', style: { flex: '1 1 260px' } }, h('label', { for: 'ev-handle' }, 'Contributor handle'), handleIn, datalist),
    goBtn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const handle = handleIn.value.trim().replace(/^@/, '');
    if (!handle) { handleIn.focus(); return; }
    evaluate(handle);
    checkGithub(handle);
  });

  clear(root, h('section', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Evaluate a contributor'),
      h('p', {}, 'Decided from this project’s classified PRs and the other projects of the same maintainer. Contributors with no history are UNKNOWN: normal review, never blocked.'))),
    form,
    h('div', { class: 'panel', style: { height: '260px' } }, canvas),
    h('div', { class: 'grid-2' }, verdict, why),
    github));
}
