-- Modification #127: closing outcomes move back into Job status.
--   Job status:   Customer approval pending, WIP, Spare pending, BER, Rejected,
--                 Cancelled, Repair Completed.
--   Final status: Delivered only (the unit has been handed back to the customer).
-- A reason is recorded when a BER, Rejected or Cancelled job is delivered, and a
-- B2C job that still carries spare parts needs a manager's approval first.

-- Cards that were closed as Rejected or Cancelled keep that outcome as their job
-- status. They count as delivered only when a delivery date was recorded.
UPDATE service_job_cards
   SET job_final_status = 'Rejected',
       final_status = CASE WHEN delivery_date IS NOT NULL THEN 'Delivered' END,
       final_status_at = CASE WHEN delivery_date IS NOT NULL THEN COALESCE(final_status_at, now()) END
 WHERE final_status = 'Rejected';
UPDATE service_job_cards
   SET job_final_status = 'Cancelled',
       final_status = CASE WHEN delivery_date IS NOT NULL THEN 'Delivered' END,
       final_status_at = CASE WHEN delivery_date IS NOT NULL THEN COALESCE(final_status_at, now()) END
 WHERE final_status = 'Cancelled';
UPDATE service_job_cards
   SET job_final_status = 'Rejected'
 WHERE job_final_status = 'Customer approval pending'
   AND final_status_reason = 'Customer declined the quote' AND final_status IS NULL;

ALTER TABLE service_job_cards DROP CONSTRAINT IF EXISTS service_job_cards_job_final_status_check;
ALTER TABLE service_job_cards
  ADD CONSTRAINT service_job_cards_job_final_status_check
  CHECK (job_final_status IN
    ('Customer approval pending', 'WIP', 'Spare pending', 'BER', 'Rejected', 'Cancelled',
     'Repair Completed'));
ALTER TABLE service_job_cards DROP CONSTRAINT IF EXISTS service_job_cards_final_status_check;
ALTER TABLE service_job_cards
  ADD CONSTRAINT service_job_cards_final_status_check
  CHECK (final_status IS NULL OR final_status = 'Delivered');
ALTER TABLE service_job_cards DROP CONSTRAINT IF EXISTS service_job_cards_final_status_reason_check;
ALTER TABLE service_job_cards
  ADD CONSTRAINT service_job_cards_final_status_reason_check
  CHECK (final_status_reason IS NULL OR final_status_reason IN
    ('Parts fitted, written off', 'Parts returned to stock', 'Diagnosis charge only',
     'Customer declined the quote', 'No charge', 'Other',
     'Duplicate job card', 'Entered by mistake', 'Customer cancelled the job'));

-- Manager approval to close a B2C BER/Rejected job that carries spare parts.
ALTER TABLE service_job_cards
  ADD COLUMN closure_approval_status text,
  ADD COLUMN closure_approval_requested_by bigint REFERENCES profiles(id),
  ADD COLUMN closure_approval_requested_at timestamptz,
  ADD COLUMN closure_approval_decided_by bigint REFERENCES profiles(id),
  ADD COLUMN closure_approval_decided_at timestamptz,
  ADD COLUMN closure_approval_note text,
  ADD CONSTRAINT service_job_cards_closure_approval_check
    CHECK (closure_approval_status IS NULL
      OR closure_approval_status IN ('Pending', 'Approved', 'Declined'));

INSERT INTO permissions (code, description)
VALUES ('service_job_card.approve_closure',
        'Job card: approve closing a B2C BER or Rejected job that carries spare parts')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
CROSS JOIN permissions
WHERE roles.code IN ('admin', 'management')
  AND permissions.code = 'service_job_card.approve_closure'
ON CONFLICT DO NOTHING;
