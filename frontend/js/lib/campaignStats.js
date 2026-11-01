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

/**
 * Indices of bins whose own z-score is at least `threshold` AND that hold at least `minCount`
 * events (in sparse data a single event would otherwise look like a burst).
 */
export function burstBins(bins = [], threshold = 2, minCount = 3) {
  if (bins.length < 2) return [];
  const counts = bins.map((b) => b.count);
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const sd = Math.sqrt(counts.reduce((a, c) => a + (c - mean) ** 2, 0) / counts.length) || 1;
  return counts.flatMap((c, i) => (c >= minCount && (c - mean) / sd >= threshold ? [i] : []));
}

const NICE_MINUTES = [5, 10, 15, 30, 60, 120, 240, 480, 720, 1440];

/**
 * Pick a display window and bin size for a timeline: at most `maxSpanHours` ending at the newest
 * event, and a "nice" bin size so there are no more than `maxBins` bins.
 */
export function timelineWindow(events = [], { maxSpanHours = 12, maxBins = 48 } = {}) {
  const times = events.map((e) => toMs(e.timestamp)).filter(Number.isFinite);
  if (!times.length) return null;
  const end = Math.max(...times);
  const start = Math.max(Math.min(...times), end - maxSpanHours * 3600_000);
  const spanMin = Math.max(1, (end - start) / 60_000);
  const binMinutes = NICE_MINUTES.find((m) => spanMin / m <= maxBins) || NICE_MINUTES[NICE_MINUTES.length - 1];
  return { start, end, binMinutes };
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

/** Unsigned denounce proposals for a campaign (same shape as the backend endpoint). Sends nothing. */
export function suggestDenounces(c, issuer) {
  const events = c.pr_events || [];
  const handles = [...new Set(events.map((e) => e.handle).filter(Boolean))];
  return {
    campaign_id: c.id,
    issuer,
    sent: false,
    note: 'Proposals only. Review them, then sign and publish from your own project if you agree.',
    proposals: handles.map((handle) => ({
      issuer,
      subject_handle: handle,
      type: 'denounce',
      reason: `Part of coordinated campaign ${c.id}: ${c.size} accounts, ${c.projects_hit} projects, ${c.window_minutes}-minute window`,
      evidence_urls: events.filter((e) => e.handle === handle).map((e) => `urn:sniffer:pr-event:${e.id}`).slice(0, 10),
      signed: false,
    })),
  };
}
