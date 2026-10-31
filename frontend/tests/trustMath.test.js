import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeTrust, evaluate, effectiveTrustList } from '../js/lib/trustMath.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const chain = [{ from: 'me', to: 'a', weight: 0.8 }, { from: 'a', to: 'b', weight: 0.8 }];

test('two hops of 0.8 give 0.8 x 0.8 = 0.64', () => {
  const { trust } = computeTrust(chain, 'me', { decay: 1 });
  close(trust.get('a').trust, 0.8);
  close(trust.get('b').trust, 0.64);
  // Same numbers with full-trust edges and decay 0.8
  const full = computeTrust([{ from: 'me', to: 'a', weight: 1 }, { from: 'a', to: 'b', weight: 1 }], 'me', { decay: 0.8 }).trust;
  close(full.get('a').trust, 0.8);
  close(full.get('b').trust, 0.64);
});

test('best path wins over a weaker one', () => {
  const edges = [{ from: 'me', to: 'x', weight: 0.2 }, { from: 'me', to: 'a', weight: 1 }, { from: 'a', to: 'x', weight: 1 }];
  close(computeTrust(edges, 'me', { decay: 1 }).trust.get('x').trust, 1);
});

test('depth cutoff ignores projects beyond maxDepth', () => {
  const edges = [{ from: 'me', to: 'a', weight: 1 }, { from: 'a', to: 'b', weight: 1 }, { from: 'b', to: 'c', weight: 1 }];
  const { trust, beyond, frontier } = computeTrust(edges, 'me', { maxDepth: 2 });
  assert.ok(trust.has('b'));
  assert.ok(!trust.has('c'));
  assert.ok(beyond.has('c') && frontier.has('c'));
  const res = evaluate({ edges, records: [{ id: 'r1', issuer: 'c', subject_handle: 'x', type: 'vouch', signature_valid: true }], projectId: 'me', handle: 'x', options: { maxDepth: 2 } });
  assert.equal(res.decision, 'UNKNOWN');
  assert.match(res.ignored[0].reason, /beyond depth limit/);
});

test('no records means UNKNOWN, never blocked', () => {
  const res = evaluate({ edges: chain, records: [], projectId: 'me', handle: 'newbie' });
  assert.equal(res.decision, 'UNKNOWN');
  assert.equal(res.score, 0);
  assert.match(res.summary, /not blocked/);
});

test('one denounce alone does not produce FLAG, even from your own project', () => {
  const records = [{ id: 'd1', issuer: 'me', subject_handle: 'sam', type: 'denounce', signature_valid: true }];
  const res = evaluate({ edges: chain, records, projectId: 'me', handle: 'sam' });
  assert.equal(res.score, -1);
  assert.equal(res.decision, 'REVIEW');
  assert.match(res.summary, /soft signal/);
});

test('two independent trusted denounces produce FLAG', () => {
  const records = [
    { id: 'd1', issuer: 'me', subject_handle: 'spam', type: 'denounce', signature_valid: true },
    { id: 'd2', issuer: 'a', subject_handle: 'spam', type: 'denounce', signature_valid: true },
  ];
  assert.equal(evaluate({ edges: chain, records, projectId: 'me', handle: '@Spam' }).decision, 'FLAG');
});

test('untrusted issuers and invalid signatures are ignored with a reason', () => {
  const records = [
    { id: 'v1', issuer: 'a', subject_handle: 'ada', type: 'vouch', signature_valid: true },
    { id: 'd1', issuer: 'stranger', subject_handle: 'ada', type: 'denounce', signature_valid: true },
    { id: 'v2', issuer: 'a', subject_handle: 'ada', type: 'vouch', signature_valid: false },
  ];
  const res = evaluate({ edges: chain, records, projectId: 'me', handle: 'ada' });
  assert.equal(res.decision, 'ALLOW');
  assert.deepEqual(res.ignored.map((i) => i.reason).sort(), ['invalid signature', 'not in your trust graph']);
  assert.deepEqual(res.path[0].via, ['me', 'a']);
});

test('effectiveTrustList is sorted and excludes the origin', () => {
  const list = effectiveTrustList(chain, 'me', { decay: 1 });
  assert.deepEqual(list.map((x) => x.id), ['a', 'b']);
  assert.equal(list[1].hops, 2);
});

test('mock evaluate fixtures match what trustMath computes', () => {
  const load = (f) => JSON.parse(readFileSync(new URL(`../mock/${f}`, import.meta.url)));
  const edges = load('trust-edges.json');
  const records = load('records.json');
  for (const f of ['evaluate-allow.json', 'evaluate-unknown.json', 'evaluate-flag.json']) {
    const fx = load(f);
    const res = evaluate({ edges, records, projectId: fx.project_id, handle: fx.handle });
    assert.equal(res.decision, fx.decision, f);
    assert.equal(res.score, fx.score, f);
  }
});

test('mock maths ignores contest records instead of counting them as vouches', () => {
  const records = [{ id: 'c1', issuer: 'a', subject_handle: 'carl', type: 'contest', signature_valid: true }];
  const res = evaluate({ edges: chain, records, projectId: 'me', handle: 'carl' });
  assert.equal(res.decision, 'UNKNOWN');
  assert.match(res.ignored[0].reason, /contests/);
});
