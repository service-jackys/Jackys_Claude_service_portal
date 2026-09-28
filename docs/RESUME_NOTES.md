# Resume Notes

> **Note (2026-09-28):** this file is a Phase3 checkpoint and its commands/paths below are stale (project folder path, port 3000/5432, db name `jackys_service_portal`). For current commands, ports (3100/5544), and the actual database name (`jackys_service_portal_nah`), use `README.md` instead.

**Updated:** 2026-09-26
**Project folder:** `C:\Users\Vysakh Raju\Desktop\Jacky's\jackys service portal`
**Repository:** `https://github.com/service-jackys/Jackys-service-portal`
**Branch:** `main`
**Latest commits:**

- `89bc4aa` — Record Phase3 commit state; pushed successfully to `origin/main`.
- `1fded53` — Implement Phase3 scheduling operations; pushed successfully to `origin/main`.
- `e5db878` — Verify Phase1 and document local startup
- `600d727` — Document Windows local setup
- `b8624f3` — Establish service portal foundation and database migrations

## Current implementation

Phase3 scheduling and technician operations are locally implemented and verified. The repository currently contains:

- Express 5 TypeScript API shell.
- Local-only authentication bootstrap with in-memory users and sessions.
- Fail-closed OpenAPI JSON and Swagger UI gating.
- PostgreSQL client using `DATABASE_URL`.
- Advisory-locked, checksummed migration runner.
- Initial PostgreSQL schema for profiles, RBAC, customers, branches, technicians, availability, complaints, complaint history, appointments, appointment history, legacy references, import batches, reference counters, and audit events.
- PostgreSQL-backed integration tests for migration idempotence, generated IDs, constraints, appointment uniqueness/rebooking, rollback, and checksum protection.
- Docker Compose PostgreSQL 16 configuration.
- CI workflow with a PostgreSQL service.
- Windows CMD setup instructions in `README.md`.
- Phase2 shared complaint contracts and provider-neutral auth boundary.
- PostgreSQL repositories for profiles/permissions, complaints, counters, history, and audit events.
- Public complaint submission with strict validation, local rate limiting, transactional `CMP-yymmdd-XXX` references, and audit/history writes.
- Protected complaint list/detail/notes/status endpoints with database-backed permissions and legal transitions.
- Protected customer, branch, and technician master-data APIs with audit events and availability management.
- Transactional appointment creation, assignment, cancellation/completion coupling, status history, and deterministic ICS downloads.
- Idempotent draft schedules with atomic, retry-safe promotion.

## Last verified state

Verified with PostgreSQL running in Docker:

- Docker 29.8.0 and Docker Compose v5.5.1 available.
- PostgreSQL 16 container healthy and accepting connections.
- `npm run db:migrate` reported `No migrations to apply.` on both verification runs; migration `002` is already applied.
- `npm test` passed all 9 tests, including the PostgreSQL scheduling integration test.
- `npm run typecheck` passed.
- `npm run build` passed.
- `npm run format:check` passed.

Still environment-dependent:

- `npm audit --audit-level=high` requires npm registry/network access.

## First resume sequence

Open Docker Desktop and wait until it is running. Then open CMD:

```cmd
cd /d "C:\Users\Vysakh Raju\Desktop\Jacky's\jackys service portal"
docker --version
docker compose version
docker compose up -d postgres
docker compose ps
docker compose exec postgres pg_isready -U jackys -d jackys_service_portal
npm run db:migrate
npm run db:migrate
npm test
npm run typecheck
npm run format:check
npm run build
```

Expected migration output for the current database:

```text
No migrations to apply.
No migrations to apply.
```

If Docker fails, capture the complete output of these commands before changing files:

```cmd
docker info
docker compose config
docker compose ps -a
docker compose logs postgres
```

Do not delete the database volume or use `docker compose down -v` while diagnosing.

## Important boundaries

- Do not modify the live Apps Script deployment.
- Do not import live customer data in local development.
- Do not commit `.env`, customer exports, credentials, deployment URLs, Drive IDs, or Supabase service-role keys.
- The local auth provider must not be used in production.
- Keep Apps Script available as the rollback/read-only system until acceptance and reconciliation gates pass.

## Project paused state

Phase4 web journeys are complete. Phase5 service-operations parity is in progress locally and remains uncommitted.

### Phase5 completed today — 2026-09-26

- Added migration `003_phase5_job_cards.sql` for service job cards and status history.
- Added one-card-per-appointment enforcement and `JBC-YYYY-NNNNN` references.
- Added strict status contracts for `Open`, `In Progress`, `Completed`, and `Cancelled`.
- Added transactional creation, status transitions, history, finalization metadata, and audit events.
- Added protected API routes for job-card listing, creation, appointment lookup, detail, history, and status changes.
- Added a paginated/searchable queue endpoint protected by `service_job_card.read`.
- Added contract and integration coverage for the job-card lifecycle.
- `npm run typecheck` passed after the backend queue work.

### Known verification limitation

Integration execution is currently blocked by the existing migration runner reporting a checksum mismatch for `001_initial_schema.sql`. Do not edit migration history, bypass checksum validation, delete the PostgreSQL volume, or use `docker compose down -v`. Repair the local environment only through a safe, approved approach.

### First resume steps

1. Start Docker Desktop and run `docker compose up -d postgres` from the project folder.
2. Inspect the uncommitted Phase5 changes before editing further.
3. Continue the protected job-card workspace in `apps/web/src/index.html` and `apps/web/src/app.js`.
4. Add focused Playwright coverage for authorized/read-only access, creation, status transitions, terminal locks, and 401/403/404/409 recovery.
5. Run typecheck, formatting, build, contract tests, integration tests where the migration environment permits, and browser tests.
6. Review changed files for secrets and production changes. Create a commit only if explicitly requested; do not push or deploy.

The next backlog after the job-card slice remains inspections, quotations, approvals, attachments, print views, legacy-reference preservation, and reporting; none of those are started.
