import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyScore, fuzzyFilter } from '../js/lib/fuzzy.js';

test('substring and prefix matches rank highest', () => {
  assert.ok(fuzzyScore('eval', 'Evaluate a contributor') > fuzzyScore('eval', 'Trust levels'));
  assert.equal(fuzzyScore('xyz', 'Graph'), -1);
});

test('letters in order match even when not adjacent', () => {
  assert.ok(fuzzyScore('cmp', 'Campaigns') > 0);
  assert.equal(fuzzyScore('pmc', 'Campaigns'), -1);
});

test('fuzzyFilter ranks, limits and keeps order for empty queries', () => {
  const items = ['Graph', 'Evaluate', 'Campaigns', 'Records'];
  assert.deepEqual(fuzzyFilter(items, ''), items);
  assert.deepEqual(fuzzyFilter(items, 'rec'), ['Records']);
  assert.equal(fuzzyFilter(items, 'a', (x) => x, 2).length, 2);
});
