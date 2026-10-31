// Graph page: projects as nodes, trust edges sized by weight, flagged accounts as red diamonds.

import { h, clear, debounce, skeleton, emptyState, errorBox, pill } from '../dom.js';
import { api } from '../api.js';
import { prefs, reducedMotion, on } from '../state.js';
import { colors, rgba } from '../theme.js';
import { toElements, flaggedAccounts, neighbours } from '../lib/graphData.js';
import { recordTypeStyle } from '../lib/decision.js';
import { fmtWeight, fmtAgo } from '../lib/format.js';
import { term, openRecordDrawer } from '../ui.js';
import * as sound from '../sound.js';

/**
 * Cytoscape stylesheet built from the current theme tokens.
 * Sizes are divided by ~zoom (semantic zoom, like a map): dots and labels keep roughly the same
 * size on screen while the distances between them grow as you zoom in.
 */
function buildStyle(zoom = 1) {
  const k = colors();
  const s = 1 / Math.pow(Math.max(0.05, zoom), 0.85);
  const bg = k.dark ? '#0e2a35' : k.surface;
  const showLabels = zoom >= 0.55 ? 1 : 0;
  return [
    { selector: 'node', style: {
      'background-color': bg, 'border-color': k.accent, 'border-width': 2 * s, label: 'data(label)',
      color: k.text, 'font-size': 11 * s, 'font-family': 'ui-monospace, Menlo, monospace', 'text-valign': 'bottom',
      'text-margin-y': 4 * s, width: `mapData(deg, 0, 10, ${16 * s}, ${36 * s})`, height: `mapData(deg, 0, 10, ${16 * s}, ${36 * s})`,
      'text-outline-color': k.dark ? '#07090f' : k.surface, 'text-outline-width': 2 * s, 'text-opacity': showLabels,
      'transition-property': 'opacity', 'transition-duration': '150ms',
    } },
    { selector: 'node[?me]', style: {
      'background-color': k.accent, 'border-color': k.dark ? k.text : k.surface, 'border-width': 3 * s,
      'underlay-color': k.accent, 'underlay-padding': 10 * s, 'underlay-opacity': 0.22, 'underlay-shape': 'ellipse',
    } },
    { selector: 'node[kind="account"]', style: {
      shape: 'diamond', 'background-color': k.dark ? '#3a0d14' : rgba(k.badRgb, 0.1), 'border-color': k.bad, color: k.bad,
      width: 20 * s, height: 20 * s,
    } },
    { selector: 'edge', style: {
      width: `mapData(weight, 0, 1, ${0.8 * s}, ${4 * s})`, opacity: 'data(opacity)', 'line-color': k.accent, 'target-arrow-color': k.accent,
      'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'arrow-scale': 0.7,
    } },
    { selector: 'edge[kind="denounce"]', style: { 'line-color': k.bad, 'target-arrow-color': k.bad, 'line-style': 'dashed', width: 1.5 * s } },
    { selector: 'edge[kind="campaign"]', style: { 'line-color': k.bad, 'target-arrow-color': k.bad, 'line-style': 'dotted', 'target-arrow-shape': 'tee', width: 1 * s } },
    { selector: '.faded', style: { opacity: 0.12 } },
    { selector: '.dimmed', style: { opacity: 0.1 } },
    { selector: 'edge.flow', style: { 'line-style': 'dashed', 'line-dash-pattern': [8 * s, 6 * s], opacity: 1, 'line-color': rgba(k.accent2Rgb, 1), 'target-arrow-color': rgba(k.accent2Rgb, 1) } },
    { selector: 'node.focus', style: { 'underlay-color': rgba(k.accent2Rgb, 1), 'underlay-padding': 8 * s, 'underlay-opacity': 0.25, 'underlay-shape': 'ellipse' } },
    { selector: 'node.hl', style: { 'border-color': k.warn, 'border-width': 4 * s, 'font-weight': 'bold', 'z-index': 10 } },
    { selector: 'node:selected', style: { 'border-color': k.dark ? '#ffffff' : k.text, 'border-width': 4 * s, 'overlay-opacity': 0 } },
    // Important nodes keep their label even when zoomed far out.
    { selector: 'node[?me], node:selected, node.hl, node.focus', style: { 'text-opacity': 1 } },
    { selector: 'edge.hl', style: { opacity: 1 } },
  ];
}

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;

/**
 * Map-style zoom: wheel / pinch / double-click / +- keys ease smoothly toward the cursor,
 * and the stylesheet is rebuilt (once per frame at most) so nodes keep a steady on-screen size.
 */
function smoothZoom(cy, box) {
  cy.userZoomingEnabled(false);
  let target = cy.zoom();
  let anchor = { x: box.clientWidth / 2, y: box.clientHeight / 2 };
  let raf = 0;
  let styleRaf = 0;
  let styledAt = cy.zoom();
  let ours = false;
  const clamp = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

  const restyle = () => {
    styleRaf = 0;
    if (Math.abs(cy.zoom() / styledAt - 1) < 0.015) return;
    styledAt = cy.zoom();
    cy.style(buildStyle(styledAt));
  };
  cy.on('zoom', () => {
    if (!ours) target = cy.zoom(); // fit / animate / programmatic zoom
    if (!styleRaf) styleRaf = requestAnimationFrame(restyle);
  });

  const step = () => {
    const z = cy.zoom();
    const next = z + (target - z) * 0.2; // ease-out toward the target
    ours = true;
    cy.zoom({ level: Math.abs(target - next) / target < 0.002 ? target : next, renderedPosition: anchor });
    ours = false;
    raf = cy.zoom() === target ? 0 : requestAnimationFrame(step);
  };
  const zoomTo = (level, at) => {
    target = clamp(level);
    if (at) anchor = at;
    if (reducedMotion()) {
      ours = true; cy.zoom({ level: target, renderedPosition: anchor }); ours = false;
      return;
    }
    if (!raf) raf = requestAnimationFrame(step);
  };
  const local = (e) => { const r = box.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const centre = () => ({ x: box.clientWidth / 2, y: box.clientHeight / 2 });

  const onWheel = (e) => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    // Pinch on a trackpad arrives as ctrl+wheel with small deltas: zoom faster for those.
    zoomTo(target * Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0022)), local(e));
  };
  box.addEventListener('wheel', onWheel, { passive: false });
  cy.on('dbltap', (e) => zoomTo(target * (e.originalEvent?.shiftKey ? 0.5 : 2), e.renderedPosition));
  box.tabIndex = 0;
  const onKey = (e) => {
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomTo(target * 1.5, centre()); }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomTo(target / 1.5, centre()); }
  };
  box.addEventListener('keydown', onKey);

  return {
    zoomIn: () => zoomTo(target * 1.6, centre()),
    zoomOut: () => zoomTo(target / 1.6, centre()),
    restyleNow: () => { styledAt = cy.zoom(); cy.style(buildStyle(styledAt)); },
    destroy: () => { cancelAnimationFrame(raf); cancelAnimationFrame(styleRaf); box.removeEventListener('wheel', onWheel); box.removeEventListener('keydown', onKey); },
  };
}

function layout(cy, randomize = false) {
  cy.layout({
    name: 'cose', animate: !reducedMotion(), animationDuration: 600, randomize, padding: 30,
    nodeRepulsion: () => 14000, idealEdgeLength: () => 95, gravity: 0.4, numIter: 1200,
  }).run();
}

function legend() {
  const item = (sym, cls, text) => h('li', { class: 'row' }, h('span', { class: `legend-sym ${cls}`, 'aria-hidden': 'true' }, sym), text);
  return h('ul', { class: 'legend', aria: { label: 'Legend' } },
    item('●', 'tone-cyan', 'Project'),
    item('◉', 'legend-me', 'Your project'),
    item('◆ ✕', 'tone-bad', 'Flagged account'),
    item('→', 'tone-cyan', h('span', {}, 'Trust ', term('edge', 'edge'), ' (thicker = higher ', term('weight'), ')')),
    item('⇢ ✕', 'tone-bad', 'Denounce (dashed)'),
    item('┈ ⊣', 'tone-bad', 'Campaign PR target (dotted)'),
    item('◇', 'tone-warn', 'Search match'));
}

export async function mount(root) {
  const search = h('input', { class: 'input mono', type: 'search', placeholder: 'Search project or handle…', 'data-search': '', aria: { label: 'Search graph' } });
  const jump = h('select', { class: 'input', aria: { label: 'Jump to project (keyboard alternative to clicking nodes)' } }, h('option', { value: '' }, 'Jump to node…'));
  const fitBtn = h('button', { class: 'btn', type: 'button' }, '⤢ Fit');
  const resetBtn = h('button', { class: 'btn', type: 'button' }, '↻ Reset layout');
  const canvasBox = h('div', { class: 'graph-canvas', role: 'img', aria: { label: 'Trust graph' } });
  const side = h('aside', { class: 'panel graph-side', aria: { live: 'polite', label: 'Selected node details' } },
    h('h2', {}, 'Details'), h('p', { class: 'muted' }, 'Click a node (or use “Jump to node”) to see who it trusts, who trusts it and its recent records.'));
  const status = h('p', { class: 'hint', aria: { live: 'polite' } });
  const page = h('section', { class: 'page page-graph' },
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Trust graph'),
        h('p', {}, 'Every project publishes signed records and chooses whose records it trusts. Edges point from truster to trusted.'))),
    h('div', { class: 'row toolbar' }, search, jump, fitBtn, resetBtn, status),
    h('div', { class: 'graph-layout' }, h('div', { class: 'panel graph-main' }, canvasBox, legend()), side));
  clear(root, h('section', { class: 'page' }, skeleton(6)));

  let data;
  try {
    data = await api.network();
  } catch (err) {
    clear(root, errorBox(`Could not load the network: ${err.message}`, () => mount(root)));
    return null;
  }
  if (!data.projects.length) {
    clear(root, h('section', { class: 'page' }, emptyState({
      icon: '◎', title: 'No network loaded yet', text: 'Generate a synthetic network of projects, trust edges and records to explore.',
      actionLabel: 'Go to Simulate', href: '#/simulate',
    })));
    return null;
  }
  clear(root, page);
  if (typeof window.cytoscape !== 'function') {
    clear(canvasBox, errorBox('Cytoscape.js is missing. Place cytoscape.min.js in frontend/vendor/ (see vendor/README.md).'));
    return null;
  }

  const flagged = flaggedAccounts(data.records, data.campaigns);
  const elements = toElements({ projects: data.projects, edges: data.trust_edges, flagged, perspective: prefs.perspective });
  canvasBox.setAttribute('aria-label', `Trust graph: ${data.projects.length} projects, ${data.trust_edges.length} trust edges, ${flagged.length} flagged accounts. Use “Jump to node” to inspect with the keyboard.`);
  status.textContent = `${data.projects.length} projects · ${data.trust_edges.length} edges · ${flagged.length} flagged`;

  const cy = window.cytoscape({ container: canvasBox, elements, style: buildStyle(), minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM });
  const zoom = smoothZoom(cy, canvasBox);
  const zoomIn = h('button', { class: 'btn btn-icon map-btn', type: 'button', aria: { label: 'Zoom in (+)' }, on: { click: () => zoom.zoomIn() } }, '+');
  const zoomOut = h('button', { class: 'btn btn-icon map-btn', type: 'button', aria: { label: 'Zoom out (−)' }, on: { click: () => zoom.zoomOut() } }, '−');
  canvasBox.parentElement.append(h('div', { class: 'map-controls', role: 'group', aria: { label: 'Zoom' } }, zoomIn, zoomOut),
    h('p', { class: 'map-hint hint' }, 'Scroll or pinch to zoom · double-click to zoom in · drag to pan'));
  cy.nodes().forEach((n) => { n.data('deg', n.data('kind') === 'account' ? 2 : n.degree(false)); });
  layout(cy);

  // Marching-ants flow on the selected node's edges (rAF; off under reduced motion / hidden tab).
  let flowRaf = 0;
  let dash = 0;
  const flow = () => {
    dash = (dash - 0.6) % 28;
    cy.edges('.flow').style('line-dash-offset', dash);
    flowRaf = requestAnimationFrame(flow);
  };
  const startFlow = () => {
    cancelAnimationFrame(flowRaf);
    if (!reducedMotion() && !document.hidden && cy.edges('.flow').length) flowRaf = requestAnimationFrame(flow);
  };
  document.addEventListener('visibilitychange', startFlow);
  const offTheme = on('theme', () => zoom.restyleNow());

  for (const n of cy.nodes().sort((a, b) => a.data('label').localeCompare(b.data('label')))) {
    jump.append(h('option', { value: n.id() }, n.data('kind') === 'account' ? `◆ ${n.data('handle')} (flagged)` : n.data('label')));
  }

  const projectName = (id) => data.projects.find((p) => p.id === id)?.name || id;

  function select(node) {
    cy.elements().unselect();
    cy.elements().removeClass('flow focus');
    node.select();
    node.addClass('focus');
    node.connectedEdges().addClass('flow');
    startFlow();
    cy.animate({ center: { eles: node }, duration: reducedMotion() ? 0 : 300 });
    sound.tick();
    showDetails(node);
  }

  function nodeButton(id) {
    return h('button', { class: 'chip', type: 'button', on: { click: () => select(cy.getElementById(`p:${id}`)) } }, projectName(id));
  }

  function recordList(list) {
    if (!list.length) return h('p', { class: 'muted' }, 'No records.');
    return h('ul', { class: 'stack plain' }, list.slice(0, 6).map((r) => h('li', {},
      h('button', { class: 'chip', type: 'button', on: { click: () => openRecordDrawer(r) } },
        pill(recordTypeStyle(r.type)), h('span', {}, `@${r.subject_handle}`), h('span', { class: 'sep' }, '·'), h('span', { class: 'dim' }, fmtAgo(r.timestamp))))));
  }

  function showDetails(node) {
    if (node.data('kind') === 'account') {
      const handle = node.data('handle');
      const about = data.records.filter((r) => r.subject_handle === handle);
      const f = flagged.find((x) => x.handle === handle);
      clear(side,
        h('h2', {}, h('span', { class: 'tone-bad', 'aria-hidden': 'true' }, '◆ ✕ '), `@${handle}`),
        pill({ tone: 'bad', icon: '✕', label: 'Flagged account' }),
        h('p', { class: 'muted' }, f?.campaign ? `Part of campaign ${f.campaign}.` : 'Denounced by several independent projects.'),
        h('h3', {}, `Denounced by (${f?.denouncedBy.length || 0})`),
        h('div', { class: 'chips' }, (f?.denouncedBy || []).map(nodeButton)),
        f?.hit?.length ? h('h3', {}, `Campaign PRs sent to (${f.hit.length})`) : null,
        f?.hit?.length ? h('div', { class: 'chips' }, f.hit.map(nodeButton)) : null,
        h('h3', {}, 'Records about this account'), recordList(about),
        h('a', { class: 'btn btn-sm', href: `#/evaluate?h=${encodeURIComponent(handle)}` }, '⚖ Evaluate this handle'));
      return;
    }
    const pid = node.data('pid');
    const { trusts, trustedBy } = neighbours(pid, data.trust_edges);
    const issued = data.records.filter((r) => r.issuer === pid).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    const peerList = (list) => (list.length
      ? h('ul', { class: 'stack plain' }, list.map((p) => h('li', { class: 'row' }, nodeButton(p.id), h('span', { class: 'mono dim' }, `weight ${fmtWeight(p.weight)}`))))
      : h('p', { class: 'muted' }, 'None.'));
    clear(side,
      h('h2', {}, projectName(pid)),
      h('p', { class: 'mono dim' }, pid),
      pid === prefs.perspective ? pill({ tone: 'cyan', icon: '◉', label: 'Your project' }) : null,
      h('h3', {}, `Trusts (${trusts.length})`), peerList(trusts),
      h('h3', {}, `Trusted by (${trustedBy.length})`), peerList(trustedBy),
      h('h3', {}, `Recent records (${issued.length})`), recordList(issued));
  }

  // Hover tooltip (text only)
  const tip = document.getElementById('tooltip');
  cy.on('mouseover', 'node', (e) => {
    const n = e.target;
    const pos = n.renderedPosition();
    const box = canvasBox.getBoundingClientRect();
    tip.replaceChildren(h('strong', {}, n.data('kind') === 'account' ? `@${n.data('handle')}` : n.data('label')),
      n.data('kind') === 'account' ? '✕ Flagged account' : `Trusts ${n.outgoers('edge[kind="trust"]').length} · trusted by ${n.incomers('edge[kind="trust"]').length}`);
    tip.hidden = false;
    tip.style.left = `${Math.min(box.left + pos.x + 12, window.innerWidth - 290)}px`;
    tip.style.top = `${box.top + pos.y + 12}px`;
  });
  cy.on('mouseout', 'node', () => { tip.hidden = true; cy.elements().removeClass('dimmed'); });
  cy.on('mouseover', 'node', (e) => {
    cy.elements().not(e.target.closedNeighborhood()).addClass('dimmed');
  });
  cy.on('tap', (e) => { if (e.target === cy) { cy.elements().removeClass('flow focus'); cancelAnimationFrame(flowRaf); } });
  cy.on('tap', 'node', (e) => select(e.target));
  jump.addEventListener('change', () => { if (jump.value) select(cy.getElementById(jump.value)); });
  fitBtn.addEventListener('click', () => cy.animate({ fit: { padding: 30 }, duration: reducedMotion() ? 0 : 400 }));
  resetBtn.addEventListener('click', () => { sound.whoosh(); layout(cy, true); });

  const runSearch = () => {
    const q = search.value.trim().toLowerCase();
    cy.elements().removeClass('hl faded');
    if (!q) { status.textContent = `${data.projects.length} projects · ${data.trust_edges.length} edges · ${flagged.length} flagged`; return null; }
    const hits = cy.nodes().filter((n) => String(n.data('label')).toLowerCase().includes(q) || String(n.data('pid') || n.data('handle')).toLowerCase().includes(q));
    cy.elements().not(hits).not(hits.connectedEdges()).addClass('faded');
    hits.addClass('hl');
    hits.connectedEdges().addClass('hl');
    status.textContent = `${hits.length} match${hits.length === 1 ? '' : 'es'} for “${search.value.trim()}”`;
    return hits;
  };
  search.addEventListener('input', debounce(runSearch, 150));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const hits = runSearch(); if (hits && hits.length) select(hits[0]); }
  });

  return () => { tip.hidden = true; cancelAnimationFrame(flowRaf); offTheme(); zoom.destroy(); document.removeEventListener('visibilitychange', startFlow); cy.destroy(); };
}
