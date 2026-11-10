import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Pool } from 'pg';
import { runLookups } from '../../apps/api/src/ai/revenue-lookup.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';
import {
  createImportBatch,
  insertRevenueLines,
  type RevenueLineInput,
} from '../../packages/db/src/revenue-dashboard.js';

const databaseUrl = process.env.DATABASE_URL;

const line = (over: Partial<RevenueLineInput>): RevenueLineInput => ({
  sourceRow: 1,
  jobType: 'CSIJW',
  description: null,
  invDelNo: null,
  csoscOrderNo: null,
  orderDate: null,
  year: 2026,
  weekNo: 40,
  monthNo: 10,
  customer: 'Secret Customer LLC',
  lpoNo: null,
  csoscStatus: null,
  jobSheetStatus: 'Closed',
  salesPerson: 'Secret Person',
  qty: 1,
  unitPrice: 100,
  revenue: 100,
  originalJobValue: 100,
  billingCode: 'HAA',
  salesChannel: 'HAA',
  costStatus: 'COST',
  remarks: null,
  ...over,
});

test(
  'revenue lookups return exact figures for any date, read-only',
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
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'AI lookup') RETURNING id`,
        [`ai-lookup-${randomUUID()}@example.test`],
      );
      const rev = await createImportBatch(client as never, {
        kind: 'revenue',
        fileName: 'rev.xlsx',
        fileSha256: randomUUID(),
        rowCount: 4,
        totalAmount: 235,
        summary: {},
        uploadedBy: profile.rows[0].id,
      });
      await insertRevenueLines(client as never, rev.id, [
        line({
          sourceRow: 1,
          jobType: 'CSIDI',
          revenue: 50,
          orderDate: '2026-11-10',
          invDelNo: 'A',
        }),
        line({
          sourceRow: 2,
          jobType: 'CSIDI',
          revenue: 60,
          orderDate: '2026-11-10',
          invDelNo: 'A',
        }),
        line({
          sourceRow: 3,
          jobType: 'CSIDO',
          revenue: 25,
          orderDate: '2026-11-10',
          invDelNo: 'B',
        }),
        line({
          sourceRow: 4,
          jobType: 'CSIDI',
          revenue: 100,
          orderDate: '2026-11-11',
          invDelNo: 'C',
        }),
      ]);
      const [byType] = (await runLookups(client as never, rev.id, [
        { groupBy: ['jobType'], filters: { date: '2026-11-10' }, limit: 60 },
      ])) as Array<{ rows: Array<Record<string, unknown>> }>;
      assert.deepEqual(
        byType.rows.map((r) => [r.jobType, r.lines, r.invoices, r.revenue]),
        [
          ['CSIDI', 2, 1, 110],
          ['CSIDO', 1, 1, 25],
        ],
      );
      const [total, range] = (await runLookups(client as never, rev.id, [
        { groupBy: [], filters: { jobType: 'CSIDI' }, limit: 60 },
        { groupBy: ['date'], filters: {}, dateFrom: '2026-11-11', limit: 60 },
      ])) as Array<{ rows: Array<Record<string, unknown>> }>;
      assert.equal(total.rows[0].lines, 3);
      assert.equal(total.rows[0].revenue, 210);
      assert.equal(range.rows.length, 1);
      assert.equal(range.rows[0].date, '2026-11-11');
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await real.end();
    }
  },
);
