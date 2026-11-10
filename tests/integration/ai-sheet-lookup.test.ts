import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { runSheetLookups, type SheetCatalogEntry } from '../../apps/api/src/ai/sheet-lookup.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';
import { createImportBatch } from '../../packages/db/src/revenue-dashboard.js';
import { insertSheetRows } from '../../packages/db/src/workbook-sheets.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'sheet lookups group, filter, sum and apply a date range on stored sheet rows',
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
    const real = createDbPool(databaseUrl);
    const client = await real.connect();
    try {
      await client.query('BEGIN');
      const profile = await client.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'sheet lookup') RETURNING id`,
        [`sheet-lookup-${randomUUID()}@example.test`],
      );
      const batch = await createImportBatch(client as never, {
        kind: 'revenue',
        fileName: 'm.xlsm',
        fileSha256: randomUUID(),
        rowCount: 0,
        totalAmount: 0,
        summary: {},
        uploadedBy: profile.rows[0].id,
      });
      await insertSheetRows(client, batch.id, [
        {
          name: 'Net Sale Current',
          rows: [
            { 'Inv Dt': '2026-10-12', Brand: 'VENUS', Qty: 2, 'Net Val': 120.5 },
            { 'Inv Dt': '2026-10-13', Brand: 'VENUS', Qty: 1, 'Net Val': 60 },
            { 'Inv Dt': '2026-10-13', Brand: 'OTHER', Qty: 4, 'Net Val': 10 },
          ],
        },
      ]);
      const catalog: SheetCatalogEntry[] = [
        {
          name: 'Net Sale Current',
          rows: 3,
          dateColumn: 'Inv Dt',
          columns: [
            { name: 'Inv Dt', type: 'date' },
            { name: 'Brand', type: 'text' },
            { name: 'Qty', type: 'number' },
            { name: 'Net Val', type: 'number' },
          ],
        },
      ];
      const [byBrand, ranged, total] = (await runSheetLookups(client, batch.id, catalog, [
        {
          sheet: 'Net Sale Current',
          groupBy: ['Brand'],
          filters: {},
          sum: ['Qty', 'Net Val'],
          limit: 60,
        },
        {
          sheet: 'Net Sale Current',
          groupBy: ['Inv Dt'],
          filters: { Brand: 'venus' },
          sum: ['Qty'],
          dateFrom: '2026-10-13',
          limit: 60,
        },
        { sheet: 'Net Sale Current', groupBy: [], filters: {}, sum: ['Net Val'], limit: 60 },
      ])) as Array<{ columns: string[]; rows: unknown[][] }>;
      assert.deepEqual(byBrand.columns, ['Brand', 'rows', 'Qty', 'Net Val']);
      assert.deepEqual(byBrand.rows, [
        ['OTHER', 1, 4, 10],
        ['VENUS', 2, 3, 180.5],
      ]);
      assert.deepEqual(ranged.rows, [['2026-10-13', 1, 1]]);
      assert.deepEqual(total.rows, [[3, 190.5]]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await real.end();
    }
  },
);
