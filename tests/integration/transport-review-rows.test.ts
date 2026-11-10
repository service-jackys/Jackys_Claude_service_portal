import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { buildTransportReview } from '../../apps/api/src/revenue-dashboard/transport-review.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';
import { createImportBatch } from '../../packages/db/src/revenue-dashboard.js';
import { insertSheetRows, listSheetRows } from '../../packages/db/src/workbook-sheets.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'stored CSIDI sheet rows come back in sheet order and feed the transport review',
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
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'transport review') RETURNING id`,
        [`transport-review-${randomUUID()}@example.test`],
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
      const base = {
        Date: '2026-11-04',
        Salesman: 'A',
        'ERP City / Region': 'DUBAI',
        'Calc Qty': 1,
      };
      await insertSheetRows(client, batch.id, [
        {
          name: 'CSIDI',
          rows: [
            { ...base, 'Inv/Del No': 7003, 'Pricing Type': 'CSIDI', 'Proposed Revenue': 100 },
            { ...base, 'Inv/Del No': 7001, 'Pricing Type': 'CSIDI', 'Proposed Revenue': 100 },
            { ...base, 'Inv/Del No': 7002, 'Pricing Type': 'CSIDO', 'Proposed Revenue': 100 },
          ],
        },
        { name: 'CSIDO', rows: [{ Date: '2026-11-04' }] },
      ]);
      const rows = await listSheetRows(client, batch.id, 'CSIDI');
      assert.deepEqual(
        rows.map((r) => [r.rowNo, r.data['Inv/Del No']]),
        [
          [1, 7003],
          [2, 7001],
          [3, 7002],
        ],
      );
      const review = buildTransportReview(rows, {
        dubai: 60,
        sharjah: 90,
        csidoFee: 100,
        maxTrips: 2,
      });
      // delivery-only 100 first, then the lower invoice number of the two Dubai 60s
      assert.deepEqual(
        review.days[0].list.map((t) => [t.invoice, t.charged]),
        [
          ['7002', true],
          ['7001', true],
          ['7003', false],
        ],
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await real.end();
    }
  },
);
