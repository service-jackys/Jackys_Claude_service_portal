-- Reworks the service job-card feature to match the live Apps Script system's
-- actual business process (see conversation 2026-09-28: "A completed
-- appointment cannot receive a job card" bug report).
--
-- The live system's job card is created FROM a completed Scheduler entry (or
-- a Quotation, not yet built here): a CCE picks a completed, not-yet-used
-- appointment from a picker, its data is pulled into an editable form, and
-- the CCE fills in the service-specific fields before saving. This project
-- had it backwards -- it only allowed creating a job card from a
-- NON-terminal appointment and blocked Completed outright. That trigger
-- condition is fixed in application code (apps/api/src/job-cards/service.ts);
-- this migration adds the content fields the live job card actually carries
-- (docs/code.gs HEADERS_BY_TYPE['service-job-card']) so there is somewhere
-- for that pulled-and-edited data to live.

ALTER TABLE service_job_cards
  ADD COLUMN source_type text NOT NULL DEFAULT 'Scheduler',
  ADD COLUMN job_card_date date,
  ADD COLUMN customer_name text,
  ADD COLUMN customer_contact text,
  ADD COLUMN customer_address text,
  ADD COLUMN item_description text,
  ADD COLUMN model_no text,
  ADD COLUMN warranty_status text,
  ADD COLUMN complaint text,
  ADD COLUMN service_rendered text,
  ADD COLUMN period_from timestamptz,
  ADD COLUMN period_to timestamptz,
  ADD COLUMN time_consumed_hours numeric,
  ADD COLUMN parts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN total_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN service_charge numeric NOT NULL DEFAULT 0,
  ADD COLUMN grand_total numeric NOT NULL DEFAULT 0,
  ADD COLUMN amount_chargeable numeric,
  ADD COLUMN invoice_no text,
  ADD COLUMN delivery_date date,
  ADD COLUMN technician_name text,
  ADD COLUMN brand text,
  ADD COLUMN job_final_status text NOT NULL DEFAULT 'WIP',
  ADD COLUMN school_contact_person text,
  ADD COLUMN school_contact_number text,
  ADD COLUMN customer_number text;

-- Only 'Scheduler' is usable today -- Quotation records aren't a feature of
-- this project yet. Widen this list (don't rename the column) once
-- Quotations are built, matching the live system's two source types.
ALTER TABLE service_job_cards
  ADD CONSTRAINT service_job_cards_source_type_check CHECK (source_type IN ('Scheduler'));

-- Matches the live system's JOB_FINAL_STATUS_OPTIONS exactly (docs/code.gs).
-- This is a separate concept from this table's own `status` column: `status`
-- is this project's own workflow/lock state (Open/In Progress/Completed/
-- Cancelled, used for permissions and the terminal-edit lock); job_final_status
-- is the live system's outcome/diagnostic field a CCE sets as work progresses.
ALTER TABLE service_job_cards
  ADD CONSTRAINT service_job_cards_job_final_status_check
  CHECK (job_final_status IN ('WIP', 'BER', 'Rejected', 'Repair Completed', 'Spare pending'));
