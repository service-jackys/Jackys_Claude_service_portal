# Jacky's Service Portal Testing Guide

This guide is for testing the local migration project. It includes the complete Phase 4 browser verification checklist and assumes the previous system was built with Google Apps Script.

## 1. Understand the two systems

There are currently two separate systems:

- **Google Apps Script:** the existing production system. Customers and staff should continue using this system until a formal migration and cutover decision is approved.
- **Local migration project:** the new TypeScript, Express, PostgreSQL, and browser application used for development and testing. It is not production.

The local project uses its own local database. Do not use production credentials, live customer data, private deployment URLs, or exported customer files while testing.

## 2. Prerequisites

Install or have access to:

- Node.js and npm.
- Docker Desktop with Docker Compose enabled.
- Git, if you are updating the repository.
- A modern browser such as Chrome or Microsoft Edge.

The project dependencies are already described in `package.json`.

## 3. Open the correct project folder

Open Command Prompt or PowerShell and move to the migration project. In Command Prompt, use:

```cmd
cd /d "C:\Users\Vysakh Raju\Desktop\Jacky's\jackys service portal"
```

Confirm that the prompt is in the folder containing `package.json`:

```cmd
dir package.json
```

If npm says it cannot find `package.json`, you are probably in the older Apps Script project or another folder.

## 4. Install dependencies

Run this once after cloning the repository or when dependencies change:

```cmd
npm install
```

Do not commit `.env` files, passwords, API keys, customer exports, or other private information.

## 5. Start the local PostgreSQL database

From the migration project folder, start Docker PostgreSQL:

```cmd
docker compose up -d
```

Check that the database container is healthy or running:

```cmd
docker compose ps
```

Do not use `docker compose down -v` during normal troubleshooting because the `-v` option deletes the local database volume.

## 6. Apply database migrations

Run migrations before the first test and after pulling changes that include database migrations:

```cmd
npm run db:migrate
```

A successful run may say that there are no migrations to apply. Running this command again is safe because migrations are tracked and applied only once.

## 7. Start the backend and web UI

Keep one terminal open in the project folder and run:

```cmd
npm run dev
```

This starts the local Express server. The browser UI and API are served from the same local server.

Open this address in Chrome or Edge:

```text
http://localhost:3100/portal/
```

The trailing `/portal/` path is the local migration web UI. It does not replace the production Apps Script links.

Useful health checks:

```text
http://localhost:3100/health
http://localhost:3100/api
```

Leave the backend terminal running while using the browser or running the end-to-end tests.

## 8. Test the public complaint form

1. Open `http://localhost:3100/portal/`.
2. Confirm that the page title is **Jacky's Service Portal**.
3. Confirm that **Register a service complaint** is visible.
4. Click **Submit service request** without entering anything.
5. Confirm that field-level messages appear for:
   - Customer type.
   - Customer name.
   - Contact number.
   - Issue description.
6. Confirm that no incomplete complaint is created.
7. Enter a test customer name, phone number, customer type, and issue description. Use clearly fake local test information, not live customer details.
8. Submit the form.
9. Confirm that a success message shows the complaint reference returned by the local API.

The form sends data to `POST /api/public/complaints`.

## 9. Test local staff setup

The local system has a development-only first-time setup flow. It is not the production authentication system and it does not create a Google Apps Script or production account.

The current local test profile is:

```text
Email: vysakh.raju@jackys.com
Name: Vysakh
```

The bootstrap token is the value currently stored in your ignored local `.env` file as `LOCAL_BOOTSTRAP_TOKEN`. The local administrator password is the password you selected for this test account. Do not add either secret to this guide, source code, screenshots, or a Git commit.

### 9.1 Confirm the local environment

Stop the backend if it is running, then open the local environment file:

```cmd
cd /d "C:\Users\Vysakh Raju\Desktop\Jacky's\jackys service portal"
notepad .env
```

Confirm that these values are present:

```env
NODE_ENV=development
AUTH_PROVIDER=local
LOCAL_BOOTSTRAP_TOKEN=<your-local-token-of-at-least-32-characters>
DATABASE_URL=postgresql://jackys:jackys@localhost:5544/jackys_service_portal_nah
```

The token must be at least 32 characters. It must not be the short value `jsc`. Save the file and restart the backend after changing it because the server reads `.env` only at startup.

### 9.2 Start the backend

From the project folder, run:

```cmd
npm run dev
```

Keep this terminal open. The API must be running before using Swagger or the portal.

### 9.3 Create the administrator in the web UI

This is the recommended method because the web UI automatically keeps the returned session token in memory.

1. Open `http://localhost:3100/portal/`.
2. Scroll to **Staff workspace**.
3. Select **First-time setup**.
4. Enter the exact token currently stored in `.env` after `LOCAL_BOOTSTRAP_TOKEN=`.
5. Enter:
   - Name: `Vysakh`
   - Email: `vysakh.raju@jackys.com`
   - A local password with at least 12 characters.
6. Select **Create administrator**.
7. Wait for the protected workspace to appear.
8. Confirm that the complaint inbox loads.

The local backend creates this account with the `admin` role and all local permissions. The account is held in the running development process and is not a production account.

### 9.4 Create the administrator with Swagger instead

Swagger is useful for checking the API directly. Open:

```text
http://localhost:3100/api/docs
```

Find `POST /api/auth/bootstrap`, select **Try it out**, and send this structure. Replace the two angle-bracket values locally; do not commit the completed request body:

```json
{
  "bootstrapToken": "<copy-the-exact-value-from-.env>",
  "email": "vysakh.raju@jackys.com",
  "name": "Vysakh",
  "password": "<your-local-password-of-at-least-12-characters>"
}
```

A successful response is HTTP `201 Created` and contains a generated `token` and the new user. The returned token is a temporary bearer token for API calls; it is not the bootstrap token.

If Swagger displays `400 Invalid request`, check that the bootstrap token has at least 32 characters, the password has at least 12 characters, the email is valid, and the property names match exactly.

If Swagger displays `401 The bootstrap token is invalid`, the token sent in Swagger does not exactly match the value loaded from `.env`, or the backend was not restarted after `.env` was edited.

If Swagger displays `409 Bootstrap unavailable`, the one-time bootstrap has already been used in the current backend process. Stop the backend with `Ctrl+C`, start `npm run dev` again, and submit the request once more.

### 9.5 Sign in after setup

After the administrator is created, use the **Staff sign in** tab or refresh the portal and sign in with:

```text
Email: vysakh.raju@jackys.com
Password: the local password used during setup
```

Then confirm:

1. The protected workspace becomes visible.
2. The complaint inbox loads.
3. Selecting a complaint shows its details and history.
4. **Sign out** hides the protected workspace.

The browser stores the bearer token in memory only. Refreshing or closing the browser clears the session, so sign in again when necessary.

If the account cannot be recreated after a successful bootstrap, do not repeatedly submit the setup form. Restart the local backend first. This local authentication implementation keeps users and sessions in memory while the backend process is running.

## 10. Test staff sign-in and protected complaints

1. Open the **Staff sign in** tab.
2. Enter the local administrator credentials created during bootstrap.
3. Sign in.
4. Confirm that the protected workspace becomes visible.
5. Confirm that the complaint inbox loads from the local API.
6. Use the search and status controls if test complaints exist.
7. Select a complaint and confirm that its details and history are displayed.
8. Click **Sign out**.
9. Confirm that the protected workspace is hidden again.

The browser keeps the short-lived bearer token in memory only. Closing or refreshing the page clears it.

The protected API should reject an unauthenticated request. For example, this should return HTTP 401 when no token is supplied:

```text
GET http://localhost:3100/api/complaints
```

## 11. Manual Phase4 browser verification

Use this section when you want to verify Phase4 yourself in Chrome or Edge. Use fake local data only. Keep the backend terminal visible so you can report any API or database errors.

### 11.1 Start the local services

Use the startup steps in sections 5–7, then confirm:

- `http://localhost:3100/health` returns a healthy response.
- `http://localhost:3100/portal/` displays **Jacky's Service Portal**.
- PostgreSQL is running in Docker.
- The browser is using the local portal URL, not a production Apps Script URL.

If this is a fresh local process, complete the first-time administrator setup in section 9. The local account is created in memory and must be recreated after restarting the backend.

### 11.2 Public complaint registration and confirmation

1. Open `http://localhost:3100/portal/` in a new private/incognito window.
2. Confirm the page title is **Jacky's Service Portal** and the **Register a service complaint** section is visible.
3. Select **Individual** as the customer type.
4. Enter clearly fake local values, for example:
   - Customer name: `Phase4 Browser Customer`
   - Contact number: `0500000000`
   - Customer email: `phase4.browser@example.test` (optional)
   - Region: `Dubai`
   - Brand: `Test Brand`
   - Model: `Test Model`
   - Issue description: `Phase4 browser verification only`
5. Submit the form.
6. Confirm a success message appears with a generated complaint reference such as `CMP-yymmdd-XXX`.
7. Select **Start a new request** or the equivalent reset action and confirm the form becomes available again.

Negative check:

1. Submit the empty form.
2. Confirm field messages appear for customer type, customer name, contact number, and issue description.
3. Confirm no success reference appears.

### 11.3 Staff sign-in and complaint inbox

1. Return to the **Staff workspace** section.
2. Select **First-time setup** only if the current backend process has no administrator yet. Otherwise select **Sign in**.
3. Use the local administrator email and password created in section 9.
4. Confirm the protected workspace appears and displays the signed-in name, email, and role.
5. Confirm **Complaint inbox**, **Service requests**, and **Appointments** navigation is visible for the local administrator.
6. Confirm the complaint created in section 11.2 appears in the inbox.
7. Open the complaint and confirm its customer details, issue description, status, and history are visible.
8. Add a note such as `Phase4 browser note` and select **Save notes**. Confirm **Notes saved.** appears.
9. Change the complaint status from **New** to **Under Review**, enter a reason, and select **Update status**. Confirm **Complaint status updated.** appears.
10. Confirm the detail view refreshes and the new status and history entry are visible.
11. Select **Sign out** and confirm the protected workspace is hidden.
12. Refresh the page and confirm that the local session is not retained; sign in again when continuing.

### 11.4 Prepare a scheduling test record

The portal does not include technician master-data or availability screens. A technician and availability window must therefore be created through local Swagger before the scheduling journey can be tested. Do this only with the local administrator session/token.

1. Sign in again through the portal.
2. Open `http://localhost:3100/api/docs` in another tab.
3. In Swagger, use `POST /api/auth/login` with the same local administrator email and password. Copy the returned temporary `token` only into Swagger's **Authorize** dialog as `Bearer <token>`. Do not save or publish the token.
4. In Swagger, use `POST /api/technicians` with a fake technician:

```json
{
  "name": "Phase4 Test Technician",
  "region": "Dubai",
  "phone": "0500000001",
  "email": "phase4.technician@example.test",
  "active": true
}
```

5. Record the returned technician `id` locally for this test session.
6. Use `PUT /api/technicians/{id}/availability` for the returned ID. Choose a weekday matching the appointment date you will use. For example, for Monday use:

```json
{
  "windows": [{ "weekday": 1, "startsAt": "08:00", "endsAt": "17:00" }]
}
```

`weekday` uses JavaScript numbering: Sunday `0`, Monday `1`, Tuesday `2`, Wednesday `3`, Thursday `4`, Friday `5`, Saturday `6`.

7. Return to the portal and open **Complaint inbox**.
8. Open the test complaint and move it through the valid workflow:
   - **New** → **Under Review**
   - **Under Review** → **Ready for Scheduling**
9. Confirm the complaint is no longer treated as a normal new complaint and is available under **Service requests**.

If Swagger is disabled, confirm `.env` contains `OPENAPI_DOCS_ENABLED=true`, restart `npm run dev`, and open the docs URL again. Never enable Swagger in production.

### 11.5 Schedule and assign an appointment

1. In the portal, select **Service requests**.
2. Confirm the test complaint appears with the **Ready for Scheduling** status.
3. Open the complaint.
4. Enter an appointment date and time that match the technician availability created in section 11.4.
5. Select **Find available technicians**.
6. Confirm **Phase4 Test Technician** appears in the technician list.
7. Select the technician and choose **Schedule appointment**.
8. Confirm an appointment reference is displayed and the complaint moves to **Scheduled**.
9. Open **Appointments** and confirm the appointment appears in the list with its date, time, technician, and status.
10. Open the appointment detail and confirm the assigned technician, appointment history, and **Download calendar file** action are visible.
11. Select **Download calendar file** and confirm the browser downloads an `.ics` calendar file.

### 11.6 Appointment calendar, filters, and navigation

1. In **Appointments**, confirm the month calendar displays appointment dates and events.
2. Select **Week** and confirm the view changes to seven day cells.
3. Select **Month** and confirm the month view returns.
4. Select **Previous**, **Today**, and **Next**. Confirm the calendar title and displayed appointments update.
5. Search by the appointment reference or customer name and confirm the list is filtered.
6. Filter by **Scheduled** and confirm only scheduled appointments remain.
7. Clear the filters and confirm the appointment returns.

### 11.7 Rescheduling and appointment status workflow

1. Open the scheduled appointment detail.
2. Change the date and time to another available slot and select **Save schedule**.
3. Confirm **Appointment schedule updated.** appears and the detail reflects the new schedule.
4. Change the appointment status from **Scheduled** to **In Progress** and provide a reason if requested.
5. Confirm the status and history update.
6. Change **In Progress** to **Completed**.
7. Confirm the appointment becomes terminal:
   - Rescheduling controls are hidden or disabled.
   - Further status choices are unavailable.
8. Try to reschedule a second appointment into the same technician/time slot if another local record is available. Confirm a conflict message is shown and the current appointment state is refreshed.

### 11.8 Authorization and recovery checks

- Sign out and request a protected page action. Confirm the protected workspace is no longer available.
- With no bearer token, open `http://localhost:3100/api/complaints` directly. Confirm HTTP `401`.
- In the signed-in workspace, verify that an unauthorized API response shows an authorization message rather than silently failing. A non-admin role should not see navigation items for permissions it does not have.
- For a missing complaint or appointment detail, confirm the UI shows a not-found message and offers a retry or return action where provided.
- For a scheduling conflict, confirm the UI shows the conflict message and reloads authoritative appointment data.
- Confirm terminal completed appointments do not expose rescheduling or further status controls.

### 11.9 Phase4 manual results to report back

Copy this checklist into your reply and mark each item `PASS`, `FAIL`, or `BLOCKED`. Include the exact error text for any failure and the step where it occurred.

```text
Phase4 browser verification date:
Browser and version:
Backend URL:
PostgreSQL status:

[ ] Public complaint validation:
[ ] Public complaint submission and reference:
[ ] Administrator sign-in:
[ ] Complaint inbox and detail:
[ ] Complaint notes update:
[ ] Complaint status update:
[ ] Sign-out/session clearing:
[ ] Technician setup and availability:
[ ] Ready-for-scheduling workflow:
[ ] Appointment creation and assignment:
[ ] Appointment list and detail:
[ ] ICS download:
[ ] Month calendar:
[ ] Week calendar:
[ ] Calendar navigation:
[ ] Appointment filters/search:
[ ] Appointment rescheduling:
[ ] Appointment status transitions:
[ ] Terminal appointment lock:
[ ] Scheduling conflict recovery:
[ ] Unauthorized/recovery behavior:

Failures or blockers:
Browser console errors:
Backend terminal errors:
Screenshots or downloaded files:
```

## 12. Manual Phase5 service job-card verification

Use this section to verify the current Phase5 service job-card slice in Chrome or Edge. It covers the job-card workflow currently implemented by the local portal: an authorized staff member creates a job card from an existing appointment, views the queue and history, and moves the job card through its allowed statuses.

This Phase5 slice is intentionally appointment-linked. There is no standalone blank job-card form. The normal test path is:

```text
Complaint → Ready for Scheduling → Appointment → Create service job card → Open → In Progress → Completed or Cancelled
```

Use fake local test information only. Do not use production credentials, live customer information, or the Google Apps Script system for this test.

### 12.1 Decide whether a restart is needed

Use this checklist before starting:

- **PostgreSQL restart:** not required for every test. Run `docker compose ps`; restart Docker PostgreSQL only if the container is stopped or unhealthy.
- **Database migration:** run `npm run db:migrate` after pulling a migration change or when the local database has not been initialized. Do not delete the Docker volume to resolve a normal test error.
- **Backend restart:** required after changing `.env`, including `OPENAPI_DOCS_ENABLED`, `LOCAL_BOOTSTRAP_TOKEN`, `DATABASE_URL`, or authentication settings. It is also required after changing backend source when the `npm run dev` watcher has not reloaded successfully.
- **Browser refresh only:** enough when the backend and `.env` are unchanged and you are only repeating a browser step.
- **Authentication after restart:** local users and sessions are held in the development backend process. After every backend restart, bootstrap the local administrator again, sign in again, and obtain a fresh temporary bearer token if using Swagger.

Do not restart PostgreSQL or the backend after every browser action. Keep the `npm run dev` terminal open and watch it for errors.

### 12.2 Start or verify the local services

Open Command Prompt and use the migration project folder, not the older Apps Script project:

```cmd
cd /d "C:\Users\Vysakh Raju\Desktop\Jacky's\jackys service portal"
dir package.json
docker compose up -d
docker compose ps
npm run db:migrate
npm run dev
```

Run `npm run dev` in its own terminal and leave it running. In another terminal, verify:

```text
http://localhost:3100/health
http://localhost:3100/portal/
```

Expected result:

- The Docker PostgreSQL service is running.
- `/health` returns a healthy JSON response.
- `/portal/` displays **Jacky's Service Portal**.
- The backend terminal remains available for error details.

If the backend is already running and neither source code nor `.env` changed, do not start a second `npm run dev` process. Refresh the portal instead.

### 12.3 Bootstrap or sign in to the local administrator

If the backend was restarted, complete the first-time setup in section 9 again. Use the bootstrap token from the ignored local `.env` file and the local administrator details already described there. Do not copy the token or returned bearer token into this guide or into source code.

If the backend has not restarted and the browser session is still active, continue with the existing session. Otherwise use **Staff sign in** with the local administrator email and local password.

Confirm that:

1. The protected workspace is visible.
2. The signed-in user is the local administrator.
3. **Appointments** is available.
4. **Service job cards** is visible for an administrator with all local permissions.

If the job-card navigation is not visible, check the signed-in user and permissions before changing application code. The job-card workspace requires `service_job_card.read`.

### 12.4 Confirm or create a scheduled appointment

Use an existing non-terminal appointment if one is already available. The appointment must not already have a service job card.

If no suitable appointment exists, complete the Phase4 preparation and scheduling steps in sections 11.4 and 11.5 using fake local data. The appointment should be in a non-terminal state such as **Scheduled**. Do not use an appointment with status **Completed** or **Cancelled**, because the current service prevents creating a job card for terminal appointments.

1. Open **Appointments**.
2. Search for the fake appointment or customer used for this test.
3. Open the appointment detail.
4. Confirm the appointment reference, customer, date, time, and status are displayed.
5. Confirm the appointment does not already show an existing service job card.
6. Keep this appointment detail available for the creation test.

### 12.5 Create the service job card

1. In the appointment detail, confirm **Create service job card** is visible.
2. Select **Create service job card** once.
3. Wait for the success message containing a generated reference such as `JBC-2026-00001`.
4. Confirm the portal opens the **Service job cards** workspace and displays the new detail.
5. Confirm the initial status is **Open**.
6. Confirm the detail includes:
   - Job-card reference.
   - Appointment reference.
   - Customer name and contact number.
   - Appointment date and time.
   - Fault description.
   - Created and updated timestamps.
   - Empty finalization fields while the card is non-terminal.
7. Confirm the history contains the initial `Open` entry.

Expected result: one job card is created for the appointment and the job-card reference is shown. If the appointment already has a job card, the create request should return a conflict instead of creating a second record.

### 12.6 Verify the job-card queue, search, and status filter

1. Select **Service job cards** in the navigation if it is not already selected.
2. Confirm the new job card appears in the queue.
3. Confirm the queue shows the job-card reference, appointment reference, customer, status, and updated information.
4. Enter the job-card reference in the search box and select **Apply filters**. Confirm only the matching card remains.
5. Clear the search, enter the customer name or appointment reference, and apply the filter. Confirm the same card can be found by those values.
6. Select the **Open** status filter and apply it. Confirm the new card remains visible.
7. Select another status such as **Completed** and apply it. Confirm the open card is not shown.
8. Clear the status filter and refresh. Confirm the card is visible again.
9. Select the job-card row and confirm its detail panel opens.

Expected result: search and status filtering work without changing the job card, and selecting a result loads the correct detail and history.

### 12.7 Test the allowed status transitions and history

For the created job card:

1. Confirm the available next status is **In Progress**.
2. Optionally enter a reason such as `Technician started local Phase5 verification`.
3. Select the status update action.
4. Confirm the success message and the new **In Progress** status.
5. Confirm the history now contains the transition `Open → In Progress` and the reason when one was entered.
6. Select **Completed** or **Cancelled** as the next status.
7. Enter a reason such as `Phase5 browser verification completed`.
8. Submit the update.
9. Confirm the final status is displayed.
10. Confirm the history contains the second transition and reason.
11. Confirm finalization information is populated for the terminal record.

The allowed transitions are:

```text
Open → In Progress
Open → Cancelled
In Progress → Completed
In Progress → Cancelled
```

The current UI should not offer a transition from **Completed** or **Cancelled**. Do not try to reopen a terminal card through the UI. If testing the API through Swagger, an invalid or terminal transition should return a conflict response rather than changing the record.

### 12.8 Confirm terminal read-only behavior

After the card is **Completed** or **Cancelled**:

1. Refresh the job-card detail.
2. Confirm the status remains unchanged.
3. Confirm the status action controls are hidden or disabled.
4. Confirm the queue and detail remain readable to a user with `service_job_card.read`.
5. Refresh the browser and open the same job card again.
6. Confirm the terminal status and history are still displayed.

Expected result: terminal job cards are readable but cannot be reopened or changed through the normal UI.

### 12.9 Test permissions when suitable local users are available

The bootstrap administrator has all local permissions. The current portal does not provide a browser user-administration screen, so do not invent another account or modify database rows manually just to run this check. If a suitable local test profile is already available, verify the following:

- A user with `service_job_card.read` can see **Service job cards**, search, filter, and open detail/history.
- A user without `service_job_card.read` does not see the **Service job cards** navigation and cannot load the job-card queue.
- A read-only user with `service_job_card.read` but without `service_job_card.write` can view job cards but cannot create a job card or update status.
- A user without the required permission receives HTTP `403` from the protected API rather than receiving job-card data.

Record this check as **BLOCKED** if no suitable local test profile exists. Do not weaken permissions or use production accounts to force the test.

### 12.10 Test duplicate creation and recovery behavior

Use the original appointment after its job card has been created:

1. Return to **Appointments**.
2. Open the same appointment.
3. Confirm the create action is hidden when the existing job card is loaded, or otherwise do not submit it repeatedly.
4. If the action can still be submitted because the page is stale, select it once and wait for the response.
5. Confirm the API returns a conflict (`409`) and no second job card is created.
6. Refresh the appointment and job-card workspaces.
7. Confirm exactly one job card remains linked to the appointment.

A stale browser page or a second operator can produce this conflict. The expected recovery is to refresh and use the already-created job card, not to retry repeatedly.

### 12.11 Test unauthorized, not-found, and conflict recovery

Use the following safe checks:

- **401 unauthorized:** sign out, then request a protected action or open the protected workspace. Confirm the session is cleared and the portal asks you to sign in again. Directly opening `http://localhost:3100/api/job-cards` without a bearer token should return HTTP `401`.
- **403 forbidden:** use a suitable local profile without `service_job_card.read`, if one exists. Confirm the portal shows an authorization message and does not display job-card data. Mark this **BLOCKED** if no such local profile exists.
- **404 not found:** if a test endpoint or stale detail link refers to a job-card ID that does not exist, confirm the detail is hidden and the portal offers recovery to the job-card list. Do not delete a real local record merely to manufacture this case.
- **409 conflict:** submit the same appointment-to-job-card creation only once after a job card already exists, or use the duplicate check in section 12.10. Confirm the conflict message appears and the authoritative appointment/job-card data can be refreshed.

For every failed check, keep the exact browser message, URL, HTTP status, and backend terminal error. Do not hide the error by restarting services before recording it.

### 12.12 Phase5 manual results to report back

Copy this checklist into your reply and mark each item `PASS`, `FAIL`, or `BLOCKED`. Include the exact error text, HTTP status, and step for every failure or blocker.

```text
Phase5 browser verification date:
Browser and version:
Project folder:
Backend URL:
PostgreSQL status:
Was the backend restarted during testing? Why:
Was the administrator re-bootstrapped after restart?:

[ ] Local health and portal load:
[ ] Administrator sign-in:
[ ] Existing or newly scheduled appointment:
[ ] Create service job card:
[ ] Initial Open status:
[ ] Queue displays the job card:
[ ] Search by job-card reference:
[ ] Search by appointment or customer:
[ ] Status filter:
[ ] Detail fields:
[ ] Initial history entry:
[ ] Open → In Progress:
[ ] In Progress → Completed or Cancelled:
[ ] Status-change history and reason:
[ ] Terminal finalization details:
[ ] Terminal read-only behavior:
[ ] Duplicate creation returns 409:
[ ] 401 session recovery:
[ ] 403 permission check or BLOCKED with reason:
[ ] 404 detail recovery or BLOCKED with reason:
[ ] Browser refresh and repeat access:

Failures or blockers:
Exact HTTP status and response message:
Browser console errors:
Backend terminal errors:
Screenshots or downloaded files:
```

## 13. Run automated tests

Stop any command that is currently using the terminal only if necessary. From the project folder, run the API and contract tests:

```cmd
npm test -- --test-concurrency=1
```

The serial option avoids local PostgreSQL migration races when database-backed tests run at the same time.

Run the browser tests:

```cmd
npm run test:e2e
```

The browser tests use Chromium and the local server at `http://127.0.0.1:3000` by default. The backend
must already be running. **This checkout runs its backend on port 3100** (see section 6/9), so set
`E2E_BASE_URL` to match before running the browser tests, otherwise Playwright will try to reach a
server on port 3000 that isn't there:

```cmd
set E2E_BASE_URL=http://localhost:3100
npm run test:e2e
```

(Use `$env:E2E_BASE_URL = "http://localhost:3100"` in PowerShell, or `export E2E_BASE_URL=...` in a
bash/zsh terminal.)

If Playwright reports that a browser executable is missing, install the supported browser once:

```cmd
npx playwright install chromium
```

The generated `test-results/` directory is test output and should not be committed.

## 14. Run project verification checks

Run these commands from the project folder:

```cmd
npm run typecheck
npm run build
npm run format:check
npm run db:migrate
```

What they check:

- `typecheck`: TypeScript types without creating build output.
- `build`: production-style TypeScript compilation into `dist/`.
- `format:check`: formatting consistency.
- `db:migrate`: database schema is applied safely.

`dist/` is generated output and should not be committed.

## 15. Stop the local services safely

To stop the development server, focus the terminal running `npm run dev` and press:

```text
Ctrl+C
```

To stop the Docker services without deleting the local database volume:

```cmd
docker compose stop
```

To start them again later:

```cmd
docker compose start
```

Use `docker compose down` only when you intentionally want to remove the containers. Do not add `-v` unless you intentionally want to erase the local database volume and all local test data.

## 16. Troubleshooting

### `npm` cannot find `package.json`

Run:

```cmd
cd /d "C:\Users\Vysakh Raju\Desktop\Jacky's\jackys service portal"
dir package.json
```

The migration project is different from `service-jackys.github.io`, which contains the older Apps Script and landing-page files.

### Docker is unavailable

Open Docker Desktop and wait until it reports that Docker is running. Then check:

```cmd
docker compose ps
```

If the database container is not running, start it again with `docker compose up -d`.

### Port 3000 is already in use

Stop the other local server using port 3000, or identify the process before stopping it. Do not terminate an unknown process without checking what it is. The browser tests can use another URL only if the server and `E2E_BASE_URL` are configured consistently.

### The page loads but buttons do nothing

Check the terminal running `npm run dev` for errors. Then refresh `http://localhost:3100/portal/`. The browser UI loads its JavaScript from `/portal/app.js`; a direct file-open URL such as `file:///.../index.html` will not work correctly.

### Browser tests cannot connect

Start the backend first:

```cmd
npm run dev
```

Then run `npm run test:e2e` from a second terminal in the same project folder.

### Playwright says Chromium is missing

Run:

```cmd
npx playwright install chromium
```

Then rerun `npm run test:e2e`.

### Migration checksum mismatch

Do not delete the Docker volume or edit migration history as a shortcut. First stop concurrent test processes and check whether more than one process is running migrations. Run the affected test or the full API test suite serially:

```cmd
npm test -- --test-concurrency=1
```

If the error continues, stop and review the migration file and repository changes before changing anything in the database.

### A local login or bootstrap request fails

Check that:

- PostgreSQL is running.
- `npm run db:migrate` completed.
- The local environment variables are present where expected.
- You are using local test credentials and the correct local bootstrap token.
- No production credentials or live URLs were copied into the local project.

## 17. Safety reminders

- Google Apps Script remains the production and rollback system.
- Do not change the live Apps Script deployment while testing this migration slice.
- Do not import live customer data into the local database.
- Do not commit `.env`, credentials, bootstrap tokens, API keys, customer exports, deployment URLs, or private IDs.
- Do not push changes until you have reviewed the local commit and are ready to update GitHub.
