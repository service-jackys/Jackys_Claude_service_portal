import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createStockMasterService } from '../../apps/api/src/stock-master/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'Brand supplier template lists MDA and SDA brands only, with own brands marked',
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
    const tag = randomUUID().slice(0, 6).toUpperCase();
    const codes: string[] = [];
    const add = async (group: string, grp: string, sub: string, brand: string | null) => {
      const code = `BST-${tag}-${codes.length}`;
      codes.push(code);
      await pool.query(
        `INSERT INTO stock_master (item_code, item_desc, main_group, group_name, sub_group, brand)
         VALUES ($1, 'Test', $2, $3, $4, $5)`,
        [code, group, grp, sub, brand],
      );
    };
    try {
      const profileId = (
        await pool.query<{ id: string }>(
          `INSERT INTO profiles (email, display_name) VALUES ($1, 'Template') RETURNING id`,
          [`bst-${tag}@example.test`],
        )
      ).rows[0]!.id;
      await add('MDA', 'REFRIGERATORS', 'TOP FREEZER', `NIKAI${tag}`);
      await add('MDA', 'REFRIGERATORS', 'TOP FREEZER', `NIKAI${tag}`);
      await add('SDA', 'KETTLES', 'ELECTRIC KETTLE', `NIKAI${tag}`);
      await add('MDA', 'WASHERS', 'FRONT LOAD', 'VENUS');
      await add('IT', 'PHONES', 'MOBILE', `APPLE${tag}`); // not MDA / SDA
      await add('MDA', 'WASHERS', 'FRONT LOAD', null); // no brand
      const service = createStockMasterService(pool);
      const file = await service.supplierTemplate(profileId);
      assert.match(file.fileName, /^Brand_supplier_details_template_\d{4}-\d{2}-\d{2}\.xlsx$/);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(file.buffer as unknown as ArrayBuffer);
      assert.deepEqual(
        book.worksheets.map((w) => w.name),
        ['Brand details', 'Products by brand'],
      );
      const sheet = book.getWorksheet('Brand details')!;
      const rows: Record<string, ExcelJS.Row> = {};
      sheet.eachRow((row, n) => {
        if (n >= 3) rows[String(row.getCell(1).value ?? '')] = row;
      });
      const nikai = rows[`NIKAI${tag}`]!;
      assert.equal(nikai.getCell(2).value, 'MDA + SDA');
      assert.equal(nikai.getCell(4).value, 3);
      assert.equal(nikai.getCell(5).value, 'Supplier brand');
      assert.equal(rows['VENUS']!.getCell(5).value, 'Own brand');
      assert.equal(rows[`APPLE${tag}`], undefined, 'non MDA / SDA brand is left out');
      const refSheet = book.getWorksheet('Products by brand')!;
      let apple = 0;
      refSheet.eachRow((r) => {
        if (String(r.getCell(1).value) === `APPLE${tag}`) apple += 1;
      });
      assert.equal(apple, 0);
    } finally {
      await pool.query(`DELETE FROM stock_master WHERE item_code = ANY($1::text[])`, [codes]);
      await pool.query(`DELETE FROM profiles WHERE email = $1`, [`bst-${tag}@example.test`]);
      await pool.end();
    }
  },
);
