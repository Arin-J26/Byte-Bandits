import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterRecords, sortRecords, paginate, toCSV, denounceCounts } from '../js/lib/recordFilter.js';

const recs = [
  { id: 'r1', issuer: 'alpha', subject_handle: 'ada', type: 'vouch', reason: 'Great tests', evidence_urls: ['https://x/1'], timestamp: '2026-10-01T00:00:00Z', signature_valid: true },
  { id: 'r2', issuer: 'beta', subject_handle: 'spam', type: 'denounce', reason: 'Spam, "quoted"', evidence_urls: [], timestamp: '2026-10-03T00:00:00Z', signature_valid: true },
  { id: 'r3', issuer: 'gamma', subject_handle: 'spam', type: 'denounce', reason: '=HYPERLINK("evil")', evidence_urls: [], timestamp: '2026-10-02T00:00:00Z', signature_valid: false },
];

test('filters by text, type, signature and issuer', () => {
  assert.deepEqual(filterRecords(recs, { q: 'SPAM' }).map((r) => r.id), ['r2', 'r3']);
  assert.deepEqual(filterRecords(recs, { type: 'vouch' }).map((r) => r.id), ['r1']);
  assert.deepEqual(filterRecords(recs, { sig: 'invalid' }).map((r) => r.id), ['r3']);
  assert.deepEqual(filterRecords(recs, { issuer: 'beta' }).map((r) => r.id), ['r2']);
  assert.deepEqual(filterRecords(recs, { q: 'https://x/1' }).map((r) => r.id), ['r1']);
});

test('sorts both directions without mutating input', () => {
  assert.deepEqual(sortRecords(recs, 'timestamp', 'desc').map((r) => r.id), ['r2', 'r3', 'r1']);
  assert.deepEqual(sortRecords(recs, 'issuer', 'asc').map((r) => r.id), ['r1', 'r2', 'r3']);
  assert.equal(recs[0].id, 'r1');
});

test('paginates and clamps the page number', () => {
  const p = paginate(recs, 9, 2);
  assert.equal(p.page, 2);
  assert.equal(p.pages, 2);
  assert.deepEqual(p.items.map((r) => r.id), ['r3']);
});

test('CSV export escapes quotes/commas and neutralises formulas', () => {
  const lines = toCSV(recs).split('\n');
  assert.equal(lines[0], 'id,issuer,subject_handle,type,reason,evidence_urls,timestamp,signature_valid');
  assert.equal(lines.length, 4);
  assert.ok(lines[2].includes('"Spam, ""quoted"""'));
  assert.ok(lines[3].includes(`"'=HYPERLINK(""evil"")"`));
});

test('counts independent trusted denouncers, skipping invalid signatures', () => {
  assert.equal(denounceCounts(recs).get('spam'), 1);
  assert.equal(denounceCounts(recs, new Set(['alpha'])).get('spam'), undefined);
});
