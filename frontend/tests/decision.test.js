import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decisionStyle, recordTypeStyle } from '../js/lib/decision.js';

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
  for (const s of [recordTypeStyle('vouch'), recordTypeStyle('denounce')]) {
    assert.ok(s.icon && s.label);
  }
});

test('contest records and Gemma verdicts have their own icon and label', async () => {
  const { aiVerdictStyle } = await import('../js/lib/decision.js');
  assert.deepEqual([recordTypeStyle('contest').icon, recordTypeStyle('contest').label], ['↩', 'Contest']);
  assert.equal(aiVerdictStyle('spam').tone, 'bad');
  assert.equal(aiVerdictStyle('legit').tone, 'ok');
  assert.equal(aiVerdictStyle(undefined).label, 'AI: unclear');
});
