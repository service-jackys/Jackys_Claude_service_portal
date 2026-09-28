# Build Status

**Updated:** 2026-09-26
**Repository:** `https://github.com/service-jackys/Jackys_Claude_service_portal`
**Branch:** `main`
**Latest committed baseline:** `89bc4aa Record Phase3 commit state`

Phase2 through Phase4 changes are committed, verified, and pushed to `origin/main`. Phase5 service-operations parity is now in progress locally and remains uncommitted.

## Overall status

**Foundation, PostgreSQL persistence, complaint workflow, and scheduling/technician operations are implemented locally. Local PostgreSQL verification has passed with Docker Desktop and PostgreSQL 16.**

## Capability status

| Area                             | Status      | Notes                                                               |
| -------------------------------- | ----------- | ------------------------------------------------------------------- |
| Repository and GitHub remote     | Complete    | `main` pushed to `service-jackys/Jackys_Claude_service_portal`      |
| Express TypeScript API shell     | Complete    | API root, health, errors, security headers                          |
| Local development authentication | Complete    | In-memory only; not production-safe or persistent                   |
| OpenAPI and Swagger              | Complete    | Explicit local flag; disabled in production                         |
| PostgreSQL client                | Complete    | Uses `DATABASE_URL`                                                 |
| Migration runner                 | Complete    | Advisory lock, ordered files, SHA-256 checksums, rollback           |
| Initial PostgreSQL schema        | Implemented | Migration `001_initial_schema.sql`                                  |
| PostgreSQL integration tests     | Implemented | Requires reachable PostgreSQL; skips when unavailable               |
| Docker Compose configuration     | Present     | PostgreSQL 16 service on port 5432                                  |
| Local PostgreSQL execution       | Complete    | Docker PostgreSQL 16 healthy; migrations and integration tests pass |
| Supabase Auth                    | Not started | Reserved for staging/production                                     |
| Complaint API                    | Complete    | Public submission, inbox/detail, notes, status, history, audit      |
| Customer/branch master API       | Complete    | Protected CRUD, filtering, pagination, and audit events             |
| Technician API                   | Complete    | Protected CRUD, availability replacement, locking, and audit        |
| Appointment API                  | Complete    | Transactional linkage, assignment, status, history, audit, and ICS  |
| Draft scheduling                 | Complete    | Idempotent drafts and atomic promotion with retry-safe results      |
| Phase5 job-card backend          | In progress | Lifecycle, history, finalization locks, audit, queue API, contracts |
| Phase5 job-card web workspace    | Not started | Protected queue/detail UI remains                                   |
| Production web UI                | In progress | Phase4 web journeys complete; Phase5 workspace remains              |
| Historical import/reconciliation | Not started | Must use authorized exports outside Git                             |
| Production deployment/cutover    | Not started | Apps Script remains production                                      |

## Verification matrix

| Check                          | Previous result                          | Current action                              |
| ------------------------------ | ---------------------------------------- | ------------------------------------------- |
| `npm run typecheck`            | Passed                                   | Passed after the Phase5 queue endpoint       |
| `npm run build`                | Pending                                  | Run after the Phase5 frontend work           |
| `npm run format:check`         | Pending                                  | New Phase5 files need formatting review      |
| API/OpenAPI tests              | Pending                                  | Contract/OpenAPI checks were added; rerun    |
| Docker availability            | Passed: Docker 29.8.0 and Compose v5.5.1 | Recheck after a workstation restart         |
| PostgreSQL container           | Passed: healthy and running              | Run `docker compose ps`                     |
| Migration first run            | Passed: no pending migrations            | Migration `002` is already applied          |
| Migration second run           | Passed: no-op                            | Expect `No migrations to apply.`            |
| PostgreSQL integration test    | Passed                                   | Scheduling scenario runs against PostgreSQL |
| `npm audit --audit-level=high` | Not verified: network-dependent          | Re-run on an approved network               |

## Required evidence for Phase 1 completion

- Docker Desktop running.
- `docker compose ps` shows PostgreSQL healthy/running.
- `pg_isready` reports accepting connections.
- First migration run applies `001`.
- Second migration run is a no-op.
- `npm test` reports the PostgreSQL integration test passing, not skipped.
- Typecheck, format check, and build pass.

## Phase 0-4 parity fixes — 2026-09-28 (pushed)

Added the B2B/school workflow fields and customer-type taxonomy confirmed missing in
`docs/PARITY_REVIEW_2026-09-28.md` (migration `004_b2b_parity_fields.sql`, contracts, db layer,
appointment/complaint services, and the web UI). Verified in this pass: `npm run typecheck`,
`npm run build`, and `npm run format:check` all pass. **Still needs verification on your machine**:
`npm run db:migrate` against a real database, `npm test` (unit + integration), and `npm run test:e2e` —
the environment this change was made from has no Docker Desktop and a different OS/architecture than
this project's installed native dependencies (`esbuild`), so the test runner itself can't execute there.
Run those on your own machine (per `to_do.md`) before treating this change as fully verified.

While first running the migration on real local data, its remap step tripped over a still-active old
constraint (an ordering bug: the remap `UPDATE`s ran before the old `customer_type` CHECK constraint was
dropped). Fixed in the same migration file: constraints are now dropped first, then data is remapped
(case/whitespace-tolerant, with a safe fallback), then the new constraint is added.

Committed and pushed to `https://github.com/service-jackys/Jackys_Claude_service_portal` on 2026-09-28.

## Current blockers

1. Existing PostgreSQL migration checksum mismatch for `001_initial_schema.sql` blocks integration execution; do not bypass validation or delete the database volume.
2. `npm audit --audit-level=high` still requires npm registry/network access.
3. Phase5 job-card web workspace and focused browser coverage remain to be implemented.
4. Supabase production authentication, historical import, and cutover remain unstarted.

## Do not do during troubleshooting

- Do not delete the Docker volume.
- Do not modify the migration checksum manually except in the test's controlled checksum test.
- Do not use live customer data.
- Do not commit `.env` or credentials.
- Do not change the production Apps Script deployment.
