import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createQuotationService } from '../../apps/api/src/quotations/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';
import { listQuotations, quotationsInvoiceCheck } from '../../packages/db/src/quotations.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'An Invoiced quotation needs its ERP invoice number, the list total follows the ERP filter, and the invoice check matches the master workbook',
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
    const ids: string[] = [];
    let batchId: string | undefined;
    let profileId: string | undefined;
    const withClient = async <T>(run: (c: import('pg').PoolClient) => Promise<T>) => {
      const client = await pool.connect();
      try {
        return await run(client);
      } finally {
        client.release();
      }
    };
    try {
      profileId = (
        await pool.query<{ id: string }>(
          `INSERT INTO profiles (email, display_name) VALUES ($1, 'Invoice check') RETURNING id`,
          [`invoice-check-${suffix}@example.test`],
        )
      ).rows[0].id;
      const make = async (
        erpStatus: string,
        price: number,
        erpInvoiceNo?: string,
        name = `INV ${suffix}`,
      ) => {
        const created = await quotations.create(
          {
            customerName: name,
            quotationDate: '2031-05-05',
            erpStatus,
            erpInvoiceNo,
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
          `inv-${randomUUID()}`,
        );
        ids.push(created.id);
        return created;
      };

      // The invoice number is required when the status is Invoiced, and cleared otherwise.
      await assert.rejects(() => make('Invoiced', 100), { name: 'ZodError' });
      const pending = await make('Pending invoice', 100, 'IGNORED-1');
      assert.equal(pending.erpInvoiceNo, '');
      const found = await make('Invoiced', 200, `INV-${suffix}-A`);
      const amountOff = await make('Invoiced', 300, `INV-${suffix}-B`);
      const missing = await make('Invoiced', 400, `INV-${suffix}-C`);
      const waiting = await make('Invoiced', 800, `INV-${suffix}-D`);
      assert.equal(found.erpInvoiceNo, `INV-${suffix}-A`);

      // A quotation already Invoiced before the invoice number existed can still be edited.
      const legacy = await make('Invoiced', 1600, `INV-${suffix}-L`);
      await pool.query(`UPDATE quotations SET erp_invoice_no = '' WHERE id = $1`, [legacy.id]);
      const edited = await quotations.update(
        legacy.id,
        { customerName: `INV ${suffix} legacy edit` },
        profileId as string,
        `inv-upd-${randomUUID()}`,
      );
      assert.equal(edited?.erpInvoiceNo, '');

      // List totals cover every match and follow the ERP / ORION choice (subtotal 200 + 5% VAT).
      const totalFor = (erpStatus?: string) =>
        withClient((c) =>
          listQuotations(c, { search: `INV ${suffix}`, erpStatus, page: 1, pageSize: 1 }),
        );
      const all = await totalFor();
      assert.deepEqual([all.total, all.totalAmount], [6, 3570]);
      const onlyPending = await totalFor('Pending invoice');
      assert.deepEqual([onlyPending.total, onlyPending.totalAmount], [1, 105]);
      const onlyInvoiced = await totalFor('Invoiced');
      assert.deepEqual([onlyInvoiced.total, onlyInvoiced.totalAmount], [5, 3465]);

      // Master workbook: A matches, B matches with a different amount, C and D are absent.
      batchId = (
        await pool.query<{ id: string }>(
          `INSERT INTO revenue_import_batches (kind, file_name, file_sha256, uploaded_at)
           VALUES ('revenue', 'invoice-check-test.xlsm', $1, now() + interval '1 day') RETURNING id::text AS id`,
          [suffix],
        )
      ).rows[0].id;
      await pool.query(
        `INSERT INTO revenue_lines (batch_id, job_type, inv_del_no, revenue) VALUES
           ($1, 'CSIJO', $2, 200), ($1, 'CSIJO', $3, 250)`,
        [batchId, ` inv-${suffix}-a `, `INV-${suffix}-B`],
      );
      // C was marked Invoiced 10 days ago, D today.
      await pool.query(
        `UPDATE quotations SET invoiced_at = (now() AT TIME ZONE 'Asia/Dubai')::date - 10 WHERE id = $1`,
        [missing.id],
      );
      const check = await withClient((c) => quotationsInvoiceCheck(c, { graceDays: 7 }));
      const mine = check.rows.filter((r) => ids.includes(r.id));
      const byNo = Object.fromEntries(mine.map((r) => [r.invoiceNo, r]));
      assert.equal(byNo[`INV-${suffix}-A`], undefined, 'a matching amount is not listed');
      assert.equal(byNo[`INV-${suffix}-B`].amountMismatch, true);
      assert.equal(byNo[`INV-${suffix}-B`].difference, -50);
      assert.equal(byNo[`INV-${suffix}-C`].state, 'missing');
      assert.equal(byNo[`INV-${suffix}-D`].state, 'waiting');
      assert.ok(check.legacyCount >= 1);
      assert.ok(check.hasBatch);
    } finally {
      if (batchId) await pool.query('DELETE FROM revenue_import_batches WHERE id = $1', [batchId]);
      if (ids.length) await pool.query('DELETE FROM quotations WHERE id = ANY($1)', [ids]);
      if (profileId) await pool.query('DELETE FROM profiles WHERE id = $1', [profileId]);
      await pool.end();
    }
  },
);
