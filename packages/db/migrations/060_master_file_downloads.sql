-- Modification #160: download the master Excel files from the portal.
-- The original bytes of the newest stock upload per channel and of the active
-- revenue / budget workbook are kept so they can be downloaded exactly as
-- uploaded. Older uploads have their bytes cleared (the row history stays), so
-- storage stays bounded. Uploads made before this migration have no bytes; the
-- portal rebuilds an Excel from the stored rows for those.
ALTER TABLE stock_uploads ADD COLUMN file_bytes bytea;
ALTER TABLE revenue_import_batches ADD COLUMN file_bytes bytea;
