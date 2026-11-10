import assert from 'node:assert/strict';
import test from 'node:test';
import { quotationWriteSchema } from '../../packages/contracts/src/index.js';

// The form sends an empty ERP invoice number whenever the status is not Invoiced; the API must accept it.
test('A quotation with ERP status "Pending invoice" and a blank invoice number is accepted', () => {
  const parsed = quotationWriteSchema.safeParse({
    customerName: 'Test customer',
    erpStatus: 'Pending invoice',
    erpInvoiceNo: '',
    quotationStatus: 'Pending',
  });
  assert.equal(parsed.success, true, parsed.success ? '' : JSON.stringify(parsed.error.issues));
});

test('An invoice number longer than 60 characters is still rejected', () => {
  const parsed = quotationWriteSchema.safeParse({
    customerName: 'Test customer',
    erpStatus: 'Invoiced',
    erpInvoiceNo: 'x'.repeat(61),
  });
  assert.equal(parsed.success, false);
});
