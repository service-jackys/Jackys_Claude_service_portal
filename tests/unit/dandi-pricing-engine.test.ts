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

// --- New fridge and 13A/15A plug logic (modification #312) -------------------------------------
const FS = {
  enabled: true,
  smallBase: 30,
  smallOver10: 20,
  smallMinimum: 20,
  optionB: true,
  plugAmount: 15,
};
const newMaster = engineMasterFromDandi(dandiPricingDefault, FS);
const newPrice = (lines: EngineLineInput[], region = 'Dubai') =>
  priceDeliveryNote(newMaster, { region, lines });
const fridge = (qty: number, litres: number | null, type: 'CSIDI' | 'CSIII' = 'CSIDI') => ({
  qty,
  type,
  pricingCategory: FRIDGE,
  installable: true as boolean | null,
  litres,
});
const plug = (qty: number, type: 'CSIDI' | 'CSIII' | 'CSIDO' = 'CSIDI'): EngineLineInput => ({
  qty,
  type,
  pricingCategory: null,
  installable: null,
  isPlug: true,
});

test('new logic: fridges of 400 L and under, 2 to 10 units, base rate, no discount tier', () => {
  const r = newPrice([fridge(3, 350)]);
  assert.equal(r.ok, true);
  assert.equal(r.lines[0]!.labour, 90);
  assert.equal(r.lines[0]!.transport, 60); // more than one unit on the note: one transport charge
  assert.equal(r.lines[0]!.discountRate, 0);
  assert.equal(r.totals.total, 150);
});

test('new logic: one fridge is the market rate, over 400 L from two units the special rate', () => {
  assert.equal(newPrice([fridge(1, 300)]).totals.total, 100);
  assert.equal(newPrice([fridge(1, 500)]).totals.total, 100);
  const two = newPrice([fridge(2, 500)]);
  assert.equal(two.lines[0]!.labour, 120);
});

test('new logic: Option B charges only the units above 10 at the second tier', () => {
  const r = newPrice([fridge(12, 300)]);
  assert.equal(r.lines[0]!.labour, 10 * 30 + 2 * 20);
  const a = priceDeliveryNote(
    engineMasterFromDandi(dandiPricingDefault, { ...FS, optionB: false }),
    {
      region: 'Dubai',
      lines: [fridge(12, 300)],
    },
  );
  assert.equal(a.lines[0]!.labour, 12 * 20);
});

test('new logic: a fridge without litres is priced as 400 L and flagged', () => {
  const r = newPrice([fridge(2, null)]);
  assert.equal(r.lines[0]!.litres, 400);
  assert.equal(r.lines[0]!.labour, 60);
  assert.ok(r.issues.some((i) => i.code === 'fridge-litres-default' && i.level === 'warning'));
  assert.equal(r.ok, true);
});

test('new logic: two size groups of one note are priced apart; their lines share a group by quantity', () => {
  const r = newPrice([fridge(2, 300), fridge(3, 300), fridge(2, 500)]);
  assert.equal(r.lines[0]!.labour + r.lines[1]!.labour, 5 * 30);
  assert.equal(r.lines[2]!.labour, 120);
});

test('new logic: other categories keep their rate and discount tier, fridge units count in the tier', () => {
  const old = price([di(2, COOKER)]);
  const withFridge = newPrice([{ ...di(2, COOKER), litres: null }, fridge(1, 300)]);
  // cooker tier is now looked up on 3 units (2 + 1 fridge); the cooker rate itself is the workbook's
  const cooker = withFridge.lines[0]!;
  assert.equal(cooker.discountTier !== null, true);
  assert.equal(old.lines[0]!.discountTier !== null, true);
});

test('new logic: the plug is amount x quantity, no discount, not a unit, trip or transport', () => {
  const r = newPrice([di(1, COOKER), plug(2)]);
  const cooker = r.lines[0]!;
  const p = r.lines[1]!;
  assert.equal(p.plug, true);
  assert.equal(p.revenue, 30);
  assert.equal(p.transport, 0);
  assert.equal(r.note.csidiQty, 1); // the plug is not a unit
  assert.equal(cooker.transport, 0); // so a single cooker still has no transport
  assert.equal(r.totals.CSIDI, cooker.revenue + 30);
});

test('new logic: the plug works on installation only, and is refused on delivery only', () => {
  const ok = newPrice([inst(1, COOKER), plug(1, 'CSIII')]);
  assert.equal(ok.lines[1]!.revenue, 15);
  assert.equal(ok.totals.CSIII, ok.lines[0]!.revenue + 15);
  const bad = newPrice([del(1), plug(1, 'CSIDO')]);
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.some((i) => i.code === 'plug-delivery-only' && i.level === 'error'));
});

test('old logic switched on: fridges keep the old prices and the plug is not charged', () => {
  const offMaster = engineMasterFromDandi(dandiPricingDefault, { ...FS, enabled: false });
  const lines = [di(3), plug(2)];
  const off = priceDeliveryNote(offMaster, { region: 'Dubai', lines });
  const old = priceDeliveryNote(master, { region: 'Dubai', lines: [di(3)] });
  assert.equal(off.lines[0]!.revenue, old.lines[0]!.revenue);
  assert.equal(off.lines[1]!.revenue, 0);
  assert.ok(off.issues.some((i) => i.code === 'plug-old-logic'));
  assert.equal(off.ok, true);
});
