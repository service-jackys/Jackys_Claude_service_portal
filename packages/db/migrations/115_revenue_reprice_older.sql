-- Modification #327: "Re-price older rows at current rates" switch in the Service Revenue Dashboard.
--
-- false (default, "As booked"): the older locked rows of the master workbook keep the labour they were
-- booked with (for example cookers at AED 80).
-- true ("Current rates"): the labour of those rows is rebuilt with the Rate card as it stands now.
-- The workbook figure of every line stays in revenue_lines.workbook_revenue, so the switch is reversible
-- and the master workbook is never touched.
ALTER TABLE revenue_fridge_logic
  ADD COLUMN reprice_older boolean NOT NULL DEFAULT false;
