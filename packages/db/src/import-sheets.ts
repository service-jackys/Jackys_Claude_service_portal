import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createDbPool } from './client.js';
import { applyPlan, verifyParity } from './legacy-import/apply.js';
import {
  SOURCE_NAME,
  buildPlan,
  summarisePlan,
  type Issue,
  type Plan,
} from './legacy-import/plan.js';

// Google Sheet -> portal import.
//
//   npm run import:sheets -- --file <export.xlsx>                       dry run (default, writes nothing)
//   npm run import:sheets -- --file <export.xlsx> --apply --confirm <db> --as <admin email>
//   npm run import:sheets -- --file <export.xlsx> --verify              compare the database with the file
//
// Real customer data must only be loaded into staging or production, never a
// developer database. --apply therefore needs --confirm <database name> to
// match the DATABASE_URL it is about to write to.

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function csvCell(v: unknown) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function writeReports(dir: string, plan: Plan, extra: Record<string, unknown>) {
  await mkdir(dir, { recursive: true });
  const issueRows = [
    ['level', 'sheet', 'row', 'reference', 'message'],
    ...plan.issues.map((i: Issue) => [i.level, i.sheet, i.row, i.reference, i.message]),
  ];
  await writeFile(
    join(dir, 'import-issues.csv'),
    issueRows.map((r) => r.map(csvCell).join(',')).join('\n'),
  );
  await writeFile(
    join(dir, 'import-summary.json'),
    JSON.stringify(
      {
        source: SOURCE_NAME,
        generatedAt: new Date().toISOString(),
        summary: summarisePlan(plan),
        skippedSheets: plan.skipped,
        ...extra,
      },
      null,
      2,
    ),
  );
}

function print(plan: Plan) {
  const s = summarisePlan(plan);
  console.log('\nRecords in the plan');
  console.table({
    Technicians: s.technicians,
    Appointments: s.appointments,
    'Job cards': s.jobCards,
    Quotations: s.quotations,
    Inspections: s.inspections,
    'Thomson proposals': s.thomson,
  });
  console.log(`Issues: ${s.errors} error(s), ${s.warnings} warning(s), ${s.info} note(s)`);
  const grouped = new Map<string, number>();
  for (const i of plan.issues) {
    const key = `${i.level.toUpperCase().padEnd(5)} ${i.sheet}: ${i.message.replace(/"[^"]*"/g, '"…"').replace(/\b\d[\d.-]*\b/g, 'N')}`;
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  for (const [k, n] of [...grouped].sort()) console.log(`  ${String(n).padStart(4)} x ${k}`);
  console.log('\nSheets not imported');
  for (const k of plan.skipped) console.log(`  ${k.sheet} (${k.rows} rows): ${k.reason}`);
}

async function main() {
  const file = arg('file');
  if (!file) throw new Error('Pass the exported workbook with --file <path to .xlsx>.');
  const duplicates = (arg('duplicates') ?? 'walk-in') as 'walk-in' | 'skip';
  if (!['walk-in', 'skip'].includes(duplicates))
    throw new Error('--duplicates must be walk-in or skip.');
  const plan = await buildPlan(resolve(file), { duplicateJobCards: duplicates });
  const out = resolve(arg('out') ?? 'exports/import-report');
  const apply = flag('apply');
  const verify = flag('verify');

  print(plan);
  const errors = plan.issues.filter((i) => i.level === 'error');

  if (!apply && !verify) {
    await writeReports(out, plan, { mode: 'dry-run' });
    console.log(`\nDRY RUN: nothing was written to the database. Reports saved in ${out}`);
    process.exitCode = errors.length ? 1 : 0;
    return;
  }

  const pool = createDbPool();
  const client = await pool.connect();
  try {
    const dbName = (await client.query<{ n: string }>('SELECT current_database() AS n')).rows[0].n;
    if (verify) {
      const checks = await verifyParity(client, plan);
      console.log(`\nParity check against database "${dbName}"`);
      console.table(
        checks.map((c) => ({
          Check: c.name,
          Sheet: c.plan,
          Database: c.db,
          Result: c.ok ? 'OK' : 'MISMATCH',
        })),
      );
      await writeReports(out, plan, { mode: 'verify', database: dbName, parity: checks });
      process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
      return;
    }

    if (arg('confirm') !== dbName) {
      throw new Error(
        `Refusing to write: pass --confirm ${dbName} to confirm this is the database you mean to load.`,
      );
    }
    if (errors.length)
      throw new Error(
        `${errors.length} blocking error(s) in the plan. Fix them or the sheet first.`,
      );
    const email = arg('as');
    if (!email)
      throw new Error('Pass --as <email of the admin user the import is recorded under>.');
    const profile = await client.query<{ id: string }>(
      'SELECT id::text FROM profiles WHERE lower(email) = lower($1)',
      [email],
    );
    if (!profile.rows[0]) throw new Error(`No portal user with email ${email}.`);

    await client.query('BEGIN');
    try {
      const result = await applyPlan(client, plan, {
        profileId: profile.rows[0].id,
        sourceFile: file,
      });
      const checks = await verifyParity(client, plan);
      if (!checks.every((c) => c.ok)) {
        console.table(checks);
        throw new Error('Parity check failed after import; rolled back.');
      }
      await client.query('COMMIT');
      console.log(`\nIMPORTED into "${dbName}" (batch ${result.batchId})`);
      console.table({ created: result.created, 'already imported': result.skippedExisting });
      console.table(
        checks.map((c) => ({ Check: c.name, Sheet: c.plan, Database: c.db, Result: 'OK' })),
      );
      await writeReports(out, plan, {
        mode: 'apply',
        database: dbName,
        batchId: result.batchId,
        created: result.created,
        parity: checks,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`\nImport failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
