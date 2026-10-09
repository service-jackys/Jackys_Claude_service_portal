import type { AppointmentRecord } from '../../../../packages/db/src/appointments.js';

// Messages prepared from an appointment. The portal never sends anything: it
// builds the text and a wa.me / mailto link, staff press Send in their own app.
// Text is plain English so it reads the same in WhatsApp and in email.

export type MessageTemplate = 'customer_booked' | 'customer_rescheduled' | 'technician_assigned';
export type MessageChannel = 'whatsapp' | 'email';

export type MessageTechnician = {
  name: string;
  phone: string | null;
  email: string | null;
} | null;

export type MessageDraft = {
  template: MessageTemplate;
  label: string;
  recipientType: 'customer' | 'technician';
  recipientName: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  email: string | null;
  subject: string;
  body: string;
  // Why a channel cannot be used, so the screen can say it instead of just greying out.
  whatsappUnavailableReason: string | null;
  emailUnavailableReason: string | null;
};

const COMPANY = "Jacky's Distribution Service Centre";

// UAE numbers as typed in the portal ("0501234567", "050 123 4567", "+971 50 ...",
// or two numbers joined with " / ") -> digits with country code for wa.me.
// Only the first number is used. Returns null when it cannot be placed.
export function toWhatsAppNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const first = value.split(/\s*(?:\/|,|;|\n|\bor\b|&)\s*/i)[0] ?? '';
  let digits = first.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('971')) {
    digits = digits.slice(3);
    if (digits.startsWith('0')) digits = digits.slice(1);
  } else if (digits.startsWith('0')) {
    digits = digits.slice(1);
  } else if (digits.length > 9) {
    // Already international with another country code.
    return digits.length <= 15 ? digits : null;
  }
  if (digits.length === 9 || digits.length === 8) return `971${digits}`;
  return null;
}

export function formatMessageDate(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(value.valueOf())) return date;
  return value.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function productLine(a: AppointmentRecord): string {
  return [a.brand, a.model].filter(Boolean).join(' ') || 'your product';
}

function customerBody(
  a: AppointmentRecord,
  kind: 'booked' | 'rescheduled',
  tech: MessageTechnician,
) {
  const when = formatMessageDate(a.appointmentDate);
  const lines = [
    `Hello ${a.customerName},`,
    '',
    kind === 'booked'
      ? `This is ${COMPANY}. Your service appointment ${a.appointmentReference} for ${productLine(a)} is booked for ${when}.`
      : `This is ${COMPANY}. Your service appointment ${a.appointmentReference} for ${productLine(a)} has been rescheduled to ${when}.`,
  ];
  if (tech) lines.push(`Our technician ${tech.name} will visit you.`);
  lines.push(
    'Please keep your phone reachable on that day. Reply to this message if you need to change the date.',
    '',
    'Thank you.',
    COMPANY,
  );
  return lines.join('\n');
}

function technicianBody(a: AppointmentRecord, tech: NonNullable<MessageTechnician>) {
  const place = [a.address, a.region].filter(Boolean).join(', ');
  const lines = [
    `Hi ${tech.name}, new job for you.`,
    '',
    `Job: ${a.appointmentReference}`,
    `Date: ${formatMessageDate(a.appointmentDate)}`,
    `Customer: ${a.customerName}${a.contactNumber ? ` (${a.contactNumber})` : ''}`,
  ];
  if (place) lines.push(`Address: ${place}`);
  lines.push(`Product: ${productLine(a)}`);
  if (a.faultDescription) lines.push(`Fault: ${a.faultDescription}`);
  if (a.jobWarranty) lines.push(`Warranty: ${a.jobWarranty}`);
  lines.push('', COMPANY);
  return lines.join('\n');
}

export function buildMessageDrafts(
  appointment: AppointmentRecord,
  technician: MessageTechnician,
): MessageDraft[] {
  const customerWa = toWhatsAppNumber(appointment.contactNumber);
  const customerEmail = appointment.customerEmail || null;
  const customer = (
    template: 'customer_booked' | 'customer_rescheduled',
    label: string,
    kind: 'booked' | 'rescheduled',
  ): MessageDraft => ({
    template,
    label,
    recipientType: 'customer',
    recipientName: appointment.customerName,
    phone: appointment.contactNumber,
    whatsappNumber: customerWa,
    email: customerEmail,
    subject: `Service appointment ${appointment.appointmentReference} ${kind === 'booked' ? 'confirmed' : 'rescheduled'}`,
    body: customerBody(appointment, kind, technician),
    whatsappUnavailableReason: customerWa
      ? null
      : appointment.contactNumber
        ? 'The customer phone number does not look like a valid number.'
        : 'No customer phone number on this appointment.',
    emailUnavailableReason: customerEmail ? null : 'No customer email on this appointment.',
  });

  const drafts: MessageDraft[] = [
    customer('customer_booked', 'Customer: appointment booked', 'booked'),
    customer('customer_rescheduled', 'Customer: appointment rescheduled', 'rescheduled'),
  ];

  const techWa = toWhatsAppNumber(technician?.phone);
  drafts.push({
    template: 'technician_assigned',
    label: 'Technician: new job assigned',
    recipientType: 'technician',
    recipientName: technician?.name ?? null,
    phone: technician?.phone ?? null,
    whatsappNumber: techWa,
    email: technician?.email || null,
    subject: `New service job ${appointment.appointmentReference} on ${appointment.appointmentDate}`,
    body: technician ? technicianBody(appointment, technician) : '',
    whatsappUnavailableReason: !technician
      ? 'Assign a technician first.'
      : techWa
        ? null
        : 'The technician has no valid phone number.',
    emailUnavailableReason: !technician
      ? 'Assign a technician first.'
      : technician.email
        ? null
        : 'The technician has no email address.',
  });
  return drafts;
}

export function messageLink(
  channel: MessageChannel,
  draft: MessageDraft,
): { url: string; recipient: string } | null {
  if (channel === 'whatsapp') {
    if (!draft.whatsappNumber) return null;
    return {
      url: `https://wa.me/${draft.whatsappNumber}?text=${encodeURIComponent(draft.body)}`,
      recipient: `+${draft.whatsappNumber}`,
    };
  }
  if (!draft.email) return null;
  return {
    url: `mailto:${draft.email}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`,
    recipient: draft.email,
  };
}

// Only open appointments get message actions.
export function canSendMessages(status: string): boolean {
  return status === 'Scheduled' || status === 'In Progress';
}
