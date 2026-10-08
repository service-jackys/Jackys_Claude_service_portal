import assert from 'node:assert/strict';
import test from 'node:test';
import {
  billedAmount,
  deliveryBlockReason,
  isMdaGroup,
  mdaStandardRate,
  matchBillingRule,
  normalizeWarranty,
  resolveBilling,
  type BillingInput,
} from '../../apps/api/src/job-cards/billing.js';

const rules = [{ salesman: 'Raneesh Jose', branchKeyword: 'GEMS', billToChannel: 'JDI' }];

const base: BillingInput = {
  warrantyStatus: 'In Warranty',
  finalWarrantyStatus: null,
  customerType: 'B2C',
  salesman: null,
  salesChannel: 'JER-C/INS',
  b2bBranchSchool: null,
  paymentBy: undefined,
  billToOverride: undefined,
  rules,
};

test('older free-text warranty values map onto the two real statuses', () => {
  assert.equal(normalizeWarranty('In Warranty'), 'In Warranty');
  assert.equal(normalizeWarranty('Warranty'), 'In Warranty');
  assert.equal(normalizeWarranty('Out of warranty'), 'Out Warranty');
  assert.equal(normalizeWarranty('Out Warranty'), 'Out Warranty');
  assert.equal(normalizeWarranty('Non-warranty'), 'Out Warranty');
  assert.equal(normalizeWarranty(''), null);
  assert.equal(normalizeWarranty(null), null);
});

test('a billing rule needs both the salesman and the branch keyword to match', () => {
  assert.equal(
    matchBillingRule(rules, { salesman: 'raneesh jose', b2bBranchSchool: 'GEMS Modern Academy' })
      ?.billToChannel,
    'JDI',
  );
  assert.equal(
    matchBillingRule(rules, { salesman: 'Someone Else', b2bBranchSchool: 'GEMS Modern Academy' }),
    null,
  );
  assert.equal(
    matchBillingRule(rules, { salesman: 'Raneesh Jose', b2bBranchSchool: 'Other School' }),
    null,
  );
});

test('in warranty is CSIJW billed to the sales channel, with the rule beating the default channel', () => {
  const plain = resolveBilling(base);
  assert.equal(plain.billingJobType, 'CSIJW');
  assert.equal(plain.paymentBy, 'Sales channel');
  assert.equal(plain.billToChannel, 'JER-C/INS');

  const gems = resolveBilling({
    ...base,
    customerType: 'B2B',
    salesman: 'Raneesh Jose',
    b2bBranchSchool: 'GEMS Winchester School',
  });
  assert.equal(gems.billToChannel, 'JDI');

  // Even if someone asks for the customer to pay, an in-warranty job is billed to the channel.
  assert.equal(resolveBilling({ ...base, paymentBy: 'Customer' }).paymentBy, 'Sales channel');
});

test('the final warranty status drives billing and flags a change', () => {
  const same = resolveBilling({ ...base, finalWarrantyStatus: 'In Warranty' });
  assert.equal(same.warrantyChanged, false);
  assert.equal(same.billingJobType, 'CSIJW');

  const voided = resolveBilling({ ...base, finalWarrantyStatus: 'Out Warranty' });
  assert.equal(voided.warrantyChanged, true);
  assert.equal(voided.billingJobType, 'CSIJO');
  assert.equal(voided.paymentBy, 'Customer');
  assert.equal(voided.billToChannel, null);
});

test('out of warranty lets the user choose who pays', () => {
  const channel = resolveBilling({
    ...base,
    finalWarrantyStatus: 'Out Warranty',
    paymentBy: 'Sales channel',
  });
  assert.equal(channel.billingJobType, 'CSIJO');
  assert.equal(channel.billToChannel, 'JER-C/INS');

  const override = resolveBilling({
    ...base,
    finalWarrantyStatus: 'Out Warranty',
    paymentBy: 'Sales channel',
    billToOverride: 'Another Channel',
  });
  assert.equal(override.billToChannel, 'Another Channel');
  assert.equal(override.billToOverridden, true);

  // B2B jobs default to the channel, not the customer.
  assert.equal(
    resolveBilling({ ...base, customerType: 'B2B', finalWarrantyStatus: 'Out Warranty' }).paymentBy,
    'Sales channel',
  );
});

test('delivery is blocked only when the customer owes an unpaid amount', () => {
  const customer = {
    amount: 150,
    billingJobType: 'CSIJO',
    paymentBy: 'Customer',
    invoiceNo: null as string | null,
    paymentConfirmed: false,
  };
  assert.match(deliveryBlockReason(customer) ?? '', /invoice number/);
  assert.match(
    deliveryBlockReason({ ...customer, invoiceNo: 'INV-1' }) ?? '',
    /Confirm the payment/,
  );
  assert.equal(
    deliveryBlockReason({ ...customer, invoiceNo: 'INV-1', paymentConfirmed: true }),
    null,
  );
  // Billed to the sales channel: can be delivered, finance bills it in the ledger.
  assert.equal(deliveryBlockReason({ ...customer, paymentBy: 'Sales channel' }), null);
  // No amount, no gate.
  assert.equal(deliveryBlockReason({ ...customer, amount: 0 }), null);
  // An out-of-warranty job with an amount needs a payer chosen.
  assert.match(deliveryBlockReason({ ...customer, paymentBy: null }) ?? '', /Payment by/);
});

test('the billed amount is the chargeable amount, else service charge plus parts', () => {
  assert.equal(billedAmount({ amountChargeable: 80, grandTotal: 200 }), 80);
  assert.equal(billedAmount({ amountChargeable: null, grandTotal: 200 }), 200);
  assert.equal(billedAmount({ amountChargeable: 0, grandTotal: 200 }), 0);
});

test('MDA product group bills the rate card MDA – Standard charge', () => {
  assert.equal(isMdaGroup('MDA'), true);
  assert.equal(isMdaGroup(' mda '), true);
  assert.equal(isMdaGroup('SDA'), false);
  assert.equal(isMdaGroup(null), false);
  const sections = [
    {
      activities: [
        { name: 'SDA', rate: 50 },
        { name: 'MDA \u2013 Standard', rate: 100 },
      ],
    },
    { activities: [{ name: 'MDA \u2013 Gas Charging', rate: 200 }] },
  ];
  assert.equal(mdaStandardRate(sections), 100);
  assert.equal(mdaStandardRate([{ activities: [{ name: 'SDA', rate: 50 }] }]), null);
});
