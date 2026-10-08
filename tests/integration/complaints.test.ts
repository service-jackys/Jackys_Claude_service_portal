import assert from 'node:assert/strict';
import test from 'node:test';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';
import {
  ComplaintServiceError,
  createComplaintService,
} from '../../apps/api/src/complaints/service.js';

const databaseUrl = process.env.DATABASE_URL;

const baseComplaint = {
  customerType: 'B2C' as const,
  customerName: 'Phase2 Integration Customer',
  contactNumber: '0500000100',
  customerEmail: 'phase2@example.test',
  region: 'Dubai',
  description: 'Phase2 integration complaint',
};

test(
  'Phase2 complaint workflow allocates unique references and records history and audit events',
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
    const service = createComplaintService(pool);
    const complaintIds: string[] = [];
    let profileId: string | undefined;

    try {
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name)
         VALUES ('phase2-integration@example.test', 'Phase2 Integration')
         RETURNING id`,
      );
      profileId = profile.rows[0].id;

      const submissions = await Promise.all(
        [1, 2, 3].map((index) =>
          service.submit({
            ...baseComplaint,
            customerName: `${baseComplaint.customerName} ${index}`,
          }),
        ),
      );
      complaintIds.push(...submissions.map((complaint) => complaint.id));

      const references = submissions.map((complaint) => complaint.complaintReference);
      assert.equal(new Set(references).size, 3);
      assert.ok(references.every((reference) => /^CMP-\d{6}-\d{3}$/.test(reference)));

      await assert.rejects(
        service.submit({ ...baseComplaint, status: 'Closed' }),
        (error: unknown) => error instanceof Error && error.name === 'ZodError',
      );

      const first = submissions[0];
      const changed = await service.changeStatus(
        first.id,
        { status: 'Under Review', reason: 'Assigned for review' },
        profileId,
      );
      assert.equal(changed.status, 'Under Review');

      await assert.rejects(
        service.changeStatus(first.id, { status: 'Closed' }, profileId),
        (error: unknown) =>
          error instanceof ComplaintServiceError && error.code === 'invalid-transition',
      );

      // Scheduled is system-only: it comes from booking an appointment.
      await assert.rejects(
        service.changeStatus(first.id, { status: 'Scheduled' }, profileId),
        (error: unknown) =>
          error instanceof ComplaintServiceError &&
          error.code === 'invalid-transition' &&
          /appointment/i.test(error.message),
      );

      const detail = await service.detail(first.id);
      assert.deepEqual(
        detail.history.map((entry) => [entry.fromStatus, entry.toStatus, entry.reason]),
        [
          [null, 'New', 'Submitted'],
          ['New', 'Under Review', 'Assigned for review'],
        ],
      );

      const audits = await pool.query<{ action: string }>(
        `SELECT action
         FROM audit_events
         WHERE target_type = 'complaint' AND target_id = $1
         ORDER BY occurred_at ASC, id ASC`,
        [first.id],
      );
      assert.deepEqual(
        audits.rows.map((row) => row.action),
        ['complaint.submitted', 'complaint.status_changed'],
      );
    } finally {
      if (complaintIds.length > 0) {
        await pool.query(
          `DELETE FROM audit_events
           WHERE target_type = 'complaint' AND target_id = ANY($1::bigint[])`,
          [complaintIds],
        );
        await pool.query(`DELETE FROM complaints WHERE id = ANY($1::bigint[])`, [complaintIds]);
      }
      if (profileId) {
        await pool.query(`DELETE FROM profiles WHERE id = $1`, [profileId]);
      }
      await pool.end();
    }
  },
);
