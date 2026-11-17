-- Delivery & Installation: the Transport rules tab gets its own permissions so an admin can hide it
-- from, or let a role change it. Defaults keep today's behaviour: every role that can read D&I jobs
-- can view the tab; every role that can configure D&I (admin) can change the rules.
INSERT INTO permissions (code, description)
VALUES
  ('di_jobs.transport_rules.read', 'Delivery & Installation: view the Transport rules tab'),
  ('di_jobs.transport_rules.write', 'Delivery & Installation: change the Transport rules (daily trip cap and switches)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, np.id
FROM role_permissions rp
JOIN permissions op ON op.id = rp.permission_id AND op.code = 'di_jobs.read'
JOIN permissions np ON np.code = 'di_jobs.transport_rules.read'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, np.id
FROM role_permissions rp
JOIN permissions op ON op.id = rp.permission_id AND op.code = 'di_jobs.configure'
JOIN permissions np ON np.code = 'di_jobs.transport_rules.write'
ON CONFLICT DO NOTHING;
