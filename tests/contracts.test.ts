import assert from 'node:assert/strict';
import test from 'node:test';
import {
  serviceJobCardStatusForFinal,
  jobFinalStatuses,
  appointmentScheduleUpdateSchema,
  complaintAutomaticStatuses,
  complaintSchedulingTransitions,
  serviceJobCardStatusSchema,
  serviceJobCardStatusTransitions,
  serviceJobCardStatusUpdateSchema,
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

test('job final status drives the internal job-card status', () => {
  assert.ok(jobFinalStatuses.includes('Delivered'));
  assert.equal(serviceJobCardStatusForFinal('WIP', 'Open'), 'Open');
  assert.equal(serviceJobCardStatusForFinal('Spare pending', 'Completed'), 'In Progress');
  assert.equal(serviceJobCardStatusForFinal('Repair Completed', 'In Progress'), 'Completed');
  assert.equal(serviceJobCardStatusForFinal('Delivered', 'Completed'), 'Completed');
  assert.equal(serviceJobCardStatusForFinal('Cancelled', 'Open'), 'Cancelled');
});
