ALTER TABLE reference_counters
  DROP CONSTRAINT reference_counters_namespace_check;

ALTER TABLE reference_counters
  ADD CONSTRAINT reference_counters_namespace_check
  CHECK (namespace IN ('complaint', 'appointment', 'job_card'));

CREATE TABLE service_job_cards (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_card_reference text NOT NULL UNIQUE,
  appointment_id bigint NOT NULL UNIQUE REFERENCES appointments (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'Open',
  finalized_at timestamptz,
  finalized_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  updated_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  CONSTRAINT service_job_cards_reference_check CHECK (job_card_reference ~ '^JBC-[0-9]{4}-[0-9]{5}$'),
  CONSTRAINT service_job_cards_status_check CHECK (status IN ('Open', 'In Progress', 'Completed', 'Cancelled')),
  CONSTRAINT service_job_cards_finalized_check CHECK (
    (status IN ('Completed', 'Cancelled') AND finalized_at IS NOT NULL AND finalized_by IS NOT NULL)
    OR (status IN ('Open', 'In Progress') AND finalized_at IS NULL AND finalized_by IS NULL)
  )
);

CREATE INDEX service_job_cards_status_updated_idx
  ON service_job_cards (status, updated_at DESC);

CREATE TABLE service_job_card_status_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_card_id bigint NOT NULL REFERENCES service_job_cards (id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  changed_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  reason text,
  request_id text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_job_card_history_from_status_check CHECK (
    from_status IS NULL OR from_status IN ('Open', 'In Progress', 'Completed', 'Cancelled')
  ),
  CONSTRAINT service_job_card_history_to_status_check CHECK (
    to_status IN ('Open', 'In Progress', 'Completed', 'Cancelled')
  )
);

CREATE INDEX service_job_card_history_job_card_idx
  ON service_job_card_status_history (job_card_id, changed_at ASC, id ASC);
