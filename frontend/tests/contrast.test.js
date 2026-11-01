// WCAG AA contrast for the colour tokens in css/base.css, in both themes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../css/base.css', import.meta.url), 'utf8');

function tokens(selector) {
  const start = css.indexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf('\n}', start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const TEXT_TOKENS = ['text', 'muted', 'dim', 'accent', 'ok', 'warn', 'bad'];

for (const [name, sel] of [['light', ':root'], ['dark', ':root[data-theme="dark"]']]) {
  const t = tokens(sel);
  test(`${name} theme: text tokens meet AA (4.5:1) on bg and surface`, () => {
    for (const fg of TEXT_TOKENS) {
      for (const bg of ['bg', 'surface']) {
        assert.ok(t[fg] && t[bg], `missing --${fg} or --${bg}`);
        const r = ratio(t[fg], t[bg]);
        assert.ok(r >= 4.5, `--${fg} on --${bg} is ${r.toFixed(2)}:1`);
      }
    }
  });
}

test('light theme: decision colours stay AA on their tinted backgrounds', () => {
  const t = tokens(':root');
  for (const k of ['ok', 'warn', 'bad', 'accent']) {
    const r = ratio(t[k], t[`${k}-bg`]);
    assert.ok(r >= 4.5, `--${k} on --${k}-bg is ${r.toFixed(2)}:1`);
  }
  assert.ok(ratio(t['on-accent'], t.accent) >= 4.5, 'primary button text');
});
