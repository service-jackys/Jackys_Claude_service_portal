# Jacky's Service Portal

**Repository:** <https://github.com/service-jackys/Jackys_Claude_service_portal>

This private repository is the migration workspace for replacing the current Google Apps Script service application with a normal web application.

The live Google Apps Script application remains the production system. This local project is for development and testing only.

## Current status

- Phase 0 foundation: complete and committed.
- Phase 1 PostgreSQL persistence: implemented and verified locally.
- Phase 2 complaint workflow: implemented and verified locally.
- Phase 3 scheduling and technician operations: implemented and verified locally.
- Phase 4 web portal journeys: implemented and browser-verified locally.
- Phase 0-4 parity fixes (2026-09-28): the field/workflow gaps found by comparing this project
  against the live Apps Script system are closed — see "What we've done so far" below.
- Phase 5 service operations parity: in progress locally; the initial job-card backend and protected web workspace are implemented and remain pending manual verification before they're treated as done.
- Production cutover: not started.

The local system currently provides an Express TypeScript API, PostgreSQL migrations, local-only authentication for development, OpenAPI/Swagger documentation, complaint operations, technician and appointment scheduling, calendar and recovery workflows, and the initial Phase 5 service job-card backend. The live Google Apps Script application remains the production and rollback system.

## What we've done so far

A running log of completed work, newest first, so you can see progress without digging through commits.

**2026-09-28 — Phase 0-4 parity review and fixes.** Reviewed this project's Phase 0-4 build against the
live system's `code.gs`, `Index.html`, and `ComplaintRegistration.html` to confirm fields and workflow
matched. Findings are in `docs/PARITY_REVIEW_2026-09-28.md`. Fixed:

- Added the missing B2B/school workflow fields end to end (migration, contracts, API, web forms):
  `b2bBranchSchool`, `schoolContactPerson`, `schoolContactNumber`, `customerNumber`.
- Surfaced `salesOrderNumber` as a real input on the public complaint form and the staff scheduling
  screen, with staff input overriding the linked complaint's value when both are present.
- Replaced the placeholder `customerType` values (`individual`/`company`/`b2b`) with the live system's
  actual three tiers: `B2C`, `B2B`, `B2B-SalesChannel` — migration, contracts, OpenAPI, and the public
  form's dropdown all updated together.
- Replaced the free-text `region` input on the public form with the fixed 8-emirate dropdown used live.
- Added a `sub_group` (product category) field on appointments.
- Fixed a bug where the public complaint form sent blank optional fields as empty strings instead of
  omitting them, which broke submission validation on any blank optional field.
- Set up this checkout to run on its own ports (3100 / 5544) so it doesn't collide with another
  project's servers already running on 3000 / 5432 on this machine.
- Fixed a migration ordering bug in `004_b2b_parity_fields.sql`: the data-remap step ran before the old
  `customer_type` constraint was dropped, so it tripped over its own still-active old rule. Reordered to
  drop the old constraint first, then remap (now case/whitespace-tolerant), then add the new constraint.
- Connected this project to its GitHub repository and pushed everything above.

Full detail and file-by-file notes: `to_do.md` (checklist) and `docs/BUILD_STATUS.md` (capability matrix).

## Ports on this machine (read this first)

This checkout runs on **non-default ports** because another project's backend and Postgres
are already using `3000` and `5432` on this machine. Every command and URL in this README
uses the actual values for this machine:

- API / web UI: **http://localhost:3100**
- Postgres: host port **5544** (the container's own internal port is still 5432 — only the
  host-side mapping changed, in `docker-compose.yml`)
- Database name: **jackys_service_portal_nah** — renamed with its own dedicated Docker
  volume so this project never shares a database, volume, or data with anything else
  running on this machine.

Both are set in `.env` (`PORT=3100`, `APP_BASE_URL=http://localhost:3100`,
`DATABASE_URL=postgresql://jackys:jackys@localhost:5544/jackys_service_portal_nah_nah`) and in
`docker-compose.yml` (`"5544:5432"`). This is a per-machine override, not a project
default — a fresh clone on a machine with nothing else on 3000/5432 can use `3000`/`5432`
instead; just update `.env` and `docker-compose.yml` to match.

## Before you start

You need the following on the Windows computer:

1. **Node.js LTS**, which provides `node` and `npm`.
2. **Docker Desktop**, which provides Docker and Docker Compose.
3. This repository downloaded or cloned to:

   ```text
   C:\Users\Vysakh Raju\Desktop\Jacky's\Claude\jackys service portal
   ```

You do not need to install PostgreSQL directly on Windows. PostgreSQL runs inside Docker.

## First-time setup

Complete these steps only the first time, or when the project dependencies have been removed.

### 1. Open a terminal

You can use **Command Prompt** or **PowerShell**. The commands below use Command Prompt syntax because it handles the apostrophe in the folder name simply.

Open Command Prompt from the Windows Start menu.

### 2. Go to the project folder

```cmd
cd /d "C:\Users\Vysakh Raju\Desktop\Jacky's\Claude\jackys service portal"
```

Check that the terminal is in the correct folder:

```cmd
dir package.json
```

You should see `package.json` in the output. If you do not, stop and correct the folder path before continuing.

### 3. Check Node.js and npm

```cmd
node --version
npm --version
```

If either command is not recognized, install Node.js LTS and reopen the terminal.

### 4. Check Docker Desktop

Start **Docker Desktop** from the Windows Start menu. Wait until Docker Desktop says that Docker is running.

Then run:

```cmd
docker --version
docker compose version
docker info
```

The `docker info` command must show server information. If it says that it cannot connect to the Docker daemon, Docker Desktop is not ready yet.

### 5. Install project dependencies

```cmd
npm install
```

This creates the local `node_modules` directory. Do not commit that directory.

### 6. Create the local environment file

```cmd
copy .env.example .env
notepad .env
```

For the current local testing cycle, set `LOCAL_BOOTSTRAP_TOKEN` to the local-only value agreed for your machine. Copy it from your private local setup notes or enter it directly in `.env`; do not write the token into tracked files.

The bootstrap token is only for the local development environment. It must never be used as a production credential and must never be committed to GitHub. The `.env` file is ignored by Git.

Keep these local development values:

```text
NODE_ENV=development
AUTH_PROVIDER=local
DATABASE_URL=postgresql://jackys:jackys@localhost:5544/jackys_service_portal_nah
EMAIL_ENABLED=false
```

Save and close Notepad. The `.env` file is ignored by Git and must never be committed.

### 7. Start PostgreSQL in Docker

From the project folder, run:

```cmd
docker compose up -d postgres
docker compose ps
```

The PostgreSQL service may show `health: starting` for a few seconds. Wait until it shows `healthy` or run this readiness check:

```cmd
docker compose exec postgres pg_isready -U jackys -d jackys_service_portal_nah
```

The successful result ends with:

```text
accepting connections
```

### 8. Apply the database migration

```cmd
npm run db:migrate
```

The first run should report:

```text
Applied migrations: 001
```

Run it a second time to confirm that migrations are safely repeatable:

```cmd
npm run db:migrate
```

The second run should report:

```text
No migrations to apply.
```

The migration creates an empty local schema and seed role/permission definitions. It does not import Google Sheets, customer data, or production files.

## Starting the project after a normal PC restart

Repeat these steps whenever you restart Windows. You do not need to run `npm install` again unless dependencies changed.

### Terminal 1: Docker and PostgreSQL

1. Start Docker Desktop and wait until it reports that Docker is running.
2. Open Command Prompt.
3. Run:

```cmd
cd /d "C:\Users\Vysakh Raju\Desktop\Jacky's\Claude\jackys service portal"
docker info
docker compose up -d postgres
docker compose ps
docker compose exec postgres pg_isready -U jackys -d jackys_service_portal_nah
npm run db:migrate
```

Leave this terminal available for database diagnostics.

### Terminal 2: backend API

Open a second Command Prompt window and run:

```cmd
cd /d "C:\Users\Vysakh Raju\Desktop\Jacky's\Claude\jackys service portal"
npm run dev
```

Keep this terminal running. The API uses `tsx watch`, so it automatically restarts after API source changes.

A successful startup prints a message that the API is listening on port `3100`.

## Check that the backend is working

With `npm run dev` still running, open these addresses in a browser:

- API root: <http://localhost:3100/>
- API information: <http://localhost:3100/api>
- Health check: <http://localhost:3100/health>
- Swagger UI for local development: <http://localhost:3100/api/docs>
- OpenAPI JSON: <http://localhost:3100/api/openapi.json>

The health check is the most important first check. If it does not load, the backend is not reachable yet.

Swagger and OpenAPI are enabled only when all of the following are true:

- `NODE_ENV` is not `production`.
- `OPENAPI_DOCS_ENABLED=true` is set in the environment.

For local development, you can temporarily set this in `.env`:

```text
OPENAPI_DOCS_ENABLED=true
```

Restart `npm run dev` after changing `.env`. Documentation must not be exposed on a production deployment.

## Local authentication check

Authentication is currently for local development only. It uses in-memory users and sessions, so users and sessions disappear when the backend restarts.

For the current local testing cycle, use this local administrator profile:

```text
Email: vysakh.raju@jackys.com
Name: Vysakh
```

Keep the bootstrap token and administrator password private. The bootstrap token belongs in your ignored `.env` file as `LOCAL_BOOTSTRAP_TOKEN`; the password should only be entered locally. Neither secret belongs in this README, source code, screenshots, or GitHub.

Start the backend, open `http://localhost:3100/portal/`, select **Staff workspace → First-time setup**, and enter the exact token from `.env`, the profile above, and a password of at least 12 characters. The web UI is the recommended setup method because it keeps the returned bearer token in memory for the protected workspace.

For a direct API check, send one `POST` request to `/api/auth/bootstrap` with this structure:

```json
{
  "bootstrapToken": "copy-the-exact-value-from-.env",
  "email": "vysakh.raju@jackys.com",
  "name": "Vysakh",
  "password": "your-private-local-password-at-least-12-characters"
}
```

The `bootstrapToken` must be at least 32 characters and must exactly match `.env`. The password must be at least 12 characters. A successful response is HTTP `201 Created` and contains a temporary bearer token for local API checks. When `DATABASE_URL` is configured and migrations have run, bootstrap also creates the matching local PostgreSQL administrator profile and role assignment.

Do not use this local authentication provider in production. Production authentication is reserved for Supabase Auth and has not been wired yet. See `testing_guide.md`, Section 9, for the full setup, sign-in, Swagger, and troubleshooting flow.

## Run the verification checks

Stop the backend with `Ctrl+C` only if you need to, then run these commands from the project folder:

```cmd
npm test
npm run typecheck
npm run format:check
npm run build
```

The test suite must pass before considering a change complete. The PostgreSQL integration test must run against the Docker database rather than being skipped.

## Troubleshooting

### Docker command is not recognized

Close and reopen the terminal after installing Docker Desktop. If it is still not recognized, restart Docker Desktop and check that Docker CLI is installed and available in the Windows PATH.

### Docker cannot connect to the daemon

Open Docker Desktop and wait for it to finish starting. Then retry:

```cmd
docker info
```

### PostgreSQL is still starting

Wait a few seconds and run:

```cmd
docker compose ps
docker compose exec postgres pg_isready -U jackys -d jackys_service_portal_nah
docker compose logs postgres
```

Do not delete the Docker volume while diagnosing a startup issue.

### `npm` cannot find `package.json`

The terminal is in the wrong folder. Run this exact command again:

```cmd
cd /d "C:\Users\Vysakh Raju\Desktop\Jacky's\Claude\jackys service portal"
```

Then verify with:

```cmd
dir package.json
```

### The browser displays `Cannot GET /` or the page does not load

1. Confirm that `npm run dev` is still running.
2. Confirm that the terminal says the API is listening on port `3100`.
3. Open <http://localhost:3100/health> first.
4. If the health check fails, stop the backend with `Ctrl+C` and run `npm run dev` again from the project folder.
5. Check that another program is not already using port `3100`.

### A migration fails

Capture these outputs before changing files:

```cmd
docker compose ps -a
docker compose logs postgres
npm run db:migrate
```

Do not manually edit migration checksums and do not use `docker compose down -v` as a first troubleshooting step.

## Stopping the project safely

To stop the backend, go to its terminal and press `Ctrl+C`.

To stop PostgreSQL without deleting the local database volume:

```cmd
cd /d "C:\Users\Vysakh Raju\Desktop\Jacky's\Claude\jackys service portal"
docker compose down
```

Do **not** use the following unless you intentionally want to delete the local PostgreSQL database:

```cmd
docker compose down -v
```

## Git and security rules

- Never commit `.env`, passwords, tokens, credentials, customer exports, deployment URLs, Drive IDs, or Supabase service-role keys.
- Do not import live customer data into local development.
- Do not change the live Apps Script deployment during this migration.
- Keep Apps Script available as the production and rollback/read-only system until acceptance and reconciliation are complete.
- Local authentication is not production-safe.

## Project documents

- `to_do.md` — the phase-by-phase checklist: what's done, what's next, in what order.
- `testing_guide.md` — the full beginner-friendly walkthrough for testing every feature by hand.
- `docs/RESUME_NOTES.md` — current state and the next resume sequence.
- `docs/BUILD_STATUS.md` — capability and verification matrix.
- `docs/DEVELOPMENT_PLAN.md` — planned phases through cutover and rollback.
- `docs/PARITY_REVIEW_2026-09-28.md` — the field/workflow comparison against the live Apps Script system.
- `docs/architecture/target-architecture.md` — architecture and safety baseline.

Phase4 web journeys are implemented and browser-verified locally. They include public complaint registration, local staff sign-in, complaint inbox and updates, technician lookup, appointment scheduling and assignment, calendar views, ICS download, rescheduling, status transitions, terminal-state handling, and authorization/recovery states. Phase5 currently includes the protected service job-card workspace with appointment-linked creation, queue search/filtering, detail/history, status transitions, terminal locks, permission gating, and recovery states. Manual Phase5 verification is documented in `testing_guide.md`; the full integration suite still requires safe resolution of the existing migration checksum mismatch before the bounded slice is committed.
