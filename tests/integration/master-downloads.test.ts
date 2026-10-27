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

async function stockFile(
  tag: string,
  descOfSecond = 'Washer 8kg',
  extra: unknown[][] = [],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Item Listing with Barcode');
  sheet.addRow(['Item Code', 'Item Desc', 'Maingrp Name', 'Grp Name', 'SUBGRPNAME', 'BRANDNAME']);
  sheet.addRow([`MD-${tag}-1`, 'Fridge 300L', 'MDA', 'REFRIGERATORS', 'TOP MOUNT', 'TESTBRAND']);
  sheet.addRow([`MD-${tag}-1`, 'Fridge 300L', 'MDA', 'REFRIGERATORS', 'TOP MOUNT', 'TESTBRAND']);
  sheet.addRow([`MD-${tag}-2`, descOfSecond, 'MDA', 'WASHERS', 'FRONT LOAD', 'TESTBRAND']);
  for (const row of extra) sheet.addRow(row);
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

      // --- stock master: first upload adds the items ----------------------------
      const bytes = await stockFile(tag);
      const first = await stock.upload(
        { originalname: `items-${tag}.xlsx`, size: bytes.length, buffer: bytes },
        profileId,
      );
      uploadIds.push(first.id);
      assert.equal(first.rowCount, 3);
      assert.equal(first.itemCount, 2);
      assert.equal(first.newItems, 2);
      assert.equal(first.changedItems, 0);
      const stored = await pool.query(`SELECT * FROM stock_master WHERE item_code LIKE $1`, [
        `MD-${tag}-%`,
      ]);
      assert.equal(stored.rowCount, 2);
      const status = await stock.status();
      assert.equal(status.lastUpload?.id, first.id);
      assert.equal(status.lastUpload?.hasFile, true);

      // the file comes back exactly as uploaded
      const original = await stock.download(profileId);
      assert.equal(original.source, 'original');
      assert.equal(original.fileName, `items-${tag}.xlsx`);
      assert.ok(original.buffer.equals(bytes), 'downloaded bytes equal the uploaded bytes');

      // --- a second upload updates what changed, adds new items, keeps the rest --
      const lower = `md-${tag}-1`; // same code, different case: updates the stored one
      const bytes2 = await stockFile(tag, 'Washer 9kg', [
        [lower, 'Fridge 300L inverter', 'MDA', 'REFRIGERATORS', 'TOP MOUNT', 'TESTBRAND'],
        [`MD-${tag}-3`, 'Cable', 'ACCESSORIES IT & SMARTPHONE', 'CABLES', 'USB CABLES', null],
      ]);
      const second = await stock.upload(
        { originalname: `items2-${tag}.xlsx`, size: bytes2.length, buffer: bytes2 },
        profileId,
      );
      uploadIds.push(second.id);
      assert.equal(second.newItems, 1);
      assert.equal(second.changedItems, 1);
      assert.deepEqual(second.report.changes, [
        {
          itemCode: `MD-${tag}-2`,
          fields: [{ field: 'Item Desc', from: 'Washer 8kg', to: 'Washer 9kg' }],
        },
      ]);
      assert.match(String(second.report.warnings[0]), /upper \/ lower case/);
      const all = await pool.query(
        `SELECT item_code FROM stock_master WHERE upper(item_code) LIKE $1`,
        [`MD-${tag}-%`],
      );
      assert.equal(all.rowCount, 3, 'no duplicate for the other-case code');

      // items missing from the newest file are kept and counted
      const bytes3 = await stockFile(tag, 'Washer 9kg');
      const third = await stock.upload(
        { originalname: `items3-${tag}.xlsx`, size: bytes3.length, buffer: bytes3 },
        profileId,
      );
      uploadIds.push(third.id);
      assert.equal(third.newItems, 0);
      const afterThird = await stock.status();
      assert.ok(afterThird.notInFileCount >= 1);
      const gone = await pool.query<{ seen: boolean }>(
        `SELECT last_seen_at >= (SELECT max(uploaded_at) FROM stock_uploads) AS seen FROM stock_master WHERE item_code = $1`,
        [`MD-${tag}-3`],
      );
      assert.equal(gone.rows[0]!.seen, false);

      // only the newest upload keeps its file
      const held = await pool.query<{ id: string; kept: boolean }>(
        `SELECT id::text AS id, file_bytes IS NOT NULL AS kept FROM stock_uploads WHERE id = ANY($1::bigint[]) ORDER BY id`,
        [uploadIds],
      );
      assert.deepEqual(
        held.rows.map((row) => row.kept),
        [false, false, true],
      );

      // search and facets read the one table
      const hits = await stock.search({ q: `MD-${tag}-3`, limit: '5' });
      assert.deepEqual(
        hits.items.map((item) => item.itemCode),
        [`MD-${tag}-3`],
      );
      assert.deepEqual(hits.items[0], {
        itemCode: `MD-${tag}-3`,
        itemDesc: 'Cable',
        mainGroup: 'ACCESSORIES IT & SMARTPHONE',
        groupName: 'CABLES',
        subGroup: 'USB CABLES',
        brand: null,
      });
      const facets = await stock.facets();
      assert.ok(facets.brands.some((entry) => entry.brand === 'TESTBRAND'));

      // --- an upload with no stored file is rebuilt from the stock master ------
      await pool.query(`UPDATE stock_uploads SET file_bytes = NULL WHERE id = $1::bigint`, [
        third.id,
      ]);
      const rebuilt = await stock.download(profileId);
      assert.equal(rebuilt.source, 'rebuilt');
      assert.match(rebuilt.fileName, /^Stock_master_\d{4}-\d{2}-\d{2}\.xlsx$/);
      const reparsed = await parseStockWorkbook(rebuilt.buffer);
      const washer = reparsed.items.get(`MD-${tag}-2`)!;
      assert.equal(washer.itemDesc, 'Washer 9kg');
      assert.equal(washer.brand, 'TESTBRAND');
      assert.equal(reparsed.items.get(`MD-${tag}-3`)?.mainGroup, 'ACCESSORIES IT & SMARTPHONE');

      // a file that is not an Item Listing is refused
      await assert.rejects(
        stock.upload({ originalname: 'x.csv', size: 1, buffer: Buffer.from('x') }, profileId),
        /Upload the ERP Item Listing as .xlsx/,
      );

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
      assert.equal(audit.rowCount, 5);
    } finally {
      if (uploadIds.length) {
        await pool.query(`DELETE FROM stock_uploads WHERE id = ANY($1::bigint[])`, [uploadIds]);
      }
      await pool.query(`DELETE FROM stock_master WHERE item_code LIKE $1`, [`MD-${tag}-%`]);
      if (batchIds.length) {
        await pool.query(`DELETE FROM revenue_import_batches WHERE id = ANY($1::bigint[])`, [
          batchIds,
        ]);
      }
      await pool.end();
    }
  },
);
