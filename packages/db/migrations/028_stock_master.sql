-- Modification #58: Stock Master (item-code lookup).
--
-- The ERP "Current Stock Valuation" export is uploaded per sales channel
-- (JDI, JMS, TGE). stock_positions keeps the exact ERP columns, one row per
-- location per item, replaced wholesale for a channel on every upload.
-- stock_items is the unique-by-ItemCode view used for item search; the newest
-- upload wins when channels disagree about a descriptive field.

CREATE TABLE stock_uploads (
  id bigserial PRIMARY KEY,
  channel text NOT NULL CHECK (channel IN ('JDI', 'JMS', 'TGE')),
  file_name text NOT NULL,
  file_sha256 text NOT NULL,
  row_count integer NOT NULL,
  item_count integer NOT NULL,
  new_items integer NOT NULL DEFAULT 0,
  changed_items integer NOT NULL DEFAULT 0,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stock_uploads_channel_idx ON stock_uploads (channel, uploaded_at DESC);

CREATE TABLE stock_items (
  item_code text PRIMARY KEY,
  item_desc text NOT NULL,
  grade text,
  main_group text,
  group_name text,
  sub_group text,
  brand text,
  item_type text,
  last_channel text NOT NULL CHECK (last_channel IN ('JDI', 'JMS', 'TGE')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stock_items_desc_idx ON stock_items (lower(item_desc));
CREATE INDEX stock_items_main_group_idx ON stock_items (main_group);

-- Which channel lists which item, and when its channel last sent it. An item
-- whose last_seen_at is older than the channel's latest upload has dropped out
-- of the ERP export ("not seen") but is kept.
CREATE TABLE stock_item_channels (
  item_code text NOT NULL REFERENCES stock_items(item_code) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('JDI', 'JMS', 'TGE')),
  last_seen_at timestamptz NOT NULL,
  PRIMARY KEY (item_code, channel)
);

CREATE TABLE stock_positions (
  id bigserial PRIMARY KEY,
  channel text NOT NULL CHECK (channel IN ('JDI', 'JMS', 'TGE')),
  upload_id bigint NOT NULL REFERENCES stock_uploads(id) ON DELETE CASCADE,
  location text,
  locn_desc text,
  item_code text NOT NULL,
  item_desc text,
  grade text,
  stock numeric(18, 4),
  wac numeric(18, 4),
  value numeric(18, 4),
  transit numeric(18, 4),
  reserved numeric(18, 4),
  main_group text,
  group_name text,
  sub_group text,
  brand text,
  item_type text,
  last_grn numeric(18, 4),
  last_grn_date date,
  landed_cost numeric(18, 4)
);

CREATE INDEX stock_positions_item_idx ON stock_positions (item_code);
CREATE INDEX stock_positions_channel_idx ON stock_positions (channel);

INSERT INTO permissions (code, description)
VALUES
  ('stock.read', 'Search the stock master by item code'),
  ('stock.write', 'Upload the ERP stock master')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'stock.read'
WHERE roles.code IN ('user', 'sales', 'management', 'admin')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'stock.write'
WHERE roles.code = 'admin'
ON CONFLICT DO NOTHING;
