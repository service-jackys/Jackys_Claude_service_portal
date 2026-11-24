import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_FRIDGE_SCENARIO,
  groupLabour,
  litresOfModels,
  type FridgeRates,
} from '../../apps/api/src/revenue-dashboard/fridge-scenario.js';

const rates: FridgeRates = { market: 100, special: 60, minimum: 35 };
const s = DEFAULT_FRIDGE_SCENARIO;
const small = (units: number, opt = s) => groupLabour(units, false, rates, opt).total;
const large = (units: number) => groupLabour(units, true, rates, s).total;

test('fridge 400 L and under: 1 unit market, 2 to 10 base, no discount tiers', () => {
  assert.equal(small(1), 100);
  assert.equal(small(2), 60);
  assert.equal(small(6), 180);
  assert.equal(small(10), 300);
});

test('over 10 units: Option B charges only the units above 10 at the second tier', () => {
  assert.equal(small(12), 10 * 30 + 2 * 20);
  assert.equal(small(12, { ...s, optionB: false }), 12 * 20);
});

test('the minimum floors the base and second tier rates', () => {
  assert.equal(small(3, { ...s, smallBase: 10 }), 3 * 20);
  assert.equal(small(12, { ...s, smallOver10: 5 }), 10 * 30 + 2 * 20);
});

test('fridge over 400 L: 1 unit market, 2 or more special, no tiers', () => {
  assert.equal(large(1), 100);
  assert.equal(large(2), 120);
  assert.equal(large(40), 2400);
});

test('litres come from the model; several models take the largest; none found is 400 flagged', () => {
  const lookup = new Map([
    ['VG352CS', { litres: 350, source: 'description' }],
    ['VG552CS', { litres: 561, source: 'description' }],
    ['XX1', { litres: 400, source: 'default' }],
  ]);
  assert.deepEqual(litresOfModels('vg352cs', lookup), {
    litres: 350,
    source: 'description',
    models: ['VG352CS'],
  });
  assert.equal(litresOfModels('VG352CS, VG552CS', lookup).litres, 561);
  assert.deepEqual(litresOfModels('NOPE', lookup), {
    litres: 400,
    source: 'not-in-master',
    models: ['NOPE'],
  });
  assert.equal(litresOfModels('XX1', lookup).source, 'default');
  assert.equal(litresOfModels(null, lookup).source, 'not-in-master');
});
