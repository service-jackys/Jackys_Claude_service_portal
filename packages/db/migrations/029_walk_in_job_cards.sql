-- Modification #59: walk-in service job cards and stock-master item fields on
-- every job card.
--
-- 1. A job card can now start with no complaint, appointment or quotation:
--    the customer walks into the service centre. Such a card has
--    source_type 'Walk-in', no appointment_id and no quotation_id, its own
--    WJC-YYYY-NNNNN number series, and its TAT starts at intake_at.
-- 2. The source_type check only ever allowed 'Scheduler', although quotation
--    job cards (#18) insert 'Quotation'. It is widened here, which also makes
--    creating a job card from a quotation work.
-- 3. Job cards carry the stock-master item fields (item code, main group,
--    group, sub group) plus walk-in intake details.

ALTER TABLE reference_counters
  DROP CONSTRAINT reference_counters_namespace_check;
ALTER TABLE reference_counters
  ADD CONSTRAINT reference_counters_namespace_check
  CHECK (namespace IN (
    'complaint', 'appointment', 'job_card', 'quotation', 'inspection', 'vas_sale',
    'amc_contract', 'rate_card_sale', 'thomson_sale', 'walk_in_job_card'
  ));

ALTER TABLE service_job_cards
  DROP CONSTRAINT service_job_cards_reference_check;
ALTER TABLE service_job_cards
  ADD CONSTRAINT service_job_cards_reference_check
  CHECK (job_card_reference ~ '^(JBC|WJC)-[0-9]{4}-[0-9]{5}$');

ALTER TABLE service_job_cards
  DROP CONSTRAINT service_job_cards_source_type_check;
ALTER TABLE service_job_cards
  ADD CONSTRAINT service_job_cards_source_type_check
  CHECK (source_type IN ('Scheduler', 'Quotation', 'Walk-in'));

ALTER TABLE service_job_cards
  DROP CONSTRAINT service_job_cards_source_check;
ALTER TABLE service_job_cards
  ADD CONSTRAINT service_job_cards_source_check CHECK (
    (appointment_id IS NOT NULL AND quotation_id IS NULL AND source_type = 'Scheduler')
    OR (appointment_id IS NULL AND quotation_id IS NOT NULL AND source_type = 'Quotation')
    OR (appointment_id IS NULL AND quotation_id IS NULL AND source_type = 'Walk-in')
  );

ALTER TABLE service_job_cards
  ADD COLUMN item_code text,
  ADD COLUMN main_group text,
  ADD COLUMN group_name text,
  ADD COLUMN sub_group text,
  ADD COLUMN item_in_master boolean,
  ADD COLUMN serial_no text,
  ADD COLUMN purchase_date date,
  ADD COLUMN accessories_received text,
  ADD COLUMN condition_notes text,
  ADD COLUMN intake_at timestamptz;

CREATE INDEX service_job_cards_walk_in_idx
  ON service_job_cards (customer_contact)
  WHERE source_type = 'Walk-in';
