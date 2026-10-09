-- Modification #79: WhatsApp / email messages prepared from an appointment.
--
-- The portal does not send anything itself. Staff open a WhatsApp (wa.me) or
-- mailto link from the appointment and press Send in their own app. This table
-- records that a message was prepared and opened, who did it and the exact
-- text, so the team can see what the customer or technician was told. It is
-- not a delivery receipt.
CREATE TABLE appointment_messages (
  id bigserial PRIMARY KEY,
  appointment_id bigint NOT NULL REFERENCES appointments (id) ON DELETE CASCADE,
  template text NOT NULL,
  channel text NOT NULL,
  recipient_type text NOT NULL,
  recipient text NOT NULL,
  subject text,
  body text NOT NULL,
  sent_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_messages_template_check CHECK (
    template IN ('customer_booked', 'customer_rescheduled', 'technician_assigned')
  ),
  CONSTRAINT appointment_messages_channel_check CHECK (channel IN ('whatsapp', 'email')),
  CONSTRAINT appointment_messages_recipient_type_check CHECK (
    recipient_type IN ('customer', 'technician')
  )
);

CREATE INDEX appointment_messages_appointment_idx
  ON appointment_messages (appointment_id, created_at DESC);
