-- Modification #161: one stock master.
-- The stock master used to be built from three ERP "Current Stock Valuation"
-- files (JDI, JMS, TGE) and so only listed items that had stock. It is now the
-- ERP "Item Listing" (every item once it is created): Item Code, Item Desc,
-- Maingrp Name, Grp Name, SUBGRPNAME, BRANDNAME. There is one table,
-- stock_master; the per-channel location rows, the channel list and the grade /
-- type / channel columns are gone. stock_uploads stays as the upload log (what
-- was uploaded, when, by whom, the report and the original file).

ALTER TABLE stock_items RENAME TO stock_master;
ALTER INDEX IF EXISTS stock_items_pkey RENAME TO stock_master_pkey;
ALTER INDEX IF EXISTS stock_items_desc_idx RENAME TO stock_master_desc_idx;
ALTER INDEX IF EXISTS stock_items_main_group_idx RENAME TO stock_master_main_group_idx;

ALTER TABLE stock_master DROP COLUMN grade;
ALTER TABLE stock_master DROP COLUMN item_type;
ALTER TABLE stock_master DROP COLUMN last_channel;
ALTER TABLE stock_master DROP COLUMN first_seen_at;
ALTER TABLE stock_master ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();
UPDATE stock_master SET last_seen_at = updated_at;

-- Item codes are looked up case-insensitively, so they must be unique that way.
DELETE FROM stock_master a
 USING stock_master b
 WHERE upper(a.item_code) = upper(b.item_code) AND a.item_code > b.item_code;
CREATE UNIQUE INDEX stock_master_code_upper_idx ON stock_master (upper(item_code));
CREATE INDEX stock_master_brand_idx ON stock_master (upper(brand));

DROP TABLE stock_positions;
DROP TABLE stock_item_channels;

-- Upload log: no channel any more; the earlier per-channel files are history only.
ALTER TABLE stock_uploads DROP COLUMN channel;
UPDATE stock_uploads SET file_bytes = NULL;
