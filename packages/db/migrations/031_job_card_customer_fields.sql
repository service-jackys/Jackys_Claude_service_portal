-- Modification #66 (modification.md): service job cards (walk-in first, but every
-- source) now carry the same customer fields the complaint / appointment already
-- have: customer type, email, region, B2B branch / school and sales order no.
-- Existing cards stay NULL here; for appointment-sourced cards the API falls back
-- to the appointment's own values.
ALTER TABLE service_job_cards
  ADD COLUMN customer_type text,
  ADD COLUMN customer_email text,
  ADD COLUMN region text,
  ADD COLUMN b2b_branch_school text,
  ADD COLUMN sales_order_number text,
  ADD CONSTRAINT service_job_cards_customer_type_check
    CHECK (customer_type IS NULL OR customer_type IN ('B2C', 'B2B'));
