import assert from 'node:assert/strict';
import test from 'node:test';
import {
  serviceJobCardStatusForFinal,
  finalStatusNeedsReason,
  finalStatuses,
  jobFinalStatuses,
  appointmentScheduleUpdateSchema,
  complaintAutomaticStatuses,
  complaintSchedulingTransitions,
  serviceJobCardStatusSchema,
  serviceJobCardStatusTransitions,
  serviceJobCardStatusUpdateSchema,
  computeQuotationTotals,
  quotationWriteSchema,
} from '../packages/contracts/src/index.js';

test('appointment schedule contract accepts only a valid date', () => {
  assert.deepEqual(
    appointmentScheduleUpdateSchema.parse({
      appointmentDate: '2026-09-28',
    }),
    { appointmentDate: '2026-09-28' },
  );
});

test('appointment schedule contract rejects extra fields and invalid values', () => {
  // Scheduling is day-only now (see modification.md #8) -- appointmentTime
  // is no longer a recognized field, and the schema is .strict(), so
  // including it is itself a rejection case.
  assert.equal(
    appointmentScheduleUpdateSchema.safeParse({
      appointmentDate: '2026-09-28',
      appointmentTime: '09:30',
    }).success,
    false,
  );
  assert.equal(
    appointmentScheduleUpdateSchema.safeParse({
      appointmentDate: '2026-09-28',
      technicianId: '7',
    }).success,
    false,
  );
  assert.equal(
    appointmentScheduleUpdateSchema.safeParse({
      appointmentDate: '2026-02-31',
    }).success,
    false,
  );
});

test('complaint status transitions keep scheduling recovery explicit', () => {
  assert.deepEqual(complaintSchedulingTransitions.New, ['Under Review', 'Cancelled']);
  assert.deepEqual(complaintSchedulingTransitions['Under Review'], [
    'Pending Information',
    'Ready for Scheduling',
    'Cancelled',
  ]);
  assert.deepEqual(complaintSchedulingTransitions.Scheduled, [
    'Closed',
    'Cancelled',
    'Ready for Scheduling',
  ]);
  assert.deepEqual(complaintSchedulingTransitions.Closed, []);
  assert.deepEqual(complaintSchedulingTransitions.Cancelled, []);
});

test('Scheduled and Closed are set by the system, never picked by hand', () => {
  assert.deepEqual([...complaintAutomaticStatuses], ['Scheduled', 'Closed']);
});

test('service job-card status contract and transitions are explicit', () => {
  assert.equal(serviceJobCardStatusSchema.safeParse('In Progress').success, true);
  assert.equal(serviceJobCardStatusSchema.safeParse('Finalized').success, false);
  assert.deepEqual(serviceJobCardStatusTransitions.Open, ['In Progress', 'Cancelled']);
  assert.deepEqual(serviceJobCardStatusTransitions.Completed, []);
  assert.deepEqual(
    serviceJobCardStatusUpdateSchema.safeParse({ status: 'Completed', reason: 'Work finished' })
      .success,
    true,
  );
  assert.equal(
    serviceJobCardStatusUpdateSchema.safeParse({ status: 'Completed', unexpected: true }).success,
    false,
  );
});

test('job status and final status drive the internal job-card status', () => {
  assert.ok(finalStatuses.includes('Delivered'));
  assert.ok(!jobFinalStatuses.includes('Delivered' as never));
  assert.ok(jobFinalStatuses.includes('BER'));
  assert.equal(serviceJobCardStatusForFinal('WIP', null, 'Open'), 'Open');
  assert.equal(serviceJobCardStatusForFinal('Spare pending', null, 'Completed'), 'In Progress');
  assert.equal(serviceJobCardStatusForFinal('Customer approval pending', null, 'Open'), 'Open');
  assert.equal(
    serviceJobCardStatusForFinal('Customer approval pending', null, 'In Progress'),
    'In Progress',
  );
  assert.equal(serviceJobCardStatusForFinal('Repair Completed', null, 'In Progress'), 'Completed');
  assert.equal(serviceJobCardStatusForFinal('BER', null, 'In Progress'), 'Completed');
  assert.equal(serviceJobCardStatusForFinal('BER', 'Delivered', 'Completed'), 'Completed');
  assert.equal(serviceJobCardStatusForFinal('Rejected', null, 'In Progress'), 'Completed');
  assert.equal(serviceJobCardStatusForFinal('Cancelled', null, 'Open'), 'Cancelled');
  assert.equal(serviceJobCardStatusForFinal('Cancelled', 'Delivered', 'Cancelled'), 'Cancelled');
});

test('a delivered BER, Rejected or Cancelled job needs a reason', () => {
  const base = { jobStatus: 'BER', finalStatus: 'Delivered' };
  assert.equal(finalStatusNeedsReason(base), true);
  assert.equal(finalStatusNeedsReason({ ...base, jobStatus: 'Rejected' }), true);
  assert.equal(finalStatusNeedsReason({ ...base, jobStatus: 'Cancelled' }), true);
  assert.equal(finalStatusNeedsReason({ ...base, finalStatus: null }), false);
  assert.equal(finalStatusNeedsReason({ ...base, jobStatus: 'Repair Completed' }), false);
});

test('quotation totals add 5% VAT on every line and on the legacy labour amount', () => {
  // Old portal QO-014 pattern: lines + labour, then 5% VAT.
  const totals = computeQuotationTotals({
    parts: [
      { unitKey: 'u1', type: 'Part', partNo: '', description: 'Part', qty: 2, unitPrice: 100 },
      { unitKey: 'u1', type: 'Labour', partNo: '', description: 'Labour', qty: 1, unitPrice: 90 },
    ],
    products: [],
    labourAmount: 0,
    vatRate: 0.05,
  });
  assert.equal(totals.subtotal, 290);
  assert.equal(totals.vat, 14.5);
  assert.equal(totals.grandTotal, 304.5);
});

test('quotation totals ignore VAT when the rate is zero and still count legacy labour', () => {
  const totals = computeQuotationTotals({
    parts: [
      { unitKey: '', type: 'Service', partNo: '', description: 'Visit', qty: 3, unitPrice: 33.33 },
    ],
    products: [],
    labourAmount: 10,
    vatRate: 0,
  });
  assert.equal(totals.subtotal, 109.99);
  assert.equal(totals.vat, 0);
  assert.equal(totals.grandTotal, 109.99);
});

test('quotation totals round VAT once on the subtotal, not per line', () => {
  const totals = computeQuotationTotals({
    parts: [
      { unitKey: 'u1', type: 'Part', partNo: '', description: 'A', qty: 1, unitPrice: 0.1 },
      { unitKey: 'u2', type: 'Part', partNo: '', description: 'B', qty: 1, unitPrice: 0.1 },
    ],
    products: [],
    labourAmount: 0,
    vatRate: 0.05,
  });
  assert.equal(totals.subtotal, 0.2);
  assert.equal(totals.vat, 0.01);
  assert.equal(totals.grandTotal, 0.21);
});

test('quotation contract rejects unknown charge types and VAT above 25%', () => {
  assert.equal(
    quotationWriteSchema.safeParse({
      parts: [{ unitKey: '', type: 'Gift', partNo: '', description: 'x', qty: 1, unitPrice: 1 }],
    }).success,
    false,
  );
  assert.equal(quotationWriteSchema.safeParse({ vatRate: 0.3 }).success, false);
  assert.equal(
    quotationWriteSchema.safeParse({ vatRate: 0.05, parts: [], products: [] }).success,
    true,
  );
});
