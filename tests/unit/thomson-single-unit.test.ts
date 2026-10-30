import assert from 'node:assert/strict';
import test from 'node:test';
import {
  thomsonPricingSchema,
  thomsonSaleWriteSchema,
} from '../../packages/contracts/src/index.js';
import { thomsonPricingDefault } from '../../packages/db/src/pricing-config-defaults.js';

test('Thomson pricing accepts the optional single-unit settings and still accepts none', () => {
  assert.ok(thomsonPricingSchema.safeParse(thomsonPricingDefault).success);
  const withSmallJob = {
    ...thomsonPricingDefault,
    smallJob: { callOutFee: 50, minimumCharge: 250 },
  };
  assert.ok(thomsonPricingSchema.safeParse(withSmallJob).success);
  const negative = { ...thomsonPricingDefault, smallJob: { callOutFee: -1, minimumCharge: 0 } };
  assert.ok(!thomsonPricingSchema.safeParse(negative).success);
});

test('A Thomson sale line can be tagged as a single-unit quote', () => {
  const line = {
    region: 'Dubai',
    applianceName: 'Built-in Hob (30 cm)',
    qty: 1,
    siteVisits: 0,
    trainingSessions: 0,
    unitRate: 78,
    applianceSubtotal: 78,
    addonRevenue: 172,
    transportCost: 60,
    totalPrice: 250,
    totalCost: 90,
    margin: 160,
  };
  const sale = {
    transportSharePercent: 0,
    lineItems: [{ ...line, quoteMode: 'single' }],
    totalPrice: 250,
    totalCost: 90,
    margin: 160,
  };
  assert.ok(thomsonSaleWriteSchema.safeParse(sale).success);
  assert.ok(thomsonSaleWriteSchema.safeParse({ ...sale, lineItems: [line] }).success);
  const bad = { ...sale, lineItems: [{ ...line, quoteMode: 'bulk' }] };
  assert.ok(!thomsonSaleWriteSchema.safeParse(bad).success);
});
