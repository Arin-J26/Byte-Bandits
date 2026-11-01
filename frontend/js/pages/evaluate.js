// Evaluate page (the core demo): pick a perspective, type a handle, get ALLOW / REVIEW / UNKNOWN / FLAG
// with an animated explanation path, ignored records, and what-if trust sliders.

import { h, svg, clear, debounce, skeleton, errorBox, pill, toast, copyText } from '../dom.js';
import { api, status, syncTrustSettings } from '../api.js';
import { prefs, setPref, reducedMotion, trustOptions } from '../state.js';
import { decisionStyle, recordTypeStyle } from '../lib/decision.js';
import { fmtWeight, fmtSigned, viaList } from '../lib/format.js';
import { buildScene, createEvalGraph } from './evalGraph.js';
import { term, openRecordDrawer } from '../ui.js';
import * as sound from '../sound.js';

let current = null; // the mounted instance, used by the guided demo

/** Demo hook: evaluate a handle from a perspective and wait for the animation. */
export async function run(projectId, handle) {
  if (!current) throw new Error('Evaluate page is not mounted');
  return current.run(projectId, handle);
}

/** Demo hook: move a what-if slider (and save it like a user would). */
export async function setPeerWeight(peerId, weight) {
  if (!current) throw new Error('Evaluate page is not mounted');
  return current.setPeerWeight(peerId, weight);
}

const EXAMPLES = ['ada-commits', 'newbie-nora', 'borderline-ben', 'solo-denounce-sam', 'spam-bot-7731'];

/** Semicircle gauge from -1 (FLAG side) to +1 (ALLOW side) with a needle at `score`. */
function gauge(score, animate) {
  const arc = (from, to, color) => {
    const pt = (v) => { const a = Math.PI * (1 - (v + 1) / 2); return [60 + 48 * Math.cos(a), 60 - 48 * Math.sin(a)]; };
    const [x1, y1] = pt(from), [x2, y2] = pt(to);
    return svg('path', { d: `M${x1.toFixed(2)},${y1.toFixed(2)} A48,48 0 0 1 ${x2.toFixed(2)},${y2.toFixed(2)}`, class: `gauge-arc ${color}` });
  };
  const deg = Math.max(-1, Math.min(1, Number(score) || 0)) * 90;
  const needle = svg('g', { class: 'gauge-needle', style: `transform: rotate(${animate ? -90 : deg}deg)` },
    svg('line', { x1: '60', y1: '60', x2: '60', y2: '18', 'stroke-width': '3', 'stroke-linecap': 'round' }),
    svg('circle', { cx: '60', cy: '60', r: '5' }));
  const el = svg('svg', { viewBox: '0 0 120 70', class: 'gauge', role: 'img', 'aria-label': `Score ${Number(score).toFixed(2)} on a scale from minus 1 to plus 1` },
    arc(-1, -0.5, 'bad'), arc(-0.5, 0.5, 'warn'), arc(0.5, 1, 'ok'),
    svg('text', { x: '8', y: '69', class: 'gauge-tick' }, '✕ −1'), svg('text', { x: '112', y: '69', class: 'gauge-tick', 'text-anchor': 'end' }, '+1 ✓'),
    needle);
  if (animate) requestAnimationFrame(() => requestAnimationFrame(() => { needle.style.transform = `rotate(${deg}deg)`; }));
  return el;
}

export async function mount(root) {
  clear(root, h('section', { class: 'page' }, skeleton(5)));
  let projects, edges, records, events;
  try {
    [projects, edges, records, events] = await Promise.all([api.projects(), api.trustEdges(), api.records(), api.events().catch(() => []),
      syncTrustSettings(prefs.perspective)]);
  } catch (err) {
    clear(root, errorBox(`Could not load data: ${err.message}`, () => mount(root)));
    return null;
  }
  const recordsById = new Map(records.map((r) => [r.id, r]));
  const handles = [...new Set([...records.map((r) => r.subject_handle), ...events.map((e) => e.handle)].filter(Boolean))].sort();
  if (!projects.some((p) => p.id === prefs.perspective) && projects[0]) setPref('perspective', projects[0].id);

  /* ----- controls ----- */
  const projectSel = h('select', { class: 'input', id: 'ev-project' },
    projects.map((p) => h('option', { value: p.id, selected: p.id === prefs.perspective }, p.name || p.id)));
  const handleIn = h('input', {
    class: 'input mono', id: 'ev-handle', list: 'ev-handles', placeholder: 'e.g. ada-commits', autocomplete: 'off',
    spellcheck: 'false', 'data-search': '', required: true, maxlength: '100',
  });
  const datalist = h('datalist', { id: 'ev-handles' }, handles.map((x) => h('option', { value: x })));
  const goBtn = h('button', { class: 'btn btn-primary', type: 'submit', id: 'ev-go' }, '⚖ Evaluate');
  const form = h('form', { class: 'panel ev-form', aria: { label: 'Evaluate a contributor' } },
    h('div', { class: 'field' }, h('label', { for: 'ev-project' }, 'Project perspective'), projectSel),
    h('div', { class: 'field grow' }, h('label', { for: 'ev-handle' }, 'Contributor handle'), handleIn, datalist),
    goBtn);

  const quick = h('div', { class: 'row examples' });
  function renderQuick() {
    const hist = (prefs.history || []).filter((x) => x && x.handle);
    const chip = (handle, decision) => {
      const st = decision ? decisionStyle(decision) : null;
      return h('button', { class: `chip example${st ? ` tone-${st.tone}` : ''}`, type: 'button', on: { click: () => { handleIn.value = handle; evaluateNow(handle); } } },
        st ? h('span', { 'aria-hidden': 'true' }, st.icon) : null, `@${handle}`, st ? h('span', { class: 'sr-only' }, ` last result ${st.key}`) : null);
    };
    clear(quick,
      h('span', { class: 'hint' }, 'Try:'), EXAMPLES.filter((x) => handles.includes(x)).map((x) => chip(x)),
      hist.length ? h('span', { class: 'hint', style: { marginLeft: '8px' } }, 'Recent:') : null,
      hist.map((x) => chip(x.handle, x.decision)));
  }
  function remember(handle, decision) {
    const hist = (prefs.history || []).filter((x) => x.handle !== handle);
    setPref('history', [{ handle, decision }, ...hist].slice(0, 5));
    renderQuick();
  }

  /* ----- result areas ----- */
  const canvas = h('canvas', { class: 'ev-canvas', role: 'img', aria: { label: 'Trust path animation. The same information is listed under “Why”.' } });
  const graphPanel = h('div', { class: 'panel ev-graph' },
    h('div', { class: 'panel-title' }, h('h2', {}, 'Trust path'),
      h('span', { class: 'hint' }, 'Each hop multiplies by the edge ', term('weight'), ' and ', term('decay'), '; ', term('depth'), ' limit marked.')),
    canvas);
  const verdict = h('div', { class: 'panel verdict', aria: { live: 'polite' } },
    h('p', { class: 'muted' }, 'Pick a project, type a handle and press Evaluate.'));
  const why = h('div', { class: 'panel ev-why' });
  const whatIf = h('div', { class: 'panel ev-whatif' });
  const page = h('section', { class: 'page page-evaluate' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Evaluate a contributor'),
      h('p', {}, 'Sniffer follows your trust graph, weighs signed records from projects you trust, and explains the decision. Contributors with no history are UNKNOWN: normal review, never blocked.'))),
    form, quick,
    h('div', { class: 'ev-grid' }, graphPanel, verdict),
    h('div', { class: 'ev-grid2' }, why, whatIf));
  clear(root, page);
  const graph = createEvalGraph(canvas);

  /* ----- what-if sliders ----- */
  let saving = Promise.resolve();
  const sliders = new Map();
  function renderWhatIf() {
    const me = projectSel.value;
    const peers = edges.filter((e) => e.from === me);
    sliders.clear();
    const statusLine = h('p', { class: 'hint', aria: { live: 'polite' } },
      status.mode === 'live' ? 'Changes are saved to the backend with PUT /api/trust.' : 'Mock mode: changes stay in this browser and are computed locally.');
    const list = h('div', { class: 'stack' }, peers.map((e) => {
      const id = `wi-${e.to}`;
      const out = h('output', { class: 'mono', for: id }, fmtWeight(e.weight));
      const input = h('input', { type: 'range', id, min: '0', max: '1', step: '0.05', value: String(e.weight), aria: { label: `Trust weight for ${e.to}` } });
      const save = debounce(async (w) => {
        saving = (async () => {
          try {
            await api.putTrust(me, e.to, w);
            e.weight = w;
            statusLine.textContent = `Saved: ${me} → ${e.to} weight ${fmtWeight(w)}. Re-evaluating…`;
            if (lastHandle) await evaluateNow(lastHandle, { fast: true });
          } catch (err) {
            toast(`Could not save trust weight: ${err.message}`, 'bad');
          }
        })();
        return saving;
      }, 350);
      input.addEventListener('input', () => { out.textContent = fmtWeight(input.value); save(Number(input.value)); });
      sliders.set(e.to, { input, out, save });
      return h('div', { class: 'slider-row' }, h('label', { for: id, class: 'mono' }, e.to), input, out);
    }));
    clear(whatIf,
      h('div', { class: 'panel-title' }, h('h2', {}, 'What if?'), h('span', { class: 'hint' }, `Trust in ${me}'s direct peers`)),
      peers.length ? list : h('p', { class: 'muted' }, 'This project trusts nobody yet. Add peers on the Trust page.'),
      statusLine);
  }

  /* ----- verdict + explanation ----- */
  let lastHandle = '';
  let typeTimer = 0;
  let countRaf = 0;

  function renderVerdict(res, { animate }) {
    const st = decisionStyle(res.decision);
    const score = h('span', { class: 'mono verdict-score' }, animate && !reducedMotion() ? '0.00' : fmtSigned(res.score));
    const typed = h('p', { class: 'verdict-summary', 'aria-hidden': 'true' });
    const full = h('p', { class: 'sr-only' }, res.summary || '');
    clear(verdict,
      h('div', { class: `verdict-card tone-${st.tone}`, data: { decision: st.key } },
        h('div', { class: 'verdict-icon', 'aria-hidden': 'true' }, st.icon),
        h('div', {},
          h('div', { class: 'verdict-label' }, st.key),
          h('div', { class: 'muted' }, 'Score ', score, h('span', { class: 'dim' }, '  (−1 … +1)')),
          st.note ? h('p', { class: 'verdict-note' }, st.note) : null)),
      gauge(res.score, animate && !reducedMotion()),
      typed, full,
      h('p', { class: 'summary-source' },
        res.ai ? pill({ tone: 'cyan', icon: '✦', label: 'Summary by Gemma' }) : pill({ tone: 'dim', icon: '≡', label: 'Template summary' }),
        h('span', { class: 'hint' }, res.ai ? ' Local model, rewording the facts above. The decision comes from the trust engine.'
          : ' Written by code (mock mode, Ollama off, or Gemma still thinking: evaluate again in a moment).')));
    const card = verdict.firstElementChild;
    if (animate && !reducedMotion()) {
      card.classList.add(`fx-${st.key.toLowerCase()}`);
      // score count-up
      cancelAnimationFrame(countRaf);
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / 700);
        score.textContent = fmtSigned(res.score * (1 - Math.pow(1 - k, 3)));
        if (k < 1) countRaf = requestAnimationFrame(step);
      };
      countRaf = requestAnimationFrame(step);
      // typewriter summary
      clearInterval(typeTimer);
      const text = res.summary || '';
      let i = 0;
      typeTimer = setInterval(() => {
        i += 2;
        typed.textContent = text.slice(0, i);
        if (i >= text.length) clearInterval(typeTimer);
      }, 18);
    } else {
      typed.textContent = res.summary || '';
    }
  }

  function renderWhy(res) {
    const chips = (res.path || []).map((p) => {
      const rec = recordsById.get(p.record_id);
      const ts = recordTypeStyle(p.type || rec?.type || (p.effect < 0 ? 'denounce' : 'vouch'));
      return h('button', {
        class: 'chip', type: 'button', aria: { label: `${ts.label} by ${p.project}, via ${viaList(p.via).join(' to ')}, weight ${fmtWeight(p.weight)}, effect ${fmtSigned(p.effect)}. Open record.` },
        on: { click: () => openRecordDrawer(rec || { id: p.record_id, issuer: p.project, subject_handle: lastHandle, type: ts.label.toLowerCase() }) },
      },
      h('span', { class: `tone-${ts.tone}` }, ts.icon), h('span', {}, p.project),
      h('span', { class: 'sep' }, 'via'), h('span', { class: 'dim' }, viaList(p.via).join(' → ') || '—'),
      h('span', { class: 'sep' }, '·'), h('span', {}, `w ${fmtWeight(p.weight)}`),
      h('span', { class: 'sep' }, '·'), h('span', { class: `tone-${ts.tone}` }, fmtSigned(p.effect)));
    });
    const ignored = (res.ignored || []).map((ig) => {
      const rec = recordsById.get(ig.record_id);
      return h('li', { class: 'chip ignored' },
        h('span', { 'aria-hidden': 'true' }, '–'), h('span', {}, rec ? `${rec.type} by ${rec.issuer}` : ig.record_id),
        h('span', { class: 'sep' }, '·'), h('span', {}, `ignored: ${ig.reason}`));
    });
    const explain = () => [
      `Sniffer: @${lastHandle} from ${projectSel.value}'s perspective -> ${res.decision} (score ${fmtSigned(res.score)})`,
      res.summary || '',
      ...(res.path || []).map((p) => `  ${p.effect < 0 ? 'denounce' : 'vouch'} by ${p.project} via ${viaList(p.via).join(' > ')} (trust ${fmtWeight(p.weight)}, effect ${fmtSigned(p.effect)})`),
      ...(res.ignored || []).map((ig) => `  ignored ${ig.record_id}: ${ig.reason}`),
    ].join('\n');
    clear(why,
      h('div', { class: 'panel-title' }, h('h2', {}, 'Why'), h('span', { class: 'hint' }, 'Click a chip to open the signed record'),
        h('span', { class: 'spacer' }), h('button', { class: 'btn btn-sm', type: 'button', on: { click: () => copyText(explain()) } }, '⧉ Copy explanation')),
      chips.length ? h('div', { class: 'chips' }, chips) : h('p', { class: 'muted' }, 'No usable records in your trust graph.'),
      ignored.length ? h('h3', { class: 'dim', style: { marginTop: '12px' } }, `Ignored (${ignored.length})`) : null,
      ignored.length ? h('ul', { class: 'chips plain' }, ignored) : null);
  }

  async function evaluateNow(handle, { fast = false } = {}) {
    const me = projectSel.value;
    lastHandle = handle;
    goBtn.disabled = true;
    if (!fast) clear(verdict, skeleton(3));
    try {
      const res = await api.evaluate(me, handle);
      const opts = trustOptions();
      const edgeWeights = new Map(edges.map((e) => [`${e.from}>${e.to}`, Number(e.weight)]));
      graph.show(buildScene({ result: res, perspective: me, recordsById, maxDepth: opts.maxDepth, edgeWeights, decay: opts.decay }));
      renderWhy(res);
      if (!fast) { sound.whoosh(); clear(verdict, h('p', { class: 'muted' }, 'Following the trust graph…')); }
      await graph.play({ fast });
      const prevKey = verdict.querySelector('[data-decision]')?.dataset.decision;
      renderVerdict(res, { animate: !fast || prevKey !== res.decision });
      if (!fast || prevKey !== res.decision) sound.playDecision(decisionStyle(res.decision).sound);
      remember(handle, res.decision);
      return res;
    } catch (err) {
      clear(verdict, errorBox(`Evaluation failed: ${err.message}`, () => evaluateNow(handle)));
      return null;
    } finally {
      goBtn.disabled = false;
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const handle = handleIn.value.trim().replace(/^@/, '');
    if (!handle) { handleIn.focus(); toast('Type a contributor handle first.', 'warn'); return; }
    evaluateNow(handle);
  });
  projectSel.addEventListener('change', async () => {
    setPref('perspective', projectSel.value);
    await syncTrustSettings(projectSel.value);
    renderWhatIf();
    if (lastHandle) evaluateNow(lastHandle);
  });

  renderWhatIf();
  renderQuick();
  current = {
    async run(projectId, handle) {
      if (projectId && projectSel.value !== projectId) { projectSel.value = projectId; setPref('perspective', projectId); renderWhatIf(); }
      handleIn.value = handle;
      return evaluateNow(handle);
    },
    async setPeerWeight(peerId, weight) {
      const s = sliders.get(peerId);
      if (!s) throw new Error(`${projectSel.value} has no peer ${peerId}`);
      s.input.value = String(weight);
      s.input.dispatchEvent(new Event('input'));
      s.input.focus();
      await new Promise((r) => setTimeout(r, 400));
      await saving;
    },
  };

  const pre = new URLSearchParams(location.hash.split('?')[1] || '').get('h');
  if (pre) { handleIn.value = pre; evaluateNow(pre); } else handleIn.focus();

  return () => { current = null; clearInterval(typeTimer); cancelAnimationFrame(countRaf); graph.destroy(); };
}
