// Every file in frontend/mock/ must be valid JSON with the documented shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { validateNetwork } from '../js/lib/validate.js';

const DIR = new URL('../mock/', import.meta.url);
const files = readdirSync(DIR);
const load = (f) => JSON.parse(readFileSync(new URL(f, DIR), 'utf8'));

test('mock folder has all required files', () => {
  for (const f of ['projects.json', 'trust-edges.json', 'records.json', 'evaluate-allow.json', 'evaluate-unknown.json', 'evaluate-flag.json', 'campaigns.json', 'events.json']) {
    assert.ok(files.includes(f), `missing ${f}`);
  }
});

for (const f of files) {
  test(`${f} is valid JSON`, () => { assert.doesNotThrow(() => load(f)); });
}

test('mock network passes import validation', () => {
  const res = validateNetwork({ projects: load('projects.json'), trust_edges: load('trust-edges.json'), records: load('records.json') });
  assert.deepEqual(res.errors, []);
  assert.ok(load('projects.json').length >= 20);
});

test('records include vouches, denounces and exactly one invalid signature', () => {
  const recs = load('records.json');
  assert.ok(recs.some((r) => r.type === 'vouch') && recs.some((r) => r.type === 'denounce'));
  assert.equal(recs.filter((r) => r.signature_valid === false).length, 1);
});

test('evaluate fixtures cover ALLOW, UNKNOWN and FLAG', () => {
  assert.equal(load('evaluate-allow.json').decision, 'ALLOW');
  assert.equal(load('evaluate-unknown.json').decision, 'UNKNOWN');
  assert.equal(load('evaluate-flag.json').decision, 'FLAG');
});
