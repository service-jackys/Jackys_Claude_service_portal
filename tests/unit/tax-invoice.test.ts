import assert from 'node:assert/strict';
import test from 'node:test';
import {
  amountInWords,
  buildInvoiceLines,
  invoiceTotals,
  splitVat,
} from '../../apps/api/src/invoices/tax-invoice.js';
import { taxInvoiceIssueSchema } from '../../packages/contracts/src/index.js';

test('splitVat backs 5% VAT out of an inclusive amount', () => {
  assert.deepEqual(splitVat(25), { net: 23.81, vat: 1.19 });
  assert.deepEqual(splitVat(105), { net: 100, vat: 5 });
  const odd = splitVat(99.99);
  assert.equal(Math.round((odd.net + odd.vat) * 100), 9999);
});

test('amountInWords follows the ERP wording', () => {
  assert.equal(amountInWords(25), 'AED Twenty Five Only');
  assert.equal(amountInWords(1250.5), 'AED One Thousand Two Hundred Fifty and Fifty Fils Only');
  assert.equal(amountInWords(0.75), 'AED Zero and Seventy Five Fils Only');
  assert.equal(amountInWords(100000), 'AED One Hundred Thousand Only');
});

test('invoice lines cover service, parts and an adjustment to the chargeable amount', () => {
  const lines = buildInvoiceLines({
    itemDescription: 'Oven',
    modelNo: 'X1',
    serviceCharge: 50,
    parts: [{ partNo: 'P1', description: 'Spark plug', qty: 2, unitPrice: 20 }],
    amount: 80,
  });
  assert.equal(lines.length, 3);
  assert.equal(lines[1].qty, 2);
  assert.equal(lines[1].amount, 40);
  assert.equal(lines[2].description, 'Discount / adjustment');
  assert.equal(lines[2].amount, -10);
  const totals = invoiceTotals(lines);
  assert.equal(totals.gross, 80);
  assert.equal(Math.round((totals.net + totals.vat) * 100), 8000);
});

test('a job with only a chargeable amount becomes one service line', () => {
  const lines = buildInvoiceLines({
    itemDescription: 'TV',
    modelNo: null,
    serviceCharge: 0,
    parts: [],
    amount: 120,
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].amount, 120);
  assert.equal(invoiceTotals(lines).gross, 120);
});

test('customer TRN is optional and must be 15 digits when given', () => {
  assert.equal(taxInvoiceIssueSchema.parse({}).customerTrn, undefined);
  assert.equal(
    taxInvoiceIssueSchema.parse({ customerTrn: '1002 6890-6300003' }).customerTrn,
    '100268906300003',
  );
  assert.equal(taxInvoiceIssueSchema.parse({ customerTrn: '' }).customerTrn, '');
  assert.throws(() => taxInvoiceIssueSchema.parse({ customerTrn: '12345' }));
});
