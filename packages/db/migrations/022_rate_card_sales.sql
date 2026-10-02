-- Modification #43 (modification.md): "Issue a Rate Card Sale -- printable
-- quotation". Mirrors vas_sales (019_vas_sales.sql) / amc_contracts
-- (020_amc_contracts.sql) as closely as the domain allows -- a Rate Card
-- sale is one or more line items (section + activity + rate + qty) priced
-- as a single quotation total, so line_items is a JSONB array rather than
-- flat columns, matching how the Rate Card Calculator (modification.md
-- #32) already represents them client-side.

ALTER TABLE reference_counters
  DROP CONSTRAINT reference_counters_namespace_check;

ALTER TABLE reference_counters
  ADD CONSTRAINT reference_counters_namespace_check
  CHECK (namespace IN ('complaint', 'appointment', 'job_card', 'quotation', 'inspection', 'vas_sale', 'amc_contract', 'rate_card_sale'));

CREATE TABLE rate_card_sales (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rate_card_sale_reference text NOT NULL UNIQUE,
  sale_date date,
  client_name text,
  contact_number text,
  site_location text,
  -- [{ "sectionLabel": "...", "activityName": "...", "rate": 0, "qty": 1 }, ...]
  -- the quote lines built in the Rate Card Calculator.
  line_items jsonb NOT NULL,
  total_value numeric NOT NULL DEFAULT 0,
  -- Optional free-text override reference, same purpose as vas_sales' /
  -- amc_contracts' contract_ref.
  contract_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  updated_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  CONSTRAINT rate_card_sales_reference_check CHECK (rate_card_sale_reference ~ '^RC-[0-9]{4}-[0-9]{5}$')
);

CREATE INDEX rate_card_sales_updated_idx ON rate_card_sales (updated_at DESC);

INSERT INTO permissions (code, description)
VALUES
  ('rate_card_sale.read', 'View issued Rate Card sales and reprint quotations'),
  ('rate_card_sale.write', 'Issue a Rate Card sale and print its quotation')
ON CONFLICT (code) DO NOTHING;

-- Same roles as vas_sale/amc_contract read+write (management, sales) --
-- issuing a Rate Card sale is a day-to-day sales action, not an admin one
-- (the admin pricing master behind it stays gated to pricing_config.*).
INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code IN ('rate_card_sale.read', 'rate_card_sale.write')
WHERE roles.code IN ('management', 'sales')
ON CONFLICT DO NOTHING;
