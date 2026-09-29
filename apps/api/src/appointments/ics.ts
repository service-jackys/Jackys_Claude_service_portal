import type { AppointmentRecord } from '../../../../packages/db/src/appointments.js';

function escapeText(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll(/\r?\n/g, '\\n');
}

function compactDate(date: string): string {
  return date.replaceAll('-', '');
}

// RFC 5545 all-day events use an exclusive DTEND, so a one-day appointment
// on 2026-10-05 needs DTEND on 2026-10-06 -- see modification.md #8
// (appointments no longer carry a time, so this is now a whole-day event
// rather than a one-hour slot).
function nextDate(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function formatTimestamp(value: Date): string {
  return value
    .toISOString()
    .replaceAll(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

export function createAppointmentIcs(appointment: AppointmentRecord): string {
  const description = [
    `Customer: ${appointment.customerName}`,
    `Contact: ${appointment.contactNumber}`,
    appointment.faultDescription,
  ].join('\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    "PRODID:-//Jacky's Service Portal//Appointments//EN",
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeText(`${appointment.appointmentReference}@jackys-service-portal`)}`,
    `DTSTAMP:${formatTimestamp(appointment.createdAt)}`,
    `DTSTART;VALUE=DATE:${compactDate(appointment.appointmentDate)}`,
    `DTEND;VALUE=DATE:${compactDate(nextDate(appointment.appointmentDate))}`,
    `SUMMARY:${escapeText(`Service appointment ${appointment.appointmentReference}`)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `LOCATION:${escapeText(appointment.address ?? '')}`,
    `STATUS:${appointment.status === 'Cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.join('\r\n')}\r\n`;
}
