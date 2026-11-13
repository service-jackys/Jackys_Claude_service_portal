import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';
import {
  createImportBatch,
  insertRevenueLines,
  revenueGroup,
  revenueLines,
  revenueMatrix,
  revenueSummary,
  type RevenueLineInput,
} from '../../packages/db/src/revenue-dashboard.js';

const databaseUrl = process.env.DATABASE_URL;

const line = (over: Partial<RevenueLineInput>): RevenueLineInput => ({
  sourceRow: 1,
  jobType: 'CSIJO',
  description: null,
  invDelNo: null,
  csoscOrderNo: null,
  orderDate: '2026-11-10',
  year: 2026,
  weekNo: 46,
  monthNo: 11,
  customer: 'Customer',
  lpoNo: null,
  csoscStatus: null,
  jobSheetStatus: 'Closed',
  salesPerson: 'Person',
  qty: 1,
  unitPrice: 119,
  revenue: 119,
  originalJobValue: 0,
  billingCode: 'HAA',
  salesChannel: 'HAA',
  costStatus: 'COST',
  remarks: null,
  ...over,
});

test(
  'CSIJO basis splits original invoice from channel-billed without changing any total',
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
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'CSIJO basis') RETURNING id`,
        [`csijo-basis-${randomUUID()}@example.test`],
      );
      const batch = await createImportBatch(client as never, {
        kind: 'revenue',
        fileName: 'rev.xlsx',
        fileSha256: randomUUID(),
        rowCount: 6,
        totalAmount: 0,
        summary: {},
        uploadedBy: profile.rows[0].id,
      });
      await insertRevenueLines(client as never, batch.id, [
        // Original invoice: ERP value, revenue is that flat value, not qty x rate.
        line({
          sourceRow: 1,
          qty: 2,
          unitPrice: 119,
          revenue: 787.5,
          originalJobValue: 787.5,
          salesChannel: '3PTY',
          invDelNo: 'O1',
        }),
        // Channel-billed: zero in ERP, rate x qty.
        line({ sourceRow: 2, qty: 3, unitPrice: 119, revenue: 357, invDelNo: 'C1' }),
        // Channel-billed: zero in ERP, flat BER/RWR charge.
        line({ sourceRow: 3, qty: 4, unitPrice: 60, revenue: 60, invDelNo: 'C2' }),
        // ERP value present but revenue equals rate x qty: not an "actual value" line.
        line({
          sourceRow: 4,
          qty: 1,
          unitPrice: 119,
          revenue: 119,
          originalJobValue: 119,
          invDelNo: 'C3',
        }),
        // Other job types never carry a basis.
        line({
          sourceRow: 5,
          jobType: 'CSIJW',
          qty: 1,
          unitPrice: 100,
          revenue: 100,
          originalJobValue: 100,
          invDelNo: 'W1',
        }),
        line({
          sourceRow: 6,
          jobType: 'CSIDI',
          qty: 1,
          unitPrice: 80,
          revenue: 80,
          invDelNo: 'D1',
        }),
      ]);
      const id = batch.id;
      const byBasis = await revenueGroup(client as never, id, {}, 'csijoBasis');
      const get = (k: string) => byBasis.rows.find((r) => r.key === k);
      assert.equal(get('Original invoice')?.revenue, 787.5);
      assert.equal(get('Original invoice')?.jobs, 1);
      assert.equal(get('Channel-billed')?.revenue, 357 + 60 + 119);
      assert.equal(get('Channel-billed')?.jobs, 3);
      assert.equal(byBasis.rows.length, 2, 'non-CSIJO lines carry no basis');

      // Nothing changes: the split adds up to CSIJO, and the grand total is untouched.
      const csijo = await revenueGroup(client as never, id, { jobType: 'CSIJO' }, 'jobType');
      assert.equal(
        byBasis.rows.reduce((a, r) => a + r.revenue, 0),
        csijo.rows[0].revenue,
      );
      const all = await revenueSummary(client as never, id, {});
      assert.equal(all.totals.revenue, 787.5 + 357 + 60 + 119 + 100 + 80);
      assert.deepEqual(all.options.csijoBases, ['Channel-billed', 'Original invoice']);

      // Filter keeps only one kind, and the total follows.
      const onlyOriginal = await revenueSummary(client as never, id, {
        csijoBasis: 'Original invoice',
      });
      assert.equal(onlyOriginal.totals.revenue, 787.5);
      assert.equal(onlyOriginal.totals.jobs, 1);

      // Matrix by month and the job list expose the basis.
      const matrix = await revenueMatrix(client as never, id, {}, 'period', 'csijoBasis');
      assert.equal(matrix.cells.length, 2);
      const lines = await revenueLines(
        client as never,
        id,
        { csijoBasis: 'Channel-billed' },
        1,
        50,
      );
      assert.equal(lines.items.length, 3);
      assert.ok(
        lines.items.every((l: { csijoBasis: string }) => l.csijoBasis === 'Channel-billed'),
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await real.end();
    }
  },
);
