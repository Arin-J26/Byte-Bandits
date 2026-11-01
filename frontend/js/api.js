// The only module that talks to the backend.
// Live mode: same-origin /api/*.  Mock mode: ?mock=1, or automatically when /api is
// unreachable; data comes from frontend/mock/*.json and is computed locally.

import { evaluate as localEvaluate } from './lib/trustMath.js';
import { generateNetwork } from './lib/simulate.js';
import { emit, trustOptions } from './state.js';

const TIMEOUT_MS = 2500;
const MOCK_FILES = {
  projects: 'projects.json',
  trust_edges: 'trust-edges.json',
  records: 'records.json',
  campaigns: 'campaigns.json',
  events: 'events.json',
};

export const status = { mode: 'unknown', reason: '' };
let store = null; // mock data, loaded lazily

function setMode(mode, reason) {
  if (status.mode === mode && status.reason === reason) return;
  status.mode = mode;
  status.reason = reason;
  emit('mode', { ...status });
}

async function fetchJSON(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json' } });
    const type = res.headers.get('content-type') || '';
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    if (!type.includes('json')) throw Object.assign(new Error('Not a JSON API'), { status: 404 });
    return res.status === 204 ? null : res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Decide live vs mock once at startup. */
export async function init() {
  const params = new URLSearchParams(location.search);
  if (params.get('mock') === '1') {
    setMode('mock', 'forced');
    return status;
  }
  try {
    const data = await fetchJSON('/api/projects');
    if (!Array.isArray(data)) throw new Error('Unexpected response');
    setMode('live', '');
  } catch {
    setMode('mock', 'unreachable');
  }
  return status;
}

async function loadStore() {
  if (store) return store;
  const entries = await Promise.all(Object.entries(MOCK_FILES).map(async ([k, f]) => {
    const res = await fetch(`mock/${f}`);
    if (!res.ok) throw new Error(`Could not load mock/${f}`);
    return [k, await res.json()];
  }));
  store = Object.fromEntries(entries);
  return store;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const copy = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

/** Mock implementations of each endpoint. */
const mock = {
  async 'GET /api/projects'() { return (await loadStore()).projects; },
  async 'GET /api/trust-edges'() { return (await loadStore()).trust_edges; },
  async 'GET /api/records'() { return (await loadStore()).records; },
  async 'GET /api/campaigns'() { return (await loadStore()).campaigns; },
  async 'GET /api/events'() { return (await loadStore()).events; },
  async 'POST /api/evaluate'({ project_id, handle }) {
    const s = await loadStore();
    return localEvaluate({ edges: s.trust_edges, records: s.records, projectId: project_id, handle, options: trustOptions() });
  },
  async 'PUT /api/trust'({ project_id, peer_id, weight }) {
    const s = await loadStore();
    const w = Math.min(1, Math.max(0, Number(weight) || 0));
    const e = s.trust_edges.find((x) => x.from === project_id && x.to === peer_id);
    if (e) e.weight = w;
    else s.trust_edges.push({ from: project_id, to: peer_id, weight: w });
    return { ok: true, project_id, peer_id, weight: w };
  },
  async 'POST /api/simulate/load'(params = {}) {
    // preset "demo" restores the curated mock files; otherwise generate from the seed.
    store = null;
    if (params.preset === 'demo') await loadStore();
    else store = generateNetwork(params);
    return { ok: true, projects: store.projects.length, trust_edges: store.trust_edges.length, records: store.records.length, campaigns: store.campaigns.length };
  },
};

async function call(method, path, body) {
  if (status.mode === 'live') {
    try {
      return await fetchJSON(path, { method, body: body ? JSON.stringify(body) : undefined });
    } catch (err) {
      // Client errors are real answers from a live backend; anything else means it is down.
      if (err.status && err.status >= 400 && err.status < 500 && err.status !== 404) {
        throw new Error(`The server rejected the request (${err.message}).`);
      }
      setMode('mock', 'unreachable');
    }
  }
  const fn = mock[`${method} ${path}`];
  if (!fn) throw new Error(`No mock for ${method} ${path}`);
  await wait(120 + Math.random() * 160); // let skeletons show briefly
  return copy(await fn(body));
}

export const api = {
  projects: () => call('GET', '/api/projects'),
  trustEdges: () => call('GET', '/api/trust-edges'),
  records: () => call('GET', '/api/records'),
  campaigns: () => call('GET', '/api/campaigns'),
  events: () => call('GET', '/api/events'),
  evaluate: (project_id, handle) => call('POST', '/api/evaluate', { project_id, handle }),
  putTrust: (project_id, peer_id, weight) => call('PUT', '/api/trust', { project_id, peer_id, weight }),
  simulateLoad: (params) => call('POST', '/api/simulate/load', params),

  /** Load everything at once (Graph, Simulate download). */
  async network() {
    const [projects, trust_edges, records, campaigns, events] = await Promise.all([
      api.projects(), api.trustEdges(), api.records(), api.campaigns(), api.events(),
    ]);
    return { projects, trust_edges, records, campaigns, events };
  },

  /** Imported JSON is only held in this browser, so it always switches to mock mode. */
  importNetwork(network) {
    store = copy(network);
    setMode('mock', 'imported');
  },
};
