# Development Plan

**Project:** Jacky's Service Portal migration
**Repository:** `https://github.com/service-jackys/Jackys-service-portal`
**Current production system:** Google Apps Script and Google Sheets
**Target:** TypeScript/Express API, PostgreSQL, Supabase Auth/Storage, server-hosted web UI

## Delivery rules

- Build by capability while the Apps Script application remains operational.
- Do not change the live Apps Script deployment or redirect users until the cutover gates pass.
- Keep customer data, credentials, deployment details, and production secrets outside Git.
- Use PostgreSQL transactions, constraints, repositories, and audit records instead of sheet scans and in-memory locks.
- Keep local authentication explicitly development-only; production authentication uses Supabase Auth.

## Phase 0 — Foundation and migration safety

**Status: Complete**

- Review the live source inventory and target architecture.
- Establish the TypeScript/Express API shell.
- Establish safe local authentication bootstrap.
- Add API root, health response, RFC 7807-style errors, and security headers.
- Add local-only OpenAPI JSON and Swagger UI with production fail-closed behavior.
- Add repository hygiene, `.env.example`, CI, and safe documentation.
- Keep Apps Script as the production and rollback system.

**Gate:** Source and documentation are safe to commit; no production system has been changed.

## Phase 1 — PostgreSQL persistence foundation

**Status: Complete**

- Add provider-neutral PostgreSQL client.
- Add advisory-locked, checksummed migration runner.
- Create profiles, roles, permissions, assignments, customers, branches, technicians, availability, complaints, appointments, histories, legacy references, import batches, counters, and audit events.
- Seed role and permission definitions only.
- Enforce database-generated IDs, reference formats, status sets, foreign keys, valid time ranges, and one active appointment per complaint.
- Add PostgreSQL integration tests and CI PostgreSQL service.

**Gate:** Passed. Docker PostgreSQL starts; migrations apply cleanly; a second run is a no-op; integration tests run against real PostgreSQL.

## Phase 2 — Authentication, authorization, and complaint workflow

**Status: Complete**

- Add shared contracts and response types.
- Add Supabase access-token verification boundary without coupling repositories to Supabase internals.
- Resolve application profile, roles, and permissions from PostgreSQL.
- Add authorization middleware and service-level permission checks.
- Add public complaint submission with strict server-side whitelist, validation, abuse controls, and rate limiting.
- Add transactional complaint reference generation using `reference_counters`.
- Add protected complaint inbox, detail, CCE notes, and legal status transitions.
- Record complaint status history and audit events transactionally.
- Add complaint workflow, authorization, and rollback integration tests.

**Gate:** A complaint can be submitted, reviewed, updated, audited, and rejected when unauthorized; references are unique under concurrency.

## Phase 3 — Scheduling and technician operations

**Status: Complete**

- Add technician and customer/branch repositories and APIs.
- Add availability-aware appointment creation and assignment.
- Add transactional complaint-to-appointment linkage.
- Add one-active-appointment enforcement and cancelled rebooking.
- Add draft schedules and idempotent draft promotion.
- Add appointment status transitions, closure timestamps, history, and audit events.
- Add calendar/list filters and deterministic ICS generation in `Asia/Dubai`.
- Keep email disabled by default.

**Gate:** Passed. Complaint-to-appointment creation, technician assignment, status coupling, draft promotion, deterministic ICS output, and PostgreSQL integration tests are verified. Email remains disabled.

## Phase 4 — First usable web journeys

**Status: Complete**

- Build public complaint registration and confirmation page.
- Build staff sign-in and role-gated navigation.
- Build complaint inbox/detail/update screens.
- Build new-request and appointment scheduling screens.
- Build technician assignment and appointment list/calendar views.
- Add browser tests for public submission, staff workflow, and unauthorized access.
- Keep the UI server-hosted with normal fetch clients and vanilla JS; avoid premature frontend abstraction.

**Gate:** Passed. Business users can complete the Phase 2 MVP journeys in the local dev environment
(`npm run dev`), including staff sign-in, the complaint inbox/detail/update screens, and the
scheduling screens.

## Phase 5 — Service operations parity

**Status: Complete (built incrementally, not as one declared push — see note below)**

- Add service job cards and final-status edit locks. **Done** — includes creating a job card
  directly from a quotation (`modification.md` #18).
- Add inspection records and quotation records. **Done.**
- Add job-card attachments using private storage, size/MIME validation, signed URLs, and audit
  events. **Done** — `packages/db/migrations/007_job_card_attachments.sql`,
  `apps/api/src/attachments/storage.ts`.
- Add print views and legacy-reference preservation. **Done.**
- Add out-of-warranty approval flow and customer-facing approval links. **Done** —
  `apps/web/src/approve.html`.
- Add service reports and operational dashboard summaries. **Done** — interactive dashboard,
  see `modification.md` #6.

**Gate:** Passed. Job-card, inspection, quotation, attachment, and approval workflows are built,
working, and have been exercised through real day-to-day use while testing (not yet against a
formal set of representative legacy scenarios/reconciliation data — that's Phase 7's job).

**Note on how this phase actually got done:** this work landed through the ongoing
`modification.md` change log (day-to-day requests such as salesmen/technician management,
job-card-from-quotation, tooltips, etc.) rather than as one declared "Phase 5" milestone, which is
why this plan wasn't updated to reflect it until 2026-09-29. `modification.md` is the
up-to-date, authoritative record of what's built and working; this plan is the original roadmap
and is only updated at phase boundaries like this one.

## Phase 6 — Commercial, pricing, and workbook capabilities

**Status: Planned before production cutover**

- Add AMC quotations and contracts.
- Add VAS sales and pricing configuration.
- Add service rate cards and Delivery + Installation pricing.
- Add Thomson proposals and margin calculations.
- Add versioned admin configuration with effective dates and audit history.
- Add private workbook upload, checksum/version metadata, preview, validation, explicit apply, and rollback reference.
- Add reports, exports, and dashboard reconciliation.

**Gate:** Pricing and commercial outputs reconcile against approved source workbooks without exposing source files publicly.

## Phase 7 — Historical migration and parity verification

**Status: Planned before production cutover**

- Build dry-run and apply import tooling outside normal request paths.
- Import customers, branches, technicians, complaints, appointments, commercial records, and attachments only from authorized exports.
- Preserve legacy references and source row metadata.
- Make imports idempotent and restartable with row-level errors.
- Build count, identifier, status, date, amount, and selected-record reconciliation reports.
- Verify attachments and private file mappings.
- Run representative-record and duplicate-reference checks.

**Gate:** Authorized business owners sign the reconciliation report and migration exceptions are resolved or documented.

## Phase 8 — Security, staging, and production readiness

**Status: Planned**

- Replace local auth with Supabase Auth in staging/production.
- Configure least-privilege database, storage, and deployment secrets.
- Add rate limits, CSRF strategy if cookies are introduced, secret scanning, dependency scanning, structured logs, correlation IDs, and abuse monitoring.
- Verify HTTPS, private storage, signed URLs, backups, restore procedure, and operational health checks.
- Keep email and external adapters disabled until sender identity, templates, and staging verification are approved.
- Perform browser, API, integration, and smoke tests in staging.

**Gate:** Production smoke tests pass with secrets supplied only by the deployment platform.

## Phase 9 — Acceptance, controlled cutover, and rollback

**Status: Planned**

- Obtain business acceptance for critical workflows.
- Define a read-only migration window and rollback period.
- Keep Apps Script available as the agreed rollback/read-only system.
- Switch public complaint and portal redirects only after smoke tests and reconciliation approval.
- Monitor errors, latency, audit events, and reconciliation during the rollback period.
- Retire Apps Script only after written approval and completion of the rollback period.

**Gate:** Written cutover approval, verified rollback path, accepted reconciliation, and no unresolved critical security or data issues.

## Immediate next actions

1. Start Docker Desktop after the workstation restart.
2. Run the commands in `docs/RESUME_NOTES.md`.
3. Begin Phase 4 web journeys with the public complaint and staff scheduling flows.
4. Add browser coverage for role-gated navigation, complaint updates, appointment scheduling, and unauthorized access.
5. Keep local authentication and OpenAPI documentation development-only while the UI is built.
6. Preserve Apps Script as the production and rollback/read-only system.
