-- Lets a service job card be created directly from a saved Quotation,
-- matching the live legacy system's "pull from Quotation" job-card flow
-- (see modification.md #18). Until now a job card could only be created
-- from a completed Appointment (service_job_cards.appointment_id was
-- NOT NULL UNIQUE). This migration keeps that appointment-sourced path
-- exactly as it is and adds a second, quotation-sourced path alongside it:
--
--   - appointment_id becomes nullable (still UNIQUE, so at most one job
--     card per appointment, same as before).
--   - quotation_id is new, nullable and UNIQUE, so at most one job card
--     per quotation (the "exclude quotations already used" rule).
--   - a CHECK constraint requires exactly one of the two to be set --
--     every job card still has exactly one source record, it's just
--     either an appointment or a quotation now, never both and never
--     neither.

ALTER TABLE service_job_cards
  ALTER COLUMN appointment_id DROP NOT NULL;

ALTER TABLE service_job_cards
  ADD COLUMN quotation_id bigint REFERENCES quotations (id) ON DELETE RESTRICT;

ALTER TABLE service_job_cards
  ADD CONSTRAINT service_job_cards_quotation_id_key UNIQUE (quotation_id);

ALTER TABLE service_job_cards
  ADD CONSTRAINT service_job_cards_source_check CHECK (
    (appointment_id IS NOT NULL AND quotation_id IS NULL)
    OR (appointment_id IS NULL AND quotation_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS service_job_cards_quotation_id_idx
  ON service_job_cards (quotation_id)
  WHERE quotation_id IS NOT NULL;
