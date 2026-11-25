import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  ServiceJobCardError,
  createServiceJobCardService,
} from '../../apps/api/src/job-cards/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'walk-in visit: one card per unit, one visit reference, serial number stop, replay safety and the unit limit',
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
    const profile = await pool.query<{ id: string }>(
      `INSERT INTO profiles (email, display_name) VALUES ($1, 'Walk-in Visit') RETURNING id`,
      [`visit-${randomUUID()}@example.test`],
    );
    const profileId = profile.rows[0]!.id;
    const service = createServiceJobCardService(pool);
    const shared = {
      customerType: 'B2B',
      customerName: `VISIT CUSTOMER ${tag}`,
      b2bBranchSchool: `VISIT SCHOOL ${tag}`,
      customerContact: '0501234567',
      region: 'Dubai',
    };
    const createdIds: string[] = [];
    const track = (cards: { id: string }[]) => createdIds.push(...cards.map((card) => card.id));
    const aptRef = `APT-2099-${String(Math.floor(Math.random() * 90000) + 10000)}`;
    const serial = (n: number) => `SN-${tag}-${n}`;
    try {
      await pool.query(`UPDATE walk_in_settings SET max_units_per_visit = 10 WHERE id = 1`);

      // 3 + 2 units, different models, S/N per unit; the line fault is the default.
      const visit = await service.createWalkInVisit(
        {
          ...shared,
          requestKey: `key-${tag}-1`,
          lines: [
            {
              modelNo: 'VWD5FS',
              brand: 'VENUS',
              warrantyStatus: 'Out Warranty',
              complaint: 'Not cooling',
              quantity: 3,
              units: [
                { serialNo: serial(1), purchaseDate: '2025-03-12', invoiceNo: '16101234' },
                { serialNo: serial(2) },
                { complaint: 'No power' },
              ],
            },
            {
              modelNo: 'VWD3FS',
              brand: 'VENUS',
              warrantyStatus: 'Out Warranty',
              complaint: 'Not working',
              quantity: 2,
              units: [{ serialNo: serial(3) }],
            },
          ],
        },
        profileId,
      );
      track(visit.jobCards);
      assert.match(visit.visitReference ?? '', /^WI-\d{4}-\d{5}$/);
      assert.equal(visit.replay, false);
      assert.equal(visit.jobCards.length, 5);
      assert.deepEqual(
        visit.jobCards.map((card) => [card.visitUnitNo, card.visitUnitCount, card.visitReference]),
        [1, 2, 3, 4, 5].map((n) => [n, 5, visit.visitReference]),
      );
      assert.deepEqual(
        visit.jobCards.map((card) => [card.modelNo, card.serialNo, card.complaint]),
        [
          ['VWD5FS', serial(1), 'Not cooling'],
          ['VWD5FS', serial(2), 'Not cooling'],
          ['VWD5FS', null, 'No power'],
          ['VWD3FS', serial(3), 'Not working'],
          ['VWD3FS', null, 'Not working'],
        ],
      );
      assert.equal(visit.jobCards[0]!.purchaseDate, '2025-03-12');
      assert.equal(visit.jobCards[0]!.invoiceNo, '16101234');
      assert.equal(new Set(visit.jobCards.map((card) => card.jobCardReference)).size, 5);
      assert.ok(visit.jobCards.every((card) => card.sourceType === 'Walk-in'));
      assert.equal((await service.visitCards(visit.visitReference!)).length, 5);

      // The same key (double press / retry) returns the same cards and opens nothing new.
      const again = await service.createWalkInVisit(
        {
          ...shared,
          requestKey: `key-${tag}-1`,
          lines: [{ modelNo: 'X', complaint: 'y', quantity: 1 }],
        },
        profileId,
      );
      assert.equal(again.replay, true);
      assert.deepEqual(
        again.jobCards.map((card) => card.id),
        visit.jobCards.map((card) => card.id),
      );

      // An S/N that is already open on a card stops that visit; nothing is saved.
      const blocked = {
        ...shared,
        requestKey: `key-${tag}-2`,
        lines: [
          {
            modelNo: 'VWD5FS',
            warrantyStatus: 'Out Warranty',
            complaint: 'Leaking',
            quantity: 2,
            units: [{ serialNo: serial(9) }, { serialNo: ` ${serial(1).toLowerCase()} ` }],
          },
        ],
      };
      await assert.rejects(
        service.createWalkInVisit(blocked, profileId),
        (error: unknown) =>
          error instanceof ServiceJobCardError &&
          error.code === 'serial-open' &&
          error.message.includes(visit.jobCards[0]!.jobCardReference),
      );
      const leaked = await pool.query(
        `SELECT 1 FROM service_job_cards WHERE visit_request_key = $1`,
        [`key-${tag}-2`],
      );
      assert.equal(leaked.rowCount, 0);

      // The serial check reports it, and an open appointment with the same S/N is information only.
      await pool.query(
        `INSERT INTO appointments (appointment_reference, customer_type, customer_name, contact_number, appointment_date,
                                   fault_description, status, serial_no, created_by, updated_by)
         VALUES ($1, 'B2C', 'X', '0500000000', '2099-01-01', 'f', 'Scheduled', $2, $3, $3)`,
        [aptRef, serial(9), profileId],
      );
      const check = await service.walkInSerialCheck({ serials: [serial(1), serial(9), 'N/A'] });
      assert.deepEqual(
        check.openJobCards.map((match) => match.serial),
        [serial(1)],
      );
      assert.deepEqual(
        check.others.map((other) => [other.kind, other.serial]),
        [['Appointment', serial(9)]],
      );

      // Confirmed different repair: allowed.
      const confirmed = await service.createWalkInVisit(
        {
          ...blocked,
          requestKey: `key-${tag}-3`,
          lines: [
            {
              ...blocked.lines[0]!,
              units: [{ serialNo: serial(9) }, { serialNo: serial(1), allowDuplicateSerial: true }],
            },
          ],
        },
        profileId,
      );
      track(confirmed.jobCards);
      assert.equal(confirmed.jobCards.length, 2);

      // BER, Delivered and Cancelled release the S/N.
      await pool.query(`UPDATE service_job_cards SET job_final_status = 'BER' WHERE id = $1`, [
        visit.jobCards[1]!.id,
      ]);
      await pool.query(`UPDATE service_job_cards SET final_status = 'Delivered' WHERE id = $1`, [
        visit.jobCards[3]!.id,
      ]);
      const released = await service.walkInSerialCheck({ serials: [serial(2), serial(3)] });
      assert.deepEqual(released.openJobCards, []);

      // The same S/N twice in one visit is refused; placeholders such as N/A are not compared.
      await assert.rejects(
        service.createWalkInVisit(
          {
            ...shared,
            requestKey: `key-${tag}-4`,
            lines: [
              {
                modelNo: 'A',
                complaint: 'c',
                quantity: 2,
                units: [{ serialNo: serial(20) }, { serialNo: serial(20) }],
              },
            ],
          },
          profileId,
        ),
        (error: unknown) => error instanceof ServiceJobCardError && error.code === 'serial-open',
      );
      const placeholders = await service.createWalkInVisit(
        {
          ...shared,
          requestKey: `key-${tag}-5`,
          lines: [
            {
              modelNo: 'A',
              complaint: 'c',
              quantity: 2,
              units: [{ serialNo: 'N/A' }, { serialNo: 'N/A' }],
            },
          ],
        },
        profileId,
      );
      track(placeholders.jobCards);
      assert.equal(placeholders.jobCards.length, 2);

      // The units-per-visit limit: default 10, raised by an administrator.
      const eleven = {
        ...shared,
        requestKey: `key-${tag}-6`,
        lines: [{ modelNo: 'A', complaint: 'c', quantity: 11 }],
      };
      await assert.rejects(
        service.createWalkInVisit(eleven, profileId),
        (error: unknown) => error instanceof ServiceJobCardError && error.code === 'unit-limit',
      );
      assert.equal((await service.walkInSettings()).maxUnitsPerVisit, 10);
      assert.equal(
        (await service.saveWalkInVisitLimit({ maxUnitsPerVisit: 12 }, profileId)).maxUnitsPerVisit,
        12,
      );
      const big = await service.createWalkInVisit(eleven, profileId);
      track(big.jobCards);
      assert.equal(big.jobCards.length, 11);

      // A required customer field still stops the whole visit.
      await assert.rejects(
        service.createWalkInVisit(
          {
            ...shared,
            customerName: undefined,
            requestKey: `key-${tag}-7`,
            lines: [{ modelNo: 'A', complaint: 'c', quantity: 1 }],
          },
          profileId,
        ),
      );
    } finally {
      await pool.query(`UPDATE walk_in_settings SET max_units_per_visit = 10 WHERE id = 1`);
      if (createdIds.length) {
        await pool
          .query(`DELETE FROM service_job_card_history WHERE job_card_id = ANY($1::bigint[])`, [
            createdIds,
          ])
          .catch(() => undefined);
        await pool
          .query(`DELETE FROM service_job_cards WHERE id = ANY($1::bigint[])`, [createdIds])
          .catch(() => undefined);
      }
      await pool
        .query(`DELETE FROM appointments WHERE appointment_reference = $1`, [aptRef])
        .catch(() => undefined);
      await pool.end();
    }
  },
);
