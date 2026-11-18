-- Modification #274: one customer visit can carry several items. Each item stays its own
-- appointment (own number, own job card later); a visit group only links them together so
-- the lists, the daily schedule and the print sheets can show them as one visit.
CREATE TABLE visit_groups (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE appointments
  ADD COLUMN visit_group_id bigint REFERENCES visit_groups (id) ON DELETE SET NULL;

CREATE INDEX appointments_visit_group_idx
  ON appointments (visit_group_id)
  WHERE visit_group_id IS NOT NULL;
