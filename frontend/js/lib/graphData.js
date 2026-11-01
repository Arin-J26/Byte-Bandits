// Converts API data into Cytoscape element definitions. Pure; no Cytoscape import.

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));

/**
 * Accounts that look flagged from the network's point of view:
 * at least `minDenouncers` distinct projects denounced them with a valid signature,
 * or they appear in a detected campaign.
 */
export function flaggedAccounts(records = [], campaigns = [], minDenouncers = 2) {
  const by = new Map();
  for (const r of records) {
    if (r.type !== 'denounce' || r.signature_valid === false) continue;
    const h = String(r.subject_handle);
    if (!by.has(h)) by.set(h, new Set());
    by.get(h).add(r.issuer);
  }
  const out = new Map();
  for (const [handle, issuers] of by) {
    if (issuers.size >= minDenouncers) out.set(handle, { handle, denouncedBy: [...issuers], hit: [], campaign: null });
  }
  for (const c of campaigns) {
    for (const ev of c.pr_events || []) {
      const h = String(ev.handle || '');
      if (!h) continue;
      if (!out.has(h)) out.set(h, { handle: h, denouncedBy: [], hit: [], campaign: c.id });
      const f = out.get(h);
      f.campaign = c.id;
      if (ev.project && !f.hit.includes(ev.project)) f.hit.push(ev.project);
    }
  }
  return [...out.values()];
}

/**
 * @param {{projects?:{id,name}[], edges?:{from,to,weight}[], flagged?:{handle,denouncedBy}[], perspective?:string}} data
 * @returns {object[]} Cytoscape elements
 */
export function toElements({ projects = [], edges = [], flagged = [], perspective = null } = {}) {
  const els = [];
  const ids = new Set();
  for (const p of projects) {
    if (!p || p.id == null || ids.has(p.id)) continue;
    ids.add(p.id);
    els.push({
      group: 'nodes',
      data: { id: `p:${p.id}`, pid: p.id, label: String(p.name || p.id), kind: 'project', me: p.id === perspective },
    });
  }
  const seenEdges = new Set();
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    const id = `e:${e.from}->${e.to}`;
    if (seenEdges.has(id)) continue;
    seenEdges.add(id);
    const w = clamp01(e.weight);
    els.push({
      group: 'edges',
      data: {
        id, source: `p:${e.from}`, target: `p:${e.to}`, kind: 'trust', weight: w,
        width: 1 + 5 * w, opacity: 0.2 + 0.75 * w,
      },
    });
  }
  for (const f of flagged) {
    const nid = `a:${f.handle}`;
    if (ids.has(nid)) continue;
    ids.add(nid);
    els.push({ group: 'nodes', data: { id: nid, label: `✕ ${f.handle}`, handle: f.handle, kind: 'account' } });
    for (const issuer of f.denouncedBy || []) {
      if (!ids.has(issuer)) continue;
      els.push({
        group: 'edges',
        data: { id: `d:${issuer}->${f.handle}`, source: `p:${issuer}`, target: nid, kind: 'denounce', weight: 1, width: 1.5, opacity: 0.7 },
      });
    }
    // Campaign PRs: account -> project it targeted (only where no denounce edge already links them).
    for (const pid of f.hit || []) {
      if (!ids.has(pid) || (f.denouncedBy || []).includes(pid)) continue;
      els.push({
        group: 'edges',
        data: { id: `c:${f.handle}->${pid}`, source: nid, target: `p:${pid}`, kind: 'campaign', weight: 1, width: 1, opacity: 0.5 },
      });
    }
  }
  return els;
}

/** Neighbour summary for the side panel. */
export function neighbours(projectId, edges = []) {
  return {
    trusts: edges.filter((e) => e.from === projectId).map((e) => ({ id: e.to, weight: clamp01(e.weight) })),
    trustedBy: edges.filter((e) => e.to === projectId).map((e) => ({ id: e.from, weight: clamp01(e.weight) })),
  };
}
