import assert from 'node:assert/strict';
import test from 'node:test';
import { createDbPool } from '../../packages/db/src/client.js';
import { enrichQuotations } from '../../packages/db/src/legacy-import/enrich-quotations.js';
import { type Plan, SOURCE_NAME } from '../../packages/db/src/legacy-import/plan.js';
import { migrate } from '../../packages/db/src/migrate.js';
import { allocateQuotationReference } from '../../packages/db/src/references.js';

const databaseUrl = process.env.DATABASE_URL;

const unit = (key: string) => ({
  unitKey: key,
  partNo: '',
  description: 'Washing machine',
  brand: 'LG',
  serialNo: '',
  warranty: 'No',
  location: `Villa ${key}`,
  complaint: 'Drum noise',
  diagnosis: '',
  qty: 1,
  unitPrice: 0,
});
const charge = (unitKey: string, type: 'Part' | 'Labour', qty: number, unitPrice: number) => ({
  unitKey,
  type,
  partNo: '',
  description: type,
  qty,
  unitPrice,
});

function planned(legacyRef: string, grandTotal = 304.5) {
  return {
    legacyRef,
    row: 2,
    createdAt: new Date('2099-01-05T09:00:00Z'),
    quotationDate: '2099-01-05',
    products: [unit('u1')],
    parts: [charge('u1', 'Part', 2, 100), charge('u1', 'Labour', 1, 90)],
    labourAmount: 0,
    vatRate: 0.05,
    subtotalAmount: 290,
    vatAmount: 14.5,
    grandTotal,
  };
}

test(
  'enrichment upgrades untouched imported quotations and leaves edited ones alone',
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
    const pool = createDbPool();
    const client = await pool.connect();
    try {
      const admin = await client.query<{ id: string }>(
        `SELECT id::text FROM profiles ORDER BY id LIMIT 1`,
      );
      const profileId = admin.rows[0].id;
      await client.query('BEGIN');
      try {
        const batch = await client.query<{ id: string }>(
          `INSERT INTO import_batches (source_name, status, initiated_by) VALUES ($1, 'started', $2) RETURNING id`,
          [SOURCE_NAME, profileId],
        );
        // An imported quotation in the old shape: a priced product, no VAT, a total that is lower than the sheet's.
        const oldShape = async (legacyRef: string, edited: boolean) => {
          const reference = await allocateQuotationReference(client, '2099-01-05');
          const ins = await client.query<{ id: string }>(
            `INSERT INTO quotations (quotation_reference, quotation_date, customer_name, products, parts,
                labour_amount, grand_total, legacy_reference, created_at, updated_at, created_by, updated_by, vat_rate, subtotal_amount, vat_amount)
             VALUES ($1,'2099-01-05','School',$2::jsonb,'[]'::jsonb,0,290,$3,'2099-01-05T09:00:00Z',$4,$5,$5,0,290,0)
             RETURNING id::text`,
            [
              reference,
              JSON.stringify([
                { partNo: '', description: 'Washing machine', qty: 1, unitPrice: 290 },
              ]),
              legacyRef,
              edited ? '2099-02-01T09:00:00Z' : '2099-01-05T09:00:00Z',
              profileId,
            ],
          );
          await client.query(
            `INSERT INTO legacy_references (source_name, entity_type, legacy_reference, entity_id, import_batch_id, source_row, reconciliation_status)
             VALUES ($1,'quotation',$2,$3,$4,2,'matched')`,
            [SOURCE_NAME, legacyRef, ins.rows[0].id, batch.rows[0].id],
          );
          return ins.rows[0].id;
        };
        const idOk = await oldShape('QO-T1', false);
        const idEdited = await oldShape('QO-T2', true);
        const idBad = await oldShape('QO-T3', false);

        const plan = {
          quotations: [planned('QO-T1'), planned('QO-T2'), planned('QO-T3', 999), planned('QO-T4')],
        } as unknown as Plan;
        const status = (rows: Awaited<ReturnType<typeof enrichQuotations>>) =>
          Object.fromEntries(rows.map((r) => [r.legacyRef, r.status]));

        const dry = await enrichQuotations(client, plan, { apply: false });
        assert.deepEqual(status(dry), {
          'QO-T1': 'would-enrich',
          'QO-T2': 'skipped-edited',
          'QO-T3': 'skipped-total-mismatch',
          'QO-T4': 'skipped-not-imported',
        });
        const untouched = await client.query(
          `SELECT grand_total::text, vat_rate::text FROM quotations WHERE id = $1`,
          [idOk],
        );
        assert.equal(Number(untouched.rows[0].grand_total), 290, 'a dry run writes nothing');

        const applied = await enrichQuotations(client, plan, { apply: true, profileId });
        assert.equal(status(applied)['QO-T1'], 'enriched');
        const after = await client.query(
          `SELECT products, parts, vat_rate::text, subtotal_amount::text, vat_amount::text, grand_total::text,
                  updated_at = created_at AS untouched_stamp
             FROM quotations WHERE id = $1`,
          [idOk],
        );
        const row = after.rows[0];
        assert.equal(row.products[0].location, 'Villa u1');
        assert.equal(row.parts.length, 2);
        assert.equal(Number(row.vat_rate), 0.05);
        assert.equal(Number(row.subtotal_amount), 290);
        assert.equal(Number(row.vat_amount), 14.5);
        assert.equal(Number(row.grand_total), 304.5);
        assert.equal(row.untouched_stamp, true, 'enrichment is not recorded as a user edit');

        const audit = await client.query(
          `SELECT metadata FROM audit_events WHERE target_type = 'quotation' AND target_id = $1 AND action = 'quotation.enriched'`,
          [idOk],
        );
        assert.equal(audit.rows.length, 1);
        assert.equal(audit.rows[0].metadata.before.grandTotal, 290);

        for (const id of [idEdited, idBad]) {
          const kept = await client.query(
            `SELECT grand_total::text FROM quotations WHERE id = $1`,
            [id],
          );
          assert.equal(
            Number(kept.rows[0].grand_total),
            290,
            'edited / mismatching quotations stay as they were',
          );
        }

        const again = await enrichQuotations(client, plan, { apply: true, profileId });
        assert.equal(status(again)['QO-T1'], 'up-to-date', 'running twice changes nothing');
      } finally {
        await client.query('ROLLBACK');
      }
    } finally {
      client.release();
      await pool.end();
    }
  },
);
