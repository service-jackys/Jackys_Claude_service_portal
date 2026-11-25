import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';
import {
  createImportBatch,
  insertRevenueLines,
  invoiceFamilyOf,
  revenueInvoiceList,
  type RevenueLineInput,
} from '../../packages/db/src/revenue-dashboard.js';

const databaseUrl = process.env.DATABASE_URL;

const line = (over: Partial<RevenueLineInput>): RevenueLineInput => ({
  sourceRow: 1,
  jobType: 'CSIDI',
  description: null,
  invDelNo: '16101035',
  csoscOrderNo: null,
  orderDate: null,
  year: 2026,
  weekNo: 28,
  monthNo: 7,
  customer: 'Customer',
  lpoNo: null,
  csoscStatus: null,
  jobSheetStatus: null,
  salesPerson: 'P',
  qty: 1,
  unitPrice: 100,
  revenue: 100,
  originalJobValue: 100,
  billingCode: null,
  salesChannel: null,
  costStatus: null,
  remarks: null,
  ...over,
});

test('job family: repair and delivery series are separate documents', () => {
  assert.equal(invoiceFamilyOf('CSIJO'), 'repair');
  assert.equal(invoiceFamilyOf('CSIJW'), 'repair');
  for (const t of ['CSIDI', 'CSIDO', 'CSIII']) assert.equal(invoiceFamilyOf(t), 'delivery');
});

test(
  'the invoice picker lists one row per number and job family',
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
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'Family') RETURNING id`,
        [`family-${randomUUID()}@example.test`],
      );
      const rev = await createImportBatch(client as never, {
        kind: 'revenue',
        fileName: 'rev.xlsx',
        fileSha256: randomUUID(),
        rowCount: 4,
        totalAmount: 330,
        summary: {},
        uploadedBy: profile.rows[0].id,
      });
      await insertRevenueLines(client as never, rev.id, [
        line({ sourceRow: 1, customer: 'KADEEJA TRADING', orderDate: '2026-07-06', revenue: 100 }),
        line({
          sourceRow: 2,
          jobType: 'CSIDO',
          customer: 'KADEEJA TRADING',
          orderDate: '2026-07-06',
          revenue: 20,
        }),
        line({
          sourceRow: 3,
          jobType: 'CSIJO',
          customer: 'OUR OWN HIGH SCHOOL',
          orderDate: '2026-11-24',
          revenue: 60,
        }),
        line({
          sourceRow: 4,
          jobType: 'CSIJW',
          customer: 'OUR OWN HIGH SCHOOL',
          orderDate: '2026-11-24',
          revenue: 150,
        }),
      ]);
      const rows = await revenueInvoiceList(client as never, rev.id, {} as never, 50);
      assert.deepEqual(
        rows.map((r) => [r.key, r.customer, r.jobTypes.join('/'), r.revenue]),
        [
          ['16101035::repair', 'OUR OWN HIGH SCHOOL', 'CSIJO/CSIJW', 210],
          ['16101035::delivery', 'KADEEJA TRADING', 'CSIDI/CSIDO', 120],
        ],
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await real.end();
    }
  },
);
