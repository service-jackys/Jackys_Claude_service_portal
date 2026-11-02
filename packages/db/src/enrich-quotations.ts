import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createDbPool } from './client.js';
import { enrichQuotations } from './legacy-import/enrich-quotations.js';
import { buildPlan } from './legacy-import/plan.js';

// Brings already imported quotations into the new unit / charge / VAT format.
//
//   npm run db:enrich-quotations -- --file <export.xlsx>                       dry run (default)
//   npm run db:enrich-quotations -- --file <export.xlsx> --apply --confirm <db> --as <admin email>
//
// Quotations edited in the portal are skipped. Safe to run twice.

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function main() {
  const file = arg('file');
  if (!file) throw new Error('Pass the exported workbook with --file <path to .xlsx>.');
  const apply = process.argv.includes('--apply');
  const plan = await buildPlan(resolve(file), { duplicateJobCards: 'walk-in' });
  const pool = createDbPool();
  const client = await pool.connect();
  try {
    const dbName = (await client.query<{ n: string }>('SELECT current_database() AS n')).rows[0].n;
    let profileId: string | undefined;
    if (apply) {
      if (arg('confirm') !== dbName) {
        throw new Error(
          `Refusing to write: pass --confirm ${dbName} to confirm this is the database you mean to change.`,
        );
      }
      const email = arg('as');
      if (!email)
        throw new Error('Pass --as <email of the admin user the change is recorded under>.');
      const profile = await client.query<{ id: string }>(
        'SELECT id::text FROM profiles WHERE lower(email) = lower($1)',
        [email],
      );
      if (!profile.rows[0]) throw new Error(`No portal user with email ${email}.`);
      profileId = profile.rows[0].id;
    }

    await client.query('BEGIN');
    try {
      const rows = await enrichQuotations(client, plan, { apply, profileId });
      await client.query(apply ? 'COMMIT' : 'ROLLBACK');
      console.log(`\n${apply ? 'APPLIED to' : 'DRY RUN against'} database "${dbName}"`);
      console.table(
        rows.map((r) => ({
          Sheet: r.legacyRef,
          Portal: r.quotationReference,
          Result: r.status,
          'Total now': r.totalBefore ?? '',
          'Total after': r.totalAfter ?? '',
          'Sheet total': r.sheetTotal,
          Units: r.units,
          Charges: r.charges,
          Note: r.note,
        })),
      );
      const out = resolve(arg('out') ?? 'exports/enrich-report');
      await mkdir(out, { recursive: true });
      const header = [
        'sheet',
        'portal',
        'result',
        'total_now',
        'total_after',
        'sheet_total',
        'units',
        'charges',
        'note',
      ];
      const lines = rows.map((r) =>
        [
          r.legacyRef,
          r.quotationReference,
          r.status,
          r.totalBefore,
          r.totalAfter,
          r.sheetTotal,
          r.units,
          r.charges,
          r.note,
        ]
          .map(csvCell)
          .join(','),
      );
      await writeFile(join(out, 'enrich-quotations.csv'), [header.join(','), ...lines].join('\n'));
      console.log(`Report saved in ${out}`);
      if (!apply)
        console.log(
          'Nothing was written. Add --apply --confirm <db> --as <email> to make the change.',
        );
      process.exitCode = rows.some((r) => r.status === 'skipped-total-mismatch') ? 1 : 0;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`\nEnrich failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
