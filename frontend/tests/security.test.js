// Fails if any frontend JS assigns innerHTML/outerHTML with a non-empty value,
// or uses insertAdjacentHTML, document.write, eval or new Function.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const JS_DIR = fileURLToPath(new URL('../js/', import.meta.url));

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
}

const files = walk(JS_DIR);
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('there are JS files to scan', () => assert.ok(files.length > 10));

test('no innerHTML/outerHTML assignment with a variable', () => {
  const bad = [];
  for (const f of files) {
    const src = strip(readFileSync(f, 'utf8'));
    for (const m of src.matchAll(/\.(innerHTML|outerHTML)\s*(\+?=)\s*([^;\n]*)/g)) {
      if (!/^(''|""|``)$/.test(m[3].trim())) bad.push(`${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('no insertAdjacentHTML, document.write, eval or new Function', () => {
  const bad = [];
  for (const f of files) {
    const src = strip(readFileSync(f, 'utf8'));
    if (/insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function\s*\(/.test(src)) bad.push(f);
  }
  assert.deepEqual(bad, []);
});

test('no API keys or tokens in frontend code', () => {
  for (const f of files) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /(api[_-]?key|secret|bearer\s+[a-z0-9]|sk-[a-z0-9]{10,})/i, f);
  }
});

test('only api.js calls fetch', () => {
  const callers = files.filter((f) => /\bfetch\s*\(/.test(strip(readFileSync(f, 'utf8'))));
  assert.deepEqual(callers.map((f) => f.slice(JS_DIR.length)), ['api.js']);
});
