-- A repaired unit must carry its printed sticker before the job card is marked Delivered.
-- sticker_attached records that the sticker was stuck on the unit. Existing job cards
-- start at false; job cards imported from the old sheet are exempt in the application.
ALTER TABLE service_job_cards
  ADD COLUMN sticker_attached boolean NOT NULL DEFAULT false,
  ADD COLUMN sticker_attached_at timestamptz,
  ADD COLUMN sticker_attached_by bigint REFERENCES profiles (id) ON DELETE SET NULL;
