import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppointmentIcs } from '../../apps/api/src/appointments/ics.js';
import type { AppointmentRecord } from '../../packages/db/src/appointments.js';

const appointment: AppointmentRecord = {
  id: '42',
  appointmentReference: 'APT-2026-00042',
  complaintId: '7',
  customerId: '8',
  branchId: '9',
  technicianId: '10',
  customerType: 'B2C',
  customerName: 'A; Customer, Name',
  contactNumber: '+971 50 123 4567',
  customerEmail: 'customer@example.test',
  address: 'Line 1, Building; 2',
  region: 'Dubai',
  brand: 'Brand',
  model: 'Model',
  itemCode: 'ITEM-1',
  faultDescription: 'First line\nSecond line',
  jobWarranty: 'Warranty',
  salesOrderNumber: 'SO-1',
  b2bBranchSchool: null,
  schoolContactPerson: null,
  schoolContactNumber: null,
  customerNumber: null,
  subGroup: null,
  appointmentDate: '2026-09-25',
  appointmentTime: '23:30',
  status: 'Scheduled',
  closedAt: null,
  createdAt: new Date('2026-09-24T12:34:56.000Z'),
  updatedAt: new Date('2026-09-24T12:34:56.000Z'),
  createdBy: '1',
  updatedBy: null,
};

test('renders deterministic RFC5545 output with CRLF and escaped text', () => {
  const ics = createAppointmentIcs(appointment);

  assert.equal(
    ics,
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      "PRODID:-//Jacky's Service Portal//Appointments//EN",
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:APT-2026-00042@jackys-service-portal',
      'DTSTAMP:20260924T123456Z',
      'DTSTART;TZID=Asia/Dubai:20260925T233000',
      'DTEND;TZID=Asia/Dubai:20260926T003000',
      'SUMMARY:Service appointment APT-2026-00042',
      'DESCRIPTION:Customer: A\\; Customer\\, Name\\nContact: +971 50 123 4567\\nFirst line\\nSecond line',
      'LOCATION:Line 1\\, Building\\; 2',
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n'),
  );
  assert.equal(ics.includes('\n'), true);
  assert.equal(ics.includes('\r\n'), true);
  assert.equal(ics.replaceAll('\r\n', '').includes('\n'), false);
});

test('maps cancelled appointments to CANCELLED and accepts a configured timezone', () => {
  const ics = createAppointmentIcs({ ...appointment, status: 'Cancelled' }, 'UTC');

  assert.match(ics, /DTSTART;TZID=UTC:20260925T233000/);
  assert.match(ics, /STATUS:CANCELLED/);
});
