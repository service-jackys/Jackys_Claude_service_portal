import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLookupPlan } from '../../apps/api/src/ai/revenue-lookup.js';

test('a valid plan is read even with text around the JSON', () => {
  const plan = parseLookupPlan(
    'Sure: {"lookups":[{"groupBy":["jobType"],"filters":{"date":"2026-11-10"},"limit":20}]} done',
  );
  assert.deepEqual(plan, [{ groupBy: ['jobType'], filters: { date: '2026-11-10' }, limit: 20 }]);
});

test('customers, sales people and unknown fields are dropped', () => {
  const [lookup] = parseLookupPlan(
    '{"lookups":[{"groupBy":["customer","salesPerson","jobType","bogus"],"filters":{"customer":"ACME","invDelNo":"X1","jobType":"CSIDI"}}]}',
  );
  assert.deepEqual(lookup.groupBy, ['jobType']);
  assert.deepEqual(lookup.filters, { jobType: 'CSIDI' });
});

test('counts, limits, groupBy size and dates are capped or rejected', () => {
  const many = Array.from({ length: 6 }, () => ({
    groupBy: ['date', 'period', 'jobType'],
    limit: 99999,
    dateFrom: '10/11/2026',
    dateTo: '2026-11-30',
    filters: { jobType: 'x'.repeat(80) },
  }));
  const plan = parseLookupPlan(JSON.stringify({ lookups: many }));
  assert.equal(plan.length, 3);
  assert.equal(plan[0].groupBy.length, 2);
  assert.equal(plan[0].limit, 150);
  assert.equal(plan[0].dateFrom, undefined);
  assert.equal(plan[0].dateTo, '2026-11-30');
  assert.deepEqual(plan[0].filters, {});
});

test('nonsense gives no lookups', () => {
  assert.deepEqual(parseLookupPlan('no json here'), []);
  assert.deepEqual(parseLookupPlan('{"lookups":"x"}'), []);
  assert.deepEqual(parseLookupPlan('{"lookups":[]}'), []);
  assert.deepEqual(parseLookupPlan('{bad json}'), []);
});
