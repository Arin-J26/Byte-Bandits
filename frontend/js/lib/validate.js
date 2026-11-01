// Client-side shape validation for imported network JSON. Pure.

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const isStr = (v) => typeof v === 'string' && v.length > 0 && v.length <= 200;

/**
 * Accepts {projects, trust_edges|edges, records?, campaigns?, events?}.
 * @returns {{ok:boolean, errors:string[], network?:object}}
 */
export function validateNetwork(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['The file must contain a JSON object, not a list or a value.'] };
  }
  const projects = data.projects;
  const edges = data.trust_edges ?? data.edges;
  const records = data.records ?? [];
  if (!Array.isArray(projects) || projects.length === 0) errors.push('"projects" must be a non-empty list.');
  if (!Array.isArray(edges)) errors.push('"trust_edges" must be a list.');
  if (!Array.isArray(records)) errors.push('"records" must be a list when present.');
  if (errors.length) return { ok: false, errors };

  const ids = new Set();
  projects.forEach((p, i) => {
    if (!p || !isStr(p.id)) errors.push(`projects[${i}] needs a text "id".`);
    else ids.add(p.id);
  });
  edges.forEach((e, i) => {
    const w = e && e.weight;
    if (!e || !isStr(e.from) || !isStr(e.to)) errors.push(`trust_edges[${i}] needs "from" and "to".`);
    else if (!ids.has(e.from) || !ids.has(e.to)) errors.push(`trust_edges[${i}] points to an unknown project.`);
    if (typeof w !== 'number' || w < 0 || w > 1) errors.push(`trust_edges[${i}].weight must be a number from 0 to 1.`);
  });
  records.forEach((r, i) => {
    if (!r || !isStr(r.id) || !isStr(r.issuer) || !isStr(r.subject_handle)) errors.push(`records[${i}] needs "id", "issuer" and "subject_handle".`);
    else if (!['vouch', 'denounce', 'contest'].includes(r.type)) errors.push(`records[${i}].type must be "vouch", "denounce" or "contest".`);
  });
  if (errors.length > 8) errors.splice(8, errors.length, `…and ${errors.length - 8} more problems.`);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    network: {
      projects: projects.map((p) => ({ id: p.id, name: String(p.name || p.id) })),
      trust_edges: edges.map((e) => ({ from: e.from, to: e.to, weight: e.weight })),
      records,
      campaigns: Array.isArray(data.campaigns) ? data.campaigns : [],
      events: Array.isArray(data.events) ? data.events : [],
    },
  };
}
