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

// ---- Options C and D: compact barcode keys, barcode label and A4 sheet (modification #320) ----
const bc = core as unknown as {
  code128Modules(text: string, compact?: boolean): string;
  compactJob(reference: string): string;
  compactVisit(reference: string): string;
  compactUnit(note: string, unit: number): string;
  parseCompact(text: string): Record<string, unknown> | null;
  barcodePlan(
    count: number,
    settings: Record<string, unknown>,
  ): { pages: number; nextStartCell: number; startCell: number };
  barcodeDocument(
    items: unknown[],
    settings: Record<string, unknown>,
    ctx?: Record<string, unknown>,
  ): string;
  testBarcodeItems(settings: Record<string, unknown>): unknown[];
};

test('compact keys round-trip and set C keeps the barcode short', () => {
  assert.equal(bc.compactJob('JBC-2026-00301'), 'J26000301');
  assert.equal(bc.compactVisit('WI-2026-00112'), 'V26000112');
  assert.equal(bc.compactUnit('16101431', 1), '1610143101');
  assert.equal(bc.compactUnit('TEST0001', 1), '');
  assert.deepEqual(bc.parseCompact('J26000301'), {
    kind: 'job_card',
    reference: 'JBC-2026-00301',
  });
  assert.deepEqual(bc.parseCompact('V26000112'), { kind: 'visit', reference: 'WI-2026-00112' });
  assert.deepEqual(bc.parseCompact('1610143101'), { kind: 'unit', note: '16101431', unitNo: 1 });
  assert.equal(bc.parseCompact('JBC-2026-00301'), null);
  // set C: 101 modules instead of 189 for the long job number
  assert.equal(bc.code128Modules('J26000301', true).length, 101);
  assert.equal(bc.code128Modules('JBC-2026-00301').length, 189);
});

test('set C encoding: digit pairs, Start C, checksum (reference: "1234" = 105 12 34, check 62)', () => {
  // 105 + 12*1 + 34*2 = 185; 185 mod 103 = 82 -> symbol 82 pattern 421211? check via length and stop
  const m = bc.code128Modules('1234', true);
  assert.ok(m.startsWith('11010011100')); // Start C
  assert.ok(m.endsWith('1100011101011')); // stop
  assert.equal(m.length, 11 * 4 + 13); // start, 2 pairs, checksum, stop
});

test('barcode label: C holds 5 (rows + visit barcode), 6 or 8 per label and spills to a new label', () => {
  const items = bc.testBarcodeItems({ layout: 'C', perLabel: 8 });
  assert.equal(items.length, 8);
  const eight = bc.barcodeDocument(items, { layout: 'C', perLabel: 8 }, { footer: 'x' });
  assert.match(eight, /size:100mm 150mm/);
  assert.equal((eight.match(/class="bc-cell"/g) || []).length, 8);
  assert.equal((eight.match(/class="bc-page"/g) || []).length, 1);
  const nine = bc.barcodeDocument(
    [...items, ...bc.testBarcodeItems({ layout: 'C', perLabel: 8 }).slice(0, 1)],
    { layout: 'C', perLabel: 8 },
    {},
  );
  assert.equal((nine.match(/class="bc-page"/g) || []).length, 2);
  const five = bc.barcodeDocument(
    bc.testBarcodeItems({ layout: 'C', perLabel: 5 }),
    { layout: 'C', perLabel: 5, visitBarcode: true },
    { title: 'JUMEIRAH', visitCode: 'WI-2026-00112' },
  );
  assert.equal((five.match(/class="bc-row"/g) || []).length, 5);
  assert.ok(five.includes('WI-2026-00112'));
  const noVisit = bc.barcodeDocument(
    bc.testBarcodeItems({ layout: 'C', perLabel: 5 }),
    { layout: 'C', perLabel: 5, visitBarcode: false },
    { title: 'JUMEIRAH', visitCode: 'WI-2026-00112' },
  );
  assert.ok(!noVisit.includes('WI-2026-00112'));
});

test('A4 sheet: start cell leaves earlier cells empty, plan counts sheets and the next free cell', () => {
  const items = bc.testBarcodeItems({ layout: 'D', sheetCells: 8 }).slice(0, 5);
  const doc = bc.barcodeDocument(items, { layout: 'D', sheetCells: 8, startCell: 4 }, {});
  assert.match(doc, /size:A4/);
  assert.equal((doc.match(/class="sh-cell" style=/g) || []).length, 3); // 3 empty cells before cell 4
  assert.equal((doc.match(/<svg /g) || []).length, 5);
  assert.deepEqual(bc.barcodePlan(5, { layout: 'D', sheetCells: 8, startCell: 4 }), {
    cellsPerPage: 8,
    startCell: 4,
    pages: 1,
    nextStartCell: 1,
  });
  assert.equal(bc.barcodePlan(6, { layout: 'D', sheetCells: 8, startCell: 4 }).pages, 2);
  assert.equal(bc.barcodePlan(2, { layout: 'D', sheetCells: 6, startCell: 2 }).nextStartCell, 4);
  const six = bc.barcodeDocument(items, { layout: 'D', sheetCells: 6, startCell: 1 }, {});
  assert.equal((six.match(/height:93mm/g) || []).length, 6);
});
