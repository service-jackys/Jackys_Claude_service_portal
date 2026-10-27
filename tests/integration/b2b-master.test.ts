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

test('B2B customer master: the parser reads Cust Code, Customer, Salesman and ignores other columns', async () => {
  const own = await parseB2bWorkbook(
    await book(['Cust Code', 'Customer', 'Salesman'], [['C1', 'School One', 'Ann']]),
  );
  assert.deepEqual(own.customers.get('C1'), {
    custCode: 'C1',
    customerName: 'School One',
    salesman: 'Ann',
  });

  // An ERP invoice report: other columns are ignored, the first row per customer is used.
  const erp = await parseB2bWorkbook(
    await book(
      ['Cust_Code', 'Customer', 'Salesman', 'Inv/Del No', 'Invoice Date', 'Sales Channel'],
      [
        ['C2', 'School Two', 'Bob', 'INV-1', '05/09/2026', 'JDI'],
        ['C2', 'School Two', 'Carl', 'INV-3', '20/10/2026', 'JDI'],
        ['c2', 'School Two', 'Bob', 'INV-2', '01/10/2026', 'JDI'],
      ],
    ),
  );
  assert.equal(erp.customers.size, 1);
  assert.equal(erp.customers.get('C2')!.salesman, 'Bob');
  assert.ok(erp.warnings.some((w) => w.includes('Carl')));

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
    const headers = ['Cust Code', 'Customer', 'Salesman'];
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
            [codeA, `Alpha School ${tag}`, known],
            [codeB, `Beta School ${tag}`, unknown],
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

      // Second upload: new name for A; a blank salesman keeps the stored one.
      const second = await service.upload(
        {
          originalname: 'customers2.xlsx',
          size: 1,
          buffer: await book(headers, [[codeA, `Alpha School Renamed ${tag}`, null]]),
        },
        profileId,
      );
      uploadIds.push(second.id);
      assert.equal(second.newCustomers, 0);
      assert.equal(second.changedCustomers, 1);
      const stored = await pool.query(
        `SELECT branch_name, salesman FROM b2b_branches WHERE cust_code = $1`,
        [codeA],
      );
      assert.equal(stored.rows[0].branch_name, `Alpha School Renamed ${tag}`);
      assert.equal(stored.rows[0].salesman, known);

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
