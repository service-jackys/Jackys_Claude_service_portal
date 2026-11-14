import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { RoiServiceError, createRoiService } from '../../apps/api/src/roi-tasks/service.js';
import type { ApplicationAuth } from '../../apps/api/src/auth/application-auth.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

const authFor = (profileId: string, permissions: string[], admin = false): ApplicationAuth => ({
  provider: 'local',
  subject: profileId,
  email: `link-${profileId}@example.test`,
  displayName: `Link User ${profileId}`,
  profileId,
  roles: [admin ? 'admin' : 'user'],
  permissions: admin ? ['*'] : permissions,
});

test(
  'Tasks can be linked to one quotation, inspection or job card',
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
    const service = createRoiService(pool);
    const tag = randomUUID().slice(0, 8);
    const ref = `QO-2099-${String(Math.floor(Math.random() * 99999)).padStart(5, '0')}`;
    try {
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'Link user') RETURNING id`,
        [`link-${tag}@example.test`],
      );
      const me = profile.rows[0].id;
      const quotation = await pool.query<{ id: string }>(
        `INSERT INTO quotations (quotation_reference, customer_name, contact_number, project_name, site_location, customer_complaint, grand_total, quotation_status, customer_type)
         VALUES ($1, 'Metro Delux', '0500000000', 'P', 'S', 'C', 100, 'Pending', 'B2B') RETURNING id`,
        [ref],
      );
      const q = quotation.rows[0].id;

      const full = authFor(me, ['tasks.use', 'quotation.read']);
      const task = await service.create(full, {
        title: 'Follow up: quote',
        recordType: 'quotation',
        recordId: q,
      });
      assert.equal(task.recordType, 'quotation');
      assert.equal(task.recordId, q);
      assert.equal(task.recordLabel, `${ref} \u00B7 Metro Delux`);

      // List by record returns only this record's tasks; other tasks are untouched.
      const plain = await service.create(full, { title: 'Plain task' });
      assert.equal(plain.recordType, null);
      const byRecord = await service.list(full, { recordType: 'quotation', recordId: q });
      assert.deepEqual(
        byRecord.map((t) => t.id),
        [task.id],
      );

      // Needs the permission to open the record; a missing record and a half-pair are rejected.
      const noRead = authFor(me, ['tasks.use']);
      await assert.rejects(
        service.create(noRead, { title: 'x', recordType: 'quotation', recordId: q }),
        /cannot open that record/,
      );
      await assert.rejects(
        service.create(full, { title: 'x', recordType: 'quotation', recordId: '999999999' }),
        RoiServiceError,
      );
      await assert.rejects(service.create(full, { title: 'x', recordType: 'quotation' }));

      // Issued quote-calculator records: AMC contract, Thomson quote and VAS sale.
      const suffix = String(Math.floor(Math.random() * 99999)).padStart(5, '0');
      const amc = await pool.query<{ id: string }>(
        `INSERT INTO amc_contracts (amc_contract_reference, client_name, appliances, plans)
         VALUES ($1, 'Al Noor Hotel', '[]', '[]') RETURNING id`,
        [`AC-2099-${suffix}`],
      );
      const thomson = await pool.query<{ id: string }>(
        `INSERT INTO thomson_sales (thomson_sale_reference, client_name, line_items)
         VALUES ($1, 'Gems School', '[]') RETURNING id`,
        [`TH-2099-${suffix}`],
      );
      const vas = await pool.query<{ id: string }>(
        `INSERT INTO vas_sales (vas_sale_reference, customer_name, plan_key, vas_product)
         VALUES ($1, 'Sara Khan', 'ew1', 'Extended warranty') RETURNING id`,
        [`VS-2099-${suffix}`],
      );
      const calc = authFor(me, [
        'tasks.use',
        'amc_contract.read',
        'thomson_sale.read',
        'vas_sale.read',
      ]);
      const amcTask = await service.create(calc, {
        title: 'Follow up AMC',
        recordType: 'amc_contract',
        recordId: amc.rows[0].id,
      });
      assert.equal(amcTask.recordLabel, `AC-2099-${suffix} \u00B7 Al Noor Hotel`);
      const thomsonTask = await service.create(calc, {
        title: 'Follow up Thomson',
        recordType: 'thomson_sale',
        recordId: thomson.rows[0].id,
      });
      assert.equal(thomsonTask.recordLabel, `TH-2099-${suffix} \u00B7 Gems School`);
      const vasTask = await service.create(calc, {
        title: 'Follow up VAS',
        recordType: 'vas_sale',
        recordId: vas.rows[0].id,
      });
      assert.equal(vasTask.recordLabel, `VS-2099-${suffix} \u00B7 Sara Khan`);
      await assert.rejects(
        service.create(full, { title: 'x', recordType: 'amc_contract', recordId: amc.rows[0].id }),
        /cannot open that record/,
      );
      await pool.query(`DELETE FROM roi_tasks WHERE owner_profile_id = $1`, [me]);
      await pool.query(`DELETE FROM amc_contracts WHERE id = $1`, [amc.rows[0].id]);
      await pool.query(`DELETE FROM thomson_sales WHERE id = $1`, [thomson.rows[0].id]);
      await pool.query(`DELETE FROM vas_sales WHERE id = $1`, [vas.rows[0].id]);
      await assert.rejects(
        service.create(full, { title: 'x', recordType: 'invoice', recordId: q }),
      );
    } finally {
      await pool.end();
    }
  },
);
