import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDandiPricingService } from '../../apps/api/src/dandi-jobs/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'Delivery note pricing from item codes: stock master, category mapping and the D+I pricing master',
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
    const codes = {
      fridge: `DIF-${tag}`,
      washer: `DIW-${tag}`,
      kettle: `DIK-${tag}`,
      iron: `DII-${tag}`,
    };
    const unmappedGroup = `TEST SMALL APPLIANCE ${tag}`;
    try {
      const items: [string, string, string][] = [
        [codes.fridge, 'FRIDGE', 'Test fridge'],
        [codes.washer, 'WASHING MACHINE', 'Test washer'],
        [codes.kettle, unmappedGroup, 'Test kettle'],
        [codes.iron, unmappedGroup, 'Test iron box'],
      ];
      for (const [code, group, desc] of items) {
        await pool.query(
          `INSERT INTO stock_items (item_code, item_desc, main_group, group_name, brand, last_channel)
           VALUES ($1, $2, 'MDA', $3, 'TESTBRAND', 'JDI')`,
          [code, desc, group],
        );
      }
      const service = createDandiPricingService(pool);

      // The example from the plan: 2 fridges + 3 washers delivered and installed,
      // kettles and iron boxes delivered only (their group is not installable).
      await pool.query(
        `INSERT INTO category_mappings (group_name, installable) VALUES ($1, false)`,
        [unmappedGroup],
      );
      const note = await service.price({
        region: 'Dubai',
        lines: [
          { itemCode: codes.fridge, qty: 2, type: 'CSIDI' },
          { itemCode: codes.washer.toLowerCase(), qty: 3, type: 'CSIDI' },
          { itemCode: codes.kettle, qty: 10, type: 'CSIDO' },
          { itemCode: codes.iron, qty: 10, type: 'CSIDO' },
        ],
      });
      assert.equal(note.ok, true);
      assert.deepEqual(
        note.lines.map((l) => l.revenue),
        [114, 171, 60, 0],
      );
      assert.equal(note.totals.total, 345);
      assert.equal(note.items[0]!.groupName, 'FRIDGE');
      assert.equal(note.items[2]!.installable, false);

      // A non-installable item cannot be delivered + installed.
      const blocked = await service.price({
        region: 'Dubai',
        lines: [{ itemCode: codes.kettle, qty: 1, type: 'CSIDI' }],
      });
      assert.equal(blocked.ok, false);
      assert.equal(blocked.issues[0]!.code, 'not-installable');

      // Delivery only on a fridge warns; the price still shows.
      const warn = await service.price({
        region: 'Sharjah',
        lines: [{ itemCode: codes.fridge, qty: 1, type: 'CSIDO' }],
      });
      assert.equal(warn.ok, true);
      assert.equal(warn.issues[0]!.code, 'delivery-only-installable');
      assert.equal(warn.totals.total, 100);

      // Switching the mapping off, or an item the stock master lacks, leaves it unlinked.
      await pool.query(`UPDATE category_mappings SET active = false WHERE group_name = $1`, [
        unmappedGroup,
      ]);
      const unlinked = await service.price({
        region: 'Dubai',
        lines: [
          { itemCode: codes.kettle, qty: 1, type: 'CSIDI' },
          { itemCode: `NOPE-${tag}`, qty: 1, type: 'CSIII' },
        ],
      });
      assert.deepEqual(
        unlinked.issues.map((i) => i.code),
        ['unmapped', 'unmapped'],
      );

      // Bad input is refused before any pricing.
      await assert.rejects(service.price({ region: 'Dubai', lines: [] }));
      await assert.rejects(
        service.price({ region: 'Dubai', lines: [{ itemCode: 'X', qty: 1, type: 'CSIJW' }] }),
      );
    } finally {
      await pool.query(`DELETE FROM stock_items WHERE item_code LIKE $1`, [`DI_-${tag}`]);
      await pool.query(`DELETE FROM category_mappings WHERE group_name = $1`, [unmappedGroup]);
      await pool.end();
    }
  },
);
