import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toElements, flaggedAccounts, neighbours } from '../js/lib/graphData.js';

test('empty input gives no elements', () => {
  assert.deepEqual(toElements(), []);
  assert.deepEqual(toElements({ projects: [], edges: [] }), []);
});

test('50-node network converts to 50 project nodes with weighted edges', () => {
  const projects = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, name: `Project ${i}` }));
  const edges = projects.map((p, i) => ({ from: p.id, to: `p${(i + 1) % 50}`, weight: (i % 10) / 10 }));
  const els = toElements({ projects, edges, perspective: 'p0' });
  const nodes = els.filter((e) => e.group === 'nodes');
  const links = els.filter((e) => e.group === 'edges');
  assert.equal(nodes.length, 50);
  assert.equal(links.length, 50);
  assert.equal(nodes.find((n) => n.data.pid === 'p0').data.me, true);
  const heavy = links.find((l) => l.data.weight === 0.9);
  const light = links.find((l) => l.data.weight === 0);
  assert.ok(heavy.data.width > light.data.width && heavy.data.opacity > light.data.opacity);
});

test('edges to unknown projects, self loops and duplicates are dropped', () => {
  const els = toElements({
    projects: [{ id: 'a' }, { id: 'b' }],
    edges: [{ from: 'a', to: 'b', weight: 1 }, { from: 'a', to: 'b', weight: 1 }, { from: 'a', to: 'zzz', weight: 1 }, { from: 'a', to: 'a', weight: 1 }],
  });
  assert.equal(els.filter((e) => e.group === 'edges').length, 1);
});

test('accounts denounced by two projects become flagged diamond nodes', () => {
  const records = [
    { issuer: 'a', subject_handle: 'spam', type: 'denounce', signature_valid: true },
    { issuer: 'b', subject_handle: 'spam', type: 'denounce', signature_valid: true },
    { issuer: 'a', subject_handle: 'solo', type: 'denounce', signature_valid: true },
  ];
  const flagged = flaggedAccounts(records);
  assert.deepEqual(flagged.map((f) => f.handle), ['spam']);
  const els = toElements({ projects: [{ id: 'a' }, { id: 'b' }], flagged });
  assert.ok(els.some((e) => e.data.kind === 'account' && e.data.handle === 'spam'));
  assert.equal(els.filter((e) => e.data.kind === 'denounce').length, 2);
});

test('neighbours lists both directions', () => {
  const n = neighbours('b', [{ from: 'a', to: 'b', weight: 1 }, { from: 'b', to: 'c', weight: 0.5 }]);
  assert.deepEqual(n.trusts, [{ id: 'c', weight: 0.5 }]);
  assert.deepEqual(n.trustedBy, [{ id: 'a', weight: 1 }]);
});
