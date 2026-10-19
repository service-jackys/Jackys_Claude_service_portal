-- Separate permissions for Invoices, Billing and the Quote Calculators (#114).
-- They used to ride on other permissions: Invoices and Billing on
-- service_job_card.read / .write, the three calculators on pricing_config.read.
-- Every role that held the old permission keeps access to what it could open
-- before, so nobody loses a page; an administrator can now switch each one
-- on or off in Roles & permissions.
INSERT INTO permissions (code, description)
VALUES
  ('invoices.read', 'Invoice [Warranty and billing]: open the page and view invoices'),
  ('invoices.write', 'Invoice [Warranty and billing]: issue invoices and confirm payment'),
  ('billing.read', 'Billing: ledger, bill-to statement, cost allocation and Excel download'),
  ('quote_calculators.use', 'Quote Calculators: VAS, AMC and Thomson (reads their rate data only)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM role_permissions rp
JOIN permissions base ON base.id = rp.permission_id AND base.code = 'service_job_card.read'
JOIN permissions p ON p.code IN ('invoices.read', 'billing.read')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM role_permissions rp
JOIN permissions base ON base.id = rp.permission_id AND base.code = 'service_job_card.write'
JOIN permissions p ON p.code = 'invoices.write'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM role_permissions rp
JOIN permissions base ON base.id = rp.permission_id AND base.code = 'pricing_config.read'
JOIN permissions p ON p.code = 'quote_calculators.use'
ON CONFLICT DO NOTHING;
