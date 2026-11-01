// The only module that talks to the backend.
// Live mode (default): same-origin /api/*, with Gemma via Ollama on the backend.
// If the backend drops, the app reconnects instead of silently switching data sources.
// Mock mode ONLY when explicitly requested with ?mock=1: data from frontend/mock/*.json.

import { evaluate as localEvaluate } from './lib/trustMath.js';
import { generateNetwork } from './lib/simulate.js';
import { suggestDenounces } from './lib/campaignStats.js';
import { emit, trustOptions, setPref } from './state.js';

const TIMEOUT_MS = 8000; // the backend answers within ~1.5 s even while Gemma is thinking
const RECONNECT_MS = 3000;
const MOCK_FILES = {
  projects: 'projects.json',
  trust_edges: 'trust-edges.json',
  records: 'records.json',
  campaigns: 'campaigns.json',
  events: 'events.json',
};

/** mode: 'live' | 'offline' (backend not running at startup) | 'mock' (explicit ?mock=1 only) */
export const status = { mode: 'unknown', reason: '', connected: true };
let store = null; // mock data, loaded lazily

function setMode(mode, reason) {
  if (status.mode === mode && status.reason === reason) return;
  status.mode = mode;
  status.reason = reason;
  emit('mode', { ...status });
}

async function fetchJSON(url, opts = {}, timeoutMs = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json' } });
    } catch (netErr) {
      throw Object.assign(new Error('network'), { network: true, cause: netErr });
    }
    const type = res.headers.get('content-type') || '';
    if (!res.ok) {
      // Surface the backend's own explanation ({"error": ...}) when there is one.
      let detail = '';
      let fromApi = false;
      try {
        const body = await res.json();
        fromApi = true;
        const e = body?.error ?? body?.detail;
        detail = Array.isArray(e) ? e.map((x) => (typeof x === 'string' ? x : x.msg)).join('; ') : String(e ?? '');
        if (Array.isArray(body?.details)) detail += `: ${body.details.map((x) => x.msg).join('; ')}`;
      } catch { /* not JSON */ }
      const err = new Error(detail || `HTTP ${res.status}`);
      err.status = res.status;
      err.fromApi = fromApi;
      throw err;
    }
    if (!type.includes('json')) throw Object.assign(new Error('Not a JSON API'), { status: 404 });
    return res.status === 204 ? null : res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** True when the backend answers /api/health. */
export async function backendUp() {
  try {
    const h = await fetchJSON('/api/health', {}, 3000);
    return h && h.status === 'ok';
  } catch {
    return false;
  }
}

/** Decide once at startup: live backend (default) or explicit demo data (?mock=1). */
export async function init() {
  if (new URLSearchParams(location.search).get('mock') === '1') {
    setMode('mock', 'forced');
    return status;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await backendUp()) { setMode('live', ''); return status; }
    await wait(600);
  }
  setMode('offline', 'not running');
  return status;
}

let reconnectTimer = 0;
function setConnected(ok) {
  if (status.connected === ok) return;
  status.connected = ok;
  emit('connection', ok);
  clearInterval(reconnectTimer);
  if (!ok) {
    reconnectTimer = setInterval(async () => {
      if (await backendUp()) setConnected(true);
    }, RECONNECT_MS);
  }
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
  async 'GET /api/campaigns'() {
    // Mock data has no model behind it: say so instead of inventing an AI verdict.
    return (await loadStore()).campaigns.map((c) => ({
      ai_verdict: 'unclear', ai_reason: 'Mock mode: no AI review. Run the backend with Ollama for Gemma\'s verdict.', ai: false, ...c,
    }));
  },
  async 'GET /api/events'() { return (await loadStore()).events; },
  async 'POST /api/evaluate'({ project_id, handle }) {
    const s = await loadStore();
    return { ...localEvaluate({ edges: s.trust_edges, records: s.records, projectId: project_id, handle, options: trustOptions() }), ai: false };
  },
  async 'PUT /api/trust'({ project_id, peer_id, weight }) {
    const s = await loadStore();
    const w = Math.min(1, Math.max(0, Number(weight) || 0));
    const e = s.trust_edges.find((x) => x.from === project_id && x.to === peer_id);
    if (e) e.weight = w;
    else s.trust_edges.push({ from: project_id, to: peer_id, weight: w });
    return { ok: true, project_id, peer_id, weight: w };
  },
  async 'GET /api/health'() { return { status: 'ok', model: null, ollama_available: false, mock: true }; },
  async 'GET /api/trust/settings'(_, q) {
    const o = trustOptions();
    return { project_id: q.get('project_id'), max_depth: o.maxDepth, decay: o.decay };
  },
  async 'PUT /api/trust/settings'({ project_id, max_depth, decay }) {
    setPref('maxDepth', max_depth);
    setPref('decay', decay);
    return { project_id, max_depth, decay };
  },
  async 'POST /api/campaigns/:id/suggest-denounce'({ issuer } = {}, _q, id) {
    const c = (await loadStore()).campaigns.find((x) => x.id === id);
    if (!c) throw new Error(`Unknown campaign '${id}'`);
    return suggestDenounces(c, issuer || 'lumen-ui');
  },
  async 'GET /api/network/export'() {
    const s = await loadStore();
    return { projects: s.projects, trust_edges: s.trust_edges, records: s.records, campaigns: s.campaigns, events: s.events };
  },
  async 'POST /api/simulate/load'(params = {}) {
    // preset "demo" restores the curated mock files; otherwise generate from the seed.
    store = null;
    if (params.preset === 'demo') await loadStore();
    else store = generateNetwork(params);
    return { ok: true, projects: store.projects.length, trust_edges: store.trust_edges.length, records: store.records.length, campaigns: store.campaigns.length };
  },
};

async function call(method, path, body, timeoutMs) {
  if (status.mode === 'offline') throw new Error('The Sniffer backend is not running.');
  if (status.mode === 'live') {
    try {
      const out = await fetchJSON(path, { method, body: body ? JSON.stringify(body) : undefined }, timeoutMs);
      setConnected(true);
      return out;
    } catch (err) {
      // A JSON error from our API is a real answer: show it, never swap data sources.
      if (err.fromApi && err.status < 500) {
        if (err.status === 404 && /^No API endpoint/.test(err.message)) {
          throw new Error(`Your backend does not have ${path.split('?')[0]} yet. Restart it so it runs the latest code.`);
        }
        throw err;
      }
      setConnected(false); // network error, timeout or 5xx: reconnect in the background
      throw new Error('Cannot reach the Sniffer backend right now. Reconnecting automatically…');
    }
  }
  const [bare, query = ''] = path.split('?');
  let fn = mock[`${method} ${bare}`];
  let param;
  if (!fn) { // routes with one path parameter, e.g. /api/campaigns/:id/suggest-denounce
    for (const [key, f] of Object.entries(mock)) {
      const [m, pattern] = key.split(' ');
      const re = new RegExp(`^${pattern.replace(/:\w+/, '([^/]+)')}$`);
      const hit = m === method && bare.match(re);
      if (hit && pattern.includes(':')) { fn = f; param = decodeURIComponent(hit[1]); break; }
    }
  }
  if (!fn) throw new Error(`No mock for ${method} ${bare}`);
  await wait(120 + Math.random() * 160); // let skeletons show briefly
  return copy(await fn(body, new URLSearchParams(query), param));
}

/** Copy a project's saved depth/decay into local prefs so every page draws with the same values. */
export async function syncTrustSettings(projectId) {
  try {
    const s = await call('GET', `/api/trust/settings?project_id=${encodeURIComponent(projectId)}`);
    setPref('maxDepth', Number(s.max_depth) || 3);
    setPref('decay', Number(s.decay) || 0.8);
  } catch { /* keep the previous values */ }
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
  health: () => call('GET', '/api/health'),
  suggestDenounce: (campaignId, issuer) =>
    call('POST', `/api/campaigns/${encodeURIComponent(campaignId)}/suggest-denounce`, { issuer }),
  trustSettings: (projectId) => call('GET', `/api/trust/settings?project_id=${encodeURIComponent(projectId)}`),
  putTrustSettings: (project_id, max_depth, decay) => call('PUT', '/api/trust/settings', { project_id, max_depth, decay }),
  exportNetwork: () => call('GET', '/api/network/export'),

  /** Load everything at once (Graph, Simulate download). */
  async network() {
    const [projects, trust_edges, records, campaigns, events] = await Promise.all([
      api.projects(), api.trustEdges(), api.records(), api.campaigns(), api.events(),
    ]);
    return { projects, trust_edges, records, campaigns, events };
  },

  /**
   * Live: the backend verifies signatures and replaces its network (needs a file exported from a
   * Sniffer backend, with public keys). Mock: the data is held in this browser only.
   */
  async importNetwork(raw, normalized) {
    if (status.mode === 'live') return call('POST', '/api/network/import', raw, 30_000);
    store = copy(normalized);
    setMode('mock', 'imported');
    return { ok: true, local: true };
  },
};
