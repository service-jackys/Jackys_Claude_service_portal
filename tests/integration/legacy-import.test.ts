import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createDbPool } from '../../packages/db/src/client.js';
import { applyPlan, verifyParity } from '../../packages/db/src/legacy-import/apply.js';
import { buildPlan } from '../../packages/db/src/legacy-import/plan.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

async function sampleWorkbook(dir: string): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Technicians').addRows([
    ['Name', 'Region', 'Phone', 'Email', 'Working Hours Start', 'Working Hours End', 'Active'],
    ['Imp Siva', 'Dubai', '552513848', null, '08:30', '17:30', 'Yes'],
  ]);
  wb.addWorksheet('Schedules').addRows([
    [
      'Timestamp',
      'Appointment No',
      'Customer Type',
      'Customer Name',
      'Contact No',
      'Customer Email',
      'Location / Address',
      'Region',
      'Brand',
      'Model',
      'Fault Description',
      'Job Warranty',
      'Appointment Date',
      'Appointment Time',
      'Assigned Technician',
      'Sales Order No',
      'Status',
      'Item Code',
      'Sub Group',
      'School Contact Person',
      'School Contact Number',
      'Customer Number',
      'B2B Branch / School',
      'Closed Timestamp',
      'Complaint No',
    ],
    [
      new Date(Date.UTC(2099, 0, 5, 9)),
      'APT-2099-00001',
      'B2C',
      'Test One',
      '551085135',
      null,
      'Addr',
      'Dubai',
      'Venus',
      'M1',
      'Not cooling',
      'In Warranty',
      new Date(Date.UTC(2099, 0, 6)),
      null,
      'IMP SIVA',
      null,
      'Completed',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ],
    [
      new Date(Date.UTC(2099, 0, 5, 9)),
      'APT-2099-00002',
      'B2B',
      'Test Two',
      '0504901232',
      null,
      'Addr',
      'Sharjah',
      'DEFAULT',
      'M2',
      'Leak',
      'Out Warranty',
      new Date(Date.UTC(2099, 0, 7)),
      null,
      'Imp Siva',
      null,
      'Scheduled',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ],
  ]);
  const jcHeader = [
    'Timestamp',
    'Number',
    'Job Card Date',
    'Source Type',
    'Source Ref No',
    'Customer Name',
    'Contact No',
    'Address',
    'Item Description',
    'Model No',
    'Warranty Status',
    'Complaint',
    'Service Rendered',
    'Period From',
    'Period To',
    'Time Consumed (Hr)',
    'Parts Used',
    'Total Cost (AED)',
    'Service Charge (AED)',
    'Grand Total (AED)',
    'Amount Chargeable (AED)',
    'Invoice No',
    'Delivery Date',
    'Technician Name',
    'Brand',
    'Job Final Status',
    'School Contact Person',
    'School Contact Number',
    'Customer Number',
    'DataJSON',
  ];
  const json = (extra: object) =>
    JSON.stringify({
      parts: [{ partNo: 'P1', description: 'Fan', qty: 2, unitPrice: 10, total: 20 }],
      attachments: [],
      ...extra,
    });
  const row = (
    n: string,
    ref: string | null,
    final: string,
    delivered: Date | null,
    service: number,
    invoice: string | null,
    inJsonColumn: boolean,
  ) => {
    const cells: unknown[] = new Array(30).fill(null);
    cells[0] = new Date(Date.UTC(2099, 0, 8, 9));
    cells[1] = n;
    cells[2] = new Date(Date.UTC(2099, 0, 8));
    cells[4] = ref;
    cells[5] = 'Test One';
    cells[6] = '551085135';
    cells[10] = 'Under Warranty';
    cells[17] = 0;
    cells[18] = service;
    cells[19] = service;
    cells[21] = invoice;
    cells[22] = delivered;
    cells[23] = 'SIVA';
    cells[25] = final;
    // One row has its JSON slipped into the School Contact Person column.
    cells[inJsonColumn ? 29 : 26] = json({});
    return cells;
  };
  wb.addWorksheet('ServiceJobCards').addRows([
    jcHeader,
    row(
      'JC-901',
      'APT-2099-00001',
      'Repair Completed',
      new Date(Date.UTC(2099, 0, 9)),
      150,
      'INV-0001',
      true,
    ),
    row('JC-902', 'APT-2099-00001', 'WIP', null, 0, 'NA', false),
    row('JC-903', null, 'Spare pending', null, 0, null, true),
  ]);
  return (async () => {
    const file = join(dir, 'sample.xlsx');
    await wb.xlsx.writeFile(file);
    return file;
  })();
}

test(
  'Google Sheet import plans, applies once, and reconciles',
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
    const dir = await mkdtemp(join(tmpdir(), 'import-'));
    const pool = createDbPool();
    const client = await pool.connect();
    try {
      const file = await sampleWorkbook(dir);
      const plan = await buildPlan(file);
      assert.equal(plan.appointments.length, 2);
      assert.equal(plan.jobCards.length, 3);
      assert.equal(plan.issues.filter((i) => i.level === 'error').length, 0);
      // The second job card for the same appointment is flagged and unlinked.
      const dup = plan.jobCards.find((j) => j.legacyRef === 'JC-902');
      assert.equal(dup?.appointmentRef, null);
      assert.equal(dup?.duplicateOf, 'JC-901');
      // Junk invoice text is dropped, real invoice kept.
      assert.equal(plan.jobCards.find((j) => j.legacyRef === 'JC-902')?.invoiceNo, null);
      assert.equal(plan.jobCards.find((j) => j.legacyRef === 'JC-901')?.invoiceNo, 'INV-0001');
      // Delivered because a delivery date exists on a finished job.
      assert.equal(
        plan.jobCards.find((j) => j.legacyRef === 'JC-901')?.jobFinalStatus,
        'Delivered',
      );
      // Brand placeholder blanked, technician casing unified.
      assert.equal(plan.appointments[1].brand, null);
      assert.equal(plan.appointments[0].technicianName, 'Imp Siva');
      // The skip mode leaves the duplicate out.
      const skipPlan = await buildPlan(file, { duplicateJobCards: 'skip' });
      assert.equal(skipPlan.jobCards.length, 2);

      const admin = await client.query<{ id: string }>(
        `SELECT id::text FROM profiles ORDER BY id LIMIT 1`,
      );
      await client.query('BEGIN');
      try {
        const first = await applyPlan(client, plan, {
          profileId: admin.rows[0].id,
          sourceFile: file,
        });
        assert.equal(first.created.appointments, 2);
        assert.equal(first.created.jobCards, 3);
        const parity = await verifyParity(client, plan);
        assert.ok(
          parity.every((p) => p.ok),
          JSON.stringify(parity),
        );

        const second = await applyPlan(client, plan, {
          profileId: admin.rows[0].id,
          sourceFile: file,
        });
        assert.equal(second.created.jobCards ?? 0, 0, 're-running creates nothing');
        assert.equal(second.skippedExisting.jobCards, 3);

        const cards = await client.query(
          `SELECT legacy_reference, source_type, status, job_final_status, appointment_id IS NOT NULL AS linked
         FROM service_job_cards WHERE legacy_reference LIKE 'JC-9%' ORDER BY legacy_reference`,
        );
        assert.deepEqual(
          cards.rows.map((r) => [
            r.legacy_reference,
            r.source_type,
            r.status,
            r.job_final_status,
            r.linked,
          ]),
          [
            ['JC-901', 'Scheduler', 'Completed', 'Delivered', true],
            ['JC-902', 'Walk-in', 'Open', 'WIP', false],
            ['JC-903', 'Walk-in', 'Open', 'Spare pending', false],
          ],
        );
        // New appointments continue after the imported APT numbers.
        const counter = await client.query(
          `SELECT next_value::int AS n FROM reference_counters WHERE namespace = 'appointment' AND scope_date = '2099-01-01'`,
        );
        assert.equal(counter.rows[0].n, 3);
      } finally {
        await client.query('ROLLBACK');
      }
    } finally {
      client.release();
      await pool.end();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
