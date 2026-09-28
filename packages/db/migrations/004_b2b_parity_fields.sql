-- Phase 0-4 parity fixes (see docs/PARITY_REVIEW_2026-09-28.md and to_do.md).
--
-- Adds the B2B/school workflow fields that exist in the live Google Apps Script
-- system (Schedules + Customer_Complaints sheets) but were missing end-to-end
-- from this migration: B2B Branch / School, School Contact Person, School
-- Contact Number, Customer Number (snapshot per record, same as the live
-- sheet), plus Sub Group (product-category field from the Stock Master) on
-- appointments. `sales_order_number` and `branch_id` already existed on both
-- tables from migration 001 — this migration does not touch those.
--
-- Also widens the customer_type taxonomy to match the live system exactly
-- (B2C / B2B / B2B-SalesChannel) instead of the placeholder
-- (individual / company / b2b) used since Phase 1. Local dev tables are
-- expected to be empty or test-only per the project's own guardrails ("do not
-- import live customer data into local development"), so existing rows are
-- remapped with a simple best-effort default (individual/company -> B2C,
-- b2b -> B2B) rather than left to violate the new constraint. There is no
-- live equivalent of 'company' as its own tier, so it folds into B2C here —
-- revisit if real historical data ever needs finer treatment during Phase 7
-- import/reconciliation.
--
-- IMPORTANT: the old constraints are dropped BEFORE the remap UPDATEs run.
-- Remapping a row to 'B2C'/'B2B'/'B2B-SalesChannel' while the old
-- ('individual'/'company'/'b2b') constraint is still active would itself
-- violate that still-active constraint — that ordering bug is what caused
-- the original failed run of this migration.

ALTER TABLE complaints ADD COLUMN b2b_branch_school text;
ALTER TABLE complaints ADD COLUMN school_contact_person text;
ALTER TABLE complaints ADD COLUMN school_contact_number text;
ALTER TABLE complaints ADD COLUMN customer_number text;

ALTER TABLE appointments ADD COLUMN b2b_branch_school text;
ALTER TABLE appointments ADD COLUMN school_contact_person text;
ALTER TABLE appointments ADD COLUMN school_contact_number text;
ALTER TABLE appointments ADD COLUMN customer_number text;
ALTER TABLE appointments ADD COLUMN sub_group text;

CREATE INDEX complaints_customer_number_idx ON complaints (customer_number)
  WHERE customer_number IS NOT NULL;
CREATE INDEX appointments_customer_number_idx ON appointments (customer_number)
  WHERE customer_number IS NOT NULL;

-- Drop the old, narrower constraints first so the remap below is free to
-- write the new taxonomy's values without tripping over the old one.
ALTER TABLE customers DROP CONSTRAINT customers_type_check;
ALTER TABLE complaints DROP CONSTRAINT complaints_type_check;
ALTER TABLE appointments DROP CONSTRAINT appointments_type_check;

-- Remap existing rows (if any) now that no constraint is blocking it.
-- Matches are case-insensitive and whitespace-trimmed so real dev/test data
-- entered with inconsistent casing or stray spaces (e.g. 'B2C ',
-- 'Individual') still maps correctly, and anything left over that still
-- isn't one of the three target values falls back to 'B2C'.
UPDATE customers SET customer_type = 'B2B' WHERE trim(lower(customer_type)) = 'b2b';
UPDATE customers SET customer_type = 'B2B-SalesChannel' WHERE trim(lower(customer_type)) IN ('b2b-saleschannel', 'b2b salechannel', 'b2b sales channel');
UPDATE customers SET customer_type = 'B2C' WHERE trim(lower(customer_type)) NOT IN ('b2c', 'b2b', 'b2b-saleschannel');

UPDATE complaints SET customer_type = 'B2B' WHERE trim(lower(customer_type)) = 'b2b';
UPDATE complaints SET customer_type = 'B2B-SalesChannel' WHERE trim(lower(customer_type)) IN ('b2b-saleschannel', 'b2b salechannel', 'b2b sales channel');
UPDATE complaints SET customer_type = 'B2C' WHERE trim(lower(customer_type)) NOT IN ('b2c', 'b2b', 'b2b-saleschannel');

UPDATE appointments SET customer_type = 'B2B' WHERE trim(lower(customer_type)) = 'b2b';
UPDATE appointments SET customer_type = 'B2B-SalesChannel' WHERE trim(lower(customer_type)) IN ('b2b-saleschannel', 'b2b salechannel', 'b2b sales channel');
UPDATE appointments SET customer_type = 'B2C' WHERE trim(lower(customer_type)) NOT IN ('b2c', 'b2b', 'b2b-saleschannel');

-- Now that every row conforms, add the new, wider constraint back.
ALTER TABLE customers ADD CONSTRAINT customers_type_check
  CHECK (customer_type IN ('B2C', 'B2B', 'B2B-SalesChannel'));

ALTER TABLE complaints ADD CONSTRAINT complaints_type_check
  CHECK (customer_type IN ('B2C', 'B2B', 'B2B-SalesChannel'));

ALTER TABLE appointments ADD CONSTRAINT appointments_type_check
  CHECK (customer_type IN ('B2C', 'B2B', 'B2B-SalesChannel'));
