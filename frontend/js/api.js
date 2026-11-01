// The only module that talks to the backend: same-origin /api routes with the HttpOnly session cookie.
// There is no demo or offline data. If the backend cannot be reached, the call fails with a clear message.

import { emit } from './state.js';

const TIMEOUT_MS = 20000;

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  const headers = {};
  let payload;
  if (body instanceof Blob) {
    headers['Content-Type'] = 'application/zip';
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin', signal: ctrl.signal });
  } catch {
    emit('connection', false);
    throw new ApiError('Cannot reach the Sniffer backend. Check that it is running, then try again.', 0);
  } finally {
    clearTimeout(timer);
  }
  emit('connection', true);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON: keep null */ }
  // A 401 from a project request means the session ended. Sign-in mistakes (401 from /api/auth/) are shown on the form.
  if (res.status === 401 && !path.startsWith('/api/auth/')) emit('signed-out', true);
  if (!res.ok) {
    const msg = data && (data.error || data.detail);
    throw new ApiError(typeof msg === 'string' ? msg : `Request failed (HTTP ${res.status})`, res.status);
  }
  return data;
}

const q = (params) => new URLSearchParams(params).toString();
const enc = encodeURIComponent;

export const api = {
  health: () => request('GET', '/api/health'),
  me: () => request('GET', '/api/auth/me'),
  signUp: (login, password) => request('POST', '/api/auth/signup', { login, password }),
  signIn: (login, password) => request('POST', '/api/auth/login', { login, password }),
  signOut: () => request('POST', '/api/auth/logout'),
  dashboard: () => request('GET', '/api/projects'),
  upload: (zip) => request('POST', '/api/projects', zip),
  project: (id) => request('GET', `/api/projects/${enc(id)}`),
  classify: (id) => request('POST', `/api/projects/${enc(id)}/classify`),
  classifyStatus: (id) => request('GET', `/api/projects/${enc(id)}/classify`),
  graph: (id) => request('GET', `/api/projects/${enc(id)}/graph`),
  trust: (id) => request('GET', `/api/projects/${enc(id)}/trust`),
  contributors: (id) => request('GET', `/api/projects/${enc(id)}/contributors`),
  events: (id) => request('GET', `/api/projects/${enc(id)}/events`),
  setDecision: (id, handle, action) => request('PUT', `/api/projects/${enc(id)}/decisions/${enc(handle)}`, { action }),
  records: (id, handle) => request('GET', `/api/projects/${enc(id)}/records?${q({ handle })}`),
  evaluate: (id, handle) => request('POST', `/api/projects/${enc(id)}/evaluate`, { handle }),
  github: (id, handle) => request('GET', `/api/projects/${enc(id)}/contributors/${enc(handle)}/github`),
  campaigns: (id, windowMinutes, minSize) =>
    request('GET', `/api/projects/${enc(id)}/campaigns?${q({ window_minutes: windowMinutes, min_size: minSize })}`),
  suggest: (id, campaignId, windowMinutes, minSize) =>
    request('POST', `/api/projects/${enc(id)}/campaigns/${enc(campaignId)}/suggest?${q({ window_minutes: windowMinutes, min_size: minSize })}`, {}),
};
