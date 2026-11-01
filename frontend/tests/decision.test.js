import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decisionStyle, recordTypeStyle, signatureStyle } from '../js/lib/decision.js';

test('each decision maps to colour, icon and label', () => {
  assert.deepEqual(
    ['ALLOW', 'REVIEW', 'UNKNOWN', 'FLAG'].map((d) => [decisionStyle(d).color, decisionStyle(d).icon]),
    [['green', '✓'], ['amber', '!'], ['amber', '!'], ['red', '✕']],
  );
  assert.equal(decisionStyle('FLAG').label, 'Flag');
});

test('UNKNOWN explains that newcomers are not blocked', () => {
  assert.match(decisionStyle('UNKNOWN').note, /not blocked/);
});

test('decision lookup is case-insensitive and unknown values fall back to REVIEW', () => {
  assert.equal(decisionStyle('allow').key, 'ALLOW');
  assert.equal(decisionStyle('banana').key, 'REVIEW');
  assert.equal(decisionStyle(undefined).key, 'REVIEW');
});

test('record type and signature styles always carry an icon and text', () => {
  for (const s of [recordTypeStyle('vouch'), recordTypeStyle('denounce'), signatureStyle(true), signatureStyle(false)]) {
    assert.ok(s.icon && s.label);
  }
  assert.equal(signatureStyle(false).tone, 'bad');
});
