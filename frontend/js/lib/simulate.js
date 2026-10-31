// Seeded synthetic network generator for the Simulate page (mock mode). Pure.

/** mulberry32: tiny deterministic PRNG. */
export function rng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['lumen', 'nebula', 'forge', 'quasar', 'orbit', 'helix', 'zenith', 'aurora', 'cobalt', 'drift',
  'ember', 'fable', 'granite', 'harbor', 'ion', 'jade', 'kepler', 'lattice', 'mosaic', 'nova', 'opal',
  'prism', 'rune', 'tidal', 'vega', 'willow', 'xenon', 'yarrow', 'zephyr', 'atlas'];
const KINDS = ['ui', 'db', 'cli', 'ml', 'auth', 'web', 'docs', 'router', 'sync', 'cache', 'lang', 'fs', 'ci', 'queue', 'logs'];
const SPAM_TITLES = ['Fix typo in README.md', 'fix typo in readme', 'Fixed typo in README', 'Update README.md (typo fix)'];

/**
 * @param {{projectCount?:number, newcomers?:number, campaignSize?:number, seed?:number, now?:number}} p
 */
export function generateNetwork({ projectCount = 25, newcomers = 8, campaignSize = 10, seed = 2026, now = Date.UTC(2026, 9, 31, 12) } = {}) {
  const r = rng(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const n = Math.min(50, Math.max(2, projectCount));
  const projects = [];
  const used = new Set();
  while (projects.length < n) {
    const id = `${pick(WORDS)}-${pick(KINDS)}`;
    if (used.has(id)) continue;
    used.add(id);
    projects.push({ id, name: id });
  }
  const edges = [];
  const has = new Set();
  projects.forEach((p, i) => {
    const k = 1 + Math.floor(r() * 3);
    for (let j = 0; j < k; j++) {
      const q = projects[(i + 1 + Math.floor(r() * Math.min(6, n - 1))) % n];
      const key = `${p.id}>${q.id}`;
      if (q.id === p.id || has.has(key)) continue;
      has.add(key);
      edges.push({ from: p.id, to: q.id, weight: Math.round((0.4 + r() * 0.6) * 10) / 10 });
    }
  });
  const iso = (ms) => new Date(ms).toISOString();
  const records = [];
  let rid = 1;
  for (let i = 0; i < Math.max(4, Math.floor(n * 0.8)); i++) {
    records.push({
      id: `sim-r${rid++}`, issuer: pick(projects).id, subject_handle: `dev-${Math.floor(r() * 9000 + 1000)}`,
      type: 'vouch', reason: 'Several merged PRs with tests', evidence_urls: [], timestamp: iso(now - r() * 30 * 864e5),
      signature_valid: true,
    });
  }
  const start = now - 2 * 3600e3;
  const prEvents = Array.from({ length: Math.max(0, campaignSize) }, (_, i) => ({
    id: `sim-pr${i + 1}`, handle: `bulk-acct-${String(i + 1).padStart(2, '0')}`, project: pick(projects).id,
    title: pick(SPAM_TITLES), timestamp: iso(start + i * 60e3 + r() * 30e3),
  }));
  // A few projects already denounced the noisiest campaign accounts.
  for (const e of prEvents.slice(0, 3)) {
    const issuers = new Set([e.project, pick(projects).id]);
    for (const issuer of issuers) {
      records.push({
        id: `sim-r${rid++}`, issuer, subject_handle: e.handle, type: 'denounce', reason: 'Templated typo PR, part of a burst',
        evidence_urls: [], timestamp: e.timestamp, signature_valid: true,
      });
    }
  }
  const campaigns = campaignSize > 1 ? [{
    id: 'sim-camp-1', size: campaignSize, accounts_min_age_days: 1 + Math.floor(r() * 3),
    projects_hit: new Set(prEvents.map((e) => e.project)).size, window_minutes: campaignSize + 2,
    evidence_summary: `${campaignSize} new accounts opened near-identical README typo PRs within ${campaignSize + 2} minutes.`,
    pr_events: prEvents,
  }] : [];
  const events = [
    ...prEvents.map((e) => ({ ...e, kind: 'pr', signature_valid: true })),
    ...Array.from({ length: newcomers }, (_, i) => ({
      id: `sim-new${i + 1}`, kind: 'pr', handle: `newcomer-${i + 1}`, project: pick(projects).id,
      title: 'First contribution: improve docs', timestamp: iso(now - r() * 6 * 3600e3), signature_valid: true,
    })),
  ].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return { projects, trust_edges: edges, records, campaigns, events };
}
