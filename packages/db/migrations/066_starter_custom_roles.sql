-- Starter custom roles (modification.md #176): Finance, Sales Coordinator and
-- Receptionist. They are ordinary custom roles -- an administrator can tick or
-- untick permissions, rename or delete them in Roles & permissions. Permissions
-- are only written when the role is created here, so nothing is overwritten if
-- a role with the same code or name already exists.
WITH created AS (
  INSERT INTO roles (code, display_name, is_builtin)
  VALUES
    ('finance', 'Finance', false),
    ('sales_coordinator', 'Sales Coordinator', false),
    ('receptionist', 'Receptionist', false)
  ON CONFLICT DO NOTHING
  RETURNING id, code
),
wanted (role_code, permission_code) AS (
  VALUES
    -- Finance: revenue dashboard, budget vs actual, reports and invoices; read-only elsewhere.
    ('finance', 'dashboard.read'), ('finance', 'revenue_dashboard.read'),
    ('finance', 'revenue_dashboard.tab_overview'), ('finance', 'revenue_dashboard.tab_explorer'),
    ('finance', 'revenue_dashboard.tab_logic'), ('finance', 'revenue_dashboard.tab_reports'),
    ('finance', 'revenue_dashboard.budget_actual'), ('finance', 'revenue_dashboard.budget_variance'),
    ('finance', 'revenue_dashboard.export'), ('finance', 'reports.read'),
    ('finance', 'billing.read'), ('finance', 'invoices.read'), ('finance', 'invoices.write'),
    ('finance', 'customers.read'), ('finance', 'amc_contract.read'), ('finance', 'quotation.read'),
    ('finance', 'di_jobs.read'), ('finance', 'rate_card.view'), ('finance', 'stock.read'),
    ('finance', 'chat.use'),
    -- Sales Coordinator: everything Sales has, plus job cards, invoices and D&I jobs (read).
    ('sales_coordinator', 'amc_contract.read'), ('sales_coordinator', 'amc_contract.write'),
    ('sales_coordinator', 'appointments.read'), ('sales_coordinator', 'appointments.write'),
    ('sales_coordinator', 'branches.read'), ('sales_coordinator', 'branches.write'),
    ('sales_coordinator', 'category_mappings.read'), ('sales_coordinator', 'chat.use'),
    ('sales_coordinator', 'complaints.read'), ('sales_coordinator', 'complaints.write'),
    ('sales_coordinator', 'customers.read'), ('sales_coordinator', 'customers.write'),
    ('sales_coordinator', 'dashboard.read'), ('sales_coordinator', 'inspection.read'),
    ('sales_coordinator', 'inspection.write'), ('sales_coordinator', 'quotation.read'),
    ('sales_coordinator', 'quotation.write'), ('sales_coordinator', 'rate_card.view'),
    ('sales_coordinator', 'rate_card_sale.read'), ('sales_coordinator', 'rate_card_sale.write'),
    ('sales_coordinator', 'reports.read'), ('sales_coordinator', 'sales_channels.read'),
    ('sales_coordinator', 'salesmen.read'), ('sales_coordinator', 'scheduler.read'),
    ('sales_coordinator', 'scheduler.write'), ('sales_coordinator', 'stock.read'),
    ('sales_coordinator', 'technicians.read'), ('sales_coordinator', 'technicians.write'),
    ('sales_coordinator', 'thomson_sale.read'), ('sales_coordinator', 'thomson_sale.write'),
    ('sales_coordinator', 'vas_sale.read'), ('sales_coordinator', 'vas_sale.write'),
    ('sales_coordinator', 'warranty_approval.read'), ('sales_coordinator', 'warranty_approval.write'),
    ('sales_coordinator', 'service_job_card.read'), ('sales_coordinator', 'service_job_card.write'),
    ('sales_coordinator', 'invoices.read'), ('sales_coordinator', 'di_jobs.read'),
    -- Receptionist: front desk -- log complaints, book appointments, see the schedule and job cards.
    ('receptionist', 'chat.use'), ('receptionist', 'dashboard.read'),
    ('receptionist', 'complaints.read'), ('receptionist', 'complaints.write'),
    ('receptionist', 'appointments.read'), ('receptionist', 'appointments.write'),
    ('receptionist', 'customers.read'), ('receptionist', 'customers.write'),
    ('receptionist', 'branches.read'), ('receptionist', 'scheduler.read'),
    ('receptionist', 'technicians.read'), ('receptionist', 'service_job_card.read'),
    ('receptionist', 'service_job_card.write'), ('receptionist', 'rate_card.view'),
    ('receptionist', 'stock.read')
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT created.id, permissions.id
FROM created
JOIN wanted ON wanted.role_code = created.code
JOIN permissions ON permissions.code = wanted.permission_code
ON CONFLICT DO NOTHING;
