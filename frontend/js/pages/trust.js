// Trust page: choose "my project", tune peer weights, depth and decay, preview transitive trust, save.

import { h, clear, skeleton, errorBox, toast } from '../dom.js';
import { api, status } from '../api.js';
import { prefs, setPref } from '../state.js';
import { effectiveTrustList, DEFAULTS } from '../lib/trustMath.js';
import { fmtWeight } from '../lib/format.js';
import { term } from '../ui.js';
import * as sound from '../sound.js';

export async function mount(root) {
  clear(root, h('section', { class: 'page' }, skeleton(6)));
  let projects, edges;
  try {
    [projects, edges] = await Promise.all([api.projects(), api.trustEdges()]);
  } catch (err) {
    clear(root, errorBox(`Could not load trust settings: ${err.message}`, () => mount(root)));
    return null;
  }

  const me = () => prefs.perspective;
  let saved = new Map();   // peer -> weight as last saved
  let draft = new Map();   // peer -> weight being edited
  let depth = Number(prefs.maxDepth) || DEFAULTS.maxDepth;
  let decay = Number(prefs.decay) || DEFAULTS.decay;

  const meSel = h('select', { class: 'input', id: 'tr-me' }, projects.map((p) => h('option', { value: p.id, selected: p.id === me() }, p.name || p.id)));
  const peersBox = h('div', { class: 'stack' });
  const addSel = h('select', { class: 'input', aria: { label: 'Project to add as a peer' } });
  const addBtn = h('button', { class: 'btn btn-sm', type: 'button' }, '+ Add peer');
  const depthIn = h('input', { type: 'range', id: 'tr-depth', min: '1', max: '5', step: '1' });
  const depthOut = h('output', { class: 'mono', for: 'tr-depth' });
  const decayIn = h('input', { type: 'range', id: 'tr-decay', min: '0.5', max: '1', step: '0.05' });
  const decayOut = h('output', { class: 'mono', for: 'tr-decay' });
  const depthText = h('p', { class: 'hint' });
  const decayText = h('p', { class: 'hint' });
  const chart = h('ol', { class: 'bars', aria: { label: 'Effective transitive trust per project' } });
  const dirty = h('span', { class: 'badge tone-warn', hidden: true }, h('span', { 'aria-hidden': 'true' }, '●'), 'Unsaved changes');
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'button' }, '✓ Save');
  const resetBtn = h('button', { class: 'btn', type: 'button' }, '↺ Reset to defaults');

  clear(root, h('section', { class: 'page page-trust' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Trust settings'),
      h('p', {}, 'Choose whose records your project listens to. Trust flows transitively, fading with each hop.')),
      h('span', { style: { flex: 1 } }), dirty, resetBtn, saveBtn),
    h('div', { class: 'trust-grid' },
      h('div', { class: 'stack' },
        h('div', { class: 'panel' }, h('div', { class: 'field' }, h('label', { for: 'tr-me' }, 'My project'), meSel)),
        h('div', { class: 'panel' },
          h('div', { class: 'panel-title' }, h('h2', {}, 'Direct peers'), h('span', { class: 'hint' }, 'Trust ', term('weight'), ' 0 = ignore, 1 = full')),
          peersBox, h('div', { class: 'row', style: { marginTop: '10px' } }, addSel, addBtn)),
        h('div', { class: 'panel stack' },
          h('div', { class: 'slider-row' }, h('label', { for: 'tr-depth' }, 'Max ', term('depth')), depthIn, depthOut), depthText,
          h('div', { class: 'slider-row' }, h('label', { for: 'tr-decay' }, term('decay', 'Decay')), decayIn, decayOut), decayText,
          h('p', { class: 'hint' }, status.mode === 'live'
            ? 'Peer weights are saved to the backend. Depth and decay are preview settings stored in this browser.'
            : 'Mock mode: everything is stored in this browser and used for local evaluation.'))),
      h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, h('h2', {}, 'Effective transitive trust'), h('span', { class: 'hint' }, 'Live preview of your settings')), chart))));

  function loadFromEdges() {
    saved = new Map(edges.filter((e) => e.from === me()).map((e) => [e.to, Number(e.weight)]));
    draft = new Map(saved);
  }

  const isDirty = () => draft.size !== saved.size || [...draft].some(([k, v]) => saved.get(k) !== v)
    || depth !== (Number(prefs.maxDepth) || DEFAULTS.maxDepth) || decay !== (Number(prefs.decay) || DEFAULTS.decay);

  function renderPeers() {
    clear(peersBox, draft.size ? [...draft].map(([peer, w]) => {
      const id = `pw-${peer}`;
      const range = h('input', { type: 'range', id, min: '0', max: '1', step: '0.05', value: String(w), aria: { label: `Weight for ${peer}` } });
      const num = h('input', { class: 'input mono num', type: 'number', min: '0', max: '1', step: '0.05', value: fmtWeight(w), aria: { label: `Weight for ${peer} (number)` } });
      const set = (v) => {
        const x = Math.min(1, Math.max(0, Number(v) || 0));
        draft.set(peer, x);
        range.value = String(x);
        if (document.activeElement !== num) num.value = fmtWeight(x);
        update();
      };
      range.addEventListener('input', () => set(range.value));
      num.addEventListener('change', () => set(num.value));
      return h('div', { class: 'slider-row' }, h('label', { for: id, class: 'mono' }, peer), range, num);
    }) : h('p', { class: 'muted' }, 'No peers yet. Add one below.'));
    clear(addSel, projects.filter((p) => p.id !== me() && !draft.has(p.id)).map((p) => h('option', { value: p.id }, p.name || p.id)));
    addBtn.disabled = !addSel.options.length;
  }

  function update() {
    depthIn.value = String(depth); depthOut.textContent = String(depth);
    decayIn.value = String(decay); decayOut.textContent = fmtWeight(decay);
    depthText.textContent = `Follow trust up to ${depth} hop${depth === 1 ? '' : 's'} away. Projects further than that are ignored, even if they vouch or denounce.`;
    decayText.textContent = `Trust fades by ${Math.round((1 - decay) * 100)}% per hop: a fully trusted peer counts ${fmtWeight(decay)}, their peer ${fmtWeight(decay * decay)}, the next ${fmtWeight(decay ** 3)}.`;
    const draftEdges = edges.filter((e) => e.from !== me()).concat([...draft].map(([to, weight]) => ({ from: me(), to, weight })));
    const list = effectiveTrustList(draftEdges, me(), { maxDepth: depth, decay });
    clear(chart, list.length ? list.map((x) => h('li', { class: 'bar-row' },
      h('span', { class: 'mono bar-label' }, x.id),
      h('span', { class: 'bar-track', 'aria-hidden': 'true' }, h('span', { class: 'bar-fill', style: { transform: `scaleX(${x.trust})` } })),
      h('span', { class: 'mono bar-val' }, `${fmtWeight(x.trust)} · ${x.hops} hop${x.hops === 1 ? '' : 's'}`)))
      : h('li', { class: 'muted' }, 'Nobody is in your trust graph yet.'));
    dirty.hidden = !isDirty();
    saveBtn.disabled = !isDirty();
  }

  meSel.addEventListener('change', () => { setPref('perspective', meSel.value); loadFromEdges(); renderPeers(); update(); });
  depthIn.addEventListener('input', () => { depth = Number(depthIn.value); update(); });
  decayIn.addEventListener('input', () => { decay = Number(decayIn.value); update(); });
  addBtn.addEventListener('click', () => { if (addSel.value) { draft.set(addSel.value, 0.5); renderPeers(); update(); } });
  resetBtn.addEventListener('click', () => {
    draft = new Map(saved);
    depth = DEFAULTS.maxDepth; decay = DEFAULTS.decay;
    renderPeers(); update();
    toast('Reset to saved peers and default depth/decay. Press Save to keep.', 'cyan');
  });
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    const changed = [...draft].filter(([k, v]) => saved.get(k) !== v);
    try {
      for (const [peer, w] of changed) await api.putTrust(me(), peer, w);
      setPref('maxDepth', depth);
      setPref('decay', decay);
      edges = await api.trustEdges();
      loadFromEdges(); renderPeers(); update();
      sound.allow();
      toast(`Saved ${changed.length} peer weight${changed.length === 1 ? '' : 's'}, depth ${depth}, decay ${fmtWeight(decay)}.`, 'ok');
    } catch (err) {
      toast(`Save failed: ${err.message}`, 'bad');
      update();
    }
  });

  loadFromEdges();
  renderPeers();
  update();
  return null;
}
