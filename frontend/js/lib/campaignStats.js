// Time binning and burst detection for the Campaigns radar/timeline. Pure.

const toMs = (t) => (typeof t === 'number' ? t : Date.parse(t));

/**
 * Group events into fixed-size time bins.
 * @returns {{start:number, count:number}[]} one entry per bin, empty bins included
 */
export function binEvents(events = [], { binMinutes = 5, start, end } = {}) {
  const times = events.map((e) => toMs(e.timestamp)).filter(Number.isFinite);
  if (!times.length && (start == null || end == null)) return [];
  const size = binMinutes * 60_000;
  const lo = start != null ? toMs(start) : Math.min(...times);
  const hi = end != null ? toMs(end) : Math.max(...times);
  const first = Math.floor(lo / size) * size;
  const n = Math.max(1, Math.floor((hi - first) / size) + 1);
  const bins = Array.from({ length: n }, (_, i) => ({ start: first + i * size, count: 0 }));
  for (const t of times) {
    const i = Math.floor((t - first) / size);
    if (i >= 0 && i < n) bins[i].count++;
  }
  return bins;
}

/** z-score of the busiest bin: how far the peak stands above normal activity. */
export function burstScore(bins = []) {
  if (bins.length < 2) return 0;
  const counts = bins.map((b) => b.count);
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const sd = Math.sqrt(counts.reduce((a, c) => a + (c - mean) ** 2, 0) / counts.length);
  if (sd === 0) return 0;
  return Math.round(((Math.max(...counts) - mean) / sd) * 100) / 100;
}

/** Indices of bins whose own z-score is at least `threshold`. */
export function burstBins(bins = [], threshold = 2) {
  if (bins.length < 2) return [];
  const counts = bins.map((b) => b.count);
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const sd = Math.sqrt(counts.reduce((a, c) => a + (c - mean) ** 2, 0) / counts.length) || 1;
  return counts.flatMap((c, i) => ((c - mean) / sd >= threshold ? [i] : []));
}

/** Filters for the Campaigns page. windowMinutes=0 means any window. */
export function filterCampaigns(campaigns = [], { project = '', windowMinutes = 0, minSize = 0 } = {}) {
  return campaigns.filter((c) => {
    if (minSize && (c.size || 0) < minSize) return false;
    if (windowMinutes && (c.window_minutes || 0) > windowMinutes) return false;
    if (project && !(c.pr_events || []).some((e) => e.project === project)) return false;
    return true;
  });
}

/** Text facts shown on each campaign evidence card. */
export function campaignFacts(c) {
  const events = c.pr_events || [];
  const titles = [...new Set(events.map((e) => e.title).filter(Boolean))];
  const handles = [...new Set(events.map((e) => e.handle).filter(Boolean))];
  return {
    prCount: events.length,
    accounts: c.size ?? handles.length,
    minAge: c.accounts_min_age_days,
    projectsHit: c.projects_hit ?? new Set(events.map((e) => e.project)).size,
    window: c.window_minutes,
    method: c.similarity_method || 'Normalised PR title + diff shingles, Jaccard similarity ≥ 0.85',
    sampleTitles: titles.slice(0, 4),
    sampleHandles: handles.slice(0, 6),
  };
}
