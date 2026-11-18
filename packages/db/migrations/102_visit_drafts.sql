-- Modification #275: a visit can be saved as a draft (items now, booking later).
-- The draft keeps the shared customer fields and the items as entered, so
-- nothing is validated against capacity until the visit is actually booked.
CREATE TABLE visit_drafts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payload jsonb NOT NULL,
  customer_name text NOT NULL,
  item_count integer NOT NULL CHECK (item_count >= 1),
  created_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX visit_drafts_created_at_idx ON visit_drafts (created_at);
