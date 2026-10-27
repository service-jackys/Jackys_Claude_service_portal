import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { parseB2bWorkbook } from '../../apps/api/src/b2b-master/parser.js';
import {
  B2bMasterServiceError,
  createB2bMasterService,
} from '../../apps/api/src/b2b-master/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';
import { searchB2bBranchesForStaff } from '../../packages/db/src/b2b-branches.js';

const databaseUrl = process.env.DATABASE_URL;

async function book(headers: string[], rows: unknown[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Customers');
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test('B2B customer master: the parser reads the portal file and an ERP invoice report', async () => {
  const own = await parseB2bWorkbook(
    await book(
      [
        'Cust Code',
        'Customer',
        'Salesman',
        'Sales Channel',
        'Last Sales Order No',
        'Last Invoice Date',
      ],
      [['C1', 'School One', 'Ann', 'JDI', 'SO1', '2026-10-01']],
    ),
  );
  assert.equal(own.customers.get('C1')!.salesChannel, 'JDI');
  assert.equal(own.customers.get('C1')!.lastInvoiceDate, '2026-10-01');

  // ERP invoice report: several rows per customer, the latest invoice wins.
  const erp = await parseB2bWorkbook(
    await book(
      ['Cust_Code', 'Customer', 'Salesman', 'Inv/Del No', 'Invoice Date'],
      [
        ['C2', 'School Two', 'Bob', 'INV-1', '05/09/2026'],
        ['C2', 'School Two', 'Bob', 'INV-3', '20/10/2026'],
        ['c2', 'School Two', 'Bob', 'INV-2', '01/10/2026'],
      ],
    ),
  );
  assert.equal(erp.customers.size, 1);
  assert.equal(erp.customers.get('C2')!.lastSalesOrderNumber, 'INV-3');
  assert.equal(erp.customers.get('C2')!.lastInvoiceDate, '2026-10-20');

  await assert.rejects(
    parseB2bWorkbook(await book(['A', 'B'], [[1, 2]])),
    /Cust Code and Customer/,
  );
});

test(
  'B2B customer master: upload, report, blank keeps value, search by code, downloads',
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
    const tag = randomUUID().slice(0, 8).toUpperCase();
    const codeA = `ZA${tag}`;
    const codeB = `ZB${tag}`;
    const known = `Known ${tag}`;
    const unknown = `Nobody ${tag}`;
    const headers = [
      'Cust Code',
      'Customer',
      'Salesman',
      'Sales Channel',
      'Last Sales Order No',
      'Last Invoice Date',
    ];
    const uploadIds: string[] = [];
    try {
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'B2B master test') RETURNING id`,
        [`b2b-${randomUUID()}@example.test`],
      );
      const profileId = profile.rows[0]!.id;
      await pool.query(`INSERT INTO salesmen (name) VALUES ($1)`, [known]);
      const service = createB2bMasterService(pool);

      const first = await service.upload(
        {
          originalname: 'customers.xlsx',
          size: 1,
          buffer: await book(headers, [
            [codeA, `Alpha School ${tag}`, known, null, 'SO-1', '2026-10-01'],
            [codeB, `Beta School ${tag}`, unknown, null, null, null],
          ]),
        },
        profileId,
      );
      uploadIds.push(first.id);
      assert.equal(first.newCustomers, 2);
      assert.ok(
        first.report.warnings.some((w: string) => w.includes(unknown)),
        'unknown salesman is reported',
      );
      assert.ok(!first.report.warnings.some((w: string) => w.includes(known)));

      // Second upload: new name for A, blank salesman / order for A keeps the stored ones.
      const second = await service.upload(
        {
          originalname: 'customers2.xlsx',
          size: 1,
          buffer: await book(headers, [
            [codeA, `Alpha School Renamed ${tag}`, null, 'JDI', null, null],
          ]),
        },
        profileId,
      );
      uploadIds.push(second.id);
      assert.equal(second.newCustomers, 0);
      assert.equal(second.changedCustomers, 1);
      const stored = await pool.query(
        `SELECT branch_name, salesman, sales_channel, last_sales_order_number, to_char(last_invoice_date,'YYYY-MM-DD') AS d
           FROM b2b_branches WHERE cust_code = $1`,
        [codeA],
      );
      assert.equal(stored.rows[0].branch_name, `Alpha School Renamed ${tag}`);
      assert.equal(stored.rows[0].salesman, known);
      assert.equal(stored.rows[0].sales_channel, 'JDI');
      assert.equal(stored.rows[0].last_sales_order_number, 'SO-1');
      assert.equal(stored.rows[0].d, '2026-10-01');

      const status = await service.status();
      assert.ok(status.notInFileCount >= 1, 'customer B is not in the latest file');
      assert.equal(status.lastUpload!.fileName, 'customers2.xlsx');

      // The customer lookup finds a customer by its code as well as by name.
      const client = await pool.connect();
      try {
        const byCode = await searchB2bBranchesForStaff(client, codeA.toLowerCase());
        assert.equal(byCode[0]!.custCode, codeA);
        const byName = await searchB2bBranchesForStaff(client, `Beta School ${tag}`);
        assert.equal(byName[0]!.custCode, codeB);
      } finally {
        client.release();
      }

      // Downloads: current master rebuilt (all customers), or the last file as uploaded.
      const master = await service.download(profileId);
      assert.equal(master.source, 'rebuilt');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(master.buffer as unknown as ExcelJS.Buffer);
      const codes: string[] = [];
      wb.getWorksheet('B2B Customers')!.eachRow((row) => codes.push(String(row.getCell(1).value)));
      assert.ok(codes.includes(codeA) && codes.includes(codeB));
      assert.equal(codes[0], 'Cust Code');
      const original = await service.download(profileId, { original: true });
      assert.equal(original.source, 'original');
      assert.equal(original.fileName, 'customers2.xlsx');

      await assert.rejects(
        service.upload({ originalname: 'x.csv', size: 1, buffer: Buffer.from('a') }, profileId),
        (e: unknown) => e instanceof B2bMasterServiceError && e.code === 'invalid-file',
      );
    } finally {
      await pool.query(`DELETE FROM b2b_branches WHERE cust_code = ANY($1::text[])`, [
        [codeA, codeB],
      ]);
      await pool.query(`DELETE FROM b2b_uploads WHERE id = ANY($1::bigint[])`, [uploadIds]);
      await pool.query(`DELETE FROM salesmen WHERE name = $1`, [known]);
      await pool.end();
    }
  },
);
