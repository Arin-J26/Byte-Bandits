import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarizeNetwork } from '../js/lib/overview.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../mock/${f}`, import.meta.url)));

test('empty network summarises to zeros', () => {
  const s = summarizeNetwork();
  assert.equal(s.projects, 0);
  assert.equal(s.avgWeight, 0);
  assert.deepEqual(s.recent, []);
});

test('mock network summary is consistent', () => {
  const n = { projects: load('projects.json'), trust_edges: load('trust-edges.json'), records: load('records.json'), campaigns: load('campaigns.json'), events: load('events.json') };
  const s = summarizeNetwork(n);
  assert.equal(s.projects, 25);
  assert.equal(s.vouches + s.denounces, s.records);
  assert.equal(s.invalid, 1);
  assert.ok(s.flagged >= 1 && s.campaigns === 2);
  assert.equal(s.recent.length, 6);
  assert.ok(s.mostTrusted[0].count >= s.mostTrusted[1].count);
});
