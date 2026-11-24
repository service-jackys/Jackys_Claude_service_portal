import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createStockMasterService } from '../../apps/api/src/stock-master/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';
import {
  recalculateCapacity,
  upsertStockMaster,
  type StockItem,
} from '../../packages/db/src/stock-master.js';

const databaseUrl = process.env.DATABASE_URL;

const item = (
  code: string,
  desc: string,
  group: string,
  sub = 'FRIDGE DOUBLE DOOR',
): StockItem => ({
  itemCode: code,
  itemDesc: desc,
  mainGroup: 'MDA',
  groupName: group,
  subGroup: sub,
  brand: 'TEST',
});

test(
  'stock upload fills fridge litres, keeps typed values and recalculates the rest',
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
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const codes = {
      a: `CAP-A-${suffix}`,
      b: `CAP-B-${suffix}`,
      c: `CAP-C-${suffix}`,
      w: `CAP-W-${suffix}`,
    };
    let profileId = '';
    try {
      profileId = (
        await pool.query<{ id: string }>(
          `INSERT INTO profiles (email, display_name) VALUES ($1, 'Capacity test') RETURNING id::text AS id`,
          [`capacity-${suffix}@example.test`],
        )
      ).rows[0].id;
      const client = await pool.connect();
      try {
        const run = async (items: StockItem[]) =>
          upsertStockMaster(client, {
            fileName: 'cap.xlsx',
            fileSha256: randomUUID(),
            rowCount: items.length,
            items: new Map(items.map((i) => [i.itemCode.toUpperCase(), i])),
            uploadedBy: null,
          });
        await run([
          item(codes.a, 'TEST FRIDGE / 561 LTRS SIDE BY SIDE', 'FRIDGE'),
          item(codes.b, 'TEST FRIDGE / 2 DOOR, SILVER', 'FRIDGE'),
          item(codes.c, 'TEST CHEST FREEZER 300L', 'FREEZER', 'FREEZER - CHEST'),
          item(codes.w, 'TEST WASHER 8KG 1400 RPM 20L', 'WASHING MACHINE', 'WASHER'),
        ]);
        const read = async (code: string) =>
          (
            await client.query<{ litres: number | null; source: string | null }>(
              `SELECT capacity_litres::float8 AS litres, capacity_source AS source
                 FROM stock_master WHERE item_code = $1`,
              [code],
            )
          ).rows[0];
        assert.deepEqual(await read(codes.a), { litres: 561, source: 'description' });
        assert.deepEqual(await read(codes.b), { litres: 400, source: 'default' });
        assert.deepEqual(await read(codes.c), { litres: 300, source: 'description' });
        // Not a fridge or freezer: no capacity.
        assert.deepEqual(await read(codes.w), { litres: null, source: null });

        // A typed value survives the next upload; the others follow the file.
        const service = createStockMasterService(pool);
        const typed = await service.capacitySet(codes.b, { litres: 650 }, profileId);
        assert.equal(typed.capacitySource, 'manual');
        await run([
          item(codes.a, 'TEST FRIDGE / 500 LTRS SIDE BY SIDE', 'FRIDGE'),
          item(codes.b, 'TEST FRIDGE / 2 DOOR, SILVER', 'FRIDGE'),
        ]);
        assert.deepEqual(await read(codes.a), { litres: 500, source: 'description' });
        assert.deepEqual(await read(codes.b), { litres: 650, source: 'manual' });

        // Clearing the typed value works it out from the description again.
        const cleared = await service.capacitySet(codes.b, { litres: null }, profileId);
        assert.equal(cleared.capacitySource, 'default');
        assert.equal(cleared.capacityLitres, 400);

        // The button fixes rows stored before the column existed.
        await client.query(
          `UPDATE stock_master SET capacity_litres = NULL, capacity_source = NULL WHERE item_code = $1`,
          [codes.a],
        );
        const result = await recalculateCapacity(client);
        assert.ok(result.changed >= 1);
        assert.deepEqual(await read(codes.a), { litres: 500, source: 'description' });

        // Not a fridge: refused.
        await assert.rejects(() => service.capacitySet(codes.w, { litres: 100 }, profileId));
        const list = await service.capacityList({ filter: 'default', q: suffix });
        assert.deepEqual(
          list.items.map((row) => row.itemCode),
          [codes.b],
        );
      } finally {
        client.release();
      }
    } finally {
      await pool.query(`DELETE FROM stock_master WHERE item_code LIKE $1`, [`CAP-_-${suffix}`]);
      if (profileId) {
        await pool.query(`DELETE FROM audit_events WHERE actor_profile_id = $1::bigint`, [
          profileId,
        ]);
        await pool.query(`DELETE FROM profiles WHERE id = $1::bigint`, [profileId]);
      }
      await pool.end();
    }
  },
);
