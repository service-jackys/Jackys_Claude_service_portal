import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { REPORT_DEFINITIONS } from '../../apps/api/src/reports/definitions.js';
import { createReportService } from '../../apps/api/src/reports/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

// modification.md #295: every report must run against the real schema (a wrong column name only
// shows up when the query runs), and the new reports must return the saved values.
test(
  'Reports: every report runs, and the new reports return saved records',
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
    const service = createReportService(pool);
    const tag = randomUUID().slice(0, 8);
    const num = String(10000 + Math.floor(Math.random() * 89999));
    const diRef = `DIJ-2026-${num}`;
    const cmpRef = `CMP-9${num}-001`;
    try {
      // 1. every definition runs (empty or not) and returns one cell per column
      for (const definition of REPORT_DEFINITIONS) {
        const preview = await service.preview(definition.type, { pageSize: '5' }, ['*']);
        assert.equal(preview.columns.length, definition.columns.length, definition.type);
        for (const row of preview.rows) assert.equal(row.length, definition.columns.length);
      }
      const labels = REPORT_DEFINITIONS.map((definition) => definition.type);
      for (const type of [
        'di-job',
        'di-job-line',
        'complaint',
        'task',
        'warranty-approval',
        'revenue-rate-change',
      ]) {
        assert.ok(labels.includes(type), `${type} report is registered`);
      }

      // 2. the Tasks report is administrators only
      assert.ok(service.listTypes(['*']).some((item) => item.type === 'task'));
      assert.ok(!service.listTypes(['reports.read', 'tasks.use']).some((i) => i.type === 'task'));
      await assert.rejects(service.preview('task', {}, ['reports.read', 'tasks.use']), /cannot/);

      // 3. seed one record for each new report and read it back
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, $2) RETURNING id`,
        [`rep-${tag}@example.test`, `Report User ${tag}`],
      );
      const profileId = profile.rows[0].id;
      const job = await pool.query<{ id: string }>(
        `INSERT INTO di_jobs (reference, service_date, customer_type, customer_name, erp_inv_no, total_csidi, total_revenue, completed_at, completed_by)
         VALUES ($1, current_date, 'B2C', $2, $3, 150, 150, now(), $4) RETURNING id`,
        [diRef, `Cust ${tag}`, `INV-${tag}`, profileId],
      );
      await pool.query(
        `INSERT INTO di_job_lines (job_id, line_no, item_code, item_desc, qty, txn_type, installable, net_rate, revenue)
         VALUES ($1, 1, $2, 'Fridge', 2, 'CSIDI', true, 75, 150)`,
        [job.rows[0].id, `IC-${tag}`],
      );
      await pool.query(
        `INSERT INTO complaints (complaint_reference, customer_type, customer_name, contact_number, description, cce_notes)
         VALUES ($1, 'B2C', $2, '0500000000', 'No cooling', 'called back')`,
        [cmpRef, `Cust ${tag}`],
      );
      await pool.query(
        `INSERT INTO roi_tasks (owner_profile_id, title, kind, status, priority, percent_complete, remarks)
         VALUES ($1, $2, 'task', 'in_progress', 'high', 40, 'next step')`,
        [profileId, `Task ${tag}`],
      );
      await pool.query(
        `INSERT INTO audit_events (actor_profile_id, action, target_type, target_id, metadata)
         VALUES ($1, 'revenue_dashboard.rate_card_locked', 'revenue_rate_overrides', '1', $2::jsonb)`,
        [profileId, JSON.stringify({ batchId: 7, changes: [{ rate: 'a' }, { rate: 'b' }], tag })],
      );

      const find = async (type: string, search: string) =>
        service.preview(type, { search, pageSize: '10' }, ['*']);
      const idx = (preview: Awaited<ReturnType<typeof find>>, label: string) =>
        preview.columns.findIndex((column) => column.label === label);

      const jobs = await find('di-job', diRef);
      assert.equal(jobs.rows.length, 1);
      assert.equal(jobs.rows[0][idx(jobs, 'ERP Invoice No')], `INV-${tag}`);
      assert.equal(jobs.rows[0][idx(jobs, 'Lines')], 1);
      assert.equal(jobs.rows[0][idx(jobs, 'Completed By')], `Report User ${tag}`);

      const lines = await find('di-job-line', `IC-${tag}`);
      assert.equal(lines.rows.length, 1);
      assert.equal(lines.rows[0][idx(lines, 'Installable')], 'Yes');
      assert.equal(lines.rows[0][idx(lines, 'Job Type')], 'CSIDI');

      const complaints = await find('complaint', cmpRef);
      assert.equal(complaints.rows.length, 1);
      assert.equal(complaints.rows[0][idx(complaints, 'CCE Notes')], 'called back');

      const tasks = await find('task', `Task ${tag}`);
      assert.equal(tasks.rows.length, 1);
      assert.equal(tasks.rows[0][idx(tasks, 'Owner')], `Report User ${tag}`);
      assert.equal(tasks.rows[0][idx(tasks, 'Progress %')], 40);

      const changes = await find('revenue-rate-change', `Report User ${tag}`);
      assert.equal(changes.rows.length, 1);
      assert.equal(changes.rows[0][idx(changes, 'Event')], 'Custom rates locked');
      assert.equal(changes.rows[0][idx(changes, 'Rates Changed')], 2);

      // 4. the workbook download works for a new report
      const workbook = await service.exportWorkbook('di-job', { search: diRef }, ['*'], profileId);
      assert.equal(workbook.rows, 1);
    } finally {
      await pool.end();
    }
  },
);
