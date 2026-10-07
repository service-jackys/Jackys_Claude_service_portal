-- One status for a job card: "Job final status" is now the only status users
-- see. Delivered (handed to the customer) and Cancelled join the list. The
-- old Open / In Progress / Completed / Cancelled column stays as an internal
-- value derived from it (dashboards and TAT still read it).
ALTER TABLE service_job_cards
  DROP CONSTRAINT IF EXISTS service_job_cards_job_final_status_check;
ALTER TABLE service_job_cards
  ADD CONSTRAINT service_job_cards_job_final_status_check
  CHECK (job_final_status IN
    ('WIP', 'Spare pending', 'BER', 'Rejected', 'Repair Completed', 'Delivered', 'Cancelled'));

-- Job cards closed under the old two-status model keep their lock.
UPDATE service_job_cards
   SET job_final_status = 'Delivered'
 WHERE status = 'Completed'
   AND job_final_status IN ('WIP', 'Spare pending', 'Repair Completed');
UPDATE service_job_cards
   SET job_final_status = 'Cancelled'
 WHERE status = 'Cancelled';

-- The history now records job-status changes, so it accepts those values too.
ALTER TABLE service_job_card_status_history
  DROP CONSTRAINT IF EXISTS service_job_card_history_from_status_check;
ALTER TABLE service_job_card_status_history
  DROP CONSTRAINT IF EXISTS service_job_card_history_to_status_check;
ALTER TABLE service_job_card_status_history
  ADD CONSTRAINT service_job_card_history_from_status_check CHECK (
    from_status IS NULL OR from_status IN
      ('Open', 'In Progress', 'Completed', 'Cancelled',
       'WIP', 'Spare pending', 'BER', 'Rejected', 'Repair Completed', 'Delivered')
  );
ALTER TABLE service_job_card_status_history
  ADD CONSTRAINT service_job_card_history_to_status_check CHECK (
    to_status IN
      ('Open', 'In Progress', 'Completed', 'Cancelled',
       'WIP', 'Spare pending', 'BER', 'Rejected', 'Repair Completed', 'Delivered')
  );
