-- Modification #247: other sheets of the Service Dashboard master workbook (Net Sale Current,
-- CSIDI, CSIDO, CSIII) are kept with the revenue batch they were uploaded in, so the Ask AI
-- can answer questions from them. Rows are stored as JSON (one object per sheet row) because
-- each sheet has its own columns. Customer names and codes, TRN numbers and free-text remarks
-- are dropped when the file is read and are never stored here.

CREATE TABLE workbook_sheet_rows (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id bigint NOT NULL REFERENCES revenue_import_batches (id) ON DELETE CASCADE,
  sheet text NOT NULL,
  row_no integer NOT NULL,
  data jsonb NOT NULL
);

CREATE INDEX workbook_sheet_rows_batch_sheet_idx ON workbook_sheet_rows (batch_id, sheet);
