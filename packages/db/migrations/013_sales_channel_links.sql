-- Modification #17 (see modification.md): two sales channels now, JER-C/INS
-- (the original CSIISI-sourced data) and JDI (a second invoice source added
-- 2026-09-29). Links a B2B branch, a salesman, and eventually an
-- appointment/job card to the channel that sold to them.

-- ---------------------------------------------------------------------
-- 1. New columns
-- ---------------------------------------------------------------------
-- Job cards already carry a free-text sales_channel column (migration 011);
-- it just defaults to the linked salesman's channel now instead of always
-- null (see apps/api/src/job-cards/service.ts), so no new column needed
-- there -- only on the two master lists that need to know a channel.
ALTER TABLE b2b_branches ADD COLUMN sales_channel text;
ALTER TABLE salesmen ADD COLUMN sales_channel text;

-- ---------------------------------------------------------------------
-- 2. Backfill: every branch/salesman on file today came from the CSIISI
-- (JER-C/INS) invoice import -- see migration 010/011. The JDI batch is
-- imported separately afterwards via scripts/import-b2b-branches.mjs
-- (packages/db/seed/b2b_branches_jdi.json), which sets sales_channel='JDI'
-- on its own rows via upsert, correctly overwriting the 2 branches that
-- appear in both sources (their most recent invoice is the JDI one).
-- ---------------------------------------------------------------------
UPDATE b2b_branches SET sales_channel = 'JER-C/INS' WHERE sales_channel IS NULL;
UPDATE salesmen SET sales_channel = 'JER-C/INS' WHERE sales_channel IS NULL;

-- Three existing salesmen (AFAQUE KHAN, JAMES T. PAUL, SHIVA) sell under
-- both channels in the invoice data. A salesman links to one channel only
-- (2026-09-29 product decision), so these three move to JDI -- the channel
-- Vysakh confirmed they're actively selling for now.
UPDATE salesmen
SET sales_channel = 'JDI'
WHERE lower(name) IN (lower('AFAQUE KHAN'), lower('JAMES T. PAUL'), lower('SHIVA'));

-- Ensure both channel names exist in the sales_channels master.
INSERT INTO sales_channels (name)
SELECT 'JER-C/INS' WHERE NOT EXISTS (SELECT 1 FROM sales_channels WHERE lower(name) = lower('JER-C/INS'));
INSERT INTO sales_channels (name)
SELECT 'JDI' WHERE NOT EXISTS (SELECT 1 FROM sales_channels WHERE lower(name) = lower('JDI'));

-- New JDI salesmen not already on file: two real people from the invoice
-- data (DANISH ALAM, SAI RAVIKANTH) plus Vysakh, added manually (he isn't
-- in the invoice data but sells for JDI too).
INSERT INTO salesmen (name, sales_channel)
VALUES ('DANISH ALAM', 'JDI'), ('SAI RAVIKANTH', 'JDI'), ('VYSAKH', 'JDI')
ON CONFLICT DO NOTHING;
