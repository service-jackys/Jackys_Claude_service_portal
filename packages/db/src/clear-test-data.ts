import 'dotenv/config';
import { createDbPool } from './client.js';

// Clears everything transactional (test entries) so real data can be loaded,
// and keeps everything that configures the portal.
//
//   npm run db:clear-test-data                          shows what would be removed (writes nothing)
//   npm run db:clear-test-data -- --apply --confirm <db>  removes it
//   add --technicians to also remove the technician master (the import recreates it)

const TRANSACTIONAL = [
  'complaint_status_history',
  'appointment_status_history',
  'service_job_card_status_history',
  'job_card_attachments',
  'service_job_cards',
  'appointments',
  'complaints',
  'quotations',
  'inspections',
  'warranty_approvals',
  'draft_schedule_items',
  'draft_schedules',
  'customers',
  'branches',
  'amc_contracts',
  'vas_sales',
  'rate_card_sales',
  'thomson_sales',
  'audit_events',
  'reference_counters',
  'legacy_references',
  'import_batches',
];
const TECHNICIAN_TABLES = ['technician_availability', 'technicians'];
const KEPT = [
  'profiles, roles, permissions, local logins',
  'B2B branch master, salesmen, sales channels',
  'pricing configs, billing rules, stock master',
  'budget versions, revenue workbook lines and settings',
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const withTechnicians = process.argv.includes('--technicians');
  const pool = createDbPool();
  const client = await pool.connect();
  try {
    const dbName = (await client.query<{ n: string }>('SELECT current_database() AS n')).rows[0].n;
    const present = new Set(
      (
        await client.query<{ t: string }>(
          `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public'`,
        )
      ).rows.map((r) => r.t),
    );
    const targets = [...TRANSACTIONAL, ...(withTechnicians ? TECHNICIAN_TABLES : [])].filter((t) =>
      present.has(t),
    );
    console.log(`Database: ${dbName}`);
    const counts: Record<string, number> = {};
    for (const t of targets)
      counts[t] = Number(
        (await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${t}"`)).rows[0].n,
      );
    console.table(counts);
    console.log(`Kept: ${KEPT.join('; ')}${withTechnicians ? '' : '; technicians'}.`);
    console.log(
      'Note: uploaded job-card photos on disk (storage/attachments) are not removed by this tool.',
    );
    if (!apply) {
      console.log(
        '\nDRY RUN: nothing was removed. Add --apply --confirm <database name> to remove the rows above.',
      );
      return;
    }
    if (arg('confirm') !== dbName)
      throw new Error(
        `Refusing to clear: pass --confirm ${dbName} to confirm this is the database you mean.`,
      );
    await client.query('BEGIN');
    await client.query(
      `TRUNCATE TABLE ${targets.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );
    await client.query('COMMIT');
    console.log('\nTest data cleared.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`\nClear failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
