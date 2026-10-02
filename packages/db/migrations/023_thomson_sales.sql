-- Modification #44 (modification.md): "Issue a Thomson Sale -- printable
-- proposal/quotation" (not the full Thomson Proposal workflow, which stays
-- a separate, not-yet-started item -- this is the same save+print+Issued
-- tab+dashboard-tile treatment VAS/AMC/Rate Card already received for
-- their calculators). Mirrors rate_card_sales (022_rate_card_sales.sql) in
-- shape -- a Thomson sale is one or more project line items priced as a
-- single quotation total -- but unlike Rate Card's line items (rate * qty
-- is always reproducible later), a Thomson line's price depends on admin
-- rates that can change (tech rate, region round-trip cost, add-on rates,
-- team capacity) and the "Customer transport share %" chosen at save time.
-- So, like amc_contracts' plans (020/021), each saved line item carries
-- its own FULLY COMPUTED numbers (unit rate, subtotal, add-on revenue,
-- transport cost, total price/cost/margin) rather than just the raw
-- inputs, so a reprint later always matches what the customer was quoted,
-- even if the admin pricing master changes afterwards.

ALTER TABLE reference_counters
  DROP CONSTRAINT reference_counters_namespace_check;

ALTER TABLE reference_counters
  ADD CONSTRAINT reference_counters_namespace_check
  CHECK (namespace IN ('complaint', 'appointment', 'job_card', 'quotation', 'inspection', 'vas_sale', 'amc_contract', 'rate_card_sale', 'thomson_sale'));

CREATE TABLE thomson_sales (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thomson_sale_reference text NOT NULL UNIQUE,
  sale_date date,
  client_name text,
  contact_number text,
  site_location text,
  -- The "Customer transport share %" input used when this sale's line
  -- items were computed (0-100).
  transport_share_percent numeric NOT NULL DEFAULT 0,
  -- [{ "region": "...", "applianceName": "...", "qty": 1, "siteVisits": 1,
  --    "trainingSessions": 0, "unitRate": 0, "applianceSubtotal": 0,
  --    "addonRevenue": 0, "transportCost": 0, "totalPrice": 0,
  --    "totalCost": 0, "margin": 0 }, ...]
  line_items jsonb NOT NULL,
  total_price numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  margin numeric NOT NULL DEFAULT 0,
  -- Optional free-text override reference, same purpose as vas_sales' /
  -- amc_contracts' / rate_card_sales' contract_ref.
  contract_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  updated_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  CONSTRAINT thomson_sales_reference_check CHECK (thomson_sale_reference ~ '^TH-[0-9]{4}-[0-9]{5}$')
);

CREATE INDEX thomson_sales_updated_idx ON thomson_sales (updated_at DESC);

INSERT INTO permissions (code, description)
VALUES
  ('thomson_sale.read', 'View issued Thomson sales and reprint quotations'),
  ('thomson_sale.write', 'Issue a Thomson sale and print its quotation')
ON CONFLICT (code) DO NOTHING;

-- Same roles as vas_sale/amc_contract/rate_card_sale read+write
-- (management, sales) -- issuing a Thomson sale is a day-to-day sales
-- action, not an admin one (the admin pricing master behind it stays
-- gated to pricing_config.*).
INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code IN ('thomson_sale.read', 'thomson_sale.write')
WHERE roles.code IN ('management', 'sales')
ON CONFLICT DO NOTHING;
