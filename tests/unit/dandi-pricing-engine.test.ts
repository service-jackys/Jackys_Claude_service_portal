import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  engineMasterFromDandi,
  priceDeliveryNote,
  type EngineLineInput,
  type EngineMaster,
} from '../../apps/api/src/dandi-jobs/pricing-engine.js';
import { regionOfCity } from '../../apps/api/src/revenue-dashboard/pricing-logic.js';
import { dandiPricingDefault } from '../../packages/db/src/pricing-config-defaults.js';

const master: EngineMaster = engineMasterFromDandi(dandiPricingDefault);
const FRIDGE = 'Freestanding Refrigerator';
const WASHER = 'Freestanding Washing Machine';
const COOKER = 'Freestanding Cooker';

const di = (qty: number, pricingCategory = FRIDGE): EngineLineInput => ({
  qty,
  type: 'CSIDI',
  pricingCategory,
  installable: true,
});
const inst = (qty: number, pricingCategory = FRIDGE): EngineLineInput => ({
  qty,
  type: 'CSIII',
  pricingCategory,
  installable: true,
});
const del = (qty: number, installable: boolean | null = false): EngineLineInput => ({
  qty,
  type: 'CSIDO',
  pricingCategory: null,
  installable,
});
const price = (lines: EngineLineInput[], region = 'Dubai') =>
  priceDeliveryNote(master, { region, lines });

test('the engine master reads the D+I pricing master', () => {
  assert.equal(master.csidoFlat, 100);
  assert.deepEqual(master.transport, [
    { region: 'Dubai', roundTrip: 60 },
    { region: 'Sharjah', roundTrip: 90 },
  ]);
  const fridge = master.deliveryInstall.categories.find((c) => c.category === FRIDGE)!;
  assert.deepEqual([fridge.batchRate, fridge.standardRate, fridge.minimumRate], [60, 100, 35]);
});

test('one fridge, delivery + installation: standard rate, no discount, no transport', () => {
  const result = price([di(1)]);
  assert.equal(result.ok, true);
  assert.equal(result.lines[0]!.revenue, 100);
  assert.equal(result.lines[0]!.transport, 0);
  assert.equal(result.lines[0]!.rateKind, 'standard');
  assert.equal(result.totals.total, 100);
});

test('two washers on one note: batch rate, 5% discount, one transport charge', () => {
  const result = price([di(2, WASHER)]);
  assert.equal(result.lines[0]!.netRate, 57);
  assert.equal(result.lines[0]!.transport, 60);
  assert.equal(result.lines[0]!.revenue, 174);
  assert.equal(price([di(2, WASHER)], 'Sharjah').lines[0]!.revenue, 204);
});

test('the batch rate and discount tier follow the note total across categories', () => {
  // 2 fridges + 3 washers = 5 units: both lines are batch rate 60 at 5% = 57.
  const result = price([di(2, FRIDGE), di(3, WASHER)]);
  assert.deepEqual(
    result.lines.map((l) => [l.netRate, l.revenue]),
    [
      [57, 174], // the first line carries the single transport charge
      [57, 171],
    ],
  );
  assert.equal(result.totals.CSIDI, 345);
});

test("Vysakh's example: 2 fridges + 3 washers delivered and installed, kettle and iron box delivery only", () => {
  const result = price([di(2, FRIDGE), di(3, WASHER), del(10), del(10)]);
  assert.equal(result.ok, true);
  // CSIDI: 5 x 57 = 285 and no transport, because the note also has a CSIDO line.
  assert.equal(result.lines[0]!.revenue, 114);
  assert.equal(result.lines[1]!.revenue, 171);
  assert.equal(result.lines[0]!.transport, 0);
  // CSIDO: one regional charge for the note, not per line and not per unit.
  assert.equal(result.lines[2]!.revenue, 60);
  assert.equal(result.lines[3]!.revenue, 0);
  assert.equal(result.totals.total, 345);
  assert.equal(
    price([di(2, FRIDGE), di(3, WASHER), del(10), del(10)], 'Sharjah').totals.total,
    375,
  );
});

test('delivery only on its own is one flat charge per note, whatever the quantity', () => {
  const result = price([del(4), del(1), del(12)]);
  assert.deepEqual(
    result.lines.map((l) => l.revenue),
    [100, 0, 0],
  );
  assert.equal(result.lines[0]!.rateKind, 'flat');
});

test('delivery only mixed with delivery + installation takes the regional rate', () => {
  assert.equal(price([di(1), del(3)]).lines[1]!.revenue, 60);
  assert.equal(price([di(1), del(3)], 'Sharjah').lines[1]!.revenue, 90);
  // Single unit CSIDI with a CSIDO line: no transport on the CSIDI.
  assert.equal(price([di(1), del(3)]).lines[0]!.revenue, 100);
});

test('installation only is priced on the installation master, never with transport', () => {
  const one = price([inst(1, COOKER)]);
  assert.equal(one.lines[0]!.revenue, 80);
  const five = price([inst(5, COOKER)]);
  assert.equal(five.lines[0]!.netRate, 66.5); // batch 70 less 5%
  assert.equal(five.lines[0]!.transport, 0);
  assert.equal(five.lines[0]!.revenue, 332.5);
});

test('the net rate never drops below the minimum rate', () => {
  const low: EngineMaster = {
    ...master,
    deliveryInstall: {
      ...master.deliveryInstall,
      categories: master.deliveryInstall.categories.map((c) => ({ ...c, minimumRate: 59 })),
    },
  };
  const result = priceDeliveryNote(low, { region: 'Dubai', lines: [di(6)] });
  assert.equal(result.lines[0]!.netRate, 59);
});

test('discount tiers switch at 1, 2, 6, 11, 21, 31 and 41 units', () => {
  const rate = (qty: number) => price([di(qty)]).lines[0]!.discountRate;
  assert.deepEqual(
    [1, 2, 5, 6, 10, 11, 20, 21, 30, 31, 40, 41, 50].map(rate),
    [0, 0.05, 0.05, 0.1, 0.1, 0.15, 0.15, 0.18, 0.18, 0.2, 0.2, 0.22, 0.22],
  );
});

test('an item that cannot be installed can only be delivery only', () => {
  const result = price([{ qty: 1, type: 'CSIDI', pricingCategory: null, installable: false }]);
  assert.equal(result.ok, false);
  assert.equal(result.issues[0]!.code, 'not-installable');
  assert.match(result.issues[0]!.message, /can only be Delivery only/);
  assert.equal(result.totals.total, 0);
  const inst = price([{ qty: 1, type: 'CSIII', pricingCategory: null, installable: false }]);
  assert.equal(inst.issues[0]!.code, 'not-installable');
});

test('an item whose group is not linked cannot be priced as installed', () => {
  const result = price([{ qty: 1, type: 'CSIDI', pricingCategory: null, installable: null }]);
  assert.equal(result.issues[0]!.code, 'unmapped');
  assert.match(result.issues[0]!.message, /Ask the admin/);
});

test('delivery only on an installable item is allowed with a warning', () => {
  const result = price([del(1, true)]);
  assert.equal(result.ok, true);
  assert.equal(result.issues[0]!.level, 'warning');
  assert.equal(result.issues[0]!.code, 'delivery-only-installable');
  assert.equal(result.totals.total, 100);
});

test('a blocked line is left out of the note quantities', () => {
  // The blocked unit must not turn the other line into a batch of 2.
  const result = price([
    di(1),
    { qty: 1, type: 'CSIDI', pricingCategory: null, installable: false },
  ]);
  assert.equal(result.note.csidiQty, 1);
  assert.equal(result.lines[0]!.revenue, 100);
  assert.equal(result.ok, false);
});

test('quantity must be a whole number of 1 or more; region must be known', () => {
  for (const qty of [0, -1, 1.5, Number.NaN]) {
    assert.equal(price([di(qty)]).issues[0]!.code, 'qty');
  }
  const noRegion = price([di(1)], '');
  assert.equal(noRegion.ok, false);
  assert.equal(noRegion.issues[0]!.code, 'region');
  assert.equal(price([di(1)], ' sharjah ').region, 'Sharjah');
});

// ---- Golden data from the master workbook (19 Oct 2026) -------------------
type NetSaleRow = {
  inv: string;
  type: 'CSIDI' | 'CSIDO' | 'CSIII';
  category: string | null;
  qty: number;
  region: 'Dubai' | 'Sharjah';
  revenue: number;
};
const INSTALLABLE = new Set([FRIDGE, WASHER, COOKER]);

function toInput(row: { type: NetSaleRow['type']; category: string | null; qty: number }) {
  const installable = row.type === 'CSIDO' ? false : INSTALLABLE.has(row.category ?? '');
  // The workbook prices a D+I coded non-appliance (category "Default") as a 60 CSIDI;
  // the portal only lets such an item be delivered.
  const type = row.type !== 'CSIDO' && !installable ? 'CSIDO' : row.type;
  return {
    type,
    qty: row.qty,
    pricingCategory: installable ? row.category : null,
    installable,
  } satisfies EngineLineInput;
}

test('golden: the Net Sale Current sample (48 lines, 37 invoices) reprices line for line', () => {
  const rows = JSON.parse(
    readFileSync(new URL('../fixtures/dandi-net-sale-19oct.json', import.meta.url), 'utf8'),
  ) as NetSaleRow[];
  const invoices = new Map<string, NetSaleRow[]>();
  for (const row of rows) invoices.set(row.inv, [...(invoices.get(row.inv) ?? []), row]);
  assert.equal(invoices.size, 37);

  const totals = { CSIDI: 0, CSIDO: 0, CSIII: 0 };
  const differences: string[] = [];
  for (const [inv, lines] of invoices) {
    const result = price(lines.map(toInput), lines[0]!.region);
    assert.equal(result.ok, true, inv);
    lines.forEach((row, i) => {
      const got = result.lines[i]!;
      totals[got.type] += got.revenue;
      if (Math.abs(got.revenue - row.revenue) > 0.005) {
        differences.push(`${inv} line ${i + 1}: workbook ${row.revenue}, portal ${got.revenue}`);
      }
    });
  }
  // One known difference: a CSIDI coded 3PL non-electronics item, 60 in the workbook
  // (Default rate), 100 here because a non-installable item can only be delivered.
  assert.deepEqual(differences, ['NS-30 line 1: workbook 60, portal 100']);
  assert.deepEqual(totals, { CSIDI: 3590, CSIDO: 1240, CSIII: 60 });
  assert.equal(totals.CSIDI + totals.CSIDO + totals.CSIII, 4890); // 4,850 - 60 + 100
});

test('golden: the 629 CSIDI-sheet lines reprice exactly, except installation-only notes with several lines', () => {
  const rows = JSON.parse(
    readFileSync(new URL('../fixtures/dandi-csidi-sheet-19oct.json', import.meta.url), 'utf8'),
  ) as (Omit<NetSaleRow, 'region'> & { city: string | null })[];
  const invoices = new Map<string, typeof rows>();
  for (const row of rows) invoices.set(row.inv, [...(invoices.get(row.inv) ?? []), row]);
  assert.equal(invoices.size, 434);

  let matched = 0;
  const differences: {
    where: string;
    workbook: number;
    portal: number;
    multiLineInstall: boolean;
  }[] = [];
  for (const [inv, lines] of invoices) {
    const result = price(lines.map(toInput), regionOfCity(lines[0]!.city));
    lines.forEach((row, i) => {
      const got = result.lines[i]!;
      if (Math.abs(got.revenue - row.revenue) <= 0.005) {
        matched += 1;
        return;
      }
      differences.push({
        where: `${inv} line ${i + 1} (${row.type})`,
        workbook: row.revenue,
        portal: got.revenue,
        multiLineInstall:
          row.type === 'CSIII' && lines.filter((l) => l.type === 'CSIII').length > 1,
      });
    });
  }
  // Every CSIDI and CSIDO line agrees. The only differences are 31 CSIII lines on notes that
  // carry several installation-only lines: the stored history priced each line on its own
  // quantity, while the live Net Sale Current formula (and this engine) uses the note total.
  assert.equal(matched, 598);
  assert.equal(differences.length, 31);
  assert.ok(differences.every((d) => d.multiLineInstall));
  const delta = differences.reduce((sum, d) => sum + d.portal - d.workbook, 0);
  assert.equal(Math.round(delta * 100) / 100, -703.25);
});

test('a group that is not linked is delivery only: no warning, and it cannot be priced as installed', () => {
  const delivered = price([del(3, null)]);
  assert.equal(delivered.ok, true);
  assert.deepEqual(delivered.issues, []);
  assert.equal(delivered.totals.total, 100);

  const installed = price([{ ...di(1), installable: null, pricingCategory: null }]);
  assert.equal(installed.ok, false);
  assert.equal(installed.issues[0]!.code, 'unmapped');
});
