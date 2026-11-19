import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createDbPool } from '../../packages/db/src/client.js';
import { applyPlan } from '../../packages/db/src/legacy-import/apply.js';
import { buildPlan } from '../../packages/db/src/legacy-import/plan.js';
import { applySync, parseDecisions } from '../../packages/db/src/legacy-import/sync.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

const aptHeader = [
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
];
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

async function workbook(dir: string, name: string, version: 'old' | 'new'): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Technicians').addRows([
    ['Name', 'Region', 'Phone', 'Email', 'Working Hours Start', 'Working Hours End', 'Active'],
    ['Sync Siva', 'Dubai', '552513848', null, '08:30', '17:30', 'Yes'],
  ]);
  const apt = (n: string, status: string, fault: string) => {
    const c: unknown[] = new Array(25).fill(null);
    c[0] = new Date(Date.UTC(2097, 0, 5, 9));
    Object.assign(c, {
      1: n,
      2: 'B2C',
      3: 'Sync Customer',
      4: '551085135',
      6: 'Addr',
      7: 'Dubai',
      8: 'Venus',
      9: 'M1',
      10: fault,
      11: 'In Warranty',
      14: 'Sync Siva',
      16: status,
    });
    c[12] = new Date(Date.UTC(2097, 0, 6));
    return c;
  };
  const aptRows = [
    aptHeader,
    apt(
      'APT-2097-00001',
      version === 'old' ? 'Scheduled' : 'Completed',
      version === 'old' ? 'Not cooling' : 'Not cooling - fixed',
    ),
    apt('APT-2097-00002', 'Scheduled', 'Leak'),
  ];
  if (version === 'new') aptRows.push(apt('APT-2097-00003', 'Scheduled', 'Brand new request'));
  wb.addWorksheet('Schedules').addRows(aptRows);
  const jc = (n: string, ref: string, final: string, rendered: string, service: number) => {
    const c: unknown[] = new Array(30).fill(null);
    c[0] = new Date(Date.UTC(2097, 0, 8, 9));
    Object.assign(c, {
      1: n,
      4: ref,
      5: 'Sync Customer',
      6: '551085135',
      10: 'In Warranty',
      12: rendered,
      17: 0,
      18: service,
      19: service,
      23: 'SYNC SIVA',
      25: final,
    });
    c[2] = new Date(Date.UTC(2097, 0, 8));
    c[26] = JSON.stringify({ parts: [], attachments: [] });
    return c;
  };
  const jcRows = [
    jcHeader,
    jc(
      'JC-801',
      'APT-2097-00001',
      version === 'old' ? 'WIP' : 'Repair Completed',
      version === 'old' ? '' : 'Replaced fan',
      0,
    ),
    jc(
      'JC-802',
      'APT-2097-00002',
      version === 'old' ? 'WIP' : 'Repair Completed',
      version === 'old' ? '' : 'Replaced PCB',
      0,
    ),
  ];
  if (version === 'new') jcRows.push(jc('JC-803', 'APT-2097-00003', 'WIP', '', 0));
  wb.addWorksheet('ServiceJobCards').addRows(jcRows);
  const file = join(dir, name);
  await wb.xlsx.writeFile(file);
  return file;
}

test('sync decisions are read from the reviewed file and bad rows are refused', () => {
  const ok = parseDecisions(
    'Record,Reference,Group,Field,Old sheet says,Portal says\nAppointment,APT-1,take the sheet,status,Completed,Scheduled\nJob card,JBC-1,keep the portal,jobStatus,WIP,BER\n',
  );
  assert.deepEqual(
    ok.map((d) => [d.record, d.reference, d.field, d.take]),
    [
      ['Appointment', 'APT-1', 'status', true],
      ['Job card', 'JBC-1', 'jobStatus', false],
    ],
  );
  assert.throws(
    () => parseDecisions('Record,Reference,Group,Field\nJob card,X,maybe,jobStatus\n'),
    /take the sheet/,
  );
  assert.throws(
    () => parseDecisions('Record,Reference,Group,Field\nJob card,X,take the sheet,colour\n'),
    /unknown field/,
  );
  assert.throws(
    () =>
      parseDecisions(
        'Record,Reference,Group,Field\nJob card,X,take the sheet,parts\nJob card,X,take the sheet,parts\n',
      ),
    /twice/,
  );
});

test(
  'sync adds new records and changes only the fields marked take the sheet',
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
    const dir = await mkdtemp(join(tmpdir(), 'sync-'));
    const pool = createDbPool();
    const client = await pool.connect();
    try {
      const oldPlan = await buildPlan(await workbook(dir, 'old.xlsx', 'old'));
      const newPlan = await buildPlan(await workbook(dir, 'new.xlsx', 'new'));
      const admin = await client.query<{ id: string }>(
        `SELECT id::text FROM profiles ORDER BY id LIMIT 1`,
      );
      const options = { profileId: admin.rows[0].id, sourceFile: 'sync-test' };
      await client.query('BEGIN');
      try {
        await applyPlan(client, oldPlan, options);
        // Work done in the portal after the first import: delivered, charged, invoiced.
        await client.query(
          `UPDATE service_job_cards SET service_charge = 60, grand_total = 60, delivery_date = '2097-01-09',
                  final_status = 'Delivered', final_status_at = now() WHERE legacy_reference = 'JC-802'`,
        );
        const refs = await client.query<{ legacy_reference: string; job_card_reference: string }>(
          `SELECT legacy_reference, job_card_reference FROM service_job_cards WHERE legacy_reference IN ('JC-801','JC-802')`,
        );
        const ref = (l: string) =>
          refs.rows.find((r) => r.legacy_reference === l)!.job_card_reference;
        const decisions = parseDecisions(
          [
            'Record,Reference,Group,Field',
            'Appointment,APT-2097-00001,take the sheet,status',
            'Appointment,APT-2097-00001,keep the portal,fault',
            `Job card,${ref('JC-801')},take the sheet,jobStatus`,
            `Job card,${ref('JC-801')},take the sheet,serviceRendered`,
            `Job card,${ref('JC-802')},keep the portal,jobStatus`,
          ].join('\n'),
        );
        const result = await applySync(client, newPlan, decisions, options);
        assert.equal(result.created.appointments, 1, 'only the new appointment is added');
        assert.equal(result.created.jobCards, 1, 'only the new job card is added');
        assert.equal(result.recordsUpdated.appointments, 1);
        assert.equal(result.recordsUpdated.jobCards, 1);

        const apt = await client.query(
          `SELECT status, fault_description FROM appointments WHERE appointment_reference = 'APT-2097-00001'`,
        );
        assert.equal(apt.rows[0].status, 'Completed', 'take the sheet is applied');
        assert.equal(apt.rows[0].fault_description, 'Not cooling', 'keep the portal is left alone');
        const history = await client.query(
          `SELECT h.to_status FROM appointment_status_history h JOIN appointments a ON a.id = h.appointment_id
            WHERE a.appointment_reference = 'APT-2097-00001' ORDER BY h.id`,
        );
        assert.deepEqual(
          history.rows.map((r) => r.to_status),
          ['Scheduled', 'Completed'],
        );

        const j1 = await client.query(
          `SELECT status, job_final_status, service_rendered, finalized_at IS NOT NULL AS finalized
             FROM service_job_cards WHERE legacy_reference = 'JC-801'`,
        );
        assert.deepEqual(j1.rows[0], {
          status: 'Completed',
          job_final_status: 'Repair Completed',
          service_rendered: 'Replaced fan',
          finalized: true,
        });
        const j2 = await client.query(
          `SELECT job_final_status, service_charge::text, delivery_date::text, final_status
             FROM service_job_cards WHERE legacy_reference = 'JC-802'`,
        );
        assert.equal(j2.rows[0].job_final_status, 'WIP', 'keep the portal');
        assert.equal(j2.rows[0].service_charge, '60', 'portal charge untouched');
        assert.equal(j2.rows[0].delivery_date, '2097-01-09', 'portal delivery date untouched');
        assert.equal(j2.rows[0].final_status, 'Delivered', 'Delivered untouched');

        // A second run changes nothing.
        const again = await applySync(client, newPlan, decisions, options);
        assert.equal(again.created.jobCards ?? 0, 0);
        assert.equal(again.changes.length, 0);
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
