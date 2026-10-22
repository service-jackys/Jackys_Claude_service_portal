-- Modification #125: a job card now has two statuses.
--   Job status  (job_final_status): the stage the work is in, and where it ended
--               up: Customer approval pending, WIP, Spare pending, Repair Completed, BER.
--   Final status (final_status):    how the job was closed: Delivered, Rejected or
--               Cancelled. NULL while the job is still open.
-- Splitting them keeps the BER outcome after the unit is delivered.
ALTER TABLE service_job_cards
  ADD COLUMN final_status text,
  ADD COLUMN final_status_reason text,
  ADD COLUMN final_status_at timestamptz;

-- Existing cards. A Delivered card keeps Repair Completed as its job status (the
-- earlier status was overwritten and is not recoverable); a Cancelled card was
-- cancelled mid-work (WIP); a Rejected card was waiting on the customer.
UPDATE service_job_cards
   SET final_status = 'Delivered', final_status_at = COALESCE(updated_at, now()),
       job_final_status = 'Repair Completed'
 WHERE job_final_status = 'Delivered';
UPDATE service_job_cards
   SET final_status = 'Cancelled', final_status_at = COALESCE(updated_at, now()),
       job_final_status = 'WIP'
 WHERE job_final_status = 'Cancelled';
UPDATE service_job_cards
   SET final_status = 'Rejected', final_status_at = COALESCE(updated_at, now()),
       job_final_status = 'Customer approval pending'
 WHERE job_final_status = 'Rejected';

ALTER TABLE service_job_cards
  DROP CONSTRAINT IF EXISTS service_job_cards_job_final_status_check;
ALTER TABLE service_job_cards
  ADD CONSTRAINT service_job_cards_job_final_status_check
  CHECK (job_final_status IN
    ('Customer approval pending', 'WIP', 'Spare pending', 'BER', 'Repair Completed'));
ALTER TABLE service_job_cards
  ADD CONSTRAINT service_job_cards_final_status_check
  CHECK (final_status IS NULL OR final_status IN ('Delivered', 'Rejected', 'Cancelled'));
ALTER TABLE service_job_cards
  ADD CONSTRAINT service_job_cards_final_status_reason_check
  CHECK (final_status_reason IS NULL OR final_status_reason IN
    ('Parts fitted, written off', 'Parts returned to stock', 'Diagnosis charge only',
     'Customer declined the quote', 'No charge', 'Other'));

CREATE INDEX service_job_cards_final_status_idx ON service_job_cards (final_status);
