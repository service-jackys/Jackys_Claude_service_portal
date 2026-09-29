-- Modification #8 (see modification.md): one-time reset requested by the
-- user for a clean end-to-end test pass now that appointment_time is gone
-- and the new master data (salesmen, sales_channels, technician daily cap)
-- is in place. Migrations only ever run once per database (tracked by
-- checksum), so this TRUNCATE fires exactly once for this deployment and
-- never again on a later `db:migrate` run.
--
-- Wiped: everything transactional (complaints, appointments, job cards,
-- quotations, inspections, warranty approvals, their attachments/history,
-- customers/branches created from that data, audit events, and the unused
-- draft-schedule tables).
-- Kept: profiles/roles/permissions (logins), technicians, the B2B branch
-- master list, and the new salesmen / sales_channels master lists.

TRUNCATE TABLE
  complaint_status_history,
  appointment_status_history,
  service_job_card_status_history,
  job_card_attachments,
  service_job_cards,
  appointments,
  complaints,
  quotations,
  inspections,
  warranty_approvals,
  draft_schedule_items,
  draft_schedules,
  customers,
  branches,
  audit_events,
  reference_counters,
  legacy_references,
  import_batches
RESTART IDENTITY CASCADE;
