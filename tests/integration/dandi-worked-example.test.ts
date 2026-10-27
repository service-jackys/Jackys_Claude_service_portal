import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDiJobService } from '../../apps/api/src/dandi-jobs/jobs-service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'Delivery & installation worked example: workbook lines, saved portal figures, a live Draft price and the comparison',
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
    const tag = randomUUID().slice(0, 8).toUpperCase();
    const custCode = `DWE${tag}`;
    const branchName = `Example Branch ${tag}`;
    const salesmanName = `Example Salesman ${tag}`;
    const fridge = `DWF-${tag}`;
    const noteDone = `DWN-${tag}`;
    const noteDraft = `DWD-${tag}`;
    let batchId: string | null = null;
    try {
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'D&I example test') RETURNING id`,
        [`diw-${randomUUID()}@example.test`],
      );
      const profileId = profile.rows[0]!.id;
      await pool.query(`INSERT INTO salesmen (name, sales_channel) VALUES ($1, 'JDI')`, [
        salesmanName,
      ]);
      await pool.query(
        `INSERT INTO b2b_branches (cust_code, branch_name, salesman) VALUES ($1, $2, $3)`,
        [custCode, branchName, salesmanName],
      );
      await pool.query(
        `INSERT INTO stock_master (item_code, item_desc, main_group, group_name, brand)
         VALUES ($1, 'Test fridge', 'MDA', 'FRIDGE', 'TESTBRAND')`,
        [fridge],
      );
      const jobs = createDiJobService(pool);
      const header = { serviceDate: '2031-05-10', custCode, region: 'Dubai' };

      // A Completed job: 3 fridges on one note.
      const done = await jobs.create(
        {
          ...header,
          deliveryNoteRef: noteDone,
          lines: [{ itemCode: fridge, qty: 3, type: 'CSIDI' }],
        },
        profileId,
      );
      const completed = (await jobs.complete(done.job.id, profileId)).job;
      const revenue = completed.totalCsidi;
      assert.ok(revenue > 0);

      // A Draft on another note.
      const draft = await jobs.create(
        {
          ...header,
          deliveryNoteRef: noteDraft,
          lines: [{ itemCode: fridge, qty: 1, type: 'CSIDI' }],
        },
        profileId,
      );

      // The workbook knows the completed note (a little lower) and the draft note.
      const batch = await pool.query<{ id: string }>(
        `INSERT INTO revenue_import_batches (kind, file_name, file_sha256, is_active)
         VALUES ('revenue', $1, $2, true) RETURNING id`,
        [`example-${tag}.xlsm`, randomUUID()],
      );
      batchId = batch.rows[0]!.id;
      const addLine = (inv: string, qty: number, amount: number) =>
        pool.query(
          `INSERT INTO revenue_lines (batch_id, source_row, job_type, inv_del_no, order_date, year, month_no,
                                      customer, sales_person, sales_channel, qty, revenue)
           VALUES ($1, 5, 'CSIDI', $2, '2031-05-10', 2031, 5, $3, $4, 'HAA', $5, $6)`,
          [batchId, inv, branchName, salesmanName, qty, amount],
        );
      await addLine(noteDone, 3, revenue - 12);
      await addLine(noteDraft.toLowerCase(), 1, 99);

      // Completed job: frozen figures, a difference with the workbook.
      const example = await jobs.workedExample({ invoice: ` ${noteDone.toLowerCase()} ` });
      assert.equal(example.excel?.lines.length, 1);
      assert.equal(example.excel?.total, revenue - 12);
      assert.equal(example.jobs.length, 1);
      const job = example.jobs[0]!;
      assert.equal(job.reference, done.job.reference);
      assert.equal(job.basis, 'frozen');
      assert.equal(job.counted, true);
      assert.deepEqual(job.note, { csidiQty: 3, csiiiQty: 0, csidoLines: 0 });
      const line = job.lines[0]!;
      assert.equal(line.rateKind, 'batch');
      assert.ok((line.baseRate ?? 0) > 0 && line.netRate !== null && line.labour !== null);
      assert.equal(line.revenue, revenue);
      assert.equal(job.totals?.total, revenue);
      assert.equal(example.comparison.status, 'differs');
      assert.equal(example.comparison.difference, 12);
      assert.equal(example.comparison.byType.CSIDI.excelQty, 3);
      assert.equal(example.comparison.byType.CSIDI.portalQty, 3);
      assert.match(example.comparison.notes.join(' '), /CSIDI revenue/);

      // A Draft: priced live, not counted.
      const live = await jobs.workedExample({ invoice: noteDraft });
      assert.equal(live.jobs[0]!.status, 'Draft');
      assert.equal(live.jobs[0]!.basis, 'live');
      assert.equal(live.jobs[0]!.counted, false);
      assert.ok((live.jobs[0]!.lines[0]!.revenue ?? 0) > 0);
      assert.equal(live.comparison.status, 'only-excel');
      assert.match(
        live.comparison.notes.join(' '),
        new RegExp(`${draft.job.reference} \\(Draft\\) not counted`),
      );

      // Only in the workbook, only in the portal, and neither.
      await pool.query(`UPDATE di_jobs SET delivery_note_ref = $2 WHERE id = $1`, [
        done.job.id,
        `${noteDone}-X`,
      ]);
      const onlyExcel = await jobs.workedExample({ invoice: noteDone });
      assert.equal(onlyExcel.jobs.length, 0);
      assert.equal(onlyExcel.comparison.status, 'only-excel');
      const onlyPortal = await jobs.workedExample({ invoice: `${noteDone}-X` });
      assert.equal(onlyPortal.excel, null);
      assert.equal(onlyPortal.comparison.status, 'only-portal');
      const neither = await jobs.workedExample({ invoice: `NOPE-${tag}` });
      assert.equal(neither.excel, null);
      assert.equal(neither.jobs.length, 0);
      assert.equal(neither.comparison.status, 'none');

      await assert.rejects(jobs.workedExample({}));
      await assert.rejects(jobs.workedExample({ invoice: '   ' }));
    } finally {
      if (batchId) await pool.query(`DELETE FROM revenue_import_batches WHERE id = $1`, [batchId]);
      await pool.query(`DELETE FROM di_jobs WHERE customer_name = $1`, [branchName]);
      await pool.query(`DELETE FROM b2b_branches WHERE cust_code = $1`, [custCode]);
      await pool.query(`DELETE FROM salesmen WHERE name = $1`, [salesmanName]);
      await pool.query(`DELETE FROM stock_master WHERE item_code = $1`, [fridge]);
      await pool.end();
    }
  },
);
