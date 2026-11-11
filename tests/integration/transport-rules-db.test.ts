import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  computeTransport,
  lineAdjustments,
} from '../../apps/api/src/revenue-dashboard/transport-rules.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';
import { createImportBatch } from '../../packages/db/src/revenue-dashboard.js';
import {
  applyTransportRevenue,
  getTransportRules,
  listTransportLines,
  saveTransportRules,
  transportTotals,
} from '../../packages/db/src/revenue-transport-rules.js';
import { insertSheetRows, listSheetRows } from '../../packages/db/src/workbook-sheets.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'transport rules are stored, applied to revenue lines and fully reversible',
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
      const p = await client.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'rules') RETURNING id`,
        [`rules-${randomUUID()}@example.test`],
      );
      const batch = await createImportBatch(client as never, {
        kind: 'revenue',
        fileName: 'm.xlsm',
        fileSha256: randomUUID(),
        rowCount: 3,
        totalAmount: 0,
        summary: {},
        uploadedBy: p.rows[0].id,
      });
      for (const [i, inv] of ['5001', '5002', '5003'].entries())
        await client.query(
          `INSERT INTO revenue_lines (batch_id, source_row, job_type, inv_del_no, order_date, year, month_no, revenue) VALUES ($1, $2, 'CSIDI', $3, '2026-11-04', 2026, 11, 174)`,
          [batch.id, i + 1, inv],
        );
      const base = {
        Date: '2026-11-04',
        Salesman: 'A',
        'Pricing Type': 'CSIDI',
        'Calc Qty': 2,
        'Transport Charge': 60,
        'Proposed Revenue': 174,
      };
      await insertSheetRows(client, batch.id, [
        {
          name: 'CSIDI',
          rows: ['5001', '5002', '5003'].map((x) => ({ ...base, 'Inv/Del No': Number(x) })),
        },
      ]);
      const apply = async () => {
        const rules = await getTransportRules(client);
        const calc = computeTransport(await listSheetRows(client, batch.id, 'CSIDI'), rules);
        await applyTransportRevenue(
          client,
          batch.id,
          lineAdjustments(calc, await listTransportLines(client, batch.id)).updates,
        );
      };
      const total = async () =>
        (await transportTotals(client, batch.id)).reduce((s, x) => s + x.current, 0);
      await saveTransportRules(
        client,
        { dailyCap: true, deliveryOnlyCap: false, mixedInvoiceTransport: true, maxTrips: 2 },
        p.rows[0].id,
      );
      await apply();
      assert.equal(await total(), 174 * 3 - 60); // third trip not charged
      const stored = await getTransportRules(client);
      assert.equal(stored.appliedBatchId, String(batch.id));
      assert.equal(stored.updatedByName, 'rules');
      await saveTransportRules(
        client,
        { dailyCap: false, deliveryOnlyCap: false, mixedInvoiceTransport: true, maxTrips: 2 },
        p.rows[0].id,
      );
      await apply();
      assert.equal(await total(), 174 * 3); // back to the workbook figures
      const wb = (await transportTotals(client, batch.id)).reduce((s, x) => s + x.workbook, 0);
      assert.equal(wb, 174 * 3); // the workbook revenue is never changed
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await real.end();
    }
  },
);
