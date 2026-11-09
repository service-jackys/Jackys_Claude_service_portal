import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createServiceJobCardService } from '../../apps/api/src/job-cards/service.js';
import { createQuotationService } from '../../apps/api/src/quotations/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';
import {
  quotationsLpoPending,
  quotationsLpoPendingByMonth,
} from '../../packages/db/src/quotations.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'LPO pending counts Pending and Approved quotations whose ERP/ORION status is Pending invoice, by quotation date',
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
    const suffix = randomUUID().slice(0, 8);
    const quotations = createQuotationService(pool);
    const jobs = createServiceJobCardService(pool);
    const ids: string[] = [];
    const lpo = async (filter: { year?: string; month?: string }) => {
      const client = await pool.connect();
      try {
        return await quotationsLpoPending(client, filter);
      } finally {
        client.release();
      }
    };
    let profileId: string | undefined;
    try {
      profileId = (
        await pool.query<{ id: string }>(
          `INSERT INTO profiles (email, display_name) VALUES ($1, 'LPO pending') RETURNING id`,
          [`lpo-pending-${suffix}@example.test`],
        )
      ).rows[0].id;
      // Year 2031 keeps these rows apart from any real data.
      const make = async (date: string, status: string, erpStatus: string, price: number) => {
        const created = await quotations.create(
          {
            customerName: `LPO ${suffix}`,
            quotationDate: date,
            quotationStatus: status,
            erpStatus,
            products: [
              {
                unitKey: 'u1',
                partNo: '',
                description: 'Washer',
                brand: 'LG',
                serialNo: '',
                warranty: 'No',
                location: '',
                complaint: '',
                diagnosis: '',
              },
            ],
            parts: [
              {
                unitKey: 'u1',
                type: 'Part',
                partNo: '',
                description: 'Part',
                qty: 1,
                unitPrice: price,
              },
            ],
            vatRate: 0.05,
          },
          profileId as string,
          `lpo-${randomUUID()}`,
        );
        ids.push(created.id);
        return created;
      };
      // The ERP / ORION status is mandatory.
      await assert.rejects(
        () =>
          quotations.create({ customerName: 'No ERP' }, profileId as string, `lpo-no-${suffix}`),
        { name: 'ZodError' },
      );
      await make('2031-03-05', 'Pending', 'Pending invoice', 100);
      await make('2031-03-20', 'Approved', 'Pending invoice', 200);
      await make('2031-03-25', 'Rejected', 'Pending invoice', 400);
      await make('2031-04-02', 'Approved', 'Pending invoice', 800);
      // Already invoiced: sits inside that month's revenue, so it is not LPO pending.
      const invoicedLater = await make('2031-03-27', 'Approved', 'Invoiced', 3200);
      // Has a job card but is not invoiced yet: still LPO pending.
      const withJob = await make('2031-03-28', 'Approved', 'Pending invoice', 1600);
      await jobs.createFromQuotation(withJob.id, {}, profileId as string, `lpo-job-${suffix}`);

      const march = await lpo({ year: '2031', month: '3' });
      // Pending 100 + Approved 200 + Approved with a job card 1600. Rejected, Invoiced and April are left out; VAT is excluded.
      assert.deepEqual(
        [march.count, march.total, march.byStatus.Pending.total, march.byStatus.Approved.total],
        [3, 1900, 100, 1800],
      );
      const year = await lpo({ year: '2031' });
      assert.deepEqual([year.count, year.total], [4, 2700]);

      // Marking Invoiced stamps the invoiced date; setting it back clears it.
      const stamp = async () =>
        (
          await pool.query<{ d: string | null }>(
            `SELECT invoiced_at::text AS d FROM quotations WHERE id = $1`,
            [invoicedLater.id],
          )
        ).rows[0].d;
      assert.ok(await stamp(), 'invoiced_at is stamped when created as Invoiced');
      await pool.query(`UPDATE quotations SET erp_status = 'Pending invoice' WHERE id = $1`, [
        invoicedLater.id,
      ]);
      assert.equal(await stamp(), null);
      await pool.query(`UPDATE quotations SET erp_status = 'Invoiced' WHERE id = $1`, [
        invoicedLater.id,
      ]);
      assert.ok(await stamp());
      // Pretend it was invoiced on 10 April 2031: it was still pending at the end of March.
      await pool.query(`UPDATE quotations SET invoiced_at = '2031-04-10' WHERE id = $1`, [
        invoicedLater.id,
      ]);
      const marchAsOf = await lpo({ year: '2031', month: '3' });
      assert.deepEqual(
        [marchAsOf.count, marchAsOf.total, marchAsOf.raisedCount, marchAsOf.carriedCount],
        [4, 5100, 4, 0],
      );
      // April carries forward March's open quotations (100 + 200 + 1600) and adds April's own 800;
      // the one invoiced on 10 April is no longer pending.
      const april = await lpo({ year: '2031', month: '4' });
      assert.deepEqual(
        [
          april.count,
          april.total,
          april.raisedCount,
          april.raisedTotal,
          april.carriedCount,
          april.carriedTotal,
        ],
        [4, 2700, 1, 800, 3, 1900],
      );
      const byMonth = (
        await (async () => {
          const client = await pool.connect();
          try {
            return await quotationsLpoPendingByMonth(client);
          } finally {
            client.release();
          }
        })()
      ).filter((m) => m.period === '2031-03' || m.period === '2031-04');
      assert.deepEqual(
        byMonth.map((m) => [m.period, m.count, m.total, m.carriedCount]),
        [
          ['2031-03', 4, 5100, 0],
          ['2031-04', 4, 2700, 3],
        ],
      );
    } finally {
      if (ids.length) {
        await pool.query('DELETE FROM service_job_cards WHERE quotation_id = ANY($1)', [ids]);
        await pool.query('DELETE FROM quotations WHERE id = ANY($1)', [ids]);
      }
      if (profileId) await pool.query('DELETE FROM profiles WHERE id = $1', [profileId]);
      await pool.end();
    }
  },
);
