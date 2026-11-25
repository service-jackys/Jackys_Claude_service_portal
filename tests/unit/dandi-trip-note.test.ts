import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTripNote,
  tripOfNote,
  type TripRules,
} from '../../apps/api/src/dandi-jobs/trip-note.js';

const rules: TripRules = {
  dailyCap: true,
  deliveryOnlyCap: false,
  mixedInvoiceTransport: true,
  maxTrips: 2,
};
const mine = (charge: number, deliveryNoteRef: string | null = '16101500') => ({
  charge,
  capped: true,
  deliveryNoteRef,
});
const other = (reference: string, charge: number, deliveryNoteRef: string) => ({
  reference,
  charge,
  deliveryNoteRef,
});

test('a first trip of the day gives no note', () => {
  assert.equal(buildTripNote(mine(60), [], 2), null);
});

test('the second trip is charged and says it is the last charged trip', () => {
  const note = buildTripNote(mine(60), [other('DI-1', 60, '16101001')], 2)!;
  assert.equal(note.rank, 2);
  assert.equal(note.charged, true);
  assert.deepEqual(note.pushedOut, []);
});

test('a third trip with an equal charge and a later delivery note is not charged', () => {
  const note = buildTripNote(
    mine(60, '16101500'),
    [other('DI-1', 60, '16101001'), other('DI-2', 60, '16101002')],
    2,
  )!;
  assert.equal(note.rank, 3);
  assert.equal(note.trips, 3);
  assert.equal(note.charged, false);
});

test('a higher charge ranks first and pushes the lowest earlier trip out', () => {
  const note = buildTripNote(
    mine(120),
    [other('DI-1', 60, '16101001'), other('DI-2', 80, '16101002')],
    2,
  )!;
  assert.equal(note.rank, 1);
  assert.equal(note.charged, true);
  assert.deepEqual(
    note.pushedOut.map((o) => o.reference),
    ['DI-1'],
  );
});

test('an equal charge with a lower delivery note ranks ahead of the older job', () => {
  const note = buildTripNote(
    mine(60, '16100001'),
    [other('DI-1', 60, '16101001'), other('DI-2', 60, '16101002')],
    2,
  )!;
  assert.equal(note.rank, 1);
  assert.deepEqual(
    note.pushedOut.map((o) => o.reference),
    ['DI-2'],
  );
});

test('the maximum trips setting is respected', () => {
  const others = [other('DI-1', 60, '1'), other('DI-2', 60, '2')];
  assert.equal(buildTripNote(mine(60, '9'), others, 3)!.charged, true);
  assert.equal(buildTripNote(mine(60, '9'), others, 1)!.charged, false);
});

test('a note that is not capped gives no note', () => {
  assert.equal(
    buildTripNote({ charge: 0, capped: false, deliveryNoteRef: null }, [other('DI-1', 60, '1')], 2),
    null,
  );
});

test('tripOfNote takes the installation transport and ignores plain installation notes', () => {
  const twoFridges = tripOfNote([{ type: 'CSIDI', qty: 2, transport: 60, charge: 60 }], rules);
  assert.deepEqual(twoFridges, { charge: 60, capped: true });
  const single = tripOfNote([{ type: 'CSIDI', qty: 1, transport: 0, charge: 30 }], rules);
  assert.equal(single.capped, false);
  const installOnly = tripOfNote([{ type: 'CSIII', qty: 3, transport: 0, charge: 180 }], rules);
  assert.equal(installOnly.capped, false);
});

test('delivery only is capped only when the delivery-only cap is on, and the cap can be off', () => {
  const delivery = [{ type: 'CSIDO' as const, qty: 4, transport: 0, charge: 120 }];
  assert.equal(tripOfNote(delivery, rules).capped, false);
  assert.deepEqual(tripOfNote(delivery, { ...rules, deliveryOnlyCap: true }), {
    charge: 120,
    capped: true,
  });
  assert.equal(
    tripOfNote([{ type: 'CSIDI', qty: 2, transport: 60, charge: 60 }], {
      ...rules,
      dailyCap: false,
    }).capped,
    false,
  );
});

test('mixed invoice with one installed unit pays nothing when mixed transport is off', () => {
  const lines = [
    { type: 'CSIDI' as const, qty: 1, transport: 0, charge: 30 },
    { type: 'CSIDO' as const, qty: 2, transport: 0, charge: 50 },
  ];
  assert.deepEqual(tripOfNote(lines, rules), { charge: 50, capped: true });
  assert.equal(tripOfNote(lines, { ...rules, mixedInvoiceTransport: false }).capped, false);
});
