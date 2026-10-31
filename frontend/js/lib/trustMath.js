// Pure trust propagation and decision logic. No DOM, no network.
// Used by the mock API, the Trust page chart and the Evaluate what-if sliders.
//
// Model:
//   - Your own project has trust 1.0 (hop 0).
//   - Each hop multiplies by the edge weight AND by the decay factor,
//     so two full-trust hops with decay 0.8 give 1 x 0.8 -> 0.8 x 0.8 = 0.64.
//   - Projects further than maxDepth hops are ignored ("beyond depth limit").
//   - A vouch adds +trust, a denounce adds -trust. Score is clamped to [-1, 1].
//   - FLAG needs a strongly negative score AND at least two independent
//     denouncing projects. A single denounce is only a soft signal (REVIEW).
//   - No usable records means UNKNOWN: normal review, never blocked.

export const DEFAULTS = Object.freeze({
  maxDepth: 3,
  decay: 0.8,
  allowThreshold: 0.5,
  flagThreshold: -0.5,
  minDenouncers: 2,
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = (v) => Math.round(v * 100) / 100;
export const normHandle = (h) => String(h || '').trim().replace(/^@/, '').toLowerCase();

function adjacency(edges) {
  const out = new Map();
  for (const e of edges || []) {
    const w = Number(e.weight);
    if (!(w > 0) || e.from === e.to) continue;
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push({ to: e.to, weight: clamp(w, 0, 1) });
  }
  return out;
}

/**
 * Best (highest) transitive trust from `origin` to every project within maxDepth hops.
 * Returns { trust: Map<id,{trust,hops,path}>, beyond: Set<id>, frontier: Set<id> }.
 * `beyond` = reachable but only past the depth limit; `frontier` = exactly one hop past it.
 */
export function computeTrust(edges, origin, options = {}) {
  const { maxDepth, decay } = { ...DEFAULTS, ...options };
  const out = adjacency(edges);
  let best = new Map([[origin, { trust: 1, hops: 0, path: [origin] }]]);
  // Bounded Bellman-Ford: after round d, best holds the strongest path using <= d hops.
  for (let d = 1; d <= maxDepth; d++) {
    const next = new Map(best);
    for (const [u, info] of best) {
      for (const e of out.get(u) || []) {
        if (info.path.includes(e.to)) continue;
        const t = info.trust * e.weight * decay;
        const cur = next.get(e.to);
        if (!cur || t > cur.trust + 1e-12) {
          next.set(e.to, { trust: t, hops: info.hops + 1, path: [...info.path, e.to] });
        }
      }
    }
    best = next;
  }
  // Anything reachable without a depth limit but missing from `best` is beyond the limit.
  const seen = new Set([origin]);
  const queue = [origin];
  while (queue.length) {
    const u = queue.shift();
    for (const e of out.get(u) || []) if (!seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
  }
  const beyond = new Set([...seen].filter((id) => !best.has(id)));
  const frontier = new Set();
  for (const [u, info] of best) {
    if (info.hops !== maxDepth) continue;
    for (const e of out.get(u) || []) if (beyond.has(e.to)) frontier.add(e.to);
  }
  return { trust: best, beyond, frontier };
}

/** Keep only the newest record per issuer; older ones are reported as superseded. */
function latestPerIssuer(records) {
  const byIssuer = new Map();
  const superseded = [];
  for (const r of records) {
    const prev = byIssuer.get(r.issuer);
    if (!prev) { byIssuer.set(r.issuer, r); continue; }
    const newer = String(r.timestamp) > String(prev.timestamp) ? r : prev;
    superseded.push(newer === r ? prev : r);
    byIssuer.set(r.issuer, newer);
  }
  return { kept: [...byIssuer.values()], superseded };
}

/** Evaluate a handle from one project's perspective. Same shape as POST /api/evaluate. */
export function evaluate({ edges, records, projectId, handle, options = {} }) {
  const opts = { ...DEFAULTS, ...options };
  const { trust, beyond } = computeTrust(edges, projectId, opts);
  const h = normHandle(handle);
  const relevant = (records || []).filter((r) => normHandle(r.subject_handle) === h);

  const ignored = [];
  const usable = [];
  for (const r of relevant) {
    if (r.signature_valid === false) ignored.push({ record_id: r.id, reason: 'invalid signature' });
    else if (!trust.has(r.issuer)) {
      ignored.push({
        record_id: r.id,
        reason: beyond.has(r.issuer)
          ? `beyond depth limit (${opts.maxDepth} hops)`
          : 'not in your trust graph',
      });
    } else if (r.type === 'contest') {
      ignored.push({ record_id: r.id, reason: 'contests are only weighed by the live backend' });
    } else usable.push(r);
  }
  const { kept, superseded } = latestPerIssuer(usable);
  for (const r of superseded) ignored.push({ record_id: r.id, reason: 'superseded by a newer record from the same project' });

  let raw = 0;
  const denouncers = new Set();
  const vouchers = new Set();
  const path = kept.map((r) => {
    const t = trust.get(r.issuer);
    const sign = r.type === 'denounce' ? -1 : 1;
    raw += sign * t.trust;
    (sign < 0 ? denouncers : vouchers).add(r.issuer);
    return {
      project: r.issuer,
      via: t.path,
      weight: round2(t.trust),
      record_id: r.id,
      effect: round2(sign * t.trust),
      type: r.type,
    };
  }).sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));

  const score = round2(clamp(raw, -1, 1));
  let decision;
  if (path.length === 0) decision = 'UNKNOWN';
  else if (score <= opts.flagThreshold && denouncers.size >= opts.minDenouncers) decision = 'FLAG';
  else if (score >= opts.allowThreshold) decision = 'ALLOW';
  else decision = 'REVIEW';

  return {
    decision,
    score,
    summary: summarize(decision, { handle: h, vouchers, denouncers, ignored, opts }),
    path,
    ignored,
  };
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function summarize(decision, { handle, vouchers, denouncers, ignored, opts }) {
  const ign = ignored.length ? ` ${plural(ignored.length, 'record')} ignored.` : '';
  switch (decision) {
    case 'UNKNOWN':
      return `No history for @${handle} in your trust graph. Normal review, not blocked.${ign}`;
    case 'FLAG':
      return `@${handle} was denounced by ${plural(denouncers.size, 'independent trusted project')}. Flagged for maintainer attention.${ign}`;
    case 'ALLOW':
      return `@${handle} is vouched for by ${plural(vouchers.size, 'trusted project')}` +
        (denouncers.size ? ` (outweighing ${plural(denouncers.size, 'denounce')}).` : '.') + ign;
    default:
      if (denouncers.size === 1 && vouchers.size === 0) {
        return `@${handle} has a single denounce. One denounce is a soft signal, so this is REVIEW, not FLAG (FLAG needs ${opts.minDenouncers} independent projects).${ign}`;
      }
      return `Mixed or weak signals for @${handle}: ${plural(vouchers.size, 'vouch')}, ${plural(denouncers.size, 'denounce')}. A maintainer should take a normal look.${ign}`;
  }
}

/** Effective trust for every project, as a sorted array for the Trust page bar chart. */
export function effectiveTrustList(edges, origin, options = {}) {
  const { trust } = computeTrust(edges, origin, options);
  return [...trust.entries()]
    .filter(([id]) => id !== origin)
    .map(([id, t]) => ({ id, trust: round2(t.trust), hops: t.hops }))
    .sort((a, b) => b.trust - a.trust || a.id.localeCompare(b.id));
}
