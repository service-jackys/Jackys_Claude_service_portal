-- Modification #306: the new fridge pricing goes live in the Service Revenue Dashboard.
--
-- One row. enabled = true means the dashboard prices fridges (and 13A plug lines) with the new logic;
-- false goes back to the old logic. The workbook figure of every line stays in
-- revenue_lines.workbook_revenue, so switching back restores the old figures exactly.
CREATE TABLE revenue_fridge_logic (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT true,
  small_base numeric(12, 2) NOT NULL DEFAULT 30 CHECK (small_base >= 0),
  small_over10 numeric(12, 2) NOT NULL DEFAULT 20 CHECK (small_over10 >= 0),
  small_minimum numeric(12, 2) NOT NULL DEFAULT 20 CHECK (small_minimum >= 0),
  option_b boolean NOT NULL DEFAULT true,
  plug_amount numeric(12, 2) NOT NULL DEFAULT 15 CHECK (plug_amount >= 0),
  updated_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO revenue_fridge_logic (id) VALUES (1) ON CONFLICT DO NOTHING;
