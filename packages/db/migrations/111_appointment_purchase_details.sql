-- Modification #316: optional purchase details on an appointment (Schedules > New request).
-- All four are optional: the CCE may leave them blank and the technician writes them on the
-- printed appointment sheet. The serial number and invoice date carry into the job card's
-- Serial number and Purchase date when the job card is created from the appointment.
ALTER TABLE appointments
  ADD COLUMN serial_no text,
  ADD COLUMN invoice_number text,
  ADD COLUMN invoice_date date,
  ADD COLUMN received_date date;
