-- Modification #108: completed Tasks (ROI) items can be archived so they stay
-- out of the list and out of every weekly ROI, but can be restored later.
ALTER TABLE roi_tasks ADD COLUMN archived_at timestamptz;

CREATE INDEX roi_tasks_archived_idx ON roi_tasks (owner_profile_id, archived_at);
