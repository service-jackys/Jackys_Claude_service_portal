import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// label-core.js is a browser script (UMD); evaluate it with a stand-in module.
const source = readFileSync(new URL('../../apps/web/src/label-core.js', import.meta.url), 'utf8');
const mod: { exports: Record<string, any> } = { exports: {} };
new Function('module', source)(mod);
const core = mod.exports as {
  code128Modules(text: string): string;
  barcodeSvg(text: string, opts?: { moduleMm?: number }): string;
  missingDetails(kind: string, data: Record<string, unknown>): string[];
  labelDocument(items: unknown[], settings?: Record<string, unknown>): string;
  testItem(): { kind: string; data: Record<string, unknown> };
};

test('Code 128 modules match reference encoder output (python-barcode, decoded with zxing)', () => {
  assert.equal(core.code128Modules('A'), '1101001000010100011000100010110001100011101011');
  assert.equal(
    core.code128Modules('Hello World~'),
    '11010010000110001010001011001000011001010000110010100001000111101011011001100111010001101000111101010010011110110010100001000010011010001011110100011000101100011101011',
  );
});

test('Code 128 modules always start with Start B and end with the stop pattern', () => {
  const m = core.code128Modules('16101023-1');
  assert.ok(m.startsWith('11010010000'));
  assert.ok(m.endsWith('1100011101011'));
  // 11 modules per symbol, 13 for the stop
  assert.equal((m.length - 13) % 11, 0);
});

test('barcode SVG uses wide modules (0.375 mm) and a quiet zone', () => {
  const svg = core.barcodeSvg('JBC-1');
  const modules = core.code128Modules('JBC-1').length;
  assert.match(svg, new RegExp('width="' + ((modules + 20) * 0.375).toFixed(2) + 'mm"'));
});

test('install sticker needs customer phone only for B2C', () => {
  const base = {
    deliveryNote: '16101023',
    customerName: 'X',
    itemCode: 'C1',
    brand: 'B',
    serviceDate: '2026-11-18',
  };
  assert.deepEqual(core.missingDetails('install', { ...base, customerType: 'B2B' }), []);
  assert.deepEqual(core.missingDetails('install', { ...base, customerType: 'B2C' }), [
    'Customer phone number',
  ]);
  assert.ok(core.missingDetails('install', {}).includes('ERP delivery note'));
});

test('layout A is one 100x150 mm page with two stickers, layout B one 100x75 mm sticker', () => {
  const items = [core.testItem()];
  const a = core.labelDocument(items, { layout: 'A' });
  const b = core.labelDocument(items, { layout: 'B' });
  assert.match(a, /size:100mm 150mm/);
  assert.equal((a.match(/class="lb-sticker"/g) || []).length, 2);
  assert.match(b, /size:100mm 75mm/);
  assert.equal((b.match(/class="lb-sticker"/g) || []).length, 1);
  assert.ok(a.includes('+971 4 336 1695') && a.includes('service@jackys.com'));
});

test('sticker text is HTML-escaped', () => {
  const item = core.testItem();
  item.data.customerName = '<img src=x onerror=1>';
  const html = core.labelDocument([item], { layout: 'B' });
  assert.ok(!html.includes('<img src=x'));
});
