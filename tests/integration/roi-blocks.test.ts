import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createRoiService, RoiServiceError } from '../../apps/api/src/roi-tasks/service.js';
import type { ApplicationAuth } from '../../apps/api/src/auth/application-auth.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { isoWeekRange } from '../../packages/db/src/roi-blocks.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

const auth = (permissions: string[]): ApplicationAuth => ({
  provider: 'local',
  subject: '1',
  email: 'roi-blocks@example.test',
  displayName: 'ROI Blocks',
  profileId: null as unknown as string,
  roles: ['user'],
  permissions,
});

test('isoWeekRange gives Monday to Sunday', () => {
  assert.deepEqual(isoWeekRange(2026, 45), { start: '2026-11-02', end: '2026-11-08' });
  assert.deepEqual(isoWeekRange(2026, 10), { start: '2026-03-02', end: '2026-03-08' });
  assert.deepEqual(isoWeekRange(2026, 1), { start: '2025-12-29', end: '2026-01-04' });
});

// modification.md #298: role-specific ROI data blocks, counts and quantities only.
test(
  'ROI blocks: only the permitted blocks are returned, with counts and no revenue',
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
    const pool = createDbPool(databaseUrl!);
    const service = createRoiService(pool);
    const tag = randomUUID().slice(0, 8);
    const aptRef = `APT-2026-${String(10000 + Math.floor(Math.random() * 89999))}`;
    let batchId = '';
    try {
      const batch = await pool.query<{ id: string }>(
        `INSERT INTO revenue_import_batches (kind, file_name, file_sha256, row_count, total_amount)
         VALUES ('revenue', $1, $2, 3, 999) RETURNING id`,
        [`roi-blocks-${tag}.xlsm`, tag],
      );
      batchId = batch.rows[0].id;
      // Week 10 of 2026: two delivery lines in different channels and one warranty repair.
      for (const [type, channel, code, qty, revenue] of [
        ['CSIDI', 'INS', 'SERV-DEL&INST-JERC', 4, 400],
        ['CSIDO', 'HAA', 'SERV-DELIVERY-HAA', 3, 150],
        ['CSIJW', 'INS', 'SERV-REPAIR-WAR', 2, 0],
      ] as const) {
        await pool.query(
          `INSERT INTO revenue_lines (batch_id, job_type, year, week_no, month_no, qty, revenue, billing_code, sales_channel)
           VALUES ($1, $2, 2026, 10, 3, $3, $4, $5, $6)`,
          [batchId, type, qty, revenue, code, channel],
        );
      }
      await pool.query(
        `INSERT INTO appointments (appointment_reference, customer_type, customer_name, contact_number, fault_description, appointment_date, status, created_at, job_warranty)
         VALUES ($1, 'B2C', 'Blocks Test', '0500000000', 'test', '2026-03-04', 'Scheduled', '2026-03-03 10:00+04', 'Out Warranty')`,
        [aptRef],
      );

      // Permission gating
      const plain = await service.blocks(auth(['tasks.use']), {
        weekYear: '2026',
        weekNumber: '10',
      });
      assert.equal(plain.length, 0);
      const care = await service.blocks(auth(['tasks.use', 'tasks.roi_customer_care']), {
        weekYear: '2026',
        weekNumber: '10',
      });
      assert.deepEqual(
        care.map((b) => b.key),
        ['customer_care'],
      );
      const field = await service.blocks(auth(['tasks.use', 'tasks.roi_field_ops']), {
        weekYear: '2026',
        weekNumber: '10',
      });
      assert.deepEqual(
        field.map((b) => b.key),
        ['field_ops'],
      );
      const admin = await service.blocks(auth(['*']), { weekYear: '2026', weekNumber: '10' });
      assert.deepEqual(
        admin.map((b) => b.key),
        ['customer_care', 'field_ops'],
      );
      await assert.rejects(
        service.blocks(auth(['*']), { weekYear: '2026', weekNumber: '99' }),
        (error) => error instanceof RoiServiceError && error.code === 'invalid',
      );

      // Quantities come from the workbook for that week
      const tables = care[0].tables;
      const byCode = tables.find((t) => t.title === 'By billing code')!;
      assert.deepEqual(byCode.head, ['Billing code', 'CSIDI', 'CSIJO', 'CSIJW', 'Total']);
      const jerc = byCode.rows.find((r) => r[0] === 'SERV-DEL&INST-JERC')!;
      assert.deepEqual(jerc, ['SERV-DEL&INST-JERC', '4', '', '', '4']);
      const total = byCode.rows[byCode.rows.length - 1];
      assert.equal(total[0], 'Total');
      assert.equal(total[4], '6'); // CSIDI 4 + CSIJW 2 (CSIDO is not a column of this table)
      const delivery = tables.find((t) => t.title.startsWith('Delivery and installation'))!;
      assert.deepEqual(
        delivery.rows.find((r) => r[0] === 'HAA'),
        ['HAA', '', '3', '', '3'],
      );
      const channels = tables.find((t) => t.title.startsWith('Channel detail'))!;
      assert.deepEqual(channels.rows[channels.rows.length - 1], ['Total', 3, '9']);
      const dashboard = tables.find((t) => t.title === 'Service dashboard')!;
      assert.equal(dashboard.rows[0][0], 'This week');
      assert.equal(dashboard.rows[0][1], 1); // the appointment created that week

      // A week with no workbook rows says so instead of showing zeros
      const quiet = await service.blocks(auth(['tasks.roi_customer_care']), {
        weekYear: '2026',
        weekNumber: '11',
      });
      assert.match(quiet[0].tables[0].empty ?? '', /No workbook rows for week 11/);

      // No revenue amount is ever included
      const text = JSON.stringify(admin);
      assert.ok(
        !/revenue/i.test(text.replace(/Service Revenue Dashboard/g, '')),
        'no revenue in blocks',
      );
      assert.ok(!text.includes('400') && !text.includes('150'), 'AED figures are not exposed');

      // Field operations pending table
      const pending = field[0].tables.find((t) => t.title === 'Pending, as at today')!;
      assert.ok(
        pending.rows.some((r) => String(r[0]).includes('out of warranty') && Number(r[1]) >= 1),
      );
    } finally {
      await pool.query(`DELETE FROM appointments WHERE appointment_reference = $1`, [aptRef]);
      if (batchId) await pool.query(`DELETE FROM revenue_import_batches WHERE id = $1`, [batchId]);
      await pool.end();
    }
  },
);
