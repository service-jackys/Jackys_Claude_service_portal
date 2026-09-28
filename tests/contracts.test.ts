import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appointmentScheduleUpdateSchema,
  complaintSchedulingTransitions,
  serviceJobCardStatusSchema,
  serviceJobCardStatusTransitions,
  serviceJobCardStatusUpdateSchema,
} from '../packages/contracts/src/index.js';

test('appointment schedule contract accepts only a valid date and time', () => {
  assert.deepEqual(
    appointmentScheduleUpdateSchema.parse({
      appointmentDate: '2026-09-28',
      appointmentTime: '09:30',
    }),
    { appointmentDate: '2026-09-28', appointmentTime: '09:30' },
  );
});

test('appointment schedule contract rejects extra fields and invalid values', () => {
  assert.equal(
    appointmentScheduleUpdateSchema.safeParse({
      appointmentDate: '2026-09-28',
      appointmentTime: '09:30',
      technicianId: '7',
    }).success,
    false,
  );
  assert.equal(
    appointmentScheduleUpdateSchema.safeParse({
      appointmentDate: '2026-02-31',
      appointmentTime: '09:30',
    }).success,
    false,
  );
  assert.equal(
    appointmentScheduleUpdateSchema.safeParse({
      appointmentDate: '2026-09-28',
      appointmentTime: '24:00',
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
