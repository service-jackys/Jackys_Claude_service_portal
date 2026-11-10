import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Pool } from 'pg';
import { buildWorkbookSnapshot } from '../../apps/api/src/ai/workbook.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';
import {
  createImportBatch,
  insertBudgetLines,
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
  'the AI workbook snapshot summarises the uploaded data, by permission, without customers',
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
    // Everything happens in one transaction that is rolled back, so the real
    // uploaded workbooks are never touched.
    const client = await real.connect();
    const pool = { connect: async () => ({ query: client.query.bind(client), release() {} }) };
    try {
      await client.query('BEGIN');
      const profile = await client.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'AI workbook') RETURNING id`,
        [`ai-workbook-${randomUUID()}@example.test`],
      );
      const uploadedBy = profile.rows[0].id;
      const rev = await createImportBatch(client as never, {
        kind: 'revenue',
        fileName: 'rev.xlsx',
        fileSha256: randomUUID(),
        rowCount: 6,
        totalAmount: 735,
        summary: {},
        uploadedBy,
      });
      await insertRevenueLines(client as never, rev.id, [
        line({
          sourceRow: 1,
          revenue: 100,
          monthNo: 10,
          orderDate: '2026-10-20',
          invDelNo: 'INV-A',
        }),
        line({
          sourceRow: 4,
          revenue: 50,
          monthNo: 11,
          jobType: 'CSIDI',
          orderDate: '2026-11-10',
          invDelNo: 'INV-B',
        }),
        line({
          sourceRow: 5,
          revenue: 60,
          monthNo: 11,
          jobType: 'CSIDI',
          orderDate: '2026-11-10',
          invDelNo: 'INV-B',
        }),
        line({
          sourceRow: 6,
          revenue: 25,
          monthNo: 11,
          jobType: 'CSIDO',
          orderDate: '2026-11-10',
          invDelNo: 'INV-B',
        }),
        line({ sourceRow: 2, revenue: 200, monthNo: 10, jobType: 'CSIII' }),
        line({ sourceRow: 3, revenue: 300, monthNo: 11 }),
      ]);
      const bud = await createImportBatch(client as never, {
        kind: 'budget',
        fileName: 'bud.xlsx',
        fileSha256: randomUUID(),
        rowCount: 2,
        totalAmount: 1500,
        summary: {},
        uploadedBy,
      });
      await insertBudgetLines(client as never, bud.id, [
        {
          section: 'revenue',
          lineItem: 'Projects',
          period: '2026-10-01',
          amount: 500,
          sortOrder: 1,
        },
        {
          section: 'revenue',
          lineItem: 'Projects',
          period: '2026-11-01',
          amount: 1000,
          sortOrder: 1,
        },
      ]);

      const both = (await buildWorkbookSnapshot(pool as unknown as Pool, {
        revenue: true,
        budget: true,
      })) as any;
      assert.equal(both.revenueWorkbook.uploaded, true);
      const day = both.revenueWorkbook.dailyByJobType.rows.filter(
        (r: any) => r.date === '2026-11-10',
      );
      assert.deepEqual(
        day.map((r: any) => [r.jobType, r.lines, r.invoices, r.revenue]),
        [
          ['CSIDI', 2, 1, 110],
          ['CSIDO', 1, 1, 25],
        ],
      );
      const periods = both.revenueWorkbook.groupedBy.period.map((r: any) => [
        r.key,
        Number(r.revenue),
      ]);
      assert.deepEqual(periods, [
        ['2026-10', 300],
        ['2026-11', 435],
      ]);
      assert.ok(both.revenueWorkbook.groupedBy.jobType.some((r: any) => r.key === 'CSIII'));
      assert.equal(both.budgetWorkbook.budgetLines[0].total, 1500);
      assert.equal(both.budgetWorkbook.actualRevenueByPeriod.length, 2);
      assert.ok(!JSON.stringify(both).includes('Secret'), 'no customers or sales people');
      assert.equal(both.revenueWorkbook.groupedBy.customer, undefined);

      // Only what the person's permissions allow.
      const revOnly = (await buildWorkbookSnapshot(pool as unknown as Pool, {
        revenue: true,
        budget: false,
      })) as any;
      assert.ok(revOnly.revenueWorkbook && !revOnly.budgetWorkbook);
      const none = await buildWorkbookSnapshot(pool as unknown as Pool, {
        revenue: false,
        budget: false,
      });
      assert.deepEqual(none, {});
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      await real.end();
    }
  },
);
