// Simulate page: generate a synthetic network, import/export network JSON.

import { h, clear, toast, download, errorBox } from '../dom.js';
import { api, status } from '../api.js';
import { validateNetwork, MAX_IMPORT_BYTES } from '../lib/validate.js';
import * as sound from '../sound.js';

let current = null;

/** Demo hook: load the curated demo network. */
export async function loadDemoNetwork() {
  if (!current) throw new Error('Simulate page is not mounted');
  return current.load({ preset: 'demo' });
}

function numberField(id, label, min, max, value, hint) {
  const range = h('input', { type: 'range', id, min: String(min), max: String(max), value: String(value) });
  const num = h('input', { class: 'input mono num', type: 'number', min: String(min), max: String(max), value: String(value), aria: { label: `${label} (number)` } });
  range.addEventListener('input', () => { num.value = range.value; });
  num.addEventListener('change', () => {
    const v = Math.min(max, Math.max(min, Math.round(Number(num.value) || min)));
    num.value = String(v); range.value = String(v);
  });
  return {
    el: h('div', { class: 'stack' }, h('div', { class: 'slider-row' }, h('label', { for: id }, label), range, num), h('p', { class: 'hint' }, hint)),
    get: () => Number(range.value),
  };
}

export async function mount(root) {
  const projects = numberField('sim-projects', 'Projects', 20, 50, 30, 'How many open-source projects take part.');
  const newcomers = numberField('sim-new', 'Honest newcomers', 0, 30, 8, 'First-time contributors with no history. They must come out UNKNOWN, never blocked.');
  const campaign = numberField('sim-camp', 'Campaign size', 0, 40, 12, 'Accounts in a coordinated spam wave (0 = no campaign).');
  const seed = h('input', { class: 'input mono', id: 'sim-seed', type: 'number', value: '2026', min: '1', max: '999999' });
  const demoBtn = h('button', { class: 'btn btn-primary', type: 'button', id: 'sim-demo' }, '★ Load demo network');
  const genBtn = h('button', { class: 'btn', type: 'button', id: 'sim-gen' }, '⚙ Generate network');
  const fileIn = h('input', { type: 'file', accept: 'application/json,.json', class: 'sr-only', id: 'sim-file' });
  const importBtn = h('label', { class: 'btn', for: 'sim-file', tabindex: '0', role: 'button' }, '⇧ Import JSON');
  const exportBtn = h('button', { class: 'btn', type: 'button' }, '⇩ Download current network');
  const progress = h('progress', { max: '100', value: '0', aria: { label: 'Progress' }, hidden: true });
  const progressText = h('p', { class: 'hint', aria: { live: 'polite' } });
  const summary = h('div', { class: 'panel', aria: { live: 'polite' } }, h('h2', {}, 'Summary'), h('p', { class: 'muted' }, 'Nothing generated in this session yet.'));

  clear(root, h('section', { class: 'page page-simulate' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Simulate a network'),
      h('p', {}, 'Everything here is synthetic. Generate projects, trust edges, honest newcomers and a spam campaign, or import your own network file.'))),
    h('div', { class: 'sim-grid' },
      h('div', { class: 'panel stack' },
        projects.el, newcomers.el, campaign.el,
        h('div', { class: 'field' }, h('label', { for: 'sim-seed' }, 'Random seed'), seed, h('p', { class: 'hint' }, 'Same seed, same network: handy for repeatable demos.')),
        h('div', { class: 'row' }, demoBtn, genBtn),
        h('div', { class: 'row' }, importBtn, fileIn, exportBtn),
        progress, progressText,
        h('p', { class: 'hint' }, `Import accepts JSON up to ${MAX_IMPORT_BYTES / 1024 / 1024} MB with "projects" and "trust_edges". Imported data stays in this browser.`)),
      summary)));

  function setProgress(v, text) {
    progress.hidden = v == null;
    progress.value = v ?? 0;
    progressText.textContent = text || '';
  }

  async function showSummary(title) {
    const n = await api.network();
    const vouches = n.records.filter((r) => r.type === 'vouch').length;
    const invalid = n.records.filter((r) => r.signature_valid === false).length;
    clear(summary, h('h2', {}, title),
      h('dl', { class: 'facts' },
        ...[['Projects', n.projects.length], ['Trust edges', n.trust_edges.length], ['Vouches', vouches],
          ['Denounces', n.records.length - vouches], ['Invalid signatures', invalid], ['Campaigns', n.campaigns.length], ['Events', n.events.length]]
          .map(([k, v]) => h('div', { class: 'fact' }, h('dt', {}, k), h('dd', { class: 'mono' }, String(v))))),
      h('div', { class: 'row' }, h('a', { class: 'btn btn-sm', href: '#/graph' }, '◎ View graph'), h('a', { class: 'btn btn-sm', href: '#/evaluate' }, '⚖ Evaluate someone')));
  }

  async function load(params) {
    for (const b of [demoBtn, genBtn]) b.disabled = true;
    try {
      setProgress(15, status.mode === 'live' ? 'Asking the backend to load the network…' : 'Generating locally…');
      await api.simulateLoad(params);
      setProgress(70, 'Loading the new network…');
      await showSummary(params.preset === 'demo' ? 'Demo network loaded' : 'Synthetic network generated');
      setProgress(100, 'Done.');
      sound.allow();
      toast('Network loaded.', 'ok');
    } catch (err) {
      setProgress(null);
      clear(summary, errorBox(`Could not load the network: ${err.message}`, () => load(params)));
    } finally {
      for (const b of [demoBtn, genBtn]) b.disabled = false;
      setTimeout(() => setProgress(null), 1500);
    }
  }

  demoBtn.addEventListener('click', () => load({ preset: 'demo' }));
  genBtn.addEventListener('click', () => load({
    projectCount: projects.get(), newcomers: newcomers.get(), campaignSize: campaign.get(), seed: Number(seed.value) || 1,
  }));

  importBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
  fileIn.addEventListener('change', async () => {
    const file = fileIn.files?.[0];
    fileIn.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      toast(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 5 MB.`, 'bad', 6000);
      return;
    }
    let data;
    try { data = JSON.parse(await file.text()); } catch {
      toast('That file is not valid JSON. Check it in a JSON validator and try again.', 'bad', 6000);
      return;
    }
    const res = validateNetwork(data);
    if (!res.ok) {
      clear(summary, h('div', { class: 'error-box', role: 'alert' }, h('strong', {}, '✕ This file does not look like a Sniffer network.'),
        h('ul', {}, res.errors.map((e) => h('li', {}, e)))));
      sound.review();
      return;
    }
    api.importNetwork(res.network);
    await showSummary(`Imported ${file.name}`);
    toast('Imported. The badge now shows Mock because this data lives only in your browser.', 'ok', 5000);
  });

  exportBtn.addEventListener('click', async () => {
    try {
      const n = await api.network();
      download(`sniffer-network-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(n, null, 2));
    } catch (err) { toast(`Export failed: ${err.message}`, 'bad'); }
  });

  current = { load };
  return () => { current = null; };
}
