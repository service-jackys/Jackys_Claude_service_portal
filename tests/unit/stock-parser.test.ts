import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { parseStockWorkbook, StockParseError } from '../../apps/api/src/stock-master/parser.js';

const HEADER = ['Item Code', 'Item Desc', 'Maingrp Name', 'Grp Name', 'SUBGRPNAME', 'BRANDNAME'];

async function build(rows: unknown[][], titleRows = 0, header: string[] = HEADER): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Item Listing with Barcode');
  for (let i = 0; i < titleRows; i += 1) sheet.addRow(i === 0 ? ['Item Listing'] : []);
  sheet.addRow(header);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const row = (code: string, desc: string, brand: string | null = 'THOMSON') => [
  code,
  desc,
  'MDA',
  'FREEZER',
  'FREEZER - CHEST',
  brand,
];

test('reads the Item Listing and keeps one item per item code', async () => {
  const parsed = await parseStockWorkbook(
    await build([row('X1', 'FREEZER ONE'), row('X1', 'FREEZER ONE'), row('X2', 'TWO')]),
  );
  assert.equal(parsed.headerRow, 1);
  assert.equal(parsed.rowCount, 3);
  assert.deepEqual([...parsed.items.keys()], ['X1', 'X2']);
  assert.deepEqual(parsed.items.get('X2'), {
    itemCode: 'X2',
    itemDesc: 'TWO',
    mainGroup: 'MDA',
    groupName: 'FREEZER',
    subGroup: 'FREEZER - CHEST',
    brand: 'THOMSON',
  });
  assert.equal(parsed.warnings.length, 0);
});

test('finds the header below title rows, trims codes and allows a blank brand', async () => {
  const parsed = await parseStockWorkbook(await build([row(' X9 ', 'NINE', null)], 3));
  assert.equal(parsed.headerRow, 4);
  assert.equal(parsed.items.get('X9')?.itemCode, 'X9');
  assert.equal(parsed.items.get('X9')?.brand, null);
});

test('warns when rows of one item disagree, and when codes differ only by case', async () => {
  const parsed = await parseStockWorkbook(
    await build([
      row('X1', 'FREEZER ONE'),
      row('X1', 'FREEZER ONE', 'OTHER'),
      row('x1', 'FREEZER ONE'),
    ]),
  );
  assert.equal(parsed.warnings.length, 2);
  assert.match(parsed.warnings[0], /differs from its earlier row.*brand/);
  assert.match(parsed.warnings[1], /upper \/ lower case/);
  assert.equal(parsed.items.size, 1);
  assert.equal(parsed.items.get('X1')?.brand, 'THOMSON');
});

test('skips a row without an item description', async () => {
  const parsed = await parseStockWorkbook(await build([row('X1', ''), row('X2', 'TWO')]));
  assert.deepEqual([...parsed.items.keys()], ['X2']);
  assert.match(parsed.warnings[0], /no Item Desc/);
});

test('still reads the older ERP column names', async () => {
  const parsed = await parseStockWorkbook(
    await build([row('X1', 'ONE')], 0, [
      'ItemCode',
      'ItemDesc',
      'MainGroup',
      'Group',
      'SubGroup',
      'Brand',
    ]),
  );
  assert.equal(parsed.items.get('X1')?.groupName, 'FREEZER');
});

test('names the missing columns', async () => {
  await assert.rejects(
    parseStockWorkbook(await build([['X1', 'ONE']], 0, ['Item Code', 'Item Desc'])),
    /missing columns: Maingrp Name, Grp Name, SUBGRPNAME, BRANDNAME/,
  );
});

test('rejects a file without the ERP header', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Sheet1').addRow(['nothing', 'here']);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  await assert.rejects(parseStockWorkbook(buffer), StockParseError);
});

test('rejects a header with no item rows', async () => {
  await assert.rejects(parseStockWorkbook(await build([])), /no item rows/);
});
