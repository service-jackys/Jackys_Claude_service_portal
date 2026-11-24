import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PRICING_RULES } from '../../apps/api/src/revenue-dashboard/pricing-logic.js';
import { DEFAULT_FRIDGE_SCENARIO } from '../../apps/api/src/revenue-dashboard/fridge-scenario.js';
import { ratesOf } from '../../apps/api/src/revenue-dashboard/rate-overrides.js';
import { runScenario } from '../../apps/api/src/revenue-dashboard/scenario-run.js';

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
