-- Modification #303: fridge capacity (litres) in the stock master.
--
-- Worked out from the item description on every ERP Item Listing upload (fridge and freezer groups
-- only); capacity_source says where the number came from. 'manual' values are typed by an admin and
-- are kept by uploads. Nothing prices from this yet: it feeds the D+I fridge scenario test.
ALTER TABLE stock_master
  ADD COLUMN capacity_litres numeric(7, 1),
  ADD COLUMN capacity_source text
    CHECK (capacity_source IN ('description', 'gross', 'cft', 'range', 'default', 'manual', 'check'));

CREATE INDEX stock_master_capacity_source_idx ON stock_master (capacity_source)
  WHERE capacity_source IS NOT NULL;
