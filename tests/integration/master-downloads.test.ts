import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { parseStockWorkbook } from '../../apps/api/src/stock-master/parser.js';
import { createStockMasterService } from '../../apps/api/src/stock-master/service.js';
import {
  createRevenueDashboardService,
  RevenueDashboardServiceError,
} from '../../apps/api/src/revenue-dashboard/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

async function sheetRows(buffer: Buffer, sheetName: string): Promise<unknown[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet(sheetName);
  assert.ok(sheet, `sheet ${sheetName} exists`);
  const rows: unknown[][] = [];
  sheet.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
  return rows;
}

async function stockFile(tag: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Stock');
  sheet.addRow([
    'Location',
    'LocnDesc',
    'ItemCode',
    'ItemDesc',
    'Grade',
    'Stock',
    'WAC',
    'Value',
    'Transit',
    'Reserved',
    'MainGroup',
    'Group',
    'SubGroup',
    'Brand',
    'TYPE',
    'LastGRN',
    'LastGRNDate',
    'LandedCost',
  ]);
  sheet.addRow([
    'W1',
    'Main store',
    `MD-${tag}-1`,
    'Fridge 300L',
    'A',
    5,
    1200.5,
    6002.5,
    1,
    2,
    'MDA',
    'REFRIGERATORS',
    'TOP MOUNT',
    'TESTBRAND',
    'FG',
    40,
    new Date('2026-09-30T00:00:00Z'),
    1100,
  ]);
  sheet.addRow([
    'W2',
    'Showroom',
    `MD-${tag}-2`,
    'Washer 8kg',
    'A',
    3,
    900,
    2700,
    0,
    0,
    'MDA',
    'WASHERS',
    'FRONT LOAD',
    'TESTBRAND',
    'FG',
    12,
    new Date('2026-08-01T00:00:00Z'),
    850,
  ]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test(
  'Master downloads: stock files and revenue/budget workbooks come back as uploaded, or rebuilt when the original is not kept',
  { skip: !databaseUrl, concurrency: false },
  async (context) => {
    try {
      await migrate();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        context.skip('PostgreSQL is not available');
        return;
      }
      throw error;
    }
    const pool = createDbPool(databaseUrl);
    const tag = randomUUID().slice(0, 8).toUpperCase();
    const uploadIds: string[] = [];
    const batchIds: string[] = [];
    try {
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'Master download test') RETURNING id`,
        [`md-${randomUUID()}@example.test`],
      );
      const profileId = profile.rows[0]!.id;
      const stock = createStockMasterService(pool);

      // --- stock: the file as uploaded --------------------------------------
      const bytes = await stockFile(tag);
      const uploaded = await stock.upload(
        'TGE',
        { originalname: `tge-${tag}.xlsx`, size: bytes.length, buffer: bytes },
        profileId,
      );
      uploadIds.push(uploaded.id);
      const original = await stock.download('TGE', profileId);
      assert.equal(original.source, 'original');
      assert.equal(original.fileName, `tge-${tag}.xlsx`);
      assert.ok(original.buffer.equals(bytes), 'downloaded bytes equal the uploaded bytes');

      // a newer upload for the channel drops the older bytes
      const second = await stock.upload(
        'TGE',
        { originalname: `tge2-${tag}.xlsx`, size: bytes.length, buffer: bytes },
        profileId,
      );
      uploadIds.push(second.id);
      const held = await pool.query<{ id: string; kept: boolean }>(
        `SELECT id::text AS id, file_bytes IS NOT NULL AS kept FROM stock_uploads WHERE id = ANY($1::bigint[]) ORDER BY id`,
        [uploadIds],
      );
      assert.deepEqual(
        held.rows.map((row) => row.kept),
        [false, true],
      );

      // --- stock: an old upload with no bytes is rebuilt from the rows --------
      await pool.query(`UPDATE stock_uploads SET file_bytes = NULL WHERE id = $1::bigint`, [
        second.id,
      ]);
      const rebuilt = await stock.download('TGE', profileId);
      assert.equal(rebuilt.source, 'rebuilt');
      assert.match(rebuilt.fileName, /^Stock_TGE_rebuilt_\d{4}-\d{2}-\d{2}\.xlsx$/);
      const reparsed = await parseStockWorkbook(rebuilt.buffer);
      assert.equal(reparsed.rows.length, 2);
      const fridge = reparsed.rows.find((row) => row.itemCode === `MD-${tag}-1`)!;
      assert.equal(fridge.itemDesc, 'Fridge 300L');
      assert.equal(fridge.brand, 'TESTBRAND');
      assert.equal(fridge.stock, 5);
      assert.equal(fridge.wac, 1200.5);
      assert.equal(fridge.lastGrnDate, '2026-09-30');
      assert.equal(fridge.landedCost, 1100);

      // --- stock: item list and bad input -----------------------------------
      const items = await stock.download('items', profileId);
      const itemRows = await sheetRows(items.buffer, 'Stock item master');
      assert.deepEqual(itemRows[0]!.slice(0, 9), [
        'ItemCode',
        'ItemDesc',
        'Grade',
        'MainGroup',
        'Group',
        'SubGroup',
        'Brand',
        'TYPE',
        'Last channel',
      ]);
      const itemRow = itemRows.find((row) => row[0] === `MD-${tag}-2`)!;
      assert.equal(itemRow[1], 'Washer 8kg');
      assert.equal(itemRow[8], 'TGE');
      assert.equal(itemRow[11], 'In latest file');
      await assert.rejects(stock.download('XYZ', profileId), /Choose what to download/);

      // --- revenue + budget batches -----------------------------------------
      const revenue = createRevenueDashboardService(pool);
      const revBatch = await pool.query<{ id: string }>(
        `INSERT INTO revenue_import_batches (kind, file_name, file_sha256, row_count, total_amount, is_active, uploaded_by)
         VALUES ('revenue', $1, 'x', 1, 150, false, $2) RETURNING id::text AS id`,
        [`Master-${tag}.xlsm`, profileId],
      );
      batchIds.push(revBatch.rows[0]!.id);
      await pool.query(
        `INSERT INTO revenue_lines (batch_id, source_row, job_type, inv_del_no, order_date, year, month_no, customer, sales_person, qty, revenue, billing_code, sales_channel)
         VALUES ($1::bigint, 7, 'CSIDI', $2, '2026-10-05', 2026, 10, 'Test Customer', 'Test Salesman', 2, 150, 'B1', 'JDI')`,
        [revBatch.rows[0]!.id, `INV-${tag}`],
      );
      const revRebuilt = await revenue.downloadBatch(revBatch.rows[0]!.id, profileId);
      assert.equal(revRebuilt.source, 'rebuilt');
      assert.equal(revRebuilt.fileName, `Master-${tag}_rebuilt.xlsx`);
      const revRows = await sheetRows(revRebuilt.buffer, 'Revenue Source');
      assert.equal(revRows[0]![1], 'Job Type');
      assert.equal(revRows[1]![1], 'CSIDI');
      assert.equal(revRows[1]![3], `INV-${tag}`);
      assert.equal(revRows[1]![16], 150);

      const kept = Buffer.from(`original-${tag}`);
      await pool.query(`UPDATE revenue_import_batches SET file_bytes = $2 WHERE id = $1::bigint`, [
        revBatch.rows[0]!.id,
        kept,
      ]);
      const revOriginal = await revenue.downloadBatch(revBatch.rows[0]!.id, profileId);
      assert.equal(revOriginal.source, 'original');
      assert.equal(revOriginal.fileName, `Master-${tag}.xlsm`);
      assert.ok(revOriginal.buffer.equals(kept));

      const budBatch = await pool.query<{ id: string }>(
        `INSERT INTO revenue_import_batches (kind, file_name, file_sha256, row_count, total_amount, is_active, uploaded_by)
         VALUES ('budget', $1, 'y', 2, 300, false, $2) RETURNING id::text AS id`,
        [`Budget-${tag}.xlsx`, profileId],
      );
      batchIds.push(budBatch.rows[0]!.id);
      await pool.query(
        `INSERT INTO budget_lines (batch_id, section, line_item, period, amount, sort_order)
         VALUES ($1::bigint, 'revenue', 'REVENUE', '2026-01-01', 100, 1), ($1::bigint, 'revenue', 'REVENUE', '2026-02-01', 200, 1)`,
        [budBatch.rows[0]!.id],
      );
      const budRebuilt = await revenue.downloadBatch(budBatch.rows[0]!.id, profileId);
      assert.equal(budRebuilt.source, 'rebuilt');
      const budRows = await sheetRows(budRebuilt.buffer, 'Budget (from portal data)');
      assert.deepEqual(budRows[0], ['Section', 'Line item', '2026-01', '2026-02', 'Total']);
      assert.deepEqual(budRows[1], ['Revenue', 'REVENUE', 100, 200, 300]);

      for (const bad of ['abc', '999999999999']) {
        await assert.rejects(revenue.downloadBatch(bad, profileId), (error: unknown) => {
          assert.ok(error instanceof RevenueDashboardServiceError);
          assert.equal(error.code, 'not-found');
          return true;
        });
      }

      const audit = await pool.query(
        `SELECT action FROM audit_events WHERE actor_profile_id = $1::bigint AND action IN ('stock.downloaded', 'revenue_dashboard.downloaded')`,
        [profileId],
      );
      assert.equal(audit.rowCount, 6);
    } finally {
      if (uploadIds.length) {
        await pool.query(`DELETE FROM stock_uploads WHERE id = ANY($1::bigint[])`, [uploadIds]);
      }
      await pool.query(`DELETE FROM stock_items WHERE item_code LIKE $1`, [`MD-${tag}-%`]);
      if (batchIds.length) {
        await pool.query(`DELETE FROM revenue_import_batches WHERE id = ANY($1::bigint[])`, [
          batchIds,
        ]);
      }
      await pool.end();
    }
  },
);
