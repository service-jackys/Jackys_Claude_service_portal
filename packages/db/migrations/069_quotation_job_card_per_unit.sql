-- A quotation with several units (a school, a building) can now have one service
-- job card per unit, instead of a single job card for the whole quotation.
--
--   quotation_unit_key  '' = the job card covers the whole quotation (every job card
--                       made before this change, and quotations with one unit or
--                       none); otherwise the unit key (u1, u2, ...) of the unit it
--                       was created for.
--
-- The old rule "at most one job card per quotation" becomes "at most one job card
-- per quotation and unit", so the same unit cannot get two job cards.

ALTER TABLE service_job_cards
  ADD COLUMN IF NOT EXISTS quotation_unit_key text NOT NULL DEFAULT '';

ALTER TABLE service_job_cards
  DROP CONSTRAINT IF EXISTS service_job_cards_quotation_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS service_job_cards_quotation_unit_key
  ON service_job_cards (quotation_id, quotation_unit_key)
  WHERE quotation_id IS NOT NULL;
