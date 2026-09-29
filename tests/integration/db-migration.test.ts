import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'PostgreSQL migration schema enforces persistence invariants',
  { skip: !databaseUrl },
  async (context) => {
    let applied: string[];
    try {
      applied = await migrate();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        context.skip('PostgreSQL is not available');
        return;
      }
      throw error;
    }
    assert.ok(applied.length <= 1);
    assert.deepEqual(await migrate(), []);

    const pool = createDbPool(databaseUrl);
    const client = await pool.connect();
    let profileId: string | undefined;
    let complaintId: string | undefined;

    try {
      await client.query(
        `DELETE FROM appointments WHERE appointment_reference IN ('APT-2026-90001', 'APT-2026-90002')`,
      );
      await client.query(
        `DELETE FROM complaints WHERE complaint_reference IN ('CMP-260924-901', 'CMP-260924-902')`,
      );
      await client.query(`DELETE FROM legacy_references WHERE source_name = 'migration-test'`);
      await client.query(`DELETE FROM audit_events WHERE request_id = 'migration-test'`);
      await client.query(`DELETE FROM profiles WHERE lower(email) = 'migration-test@example.test'`);
      await client.query(`DELETE FROM technicians WHERE name = 'Migration Technician'`);

      const profile = await client.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name)
       VALUES ('migration-test@example.test', 'Migration Test')
       RETURNING id`,
      );
      profileId = profile.rows[0].id;
      assert.equal(typeof profileId, 'string');

      const role = await client.query<{ id: number }>(`SELECT id FROM roles WHERE code = 'admin'`);
      assert.equal(role.rowCount, 1);
      const permissions = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
       FROM role_permissions
       WHERE role_id = $1`,
        [role.rows[0].id],
      );
      assert.ok(Number(permissions.rows[0].count) > 0);

      await assert.rejects(
        client.query(
          `INSERT INTO profiles (email, display_name) VALUES ('MIGRATION-TEST@example.test', 'Duplicate')`,
        ),
        /duplicate key/i,
      );

      const technician = await client.query<{ id: string }>(
        `INSERT INTO technicians (name) VALUES ('Migration Technician') RETURNING id`,
      );
      await client.query(
        `INSERT INTO technician_availability (technician_id, weekday, starts_at, ends_at)
       VALUES ($1, 1, '08:00', '17:00')`,
        [technician.rows[0].id],
      );
      await assert.rejects(
        client.query(
          `INSERT INTO technician_availability (technician_id, weekday, starts_at, ends_at)
         VALUES ($1, 1, '09:00', '08:00')`,
          [technician.rows[0].id],
        ),
        /technician_availability_range_check/i,
      );

      const complaint = await client.query<{ id: string }>(
        `INSERT INTO complaints (
         complaint_reference, customer_type, customer_name, contact_number, description
       ) VALUES ('CMP-260924-901', 'individual', 'Migration Customer', '0500000000', 'Migration test complaint')
       RETURNING id`,
      );
      complaintId = complaint.rows[0].id;
      assert.equal(typeof complaintId, 'string');

      await client.query(
        `INSERT INTO legacy_references (
           source_name, entity_type, legacy_reference, entity_id
         ) VALUES ('migration-test', 'complaint', 'CMP-260924-901', $1)`,
        [complaintId],
      );
      await assert.rejects(
        client.query(
          `INSERT INTO legacy_references (
             source_name, entity_type, legacy_reference, entity_id
           ) VALUES ('migration-test', 'complaint', 'CMP-260924-901', $1)`,
          [complaintId],
        ),
        /legacy_references_unique/i,
      );

      await client.query(
        `INSERT INTO appointments (
         appointment_reference, complaint_id, customer_type, customer_name,
         contact_number, fault_description, appointment_date
       ) VALUES ('APT-2026-90001', $1, 'individual', 'Migration Customer',
         '0500000000', 'Migration test fault', '2026-09-25')`,
        [complaintId],
      );
      await assert.rejects(
        client.query(
          `INSERT INTO appointments (
           appointment_reference, complaint_id, customer_type, customer_name,
           contact_number, fault_description, appointment_date
         ) VALUES ('APT-2026-90002', $1, 'individual', 'Migration Customer',
           '0500000000', 'Second active appointment', '2026-09-26')`,
          [complaintId],
        ),
        /appointments_active_complaint_unique/i,
      );

      await client.query(
        `UPDATE appointments
       SET status = 'Cancelled', closed_at = now()
       WHERE complaint_id = $1`,
        [complaintId],
      );
      await client.query(
        `INSERT INTO appointments (
         appointment_reference, complaint_id, customer_type, customer_name,
         contact_number, fault_description, appointment_date
       ) VALUES ('APT-2026-90002', $1, 'individual', 'Migration Customer',
         '0500000000', 'Rebooked test fault', '2026-09-26')`,
        [complaintId],
      );

      await client.query('BEGIN');
      await client.query(
        `INSERT INTO complaints (
         complaint_reference, customer_type, customer_name, contact_number, description
       ) VALUES ('CMP-260924-902', 'individual', 'Rollback Customer', '0500000001', 'Rollback test')`,
      );
      await client.query('ROLLBACK');
      const rolledBack = await client.query(
        `SELECT 1 FROM complaints WHERE complaint_reference = 'CMP-260924-902'`,
      );
      assert.equal(rolledBack.rowCount, 0);

      const migrationPath = new URL(
        '../../packages/db/migrations/001_initial_schema.sql',
        import.meta.url,
      );
      const checksum = createHash('sha256')
        .update(await readFile(migrationPath, 'utf8'))
        .digest('hex');
      await client.query(`UPDATE schema_migrations SET checksum = 'invalid' WHERE version = '001'`);
      await assert.rejects(migrate(), /Applied migration 001_initial_schema\.sql has changed/);
      await client.query(`UPDATE schema_migrations SET checksum = $1 WHERE version = '001'`, [
        checksum,
      ]);
    } finally {
      await client.query(
        `DELETE FROM appointments WHERE appointment_reference IN ('APT-2026-90001', 'APT-2026-90002')`,
      );
      await client.query(`DELETE FROM legacy_references WHERE source_name = 'migration-test'`);
      if (complaintId !== undefined) {
        await client.query(`DELETE FROM complaints WHERE id = $1`, [complaintId]);
      }
      if (profileId !== undefined) {
        await client.query(`DELETE FROM profiles WHERE id = $1`, [profileId]);
      }
      await client.query(`DELETE FROM technicians WHERE name = 'Migration Technician'`);
      client.release();
      await pool.end();
    }
  },
);
