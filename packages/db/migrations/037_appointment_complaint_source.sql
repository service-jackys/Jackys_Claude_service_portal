-- Modification #80: staff "New request" books an appointment directly (no
-- complaint record) and records how the request reached the service centre.
-- Null for appointments created from a complaint or imported earlier.
ALTER TABLE appointments
  ADD COLUMN complaint_source text,
  ADD CONSTRAINT appointments_complaint_source_check CHECK (
    complaint_source IS NULL OR complaint_source IN ('Email', 'WhatsApp', 'Phone', 'Salesman')
  );
