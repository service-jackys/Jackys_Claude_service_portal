import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { parseStockWorkbook, StockParseError } from '../../apps/api/src/stock-master/parser.js';

const HEADER = [
  'Location',
  'LocnDesc',
  'ItemCode',
  'ItemDesc',
  'Grade',
  'Stock',
  'WAC',
  'Value',
  'Transit',
  'RESERVED',
  'MainGroup',
  'Group',
  'SubGroup',
  'Brand',
  'TYPE',
  'Last Grn',
  'Last GRN Date',
  'Landed cost',
];

async function build(rows: unknown[][], titleRows = 3): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Current Stock Valuation');
  sheet.addRow(['Current Stock Valuation']);
  for (let i = 1; i < titleRows; i += 1) sheet.addRow([]);
  sheet.addRow(HEADER);
  for (const row of rows) sheet.addRow(row);
  sheet.addRow(['Summary:']);
  sheet.addRow([]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const row = (location: string, code: string, desc: string, brand = 'THOMSON') => [
  location,
  `LOC ${location}`,
  code,
  desc,
  'NA',
  '3',
  10,
  30,
  0,
  0,
  'MDA',
  'FREEZER',
  'FREEZER - CHEST',
  brand,
  '0',
  5,
  new Date('2026-04-07T00:00:00Z'),
  5,
];

test('skips title rows and the Summary footer, keeps one item per ItemCode', async () => {
  const parsed = await parseStockWorkbook(
    await build([
      row('A', 'X1', 'FREEZER ONE'),
      row('B', 'X1', 'FREEZER ONE'),
      row('A', 'X2', 'TWO'),
    ]),
  );
  assert.equal(parsed.headerRow, 4);
  assert.equal(parsed.rows.length, 3);
  assert.deepEqual([...parsed.items.keys()], ['X1', 'X2']);
  assert.equal(parsed.rows[0].stock, 3);
  assert.equal(parsed.rows[0].lastGrnDate, '2026-04-07');
  assert.equal(parsed.warnings.length, 0);
});

test('warns when rows of one item disagree inside a file', async () => {
  const parsed = await parseStockWorkbook(
    await build([row('A', 'X1', 'FREEZER ONE'), row('B', 'X1', 'FREEZER ONE', 'OTHER')]),
  );
  assert.equal(parsed.warnings.length, 1);
  assert.equal(parsed.items.get('X1')?.brand, 'THOMSON');
});

test('rejects a file without the ERP header', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Sheet1').addRow(['nothing', 'here']);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  await assert.rejects(parseStockWorkbook(buffer), StockParseError);
});
