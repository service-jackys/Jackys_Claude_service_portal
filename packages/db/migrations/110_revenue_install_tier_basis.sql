-- Modification #314: installation-only (CSIII) discount tier basis in the Service Revenue Dashboard.
--
-- 'invoice' (default, the portal rule): every installation-only line gets the discount tier for the
-- invoice's total installation units, the same as delivery + installation and the billing engine.
-- 'line': each line is read on its own quantity, as the master workbook does. The workbook figure of
-- every line stays in revenue_lines.workbook_revenue, so either setting is reversible.
ALTER TABLE revenue_fridge_logic
  ADD COLUMN install_tier_basis text NOT NULL DEFAULT 'invoice'
  CHECK (install_tier_basis IN ('invoice', 'line'));
