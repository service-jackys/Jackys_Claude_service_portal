-- Modification #194: admin can reopen an issued AMC quote, re-price it with
-- the current Admin prices and save it again, keeping the same AMC reference.
-- Every save replaces the live record and moves the previous version into
-- amc_contract_revisions, so nothing that was ever saved is lost.

ALTER TABLE amc_contracts
  ADD COLUMN revision integer NOT NULL DEFAULT 1,
  ADD COLUMN revision_note text;

CREATE TABLE amc_contract_revisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  amc_contract_id bigint NOT NULL REFERENCES amc_contracts (id) ON DELETE CASCADE,
  revision integer NOT NULL,
  -- Full content of that version: client/site fields, appliance schedule,
  -- all computed plans, status at that time.
  snapshot jsonb NOT NULL,
  revision_note text,
  -- When and by whom THAT version was saved.
  saved_at timestamptz NOT NULL,
  saved_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  -- When and by whom it was replaced by the next version.
  superseded_at timestamptz NOT NULL DEFAULT now(),
  superseded_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  UNIQUE (amc_contract_id, revision)
);

CREATE INDEX amc_contract_revisions_contract_idx
  ON amc_contract_revisions (amc_contract_id, revision DESC);

INSERT INTO permissions (code, description)
VALUES
  ('amc_contract.revise', 'Reopen and edit an issued AMC quote, and view its revision history')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'amc_contract.revise'
WHERE roles.code = 'admin'
ON CONFLICT DO NOTHING;
