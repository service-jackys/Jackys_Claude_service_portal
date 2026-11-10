import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { parseExtraSheets } from '../../apps/api/src/revenue-dashboard/extra-sheets.js';
import { parseSheetLookups, type SheetCatalogEntry } from '../../apps/api/src/ai/sheet-lookup.js';

function workbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Net Sale Current');
  ws.addRow([
    'Inv No',
    'Inv Dt',
    'Cust Name',
    'Cust Code',
    'TRN_No',
    'Remarks',
    'Brand',
    'Qty',
    'Net Val',
  ]);
  ws.addRow([
    1,
    new Date('2026-10-12T00:00:00Z'),
    'ACME LLC',
    55,
    'TRN1',
    'call Ali',
    'VENUS',
    2,
    120.5,
  ]);
  ws.addRow([2, new Date('2026-10-13T00:00:00Z'), 'Other Co', 56, null, null, 'VENUS', 1, 60]);
  ws.addRow([]);
  wb.addWorksheet('CSIDO').addRow(['Date']);
  return wb;
}

test('extra sheets drop customer columns and keep typed values', () => {
  const sheets = parseExtraSheets(workbook());
  assert.equal(sheets.length, 1); // CSIDO has no rows; other sheets are absent
  const [sheet] = sheets;
  assert.equal(sheet.name, 'Net Sale Current');
  assert.equal(sheet.dateColumn, 'Inv Dt');
  assert.deepEqual(
    sheet.columns.map((c) => c.name),
    ['Inv No', 'Inv Dt', 'Brand', 'Qty', 'Net Val'],
  );
  assert.equal(sheet.columns.find((c) => c.name === 'Inv Dt')?.type, 'date');
  assert.equal(sheet.columns.find((c) => c.name === 'Qty')?.type, 'number');
  assert.equal(sheet.rows.length, 2);
  assert.deepEqual(sheet.rows[0], {
    'Inv No': 1,
    'Inv Dt': '2026-10-12',
    Brand: 'VENUS',
    Qty: 2,
    'Net Val': 120.5,
  });
  assert.ok(!JSON.stringify(sheet.rows).includes('ACME'));
});

const catalog: SheetCatalogEntry[] = [
  {
    name: 'Net Sale Current',
    rows: 2,
    dateColumn: 'Inv Dt',
    columns: [
      { name: 'Inv Dt', type: 'date' },
      { name: 'Brand', type: 'text' },
      { name: 'Qty', type: 'number' },
    ],
  },
];

test('sheet lookups keep only known sheets and columns, numeric sums and capped limits', () => {
  const [lookup] = parseSheetLookups(
    JSON.stringify({
      lookups: [
        {
          sheet: 'Net Sale Current',
          groupBy: ['Brand', 'Cust Name', 'Qty', 'Inv Dt'],
          filters: { Brand: 'VENUS', 'Cust Name': 'ACME' },
          sum: ['Qty', 'Brand'],
          dateFrom: '2026-10-01',
          dateTo: 'bad',
          limit: 5000,
        },
        { sheet: 'Secret Sheet', groupBy: [] },
        { groupBy: ['Brand'] },
      ],
    }),
    catalog,
  );
  assert.deepEqual(lookup.groupBy, ['Brand', 'Qty']);
  assert.deepEqual(lookup.filters, { Brand: 'VENUS' });
  assert.deepEqual(lookup.sum, ['Qty']);
  assert.equal(lookup.dateFrom, '2026-10-01');
  assert.equal(lookup.dateTo, undefined);
  assert.equal(lookup.limit, 60);
  assert.deepEqual(parseSheetLookups('{"lookups":[{"sheet":"CSIDI"}]}', catalog), []);
  assert.deepEqual(parseSheetLookups('{"lookups":[{"sheet":"Net Sale Current"}]}', []), []);
});
