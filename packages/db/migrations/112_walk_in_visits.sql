-- Modification #317: Walk-in job card for several units in one visit.
-- Each unit is still its own job card. A visit groups them under one reference (WI-2026-00012),
-- with the unit's position ("unit 3 of 7"). visit_request_key makes a double press / retry safe:
-- the same key can never create the same unit twice.
-- walk_in_settings holds the units-per-visit limit (default 10, changed only by an administrator).

ALTER TABLE reference_counters DROP CONSTRAINT reference_counters_namespace_check;
ALTER TABLE reference_counters
  ADD CONSTRAINT reference_counters_namespace_check
  CHECK (namespace IN (
    'complaint', 'appointment', 'job_card', 'quotation', 'inspection', 'vas_sale',
    'amc_contract', 'rate_card_sale', 'thomson_sale', 'walk_in_job_card', 'warranty_approval',
    'tax_invoice', 'di_job', 'walk_in_visit'
  ));

ALTER TABLE service_job_cards
  ADD COLUMN visit_reference text,
  ADD COLUMN visit_unit_no smallint,
  ADD COLUMN visit_unit_count smallint,
  ADD COLUMN visit_request_key text;

CREATE INDEX service_job_cards_visit_reference_idx
  ON service_job_cards (visit_reference) WHERE visit_reference IS NOT NULL;
CREATE UNIQUE INDEX service_job_cards_visit_request_key
  ON service_job_cards (visit_request_key, visit_unit_no) WHERE visit_request_key IS NOT NULL;
-- Serial number look-up (same S/N already open?), ignoring case and spaces.
CREATE INDEX service_job_cards_serial_norm_idx
  ON service_job_cards (upper(regexp_replace(serial_no, '[[:space:]]', '', 'g')))
  WHERE serial_no IS NOT NULL;

CREATE TABLE walk_in_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  max_units_per_visit smallint NOT NULL DEFAULT 10 CHECK (max_units_per_visit BETWEEN 1 AND 500),
  updated_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO walk_in_settings (id) VALUES (1);
