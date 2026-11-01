// Network summary for the Overview page. Pure.

import { flaggedAccounts } from './graphData.js';
import { binEvents } from './campaignStats.js';

/** @param {{projects?,trust_edges?,records?,campaigns?,events?}} n */
export function summarizeNetwork(n = {}) {
  const projects = n.projects || [];
  const edges = n.trust_edges || [];
  const records = n.records || [];
  const campaigns = n.campaigns || [];
  const events = n.events || [];
  const vouches = records.filter((r) => r.type === 'vouch').length;
  const avgWeight = edges.length ? edges.reduce((a, e) => a + (Number(e.weight) || 0), 0) / edges.length : 0;
  const trustedBy = new Map();
  for (const e of edges) trustedBy.set(e.to, (trustedBy.get(e.to) || 0) + 1);
  const mostTrusted = [...trustedBy].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5)
    .map(([id, count]) => ({ id, count }));
  return {
    projects: projects.length,
    edges: edges.length,
    avgWeight: Math.round(avgWeight * 100) / 100,
    records: records.length,
    vouches,
    denounces: records.length - vouches,
    invalid: records.filter((r) => r.signature_valid === false).length,
    flagged: flaggedAccounts(records, campaigns).length,
    campaigns: campaigns.length,
    mostTrusted,
    activity: binEvents(events, { binMinutes: 30 }).map((b) => b.count),
    recent: [...events].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)).slice(0, 6),
  };
}
