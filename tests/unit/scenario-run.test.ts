import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PRICING_RULES } from '../../apps/api/src/revenue-dashboard/pricing-logic.js';
import { DEFAULT_FRIDGE_SCENARIO } from '../../apps/api/src/revenue-dashboard/fridge-scenario.js';
import { ratesOf } from '../../apps/api/src/revenue-dashboard/rate-overrides.js';
import { plugQuantities } from '../../apps/api/src/revenue-dashboard/fridge-scenario.js';
import { fridgeRevenue, runScenario } from '../../apps/api/src/revenue-dashboard/scenario-run.js';

const line = (
  id: string,
  invoice: string,
  category: string,
  model: string,
  qty: number,
  net: number,
) => ({
  id,
  jobType: 'CSIII',
  invDelNo: invoice,
  qty,
  unitPrice: 60,
  workbookRevenue: Math.round(qty * net * 100) / 100,
  remarks: null,
  billingCode: null,
  originalJobValue: 0,
  year: 2026,
  monthNo: 10,
  salesPerson: 'SHIVA',
  pricing: {
    applianceCategory: category,
    erpModels: model,
    crewSize: 2,
    netUnitRate: net,
    before: {},
  },
});

const inputs = {
  lines: [
    line('1', 'A', 'Freestanding Refrigerator', 'F350', 3, 52.25),
    line('2', 'A', 'Freestanding Washing Machine', 'W1', 3, 52.25),
    line('3', 'B', 'Freestanding Refrigerator', 'F561', 1, 60),
    line('4', 'C', 'Freestanding Refrigerator', 'NOPE', 1, 60),
  ],
  transportLines: [],
  sheetRows: [],
  transportRules: {
    dailyCap: false,
    deliveryOnlyCap: false,
    mixedInvoiceTransport: false,
    maxTrips: 2,
  },
};
const lookup = new Map([
  ['F350', { litres: 350, source: 'description' }],
  ['F561', { litres: 561, source: 'description' }],
]);
const settings = { rates: ratesOf(DEFAULT_PRICING_RULES), fridge: DEFAULT_FRIDGE_SCENARIO };

test('only the fridge lines move; the live total is the workbook total', () => {
  const r = runScenario(inputs as never, DEFAULT_PRICING_RULES, null, settings, lookup);
  // current: 156.75 + 156.75 + 60 + 60
  assert.equal(r.current, 433.5);
  // 3 small fridges x 30 = 90; washing machine unchanged; 1 large = market 60; unknown model = 400 L small, 1 unit = market 60
  assert.equal(r.scenario, 90 + 156.75 + 60 + 60);
  assert.equal(r.change, -66.75);
});

test('a fridge with no litres in the master is flagged and counted as 400 L', () => {
  const r = runScenario(inputs as never, DEFAULT_PRICING_RULES, null, settings, lookup);
  assert.equal(r.fridges.lines, 3);
  assert.equal(r.fridges.defaultLines, 1);
  assert.deepEqual(r.fridges.modelsNotInMaster, ['NOPE']);
  const flagged = r.invoices.filter((i) => i.defaultLitres);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0]!.litres, 400);
});

test('washing machine and cooker rates still follow the old logic when edited', () => {
  const edited = JSON.parse(JSON.stringify(settings));
  const washer = edited.rates.install.categories.find(
    (c: { category: string }) => c.category === 'Freestanding Washing Machine',
  );
  washer.batchRate = 65;
  const r = runScenario(inputs as never, DEFAULT_PRICING_RULES, null, edited, lookup);
  const wm = r.byCategory.find((c) => c.label === 'Washing Machine')!;
  assert.ok(wm.scenario > wm.current);
});

test('changing option B to A only changes fridges over 10 units', () => {
  const big = {
    ...inputs,
    lines: [line('9', 'Z', 'Freestanding Refrigerator', 'F350', 12, 50)],
  };
  const b = runScenario(big as never, DEFAULT_PRICING_RULES, null, settings, lookup);
  const a = runScenario(
    big as never,
    DEFAULT_PRICING_RULES,
    null,
    { ...settings, fridge: { ...settings.fridge, optionB: false } },
    lookup,
  );
  assert.equal(b.scenario, 10 * 30 + 2 * 20);
  assert.equal(a.scenario, 12 * 20);
});

test('13A plug lines add amount x quantity once per invoice, outside units and discounts', () => {
  const plugs = new Map([
    ['A|CSIII', 2],
    ['NOPE|CSIII', 1],
  ]);
  const without = runScenario(inputs as never, DEFAULT_PRICING_RULES, null, settings, lookup);
  const r = runScenario(inputs as never, DEFAULT_PRICING_RULES, null, settings, lookup, plugs);
  assert.equal(r.scenario, without.scenario + 30);
  assert.equal(r.current, without.current);
  assert.deepEqual(r.plugs.unmatched, ['NOPE|CSIII']);
  assert.equal(r.plugs.units, 2);
  assert.equal(r.plugs.total, 30);
  const row = r.byCategory.find((c) => c.key === 'plugs')!;
  assert.equal(row.units, 2);
  assert.equal(row.scenario, 30);
  assert.equal(r.invoices.filter((i) => i.category === '13A plug').length, 1);
});

test('plug quantities are read from REPAIR-MATERIAL lines of CSIDI and CSIII only', () => {
  const rows = [
    {
      data: {
        'Invi Item Code': 'REPAIR-MATERIAL',
        'Txn Code': 'CSIDI',
        'Inv No': 16101580,
        QTY: 1,
      },
    },
    {
      data: {
        'Invi Item Code': ' repair-material ',
        'Txn Code': 'CSIDI',
        'Inv No': '16101580',
        QTY: 2,
      },
    },
    {
      data: {
        'Invi Item Code': 'REPAIR-MATERIAL',
        'Txn Code': 'CSIII',
        'Inv No': 16101600,
        QTY: 4,
      },
    },
    {
      data: {
        'Invi Item Code': 'REPAIR-MATERIAL',
        'Txn Code': 'CSIDO',
        'Inv No': 16101700,
        QTY: 1,
      },
    },
    {
      data: {
        'Invi Item Code': 'SERV- DEL&INST -JERC',
        'Txn Code': 'CSIDI',
        'Inv No': 16101580,
        QTY: 1,
      },
    },
  ];
  const q = plugQuantities(rows);
  assert.equal(q.get('16101580|CSIDI'), 3);
  assert.equal(q.get('16101600|CSIII'), 4);
  assert.equal(q.size, 2);
});

test('live revenue (fridgeRevenue) adds up to the scenario total, plugs included', () => {
  const plug = new Map([['A|CSIII', 2]]);
  const live = fridgeRevenue(
    inputs as never,
    DEFAULT_PRICING_RULES,
    settings.rates,
    settings.fridge,
    lookup,
    plug,
  );
  const total = [...live.revenue.values()].reduce((a, b) => a + b, 0);
  const r = runScenario(inputs as never, DEFAULT_PRICING_RULES, null, settings, lookup, plug);
  assert.equal(Math.round(total * 100) / 100, r.scenario);
  // 90 + 156.75 + 60 + 60 + 2 plugs x 15
  assert.equal(r.scenario, 90 + 156.75 + 60 + 60 + 30);
});

test('plug amount follows the saved setting, not a typed number', () => {
  const live = fridgeRevenue(
    inputs as never,
    DEFAULT_PRICING_RULES,
    settings.rates,
    { ...settings.fridge, plugAmount: 25 },
    lookup,
    new Map([['A|CSIII', 1]]),
  );
  assert.equal(live.plugOf.get('1'), 25);
});
