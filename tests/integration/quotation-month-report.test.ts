import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createQuotationService } from '../../apps/api/src/quotations/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'Quotations: month filter, month list and the management Excel report',
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
    const tag = randomUUID().slice(0, 8);
    const service = createQuotationService(pool);
    const ids: string[] = [];
    try {
      const profileId = (
        await pool.query<{ id: string }>(
          `INSERT INTO profiles (email, display_name) VALUES ($1, 'Quotation report') RETURNING id`,
          [`qr-${tag}@example.test`],
        )
      ).rows[0]!.id;
      const make = async (date: string, status: string, erp: string, price: number) => {
        const created = await service.create(
          {
            customerName: `QR ${tag}`,
            quotationDate: date,
            quotationStatus: status,
            erpStatus: erp,
            erpInvoiceNo: erp === 'Invoiced' ? `ORN-${tag}` : undefined,
            products: [
              {
                unitKey: 'u1',
                partNo: '',
                description: 'Washer',
                brand: 'LG',
                serialNo: '',
                warranty: 'No',
                location: '',
                complaint: '',
                diagnosis: '',
              },
            ],
            parts: [
              {
                unitKey: 'u1',
                type: 'Part',
                partNo: '',
                description: 'P',
                qty: 1,
                unitPrice: price,
              },
            ],
            vatRate: 0.05,
          },
          profileId,
          `qr-${randomUUID()}`,
        );
        ids.push(created.id);
        return created;
      };
      await make('2031-05-03', 'Pending', 'Pending invoice', 100);
      await make('2031-05-20', 'Approved', 'Invoiced', 200);
      await make('2031-06-09', 'Approved', 'Pending invoice', 400);

      // Month filter on the list.
      const may = await service.list({ search: tag, month: '2031-05', pageSize: '50' });
      assert.equal(may.total, 2);
      assert.equal(may.totalSubtotal, 300);
      const june = await service.list({ search: tag, month: '2031-06', pageSize: '50' });
      assert.equal(june.total, 1);
      assert.equal((await service.list({ search: tag, pageSize: '50' })).total, 3);
      await assert.rejects(() => service.list({ month: '2031-13' }), { name: 'ZodError' });

      // Month list: newest first, with counts.
      const months = await service.months();
      const m = (k: string) => months.find((x) => x.month === k)?.count ?? 0;
      assert.ok(m('2031-05') >= 2 && m('2031-06') >= 1);
      assert.ok(
        months.findIndex((x) => x.month === '2031-06') <
          months.findIndex((x) => x.month === '2031-05'),
      );

      // Report: one month, then everything for this search.
      const read = async (query: Record<string, unknown>) => {
        const report = await service.exportReport(query);
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(report.buffer as unknown as ArrayBuffer);
        return { report, book };
      };
      const { report, book } = await read({ search: tag, month: '2031-05' });
      assert.equal(report.fileName, 'quotations-report-2031-05.xlsx');
      assert.equal(report.rows, 2);
      assert.deepEqual(
        book.worksheets.map((w) => w.name),
        ['Summary', 'Quotations'],
      );
      const sheet = book.getWorksheet('Quotations')!;
      const headers = (sheet.getRow(1).values as unknown[]).slice(1);
      assert.ok(!headers.includes('Job cards') && !headers.includes('Customer approval'));
      assert.ok(headers.includes('ORION Ref'));
      const col = (name: string) => headers.indexOf(name) + 1;
      // Header + 2 quotations + total row.
      assert.equal(sheet.rowCount, 4);
      const invoiced = [2, 3]
        .map((r) => sheet.getRow(r))
        .find((r) => r.getCell(col('ORION Ref')).value);
      assert.equal(invoiced!.getCell(col('ORION Ref')).value, `ORN-${tag}`);
      // The total row is a SUBTOTAL formula, so it follows an Excel filter.
      const total = sheet.getRow(4).getCell(col('Subtotal (AED)')).value as {
        formula: string;
        result: number;
      };
      assert.match(total.formula, /^SUBTOTAL\(109,/);
      assert.equal(total.result, 300);

      const all = await read({ search: tag });
      assert.equal(all.report.fileName, 'quotations-report-all-months.xlsx');
      assert.equal(all.report.rows, 3);
      await assert.rejects(() => service.exportReport({ month: 'May' }), { name: 'ZodError' });
    } finally {
      if (ids.length)
        await pool.query(`DELETE FROM quotations WHERE id = ANY($1::bigint[])`, [ids]);
      await pool.query(`DELETE FROM profiles WHERE email = $1`, [`qr-${tag}@example.test`]);
      await pool.end();
    }
  },
);
