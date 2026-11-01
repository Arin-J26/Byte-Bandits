import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateNetwork } from '../js/lib/validate.js';
import { generateNetwork } from '../js/lib/simulate.js';

test('rejects non-objects and missing fields with friendly messages', () => {
  assert.equal(validateNetwork([]).ok, false);
  assert.equal(validateNetwork(null).ok, false);
  assert.match(validateNetwork({}).errors.join(' '), /projects/);
});

test('rejects bad weights and unknown edge targets', () => {
  const res = validateNetwork({ projects: [{ id: 'a' }], trust_edges: [{ from: 'a', to: 'b', weight: 2 }] });
  assert.equal(res.ok, false);
  assert.equal(res.errors.length, 2);
});

test('generated networks are deterministic and valid', () => {
  const a = generateNetwork({ projectCount: 40, seed: 7 });
  const b = generateNetwork({ projectCount: 40, seed: 7 });
  assert.deepEqual(a, b);
  assert.equal(a.projects.length, 40);
  assert.equal(validateNetwork(a).ok, true);
});
