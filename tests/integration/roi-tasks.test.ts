import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {
  RoiServiceError,
  createRoiService,
  parseTrackerWorkbook,
} from '../../apps/api/src/roi-tasks/service.js';
import type { ApplicationAuth } from '../../apps/api/src/auth/application-auth.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

const authFor = (profileId: string, admin = false): ApplicationAuth => ({
  provider: 'local',
  subject: profileId,
  email: `roi-${profileId}@example.test`,
  displayName: `ROI User ${profileId}`,
  profileId,
  roles: [admin ? 'admin' : 'user'],
  permissions: admin ? ['*'] : ['tasks.use'],
});

async function trackerBuffer(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.addRow(['Task Description', 'Status', '% Complete', 'Remarks / Next Action']);
  sheet.addRow(['Landing page for complaints', 'Completed', '100%', 'Live']);
  sheet.addRow(['Redtra pricing', 'In Progress', '60%', 'Waiting on INS']);
  sheet.addRow([]);
  sheet.addRow(['Task Description', 'Target', '% Complete', 'Next Action']);
  sheet.addRow(['Service Cost-Based Model', '50% → 100%', 'In Progress', 'Ongoing discussion']);
  sheet.addRow(['Key access for WH', '0% → 100%', 'Not Started', 'Informed to VP']);
  workbook.addWorksheet('EmailTracker').addRow(['ID', 'MessageId', 'LastSentDate']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test('tracker workbook parser reads result and objective tables', async () => {
  const sheets = await parseTrackerWorkbook(await trackerBuffer());
  assert.equal(sheets.length, 1);
  const [done, progress, objective, notStarted] = sheets[0].tasks;
  assert.deepEqual([done.status, done.percentComplete, done.remarks], ['completed', 100, 'Live']);
  assert.deepEqual([progress.status, progress.percentComplete], ['in_progress', 60]);
  assert.deepEqual([objective.status, objective.percentComplete], ['in_progress', 50]);
  assert.deepEqual([notStarted.status, notStarted.percentComplete], ['not_started', 0]);
  await assert.rejects(parseTrackerWorkbook(Buffer.from('not a workbook')), RoiServiceError);
});

test(
  'Tasks (ROI): ownership, completion rules, settings, reports and import',
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
    const ids: string[] = [];
    try {
      for (const name of ['a', 'b']) {
        const result = await pool.query<{ id: string }>(
          `INSERT INTO profiles (email, display_name) VALUES ($1, $2) RETURNING id`,
          [`roi-${name}-${randomUUID()}@example.test`, `ROI ${name}`],
        );
        ids.push(result.rows[0].id);
      }
      const [a, b] = ids;
      const userA = authFor(a);
      const userB = authFor(b);
      const admin = authFor(b, true);

      // Create + defaults
      const task = await service.create(userA, { title: '  Pricing review  ' });
      assert.equal(task.title, 'Pricing review');
      assert.deepEqual(
        [task.kind, task.status, task.priority, task.percentComplete, task.completedAt],
        ['task', 'not_started', 'medium', 0, null],
      );

      // Isolation: B cannot see, edit or delete A's task; admin can
      assert.equal((await service.list(userB, {})).length, 0);
      await assert.rejects(service.list(userB, { owner: a }), /only see your own/);
      await assert.rejects(service.list(userB, { owner: 'all' }), RoiServiceError);
      await assert.rejects(service.update(userB, task.id, { title: 'x' }), /not found/);
      await assert.rejects(service.remove(userB, task.id), /not found/);
      assert.equal((await service.list(admin, { owner: a })).length, 1);
      assert.ok((await service.list(admin, { owner: 'all' })).some((t) => t.id === task.id));

      // Percent drives status; completing stamps completed_at; lowering reopens
      let t = await service.update(userA, task.id, { percentComplete: 40 });
      assert.equal(t.status, 'in_progress');
      t = await service.update(userA, task.id, { percentComplete: 100 });
      assert.equal(t.status, 'completed');
      assert.ok(t.completedAt);
      t = await service.update(userA, task.id, { percentComplete: 70 });
      assert.deepEqual([t.status, t.completedAt], ['in_progress', null]);
      t = await service.update(userA, task.id, { status: 'completed' });
      assert.deepEqual([t.percentComplete, Boolean(t.completedAt)], [100, true]);

      // Dates, validation, reassignment
      await assert.rejects(
        service.create(userA, { title: 'bad', startDate: '2026-10-10', dueDate: '2026-10-01' }),
      );
      await assert.rejects(
        service.update(userA, task.id, { startDate: '2026-10-10', dueDate: '2026-10-01' }),
        /end date/,
      );
      await assert.rejects(service.update(userA, task.id, { ownerProfileId: b }), /administrators/);
      t = await service.update(admin, task.id, { ownerProfileId: b });
      assert.equal(t.ownerProfileId, b);
      t = await service.update(userB, task.id, {
        startDate: '2026-10-05',
        dueDate: '2026-10-09',
        priority: 'urgent',
      });
      assert.deepEqual(
        [t.startDate, t.dueDate, t.priority],
        ['2026-10-05', '2026-10-09', 'urgent'],
      );
      assert.deepEqual((await service.owners(userB)).length, 0);
      assert.ok((await service.owners(admin)).some((o) => o.id === a));

      // Filters
      await service.create(userB, { title: 'Open issue', kind: 'issue', remarks: 'ERP access' });
      assert.equal((await service.list(userB, { kind: 'issue' })).length, 1);
      assert.equal((await service.list(userB, { search: 'erp' })).length, 1);
      assert.equal((await service.list(userB, { status: 'completed' })).length, 1);

      // Delete
      await service.remove(userB, task.id);
      assert.equal((await service.list(userB, {})).length, 1);

      // Settings default to the thread's recipients, then persist
      const defaults = await service.settings(userA);
      assert.ok(defaults.toEmails.includes('manohar@jackys.com'));
      assert.ok(defaults.ccEmails.includes('shameer.abdulla@jackys.com'));
      await service.saveSettings(userA, {
        toEmails: ['x@example.test'],
        ccEmails: [],
        signature: 'Me\nHead of Service',
      });
      assert.deepEqual((await service.settings(userA)).toEmails, ['x@example.test']);
      await assert.rejects(
        service.saveSettings(userA, { toEmails: ['nope'], ccEmails: [], signature: '' }),
      );

      // Reports history
      await service.logReport(userA, {
        weekYear: 2026,
        weekNumber: 40,
        weekEnding: '2026-10-02',
        subject: 'Weekly ROI: Week 40',
        toEmails: ['x@example.test'],
        ccEmails: [],
        includesSummary: true,
        counts: { results: 2, objectives: 3 },
      });
      const reports = await service.reports(userA);
      assert.equal(reports.length, 1);
      assert.deepEqual(reports[0].counts, { results: 2, objectives: 3 });
      assert.equal((await service.reports(userB)).length, 0);

      // Import: parsed rows land as tasks, re-running skips duplicates
      const preview = await service.previewImport({
        originalname: 'WeeklyTasks.xlsx',
        size: 1,
        buffer: await trackerBuffer(),
      });
      const rows = preview.sheets[0].tasks.map((row) => ({
        ...row,
        completedOn: row.status === 'completed' ? '2026-09-25' : null,
      }));
      const first = await service.importTasks(userA, { tasks: rows });
      assert.deepEqual([first.added, first.skipped], [4, 0]);
      const second = await service.importTasks(userA, { tasks: rows });
      assert.deepEqual([second.added, second.skipped], [0, 4]);
      const imported = (await service.list(userA, { status: 'completed' })).find(
        (row) => row.title === 'Landing page for complaints',
      );
      assert.equal(imported?.completedAt?.toISOString().slice(0, 10), '2026-09-25');
      await assert.rejects(
        service.previewImport({ originalname: 'a.csv', size: 1, buffer: Buffer.from('x') }),
        RoiServiceError,
      );
    } finally {
      if (ids.length) {
        await pool.query(`DELETE FROM roi_reports WHERE owner_profile_id = ANY($1)`, [ids]);
        await pool.query(`DELETE FROM roi_settings WHERE owner_profile_id = ANY($1)`, [ids]);
        await pool.query(`DELETE FROM roi_tasks WHERE owner_profile_id = ANY($1)`, [ids]);
        await pool.query(`DELETE FROM audit_events WHERE actor_profile_id = ANY($1)`, [ids]);
        await pool.query(`DELETE FROM profiles WHERE id = ANY($1)`, [ids]);
      }
      await pool.end();
    }
  },
);
