import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMessageDrafts,
  canSendMessages,
  messageLink,
  toWhatsAppNumber,
} from '../../apps/api/src/appointments/messages.js';
import type { AppointmentRecord } from '../../packages/db/src/appointments.js';

function appointment(overrides: Partial<AppointmentRecord> = {}): AppointmentRecord {
  return {
    id: '1',
    appointmentReference: 'APT-2026-00001',
    customerName: 'Aisha Khan',
    contactNumber: '050 123 4567',
    customerEmail: 'aisha@example.test',
    address: 'Villa 4, Al Barsha',
    region: 'Dubai',
    brand: 'VENUS',
    model: 'VW550',
    faultDescription: 'Not cooling',
    jobWarranty: 'In Warranty',
    appointmentDate: '2026-10-12',
    status: 'Scheduled',
    technicianId: '7',
    ...overrides,
  } as AppointmentRecord;
}

test('toWhatsAppNumber turns local UAE numbers into wa.me numbers', () => {
  assert.equal(toWhatsAppNumber('0501234567'), '971501234567');
  assert.equal(toWhatsAppNumber('050 123 4567'), '971501234567');
  assert.equal(toWhatsAppNumber('501234567'), '971501234567');
  assert.equal(toWhatsAppNumber('+971 50 123 4567'), '971501234567');
  assert.equal(toWhatsAppNumber('00971501234567'), '971501234567');
  assert.equal(toWhatsAppNumber('0501234567 / 0559876543'), '971501234567');
  assert.equal(toWhatsAppNumber('043211234'), '97143211234');
});

test('toWhatsAppNumber refuses numbers it cannot place', () => {
  assert.equal(toWhatsAppNumber(null), null);
  assert.equal(toWhatsAppNumber(''), null);
  assert.equal(toWhatsAppNumber('N/A'), null);
  assert.equal(toWhatsAppNumber('123'), null);
});

test('only Scheduled and In Progress appointments can be messaged', () => {
  assert.equal(canSendMessages('Scheduled'), true);
  assert.equal(canSendMessages('In Progress'), true);
  assert.equal(canSendMessages('Completed'), false);
  assert.equal(canSendMessages('Cancelled'), false);
});

test('customer drafts carry reference, product, date and technician', () => {
  const drafts = buildMessageDrafts(appointment(), {
    name: 'Siva',
    phone: '0559876543',
    email: 'siva@example.test',
  });
  const booked = drafts.find((d) => d.template === 'customer_booked')!;
  assert.match(booked.body, /Hello Aisha Khan/);
  assert.match(booked.body, /APT-2026-00001/);
  assert.match(booked.body, /VENUS VW550/);
  assert.match(booked.body, /12 October 2026/);
  assert.match(booked.body, /technician Siva/);
  assert.equal(booked.whatsappNumber, '971501234567');
  const rescheduled = drafts.find((d) => d.template === 'customer_rescheduled')!;
  assert.match(rescheduled.body, /rescheduled to/);
});

test('technician draft needs an assigned technician', () => {
  const without = buildMessageDrafts(appointment({ technicianId: null }), null).find(
    (d) => d.template === 'technician_assigned',
  )!;
  assert.equal(without.body, '');
  assert.match(without.whatsappUnavailableReason ?? '', /Assign a technician/);
  assert.equal(messageLink('whatsapp', without), null);

  const withTech = buildMessageDrafts(appointment(), {
    name: 'Siva',
    phone: '0559876543',
    email: null,
  }).find((d) => d.template === 'technician_assigned')!;
  assert.match(withTech.body, /Address: Villa 4, Al Barsha, Dubai/);
  assert.match(withTech.body, /Fault: Not cooling/);
  assert.equal(withTech.whatsappNumber, '971559876543');
  assert.equal(messageLink('email', withTech), null);
  assert.match(withTech.emailUnavailableReason ?? '', /no email/);
});

test('links are encoded for wa.me and mailto', () => {
  const draft = buildMessageDrafts(appointment(), null)[0]!;
  const wa = messageLink('whatsapp', draft)!;
  assert.ok(wa.url.startsWith('https://wa.me/971501234567?text='));
  assert.ok(wa.url.includes('Hello%20Aisha%20Khan'));
  assert.equal(wa.recipient, '+971501234567');
  const mail = messageLink('email', draft)!;
  assert.ok(mail.url.startsWith('mailto:aisha@example.test?subject='));
  assert.ok(mail.url.includes('&body='));
});

test('missing customer phone or email explains why', () => {
  const draft = buildMessageDrafts(
    appointment({ contactNumber: null, customerEmail: null }),
    null,
  )[0]!;
  assert.match(draft.whatsappUnavailableReason ?? '', /No customer phone/);
  assert.match(draft.emailUnavailableReason ?? '', /No customer email/);
});
