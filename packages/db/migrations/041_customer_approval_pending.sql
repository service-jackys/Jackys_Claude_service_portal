-- Modification #100: new job status "Customer approval pending" (a job waits
-- here until the customer approves the out-of-warranty work), and approval
-- requests record how the decision was made (customer link, phone, email...).
ALTER TABLE service_job_cards
  DROP CONSTRAINT IF EXISTS service_job_cards_job_final_status_check;
ALTER TABLE service_job_cards
  ADD CONSTRAINT service_job_cards_job_final_status_check
  CHECK (job_final_status IN
    ('Customer approval pending', 'WIP', 'Spare pending', 'BER', 'Rejected',
     'Repair Completed', 'Delivered', 'Cancelled'));

ALTER TABLE service_job_card_status_history
  DROP CONSTRAINT IF EXISTS service_job_card_history_from_status_check;
ALTER TABLE service_job_card_status_history
  DROP CONSTRAINT IF EXISTS service_job_card_history_to_status_check;
ALTER TABLE service_job_card_status_history
  ADD CONSTRAINT service_job_card_history_from_status_check CHECK (
    from_status IS NULL OR from_status IN
      ('Open', 'In Progress', 'Completed', 'Cancelled',
       'Customer approval pending', 'WIP', 'Spare pending', 'BER', 'Rejected',
       'Repair Completed', 'Delivered')
  );
ALTER TABLE service_job_card_status_history
  ADD CONSTRAINT service_job_card_history_to_status_check CHECK (
    to_status IN
      ('Open', 'In Progress', 'Completed', 'Cancelled',
       'Customer approval pending', 'WIP', 'Spare pending', 'BER', 'Rejected',
       'Repair Completed', 'Delivered')
  );

-- How an approval was given. NULL on requests that are still pending.
ALTER TABLE warranty_approvals
  ADD COLUMN decision_method text,
  ADD CONSTRAINT warranty_approvals_decision_method_check CHECK (
    decision_method IS NULL OR decision_method IN
      ('Customer link', 'Phone', 'Email', 'WhatsApp', 'In person', 'Other')
  );
UPDATE warranty_approvals SET decision_method = 'Customer link'
 WHERE status IN ('Approved', 'Declined') AND decision_method IS NULL;
