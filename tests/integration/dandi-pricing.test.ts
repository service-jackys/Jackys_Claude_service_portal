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
          `INSERT INTO stock_master (item_code, item_desc, main_group, group_name, brand)
           VALUES ($1, $2, 'MDA', $3, 'TESTBRAND')`,
          [code, desc, group],
        );
      }
      const service = createDandiPricingService(pool);
      // The old logic first: these figures are the long-standing ones. The new fridge logic follows below.
      const savedLogic = await pool.query(`SELECT * FROM revenue_fridge_logic WHERE id = 1`);
      const setLogic = (enabled: boolean) =>
        pool.query(
          `INSERT INTO revenue_fridge_logic (id, enabled, small_base, small_over10, small_minimum, option_b, plug_amount)
           VALUES (1, $1, 30, 20, 20, true, 15)
           ON CONFLICT (id) DO UPDATE SET enabled = $1, small_base = 30, small_over10 = 20,
             small_minimum = 20, option_b = true, plug_amount = 15`,
          [enabled],
        );
      await setLogic(false);

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

      // The new fridge logic, read from the saved settings and the Stock Master litres.
      await setLogic(true);
      await pool.query(
        `UPDATE stock_master SET capacity_litres = 350, capacity_source = 'manual' WHERE item_code = $1`,
        [codes.fridge],
      );
      const inserted = await pool.query(
        `INSERT INTO stock_master (item_code, item_desc, main_group, group_name, brand)
         VALUES ('REPAIR-MATERIAL', 'SERVICE - MATERIAL PURCHASE FOR REPAIR/INSTALLATION', 'MDA', 'SERVICE MATERIAL', 'TESTBRAND')
         ON CONFLICT DO NOTHING RETURNING item_code`,
      );
      try {
        const fresh = await service.price({
          region: 'Dubai',
          lines: [
            { itemCode: codes.fridge, qty: 3, type: 'CSIDI' },
            { itemCode: 'REPAIR-MATERIAL', qty: 2, type: 'CSIDI' },
          ],
        });
        assert.equal(fresh.ok, true);
        // 3 fridges of 350 L: 3 x 30 + one transport (Dubai 60); the plug is 2 x 15 and not a unit.
        assert.deepEqual(
          fresh.lines.map((l) => l.revenue),
          [150, 30],
        );
        assert.equal(fresh.lines[0]!.litres, 350);
        assert.equal(fresh.totals.CSIDI, 180);
        // A plug cannot be Delivery only.
        const refused = await service.price({
          region: 'Dubai',
          lines: [{ itemCode: 'REPAIR-MATERIAL', qty: 1, type: 'CSIDO' }],
        });
        assert.equal(refused.ok, false);
        assert.equal(refused.issues[0]!.code, 'plug-delivery-only');
      } finally {
        if (inserted.rowCount) {
          await pool.query(`DELETE FROM stock_master WHERE item_code = 'REPAIR-MATERIAL'`);
        }
        if (savedLogic.rows[0]) {
          const r = savedLogic.rows[0];
          await pool.query(
            `UPDATE revenue_fridge_logic SET enabled=$1, small_base=$2, small_over10=$3, small_minimum=$4, option_b=$5, plug_amount=$6 WHERE id = 1`,
            [r.enabled, r.small_base, r.small_over10, r.small_minimum, r.option_b, r.plug_amount],
          );
        } else {
          await pool.query(`DELETE FROM revenue_fridge_logic WHERE id = 1`);
        }
      }

      // Bad input is refused before any pricing.
      await assert.rejects(service.price({ region: 'Dubai', lines: [] }));
      await assert.rejects(
        service.price({ region: 'Dubai', lines: [{ itemCode: 'X', qty: 1, type: 'CSIJW' }] }),
      );
    } finally {
      await pool.query(`DELETE FROM stock_master WHERE item_code LIKE $1`, [`DI_-${tag}`]);
      await pool.query(`DELETE FROM category_mappings WHERE group_name = $1`, [unmappedGroup]);
      await pool.end();
    }
  },
);
