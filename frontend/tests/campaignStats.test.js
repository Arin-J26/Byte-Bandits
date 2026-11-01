import { test } from 'node:test';
import assert from 'node:assert/strict';
import { binEvents, burstScore, burstBins, filterCampaigns, campaignFacts, timelineWindow } from '../js/lib/campaignStats.js';

const at = (min) => ({ timestamp: new Date(Date.UTC(2026, 9, 31, 10, 0) + min * 60_000).toISOString() });

test('events are grouped into fixed bins, empty bins included', () => {
  const bins = binEvents([at(0), at(1), at(4), at(12)], { binMinutes: 5 });
  assert.deepEqual(bins.map((b) => b.count), [3, 0, 1]);
  assert.equal(bins[1].start - bins[0].start, 5 * 60_000);
});

test('binning with no events and no range is empty', () => {
  assert.deepEqual(binEvents([]), []);
});

test('a burst scores higher than steady activity', () => {
  const steady = binEvents([0, 5, 10, 15, 20, 25].map(at), { binMinutes: 5 });
  const burst = binEvents([0, 5, 10, 15, 20, 25, ...Array(10).fill(26)].map((m, i) => at(m + i * 0.01)), { binMinutes: 5 });
  assert.equal(burstScore(steady), 0);
  assert.ok(burstScore(burst) > 2);
  assert.deepEqual(burstBins(burst, 2), [5]);
});

test('campaign filters by size, window and project', () => {
  const cs = [
    { id: 'a', size: 12, window_minutes: 18, pr_events: [{ project: 'p1' }] },
    { id: 'b', size: 4, window_minutes: 40, pr_events: [{ project: 'p2' }] },
  ];
  assert.deepEqual(filterCampaigns(cs, { minSize: 5 }).map((c) => c.id), ['a']);
  assert.deepEqual(filterCampaigns(cs, { windowMinutes: 20 }).map((c) => c.id), ['a']);
  assert.deepEqual(filterCampaigns(cs, { project: 'p2' }).map((c) => c.id), ['b']);
});

test('campaign facts include samples as text', () => {
  const f = campaignFacts({ size: 2, pr_events: [{ handle: 'x', project: 'p', title: 'Fix typo' }, { handle: 'y', project: 'q', title: 'Fix typo' }] });
  assert.equal(f.prCount, 2);
  assert.equal(f.projectsHit, 2);
  assert.deepEqual(f.sampleTitles, ['Fix typo']);
});

test('sparse single events are never bursts', () => {
  const sparse = binEvents([0, 300, 900, 2000].map(at), { binMinutes: 5 });
  assert.deepEqual(burstBins(sparse, 2), []);
});

test('timeline window caps the span and keeps the bin count small', () => {
  const old = { timestamp: '2026-04-01T00:00:00Z' };
  const win = timelineWindow([old, at(0), at(100)], { maxSpanHours: 12, maxBins: 48 });
  assert.equal(win.end - win.start <= 12 * 3600_000, true);
  assert.ok((win.end - win.start) / 60_000 / win.binMinutes <= 48);
  assert.equal(timelineWindow([]), null);
  assert.equal(timelineWindow([at(0), at(30)]).binMinutes, 5);
});

test('suggested denounces are unsigned and match the backend shape', async () => {
  const { suggestDenounces } = await import('../js/lib/campaignStats.js');
  const res = suggestDenounces({ id: 'c1', size: 2, projects_hit: 2, window_minutes: 5,
    pr_events: [{ id: 'e1', handle: 'a' }, { id: 'e2', handle: 'b' }, { id: 'e3', handle: 'a' }] }, 'lumen-ui');
  assert.equal(res.sent, false);
  assert.deepEqual(res.proposals.map((p) => p.subject_handle), ['a', 'b']);
  assert.deepEqual(res.proposals[0].evidence_urls, ['urn:sniffer:pr-event:e1', 'urn:sniffer:pr-event:e3']);
  assert.ok(res.proposals.every((p) => p.type === 'denounce' && p.signed === false));
});
