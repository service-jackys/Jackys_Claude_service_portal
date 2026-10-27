import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  createDiJobService,
  DiJobServiceError,
} from '../../apps/api/src/dandi-jobs/jobs-service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof DiJobServiceError, String(error));
    assert.equal(error.code, code);
    return true;
  });
}

test(
  'Delivery & installation jobs: draft, validation, completion with frozen figures, duplicates, cancel and reopen',
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
    const custCode = `DIJ${tag}`;
    const salesmanOk = `Test Salesman ${tag}`;
    const salesmanNoChannel = `Test Nochannel ${tag}`;
    const unmappedGroup = `TEST KETTLES ${tag}`;
    const codes = { fridge: `DJF-${tag}`, kettle: `DJK-${tag}`, venus: `DJV-${tag}` };
    const noteRef = `DN-${tag}`;
    let ruleId: string | null = null;
    try {
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'D&I jobs test') RETURNING id`,
        [`dij-${randomUUID()}@example.test`],
      );
      const profileId = profile.rows[0]!.id;
      await pool.query(
        `INSERT INTO b2b_branches (cust_code, branch_name, salesman) VALUES ($1, $2, $3)`,
        [custCode, `Test Branch ${tag}`, salesmanOk.toUpperCase()],
      );
      await pool.query(
        `INSERT INTO salesmen (name, sales_channel) VALUES ($1, 'JDI'), ($2, NULL)`,
        [salesmanOk, salesmanNoChannel],
      );
      await pool.query(
        `INSERT INTO category_mappings (group_name, installable) VALUES ($1, false)`,
        [unmappedGroup],
      );
      const stock: [string, string, string, string][] = [
        [codes.fridge, 'FRIDGE', 'Test fridge', 'TESTBRAND'],
        [codes.kettle, unmappedGroup, 'Test kettle', 'TESTBRAND'],
        [codes.venus, 'FRIDGE', 'Test venus fridge', 'VENUS'],
      ];
      for (const [code, group, desc, brand] of stock) {
        await pool.query(
          `INSERT INTO stock_items (item_code, item_desc, main_group, group_name, brand, last_channel)
           VALUES ($1, $2, 'MDA', $3, $4, 'JDI')`,
          [code, desc, group, brand],
        );
      }
      const service = createDiJobService(pool);

      // Pickers
      const options = await service.options();
      assert.ok(options.regions.includes('Dubai'));
      assert.ok(options.salesmen.some((s) => s.name === salesmanOk && s.salesChannel === 'JDI'));
      assert.equal(options.erpInvMandatory, false);
      assert.equal(
        (await service.customers(`Test Branch ${tag}`)).customers[0]?.custCode,
        custCode,
      );
      const hits = (await service.items(`DJK-${tag}`)).items;
      assert.equal(hits[0]?.installable, false);
      assert.equal((await service.items('x')).items.length, 0);

      // Draft: customer name, salesman (master spelling) and channel are filled in from the masters.
      const base = {
        serviceDate: '2026-10-20',
        custCode,
        region: 'Dubai',
        lines: [
          { itemCode: codes.fridge, qty: 2, type: 'CSIDI' as const },
          { itemCode: codes.kettle, qty: 5, type: 'CSIDO' as const },
        ],
      };
      const created = await service.create(base, profileId);
      const job = created.job;
      assert.match(job.reference, /^DIJ-2026-\d{5}$/);
      assert.equal(job.status, 'Draft');
      assert.equal(job.customerName, `Test Branch ${tag}`);
      assert.equal(job.salesman, salesmanOk);
      assert.equal(job.salesChannel, 'JDI');
      assert.equal(job.lines.length, 2);
      assert.equal(job.lines[0]!.salesChannel, 'JDI');
      assert.equal(job.lines[1]!.installable, false);
      assert.equal(job.lines[0]!.revenue, null);

      // A non-installable item cannot be Delivery + Installation; unknown items and customers are refused.
      await rejectsWith(
        service.create(
          { ...base, lines: [{ itemCode: codes.kettle, qty: 1, type: 'CSIDI' }] },
          profileId,
        ),
        'invalid',
      );
      await rejectsWith(
        service.create(
          { ...base, lines: [{ itemCode: `NOPE-${tag}`, qty: 1, type: 'CSIDO' }] },
          profileId,
        ),
        'invalid',
      );
      await rejectsWith(service.create({ ...base, custCode: `NOPE${tag}` }, profileId), 'invalid');
      await assert.rejects(service.create({ ...base, serviceDate: '20/10/2026' }, profileId));

      // Completing needs the delivery note.
      await assert.rejects(service.complete(job.id, profileId), (error: unknown) => {
        assert.ok(error instanceof DiJobServiceError);
        assert.equal(error.code, 'incomplete');
        assert.deepEqual(error.messages, ['Enter the ERP delivery note (Ref Inv).']);
        return true;
      });

      // The admin switch makes the ERP Inv No required as well.
      await service.updateSettings({ erpInvMandatory: true }, profileId);
      const withNote = { ...base, deliveryNoteRef: `  ${noteRef}  ` };
      const saved = await service.update(job.id, withNote, profileId);
      assert.equal(saved.job.deliveryNoteRef, noteRef);
      await assert.rejects(service.complete(job.id, profileId), (error: unknown) => {
        assert.ok(error instanceof DiJobServiceError);
        assert.deepEqual(error.messages, ['Enter the ERP Inv No.']);
        return true;
      });
      await service.updateSettings({ erpInvMandatory: false }, profileId);

      // Complete: figures are frozen. 2 fridges delivered+installed, 5 kettles delivered only.
      const done = await service.complete(job.id, profileId);
      assert.equal(done.job.status, 'Completed');
      assert.ok(done.job.completedAt);
      const fridgeLine = done.job.lines[0]!;
      const kettleLine = done.job.lines[1]!;
      assert.equal(fridgeLine.revenue! > 0, true);
      assert.equal(kettleLine.charge, 60);
      assert.equal(
        done.job.totalRevenue,
        Math.round((fridgeLine.revenue! + kettleLine.revenue!) * 100) / 100,
      );
      assert.equal(done.job.totalCsido, 60);
      assert.equal(done.job.totalCsidi, fridgeLine.revenue);
      const frozenTotal = done.job.totalRevenue;

      // A completed job is not editable and cannot be completed twice.
      await rejectsWith(service.update(job.id, withNote, profileId), 'conflict');
      await rejectsWith(service.complete(job.id, profileId), 'conflict');

      // The same delivery note on another job is a warning only.
      const second = await service.create({ ...withNote }, profileId);
      assert.deepEqual(
        second.duplicates.map((d) => d.reference),
        [job.reference],
      );
      assert.equal((await service.get(job.id)).duplicates[0]?.reference, second.job.reference);

      // A salesman with no channel blocks completion with the "contact admin" message.
      const noChannel = await service.update(
        second.job.id,
        { ...withNote, deliveryNoteRef: `${noteRef}-2`, salesman: salesmanNoChannel },
        profileId,
      );
      assert.equal(noChannel.job.salesChannel, null);
      await assert.rejects(service.complete(second.job.id, profileId), (error: unknown) => {
        assert.ok(error instanceof DiJobServiceError);
        assert.match(error.messages[0]!, /Contact the administrator/);
        return true;
      });

      // A billing rule on salesman + brand sets the line channel (the Raneesh Jose pattern).
      const rule = await pool.query<{ id: string }>(
        `INSERT INTO billing_rules (salesman, brand, brand_match, bill_to_channel)
         VALUES ($1, 'VENUS', 'is', 'JER-C/INS') RETURNING id`,
        [salesmanOk],
      );
      ruleId = rule.rows[0]!.id;
      const branded = await service.update(
        second.job.id,
        {
          ...withNote,
          deliveryNoteRef: `${noteRef}-3`,
          lines: [
            { itemCode: codes.venus, qty: 1, type: 'CSIDI' },
            { itemCode: codes.fridge, qty: 1, type: 'CSIDI' },
          ],
        },
        profileId,
      );
      assert.deepEqual(
        branded.job.lines.map((l) => l.salesChannel),
        ['JER-C/INS', 'JDI'],
      );

      // Cancelling: a draft by anyone who enters jobs, a completed job only with the reopen right.
      const cancelledDraft = await service.cancel(second.job.id, profileId, false);
      assert.equal(cancelledDraft.job.status, 'Cancelled');
      assert.equal(cancelledDraft.duplicates.length, 0);
      await rejectsWith(service.cancel(second.job.id, profileId, true), 'conflict');
      await rejectsWith(service.cancel(job.id, profileId, false), 'forbidden');

      // Reopen clears the frozen figures and puts the job back to Draft.
      const reopened = await service.reopen(job.id, profileId);
      assert.equal(reopened.job.status, 'Draft');
      assert.equal(reopened.job.totalRevenue, 0);
      assert.equal(reopened.job.lines[0]!.revenue, null);
      await rejectsWith(service.reopen(job.id, profileId), 'conflict');
      const again = await service.complete(job.id, profileId);
      assert.equal(again.job.totalRevenue, frozenTotal);

      // Listing and filters
      const listed = await service.list({ search: noteRef, status: 'Completed' });
      assert.equal(listed.total, 1);
      assert.equal(listed.jobs[0]!.lineCount, 2);
      assert.equal(listed.jobs[0]!.totalQty, 7);

      // The history is on the audit trail.
      const audit = await pool.query<{ action: string }>(
        `SELECT action FROM audit_events WHERE target_type = 'di_job' AND target_id = $1 ORDER BY id`,
        [job.id],
      );
      assert.deepEqual(
        audit.rows.map((r) => r.action),
        [
          'di_job.created',
          'di_job.updated',
          'di_job.completed',
          'di_job.reopened',
          'di_job.completed',
        ],
      );
    } finally {
      if (ruleId) await pool.query(`DELETE FROM billing_rules WHERE id = $1`, [ruleId]);
      await pool.query(`DELETE FROM di_jobs WHERE customer_name = $1`, [`Test Branch ${tag}`]);
      await pool.query(`DELETE FROM b2b_branches WHERE cust_code = $1`, [custCode]);
      await pool.query(`DELETE FROM salesmen WHERE name IN ($1, $2)`, [
        salesmanOk,
        salesmanNoChannel,
      ]);
      await pool.query(`DELETE FROM stock_items WHERE item_code LIKE $1`, [`DJ_-${tag}`]);
      await pool.query(`DELETE FROM category_mappings WHERE group_name = $1`, [unmappedGroup]);
      await pool.query(
        `UPDATE revenue_settings SET value = 'false'::jsonb WHERE key = 'dandi_erp_inv_mandatory'`,
      );
      await pool.end();
    }
  },
);
