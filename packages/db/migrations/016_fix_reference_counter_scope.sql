-- Modification #22 (see modification.md): appointment / job-card / quotation
-- / inspection / warranty-approval reference numbers are formatted as
-- PREFIX-YYYY-NNNNN -- year-level granularity only -- but each one's
-- reference_counters row was keyed by the *exact* scope date passed in
-- (the appointment date, job date, etc.), not the year. Two different
-- calendar dates in the same year each started counting from 1
-- independently, so their formatted references collided the moment both
-- reached the same sequence number (e.g. two unrelated appointments on
-- different days both becoming "APT-2026-00001"). That DB-level unique
-- violation on insert was then misreported to staff as "The complaint
-- already has an active appointment" (see appointments/service.ts's
-- generic unique-violation handling), which is what sent them looking for
-- a phantom scheduling conflict that never existed.
--
-- Complaint references are unaffected -- CMP-YYMMDD-NNN already encodes
-- the full date, matching how the complaint counter is scoped.
--
-- Fix: packages/db/src/references.ts now keys these five namespaces' rows
-- by 1 January of the relevant year instead of the exact date. Seed that
-- new key here from whatever has already been issued (per table), so the
-- next allocation continues the real sequence instead of colliding with a
-- reference that's already in use.

INSERT INTO reference_counters (namespace, scope_date, next_value)
SELECT 'appointment', make_date(year_part, 1, 1), max_value + 1
FROM (
  SELECT substring(appointment_reference from 5 for 4)::int AS year_part,
         max(substring(appointment_reference from 10)::int) AS max_value
  FROM appointments
  GROUP BY substring(appointment_reference from 5 for 4)
) sub
ON CONFLICT (namespace, scope_date) DO NOTHING;

INSERT INTO reference_counters (namespace, scope_date, next_value)
SELECT 'job_card', make_date(year_part, 1, 1), max_value + 1
FROM (
  SELECT substring(job_card_reference from 5 for 4)::int AS year_part,
         max(substring(job_card_reference from 10)::int) AS max_value
  FROM service_job_cards
  GROUP BY substring(job_card_reference from 5 for 4)
) sub
ON CONFLICT (namespace, scope_date) DO NOTHING;

INSERT INTO reference_counters (namespace, scope_date, next_value)
SELECT 'quotation', make_date(year_part, 1, 1), max_value + 1
FROM (
  SELECT substring(quotation_reference from 4 for 4)::int AS year_part,
         max(substring(quotation_reference from 9)::int) AS max_value
  FROM quotations
  GROUP BY substring(quotation_reference from 4 for 4)
) sub
ON CONFLICT (namespace, scope_date) DO NOTHING;

INSERT INTO reference_counters (namespace, scope_date, next_value)
SELECT 'inspection', make_date(year_part, 1, 1), max_value + 1
FROM (
  SELECT substring(inspection_reference from 4 for 4)::int AS year_part,
         max(substring(inspection_reference from 9)::int) AS max_value
  FROM inspections
  GROUP BY substring(inspection_reference from 4 for 4)
) sub
ON CONFLICT (namespace, scope_date) DO NOTHING;

INSERT INTO reference_counters (namespace, scope_date, next_value)
SELECT 'warranty_approval', make_date(year_part, 1, 1), max_value + 1
FROM (
  SELECT substring(approval_reference from 4 for 4)::int AS year_part,
         max(substring(approval_reference from 9)::int) AS max_value
  FROM warranty_approvals
  GROUP BY substring(approval_reference from 4 for 4)
) sub
ON CONFLICT (namespace, scope_date) DO NOTHING;
