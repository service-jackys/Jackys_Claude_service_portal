-- Modification #264: a task can be linked to one quotation, inspection or service job card
-- so staff can follow it up from Tasks. Both columns are optional; every existing task is
-- unchanged. record_label keeps the reference and customer as they were when the task was
-- created, so the task still reads well if the record is later renamed or removed.
ALTER TABLE roi_tasks
  ADD COLUMN record_type text,
  ADD COLUMN record_id bigint,
  ADD COLUMN record_label text,
  ADD CONSTRAINT roi_tasks_record_type_check CHECK (
    record_type IS NULL OR record_type IN ('quotation', 'inspection', 'job_card')
  ),
  ADD CONSTRAINT roi_tasks_record_pair_check CHECK (
    (record_type IS NULL AND record_id IS NULL) OR (record_type IS NOT NULL AND record_id IS NOT NULL)
  );

CREATE INDEX roi_tasks_record_idx ON roi_tasks (record_type, record_id) WHERE record_type IS NOT NULL;
