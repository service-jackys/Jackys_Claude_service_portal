import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('index.html inline CSS has balanced braces', () => {
  const html = readFileSync('apps/web/src/index.html', 'utf8');
  const blocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)];
  assert.ok(blocks.length > 0);
  for (const block of blocks) {
    const css = block[1].replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(css.split('{').length, css.split('}').length, 'unbalanced CSS braces');
  }
});
