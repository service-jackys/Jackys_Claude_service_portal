// One-off / re-runnable import for the B2B Branch / School master list.
// Reads a seed JSON (built once per sales channel from the last ~365 days
// of that channel's sales invoice data -- Cust_Code, Customer, Salesman,
// Inv/Del No -- see modification.md #1 and #17) and upserts each row into
// the b2b_branches table added by migration 010 (sales_channel added by
// migration 013). Safe to re-run: it's an upsert keyed on cust_code -- a
// branch that appears in more than one channel's data ends up tagged with
// whichever import ran most recently.
//
// Run with: node scripts/import-b2b-branches.mjs [seedFile] [salesChannel]
//   node scripts/import-b2b-branches.mjs                                   -- b2b_branches.json, JER-C/INS
//   node scripts/import-b2b-branches.mjs b2b_branches_jdi.json JDI         -- the JDI batch
// (after `npm run db:migrate` has applied the relevant migration)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const envPath = path.join(root, '.env');
const env = fs.readFileSync(envPath, 'utf8');
const dbUrl = env
  .split('\n')
  .find((line) => line.startsWith('DATABASE_URL='))
  ?.slice('DATABASE_URL='.length)
  .trim();
if (!dbUrl) {
  console.error('DATABASE_URL not found in .env');
  process.exit(1);
}

const seedFileName = process.argv[2] || 'b2b_branches.json';
const salesChannel = process.argv[3] || 'JER-C/INS';

const seedPath = path.join(root, 'packages', 'db', 'seed', seedFileName);
const rows = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

const pool = new pg.Pool({ connectionString: dbUrl });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    const result = await client.query(
      `INSERT INTO b2b_branches (cust_code, branch_name, salesman, sales_channel, last_sales_order_number, last_invoice_date)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (cust_code) DO UPDATE SET
         branch_name = EXCLUDED.branch_name,
         salesman = EXCLUDED.salesman,
         sales_channel = EXCLUDED.sales_channel,
         last_sales_order_number = EXCLUDED.last_sales_order_number,
         last_invoice_date = EXCLUDED.last_invoice_date,
         updated_at = now()
       RETURNING (xmax = 0) AS inserted`,
      [
        row.custCode,
        row.branchName,
        row.salesman ?? null,
        salesChannel,
        row.lastSalesOrderNumber ?? null,
        row.lastInvoiceDate ?? null,
      ],
    );
    if (result.rows[0]?.inserted) inserted += 1;
    else updated += 1;
  }
  await client.query('COMMIT');
  console.log(
    `B2B branch master (${salesChannel}): ${inserted} inserted, ${updated} updated, ${rows.length} total.`,
  );
} catch (error) {
  await client.query('ROLLBACK');
  console.error('Import failed, rolled back:', error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
