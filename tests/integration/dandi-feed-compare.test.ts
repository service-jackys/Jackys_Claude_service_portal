import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  createDiJobService,
  DiJobServiceError,
} from '../../apps/api/src/dandi-jobs/jobs-service.js';
import {
  createSalesmanAliasService,
  SalesmanAliasServiceError,
} from '../../apps/api/src/salesman-aliases/service.js';
import { actualRevenue } from '../../packages/db/src/budget-variance.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'Delivery & installation: salesman spellings, the revenue feed switch, and the comparison with the workbook',
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
    const custCode = `DFC${tag}`;
    const branchName = `Feed Branch ${tag}`;
    const salesmanName = `Raneesh ${tag}`;
    const aliasText = `RENEESH ${tag}`;
    const codes = { fridge: `DFF-${tag}`, kettle: `DFK-${tag}` };
    const note = `DNF-${tag}`;
    const group = `TEST KETTLES ${tag}`;
    let batchId: string | null = null;
    try {
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'D&I feed test') RETURNING id`,
        [`dif-${randomUUID()}@example.test`],
      );
      const profileId = profile.rows[0]!.id;
      const salesman = await pool.query<{ id: string }>(
        `INSERT INTO salesmen (name, sales_channel) VALUES ($1, 'JDI') RETURNING id`,
        [salesmanName],
      );
      // The B2B list spells the salesman the way the workbook does.
      await pool.query(
        `INSERT INTO b2b_branches (cust_code, branch_name, salesman) VALUES ($1, $2, $3)`,
        [custCode, branchName, aliasText],
      );
      await pool.query(
        `INSERT INTO category_mappings (group_name, installable) VALUES ($1, false)`,
        [group],
      );
      for (const [code, g] of [
        [codes.fridge, 'FRIDGE'],
        [codes.kettle, group],
      ] as const) {
        await pool.query(
          `INSERT INTO stock_master (item_code, item_desc, main_group, group_name, brand)
           VALUES ($1, 'Test item', 'MDA', $2, 'TESTBRAND')`,
          [code, g],
        );
      }
      const jobs = createDiJobService(pool);
      const aliases = createSalesmanAliasService(pool);

      // Without the spelling the customer's salesman is not recognised.
      const before = await jobs.customers(branchName);
      assert.equal(before.customers[0]!.salesman, aliasText);

      const added = await aliases.create(
        { alias: aliasText, salesmanId: salesman.rows[0]!.id },
        profileId,
      );
      assert.equal(added.alias.salesmanName, salesmanName);
      await assert.rejects(
        aliases.create(
          { alias: aliasText.toLowerCase(), salesmanId: salesman.rows[0]!.id },
          profileId,
        ),
        (e: unknown) => e instanceof SalesmanAliasServiceError && e.code === 'duplicate',
      );
      await assert.rejects(
        aliases.create(
          { alias: salesmanName.toUpperCase(), salesmanId: salesman.rows[0]!.id },
          profileId,
        ),
        (e: unknown) => e instanceof SalesmanAliasServiceError && e.code === 'same-name',
      );
      assert.equal(
        (await aliases.list()).aliases.some((a) => a.alias === aliasText),
        true,
      );

      // With it, the picker offers the master name and a new job takes that salesman and its channel.
      assert.equal((await jobs.customers(branchName)).customers[0]!.salesman, salesmanName);
      const created = await jobs.create(
        {
          serviceDate: '2031-03-10',
          custCode,
          region: 'Dubai',
          deliveryNoteRef: note,
          lines: [
            { itemCode: codes.fridge, qty: 2, type: 'CSIDI' },
            { itemCode: codes.kettle, qty: 3, type: 'CSIDO' },
          ],
        },
        profileId,
      );
      assert.equal(created.job.salesman, salesmanName);
      assert.equal(created.job.salesChannel, 'JDI');
      const done = (await jobs.complete(created.job.id, profileId)).job;
      const csidiRevenue = done.totalCsidi;
      const csidoRevenue = done.totalCsido;
      assert.ok(csidiRevenue > 0 && csidoRevenue > 0);

      // The workbook upload for the month: the same note, the other spelling, the workbook's channel name.
      const batch = await pool.query<{ id: string }>(
        `INSERT INTO revenue_import_batches (kind, file_name, file_sha256, is_active)
         VALUES ('revenue', $1, $2, true) RETURNING id`,
        [`feed-test-${tag}.xlsm`, randomUUID()],
      );
      batchId = batch.rows[0]!.id;
      const addLine = (type: string, inv: string, qty: number, revenue: number) =>
        pool.query(
          `INSERT INTO revenue_lines (batch_id, job_type, inv_del_no, order_date, year, month_no,
                                      customer, sales_person, sales_channel, qty, revenue)
           VALUES ($1, $2, $3, '2031-03-10', 2031, 3, $4, $5, 'HAA', $6, $7)`,
          [batchId, type, inv, branchName, aliasText, qty, revenue],
        );
      await addLine('CSIDI', note, 2, csidiRevenue);
      await addLine('CSIDO', note, 1, csidoRevenue);
      await addLine('CSIDI', `MISSING-${tag}`, 1, 57);

      const result = await jobs.compare({ month: '2031-03' });
      const mine = result.rows.find((r) => r.key === note.toUpperCase())!;
      assert.equal(mine.status, 'match', mine.notes.join(' | '));
      assert.deepEqual(mine.notes, []);
      assert.equal(mine.jobs[0]!.reference, created.job.reference);
      const missing = result.rows.find((r) => r.key === `MISSING-${tag}`)!;
      assert.equal(missing.status, 'only-excel');
      assert.equal(result.summary.counts.onlyExcel, 1);
      assert.equal(result.summary.counts.match, 1);
      assert.equal(result.summary.byType.CSIDI.excelRevenue, csidiRevenue + 57);
      assert.equal(result.summary.byType.CSIDI.portalRevenue, csidiRevenue);
      assert.equal(result.workbook.fileName, `feed-test-${tag}.xlsm`);

      // A changed workbook figure turns the note into a difference.
      await pool.query(
        `UPDATE revenue_lines SET revenue = revenue + 10 WHERE batch_id = $1 AND inv_del_no = $2 AND job_type = 'CSIDI'`,
        [batchId, note],
      );
      const changed = await jobs.compare({ month: '2031-03' });
      assert.equal(changed.rows.find((r) => r.key === note.toUpperCase())!.status, 'differs');

      await assert.rejects(jobs.compare({ month: '2031-13' }));
      await assert.rejects(jobs.compare({}));

      // The revenue feed: off, the workbook supplies CSIDI / CSIDO; on, the Completed jobs do.
      const kinds = (rows: Awaited<ReturnType<typeof actualRevenue>>) =>
        Object.fromEntries(
          rows.map((r) => [
            `${r.kind}|${r.matchValue}`,
            { revenue: Number(r.revenue), qty: Number(r.qty) },
          ]),
        );
      const off = kinds(
        await actualRevenue(pool as never, batchId, '2031-03-01', '2031-04-01', {}),
      );
      assert.equal(off['excel_job_type|CSIDI']!.revenue, csidiRevenue + 10 + 57);
      assert.equal(off['portal_dandi_csidi|*'], undefined);
      const on = kinds(
        await actualRevenue(pool as never, batchId, '2031-03-01', '2031-04-01', {
          portalDandi: true,
        }),
      );
      assert.equal(on['excel_job_type|CSIDI'], undefined);
      assert.equal(on['excel_job_type|CSIDO'], undefined);
      assert.equal(on['portal_dandi_csidi|*']!.revenue, csidiRevenue);
      assert.equal(on['portal_dandi_csidi|*']!.qty, 2);
      assert.equal(on['portal_dandi_csido|*']!.revenue, csidoRevenue);
      assert.equal(on['portal_dandi_csido|*']!.qty, 1);

      // A cancelled job leaves the feed.
      await jobs.cancel(created.job.id, profileId, true);
      const gone = kinds(
        await actualRevenue(pool as never, batchId, '2031-03-01', '2031-04-01', {
          portalDandi: true,
        }),
      );
      assert.equal(gone['portal_dandi_csidi|*'], undefined);

      // The three sources are mapped to the same streams as the workbook job types.
      const mapped = await pool.query<{ source_kind: string; stream_code: string }>(
        `SELECT source_kind, stream_code FROM stream_mappings WHERE source_kind LIKE 'portal_dandi_%' ORDER BY 1`,
      );
      assert.deepEqual(
        mapped.rows.map((r) => r.source_kind),
        ['portal_dandi_csidi', 'portal_dandi_csido', 'portal_dandi_csiii'],
      );
      const setting = await pool.query<{ value: unknown }>(
        `SELECT value FROM revenue_settings WHERE key = 'portal_dandi_revenue'`,
      );
      assert.equal(setting.rows[0]!.value, false);

      // Removing the spelling again.
      await aliases.remove(added.alias.id, profileId);
      await assert.rejects(
        aliases.remove(added.alias.id, profileId),
        (e: unknown) => e instanceof SalesmanAliasServiceError && e.code === 'not-found',
      );
      void DiJobServiceError;
    } finally {
      if (batchId) await pool.query(`DELETE FROM revenue_import_batches WHERE id = $1`, [batchId]);
      await pool.query(`DELETE FROM di_jobs WHERE customer_name = $1`, [branchName]);
      await pool.query(`DELETE FROM b2b_branches WHERE cust_code = $1`, [custCode]);
      await pool.query(`DELETE FROM salesmen WHERE name = $1`, [salesmanName]);
      await pool.query(`DELETE FROM stock_master WHERE item_code LIKE $1`, [`DF_-${tag}`]);
      await pool.query(`DELETE FROM category_mappings WHERE group_name = $1`, [group]);
      await pool.end();
    }
  },
);
