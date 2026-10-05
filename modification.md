# Modification tracker (through Phase 5)

Tracks each discrete change made to the service portal going forward, one modification at a
time, up through Phase 5. See `modification_status.html` (open directly in a browser, no server
needed) for the same list as a quick-glance page — keep the two in sync when adding an entry.

Status values used below: **Code complete** (built, typechecked, needs your DB/test step),
**Verified** (you confirmed it works), **Blocked** (waiting on a decision or dependency).

---

## Modification #1 — B2B Branch / School master list on the public complaint form

- **Date:** 2026-09-29
- **Status:** Code complete — needs you to run the migration, import script, and re-test
- **Scope:** Customer complaint portal (`/complaints`)
- **Superseded in part by Modification #2 below** — point 2 in "What changed" (the public
  autocomplete) was removed for a business/privacy reason you raised yourself. Everything else in
  this entry (the master table, the dropdown/field-gating/contact-number changes) still stands as
  described.

### What changed

1. New `b2b_branches` master table, seeded from the sales invoice export you attached (last 365
   days: `Cust_Code`, `Customer`, `Salesman`, `Inv/Del No`) — 567 unique branches, deduplicated by
   `Cust_Code` using each branch's most recent invoice for its name/salesman/last sales order
   number.
   - Seed data: `packages/db/seed/b2b_branches.json`
   - Import script (re-runnable, upserts by `Cust_Code`): `scripts/import-b2b-branches.mjs`
2. ~~The public form's "B2B Branch / School" field is now an autocomplete against that master
   list...~~ **Reverted in Modification #2** — see below. The field is plain free text on the
   public form; matching against the master list moved to an authenticated staff tool instead.
3. Removed "B2B Sales Channel" from the **public form's** Customer type dropdown only. The value
   still exists everywhere else in the system (contracts, DB, other flows) — it just can't be
   self-selected by a customer submitting this form.
4. For a **B2C** customer: "B2B Branch / School", "Site contact person", and "Site contact
   number" are now greyed out (disabled) and cleared when that type is chosen — staff can fill
   them in later on the internal side if ever needed.
5. For a **B2B** customer: "Contact number" is no longer required (the site contact
   person/number already cover reaching someone on site). Still required for B2C.

### Database changes

Migration `010_b2b_branch_master_and_optional_contact.sql`:

- New `b2b_branches` table (`cust_code` unique, `branch_name`, `salesman`,
  `last_sales_order_number`, `last_invoice_date`).
- New `complaints.b2b_branch_cust_code` column (FK to `b2b_branches.cust_code`).
- `complaints.contact_number` and `appointments.contact_number` made nullable (existing CHECK
  constraints only run against non-null values, so they still apply once a number is provided).

### Needs you

1. `npm run db:migrate` (applies migration 010).
2. `node scripts/import-b2b-branches.mjs` (loads the 567 branches — safe to re-run any time the
   invoice export is refreshed; just regenerate `b2b_branches.json` and re-run).
3. `npm run test:e2e` (5 new tests added to `tests/e2e/complaints.spec.ts`) or just
   `npx playwright test tests/e2e/complaints.spec.ts` for a faster check.
4. Manually try `/complaints`: pick B2B and confirm Contact number isn't required and the branch
   field autocompletes against real data; pick B2C and confirm the three fields grey out and clear.

### Known follow-up

See Modification #2's "Known follow-up" below — carried forward, still not started.

---

## Modification #2 — Moved B2B Branch matching behind staff authentication (Option C)

- **Date:** 2026-09-29
- **Status:** Code complete — needs you to re-run the migration check (none new), re-test, and
  manually verify against real data
- **Scope:** Customer complaint portal (`/complaints`) and the internal staff portal's complaint
  detail view

### Why

You raised this yourself right after Modification #1 shipped: the public `/complaints` form's
autocomplete let anyone visiting the page browse the entire 567-branch B2B customer/branch
roster (names, and indirectly which schools/companies are Jacky's customers) with no sign-in
required. That's a real business exposure, not just a UX detail.

You picked **Option C**: keep the public form as plain free text, and give staff an authenticated
tool to match that free text to the master list after the complaint is registered.

### What changed

1. **Public form (`/complaints`)** — the "B2B Branch / School" field is plain free text again. No
   datalist, no `GET /api/public/b2b-branches` call, no `b2bBranchCustCode` in the submitted
   payload. The public `GET /api/public/b2b-branches` endpoint has been removed entirely. The
   tooltip now reads: "Type it if you know it, or leave blank — our service team will confirm it
   against our records."
2. **New staff-only endpoints** (both require sign-in and the `complaints.write` permission):
   - `GET /api/b2b-branches?query=...` — searches the master list by branch name (capped at 20
     results; with no query, returns the first 20 for browsing). Includes the salesman name,
     which is never sent to the public form.
   - `PATCH /api/complaints/{id}/b2b-branch` — links a complaint's typed branch text to a
     specific `Cust_Code` (overwrites the free text with the master list's canonical spelling) or
     unlinks it (`custCode: null`, which only clears the link and leaves the customer's typed
     text alone).
3. **New staff UI** — the complaint detail view (internal portal) now has a "B2B Branch / School
   match" card, visible only for B2B complaints and only to staff with `complaints.write`. It
   shows what the customer typed and whether it's matched yet, a search-as-you-type box against
   the master list, clickable results to link, and a "Clear match" button to unlink.

### Database changes

None new — this reuses the `b2b_branches` table and `complaints.b2b_branch_cust_code` column from
migration 010. If you haven't run that migration and the import script yet (Modification #1's
"Needs you" steps), do those first.

### Needs you

1. If you haven't already: `npm run db:migrate` and `node scripts/import-b2b-branches.mjs` (see
   Modification #1).
2. `npx playwright test tests/e2e/complaints.spec.ts tests/e2e/portal.spec.ts` — 3 new tests cover
   the staff-side search/link/unlink/B2C-hidden behavior; the public-form tests were updated to
   match the reverted free-text field.
3. Manually verify: on `/complaints`, submit a B2B complaint with a typed branch name and confirm
   no network request goes to any branch-listing endpoint. Then, signed in to the staff portal
   with a user who has `complaints.write`, open that complaint and confirm the new "B2B Branch /
   School match" card appears, search finds the branch, linking it updates the displayed text and
   shows "Clear match", and clearing it removes the link but keeps the typed text.

### Known follow-up (tracked, not started)

- Surfacing a linked branch's **Salesman** in the staff Appointment and Service Job Card views
  (carried over from Modification #1 — still not wired).
- `appointments.b2b_branch_cust_code` carry-forward from the complaint when an appointment is
  created isn't wired yet (only the complaint stores the link so far).

---

## Modification #3 — Toast-style notifications for every staff action

- **Date:** 2026-09-29
- **Status:** Code complete — needs your visual/manual check
- **Scope:** Internal staff portal (all workspaces — complaints, appointments, job cards,
  quotations, inspections, attachments, warranty approvals)

### Why

Every staff action (save notes, update status, schedule an appointment, etc.) reported success
or failure through a single banner near the top of the page — and along the way we found it was
hardcoded to the _error_ color even for success messages, so a successful save looked the same
as a failure. On longer pages, staff had to scroll back up to see it at all.

### What changed

- The same feedback element now renders as a floating, colored toast (top-right corner) instead
  of an inline banner — success is green with a check mark, errors are red with an exclamation
  mark, and it's visible immediately without scrolling.
- Success toasts auto-dismiss after 4 seconds; error toasts stay until replaced or the next
  action, since those usually need to be read and acted on.
- Fixed a related bug: appointment reschedule/technician-assignment/status-update **errors**
  were silently swallowed (the message text was set but the element was immediately hidden again)
  — they now display correctly, in red.
- No new elements, no new endpoints — this only changes how the existing `#workspaceMessage` /
  `#authMessage` feedback is presented, so it covers every action across the whole portal at once.

### Needs you

- `npx playwright test` (no test changes were needed for this one — same elements, same text).
- Manually glance through a few actions (save notes, update a status, schedule an appointment)
  and confirm the toast shows top-right, colored correctly, and success ones fade after a few
  seconds.

---

## Modification #4 — Schedule appointment: shows existing data, vertical-tab layout

- **Date:** 2026-09-29
- **Status:** Code complete — needs your manual check
- **Scope:** Internal staff portal, complaint detail view

### Why

Two issues you raised: (1) the Schedule appointment card sat at the bottom of a long, stacked
list of action cards inside the complaint detail, so staff had to scroll past Notes / B2B Branch
match / Update status to reach it; (2) its Sales order no. and B2B Branch / School fields always
showed blank with only a placeholder hint, even when the complaint already had that data.

### What changed

- The complaint's action cards (Notes, B2B Branch match, Update status, Schedule appointment) are
  now a vertical-tab layout — one card visible at a time, selected from a tab list on the left, so
  no more scrolling past cards you're not using.
- Opening a complaint that's **Ready for Scheduling** now lands directly on the Schedule
  appointment tab (since that's the action staff came there to take); otherwise it lands on
  Notes. Switching tabs to link/unlink a B2B branch or save notes no longer jumps you back to the
  default tab afterwards — it keeps you where you were.
- The Schedule appointment card's Sales order no., B2B Branch / School, Site contact
  person/number, and Customer number fields are now pre-filled from the complaint's current data
  (they were always blank before). B2B Branch / School also shows whether it's already matched to
  the master list (Cust_Code) or still needs matching, right there on the Schedule tab.

### Needs you

- `npx playwright test tests/e2e/portal.spec.ts` — one existing test updated (a tab click added
  before the status-update step) and two of the new B2B-linking tests from Modification #2
  updated the same way; no behavior changes to those tests otherwise.
- Manually open a Ready-for-Scheduling complaint that already has a Sales order no. / B2B Branch
  on file and confirm those fields show the existing data, and try switching between the four
  tabs.

### Known follow-up (tracked, not started)

- Item 1 from your last message (separate, non-mixed page views for Complaint inbox / Service
  requests / Appointments / Job cards, with an end-to-end workflow link back from job card →
  appointment → complaint) and item 4 (interactive, visually redesigned dashboard) are both large
  enough to be their own modifications — see modification #5 and #6 (not started yet).

---

## Modification #5 — End-to-end workflow links: Complaint ↔ Appointment ↔ Job card

- **Date:** 2026-09-29
- **Status:** Code complete — needs your manual check
- **Scope:** Internal staff portal — complaint detail, appointment detail, job card detail, job
  card list

### Why

Your item 1: Complaint inbox, Service requests, Appointments, and Job cards were already
separate, non-mixed page views (each is its own workspace panel) — but once a complaint was
scheduled and a job card created, there was no way to trace the chain. The job card list showed
the appointment reference as plain text (not clickable), and there was no way at all to jump from
an appointment back to the complaint it came from, or from a complaint forward to its appointment
or job card.

### What changed

- **Complaint detail** now shows a clickable trail under the status line — "Appointment
  APT-xxxxx" and, once a job card exists, "Job card JBC-xxxxx" — that jumps straight to that
  record's detail in its own workspace.
- **Appointment detail** now shows "Complaint CMP-xxxxx" (linking back) and "Job card JBC-xxxxx"
  (linking forward, once one exists). Also fixed: the detail grid's "Complaint" row was showing
  the complaint's raw internal ID instead of its reference — it now shows the actual reference.
- **Job card detail** now shows both "Complaint CMP-xxxxx" and "Appointment APT-xxxxx" links.
- **Job card list**: the Appointment column is now clickable and jumps to that appointment.
- Backend: appointment records now carry the originating complaint's reference (previously only
  the internal ID), and job card records now carry both the complaint's ID and reference —
  fetched via joins on read, with appointment/job-card summaries also returned alongside a
  complaint's own detail response.

### Needs you

- `npx playwright test tests/e2e/portal.spec.ts` — one new test added
  ("Workflow links across Complaint / Appointment / Job card") that clicks through the whole
  chain and back.
- Manually open a complaint that's been scheduled and has a job card, and click through
  Complaint → Appointment → Job card and back to confirm the links land on the right record.

### Known follow-up (tracked, not started)

- Item 4 from your message — an interactive, visually redesigned dashboard — is modification #6,
  not started yet.
- The Complaint inbox / Service requests list views don't yet show the linked appointment
  reference in the table row itself (only in the detail panel) — could be added as a follow-up if
  useful.

---

## Modification #6 — Interactive, visually redesigned dashboard

- **Date:** 2026-09-29
- **Status:** Code complete — needs your manual check
- **Scope:** Internal staff portal, Dashboard workspace

### Why

Your item 4: the dashboard was a flat grid of plain white number tiles — accurate, but static
and visually flat, with no way to act on what you saw.

### What changed

- Each section (Complaints, Appointments, Service job cards, Quotations & inspections, Warranty
  approvals) now has its own color accent and a small icon badge, and a "Last updated" timestamp
  at the top.
- Tiles now use that color as a left-edge accent, with a hover/focus lift so it's clear they're
  interactive.
- **Every status tile is now clickable** and jumps straight to that record type's workspace,
  pre-filtered to that status — e.g. clicking "Ready for Scheduling" under Complaints opens the
  Complaint inbox already filtered to that status. The Appointments "Today" tile jumps to the
  appointments list filtered to today's date. Keyboard-accessible (Enter/Space work, not just
  click).
- Each section with a status breakdown now also shows a small horizontal bar chart underneath the
  tiles, scaled to the largest count, for an at-a-glance read — built with plain CSS, no charting
  library added.
- No new API calls — everything uses the existing `/api/dashboard/summary` response; still
  renders whatever statuses that endpoint returns rather than a hardcoded list.

### Needs you

- `npx playwright test tests/e2e/phase5-records.spec.ts` — one new test added confirming a status
  tile click lands on the filtered list; the existing tile-rendering test needed no changes.
- Manually open the Dashboard and click a few different status tiles to confirm they land on the
  right filtered list, and glance at the colors/icons/bars.

### Known follow-up (tracked, not started)

- This closes out all four items from your last message. Nothing new queued — let me know what's
  next.

---

## Modification #7 — Fixes from your Playwright test run (56/59 → root-caused)

- **Date:** 2026-09-29
- **Status:** Two of three confirmed and fixed; one could not be reproduced (see below)
- **Scope:** Public complaint form gating, workflow-links test coverage

### Why

You ran the full suite (`npx playwright test` against your live dev server) and got 56 passed,
3 failed. I root-caused each failure by reproducing the exact click sequence from each failing
test in a headless DOM simulation (loading the real `app.js`/`complaints.js`/`index.html`/
`complaints.html` with the same mocked API responses the test uses), so these are confirmed causes,
not guesses.

### What changed

1. **`tests/e2e/complaints.spec.ts:67` (contactNumberRequiredMark stuck hidden) — fixed, real bug.**
   `apps/web/src/complaints.js`'s customer-type gating had a leftover line —
   `if (isB2c) $('#b2bBranchCustCode').value = '';` — referencing an element ID that only exists
   on the **staff** portal (`index.html`), not on the **public** complaint form
   (`complaints.html`). Switching a public-form customer from B2B back to B2C threw a `TypeError`
   partway through the gating function, which aborted it before it could reach the line that
   un-hides the "contact number required" mark. Removed the stray line — it never belonged on the
   public form, since B2B Branch matching to the master list is staff-only (modification #2).

2. **`tests/e2e/portal.spec.ts:2168` (Job card workflow-link chip timeout) — fixed, test bug, not
   an app bug.** My own new "Workflow links" test (modification #5) signs in with a fake mocked
   token, but its route mock didn't cover `GET /api/technicians`. The appointment detail page
   fetches that list in the background (for the reassignment dropdown), and since it wasn't
   mocked, the request fell through to your _real_ dev server, which correctly rejected the fake
   token with a 401 — and the app's normal 401 handling signed the test's staff session out mid-test,
   hiding the whole workspace (including the chip Playwright was about to click). Added the missing
   mock. I checked every other test that opens an appointment detail as an admin-style user and
   confirmed they already mock `/api/technicians` — this was isolated to the one new test.

3. **`tests/e2e/portal.spec.ts:1877` (`#unlinkB2bBranchButton` visible when it should be hidden) —
   fixed, real (and previously unreported) CSS bug.** You re-ran the suite and this one failed
   again, exactly the same way -- which ruled out my first guess (a flaky full-suite timing
   issue). The error log was the giveaway: Playwright's own DOM snapshot showed
   `<button hidden="" ... >` and _still_ reported it as visible. `.button` (in both
   `index.html` and `assets/landing/brand.css`) sets `display: inline-flex`, and CSS's cascade
   rule is that any normal author declaration beats the browser's built-in
   `[hidden] { display: none }` rule, _regardless of specificity_. So setting
   `element.hidden = true` on any button did nothing visually unless something else also hid it.
   This codebase already knew about that exact trap and had fixed it, selectively, for
   `.notice`, `.auth-panel`, `.dashboard-link`, `.detail-panel`, `.detail-actions` and
   `.workflow-links` (each has its own `[class][hidden] { display: none; }` override) -- `.button`
   was simply never added to that list. Added `.button[hidden] { display: none; }` in both
   stylesheets. This is a systemic fix: it was silently affecting _every_ button anywhere in the
   app that gets shown/hidden via `.hidden = true/false` (this one just happened to be the one a
   test caught), so this closes a real, previously-invisible visual bug, not just the test.

### Needs you

- `npx playwright test` — full re-run to confirm all 59 pass now.
- Worth a quick visual skim of a few screens where buttons get shown/hidden (e.g. Unlink/Clear
  match, Create job card, Download ICS) to confirm nothing looks different now that hiding
  actually hides them -- the fix should make things _disappear_ that may have been sitting there
  visibly doing nothing before.

### Addendum (2026-09-29, same day) — one more test failure after the CSS fix

Your next full re-run passed all the previously-failing tests (the CSS fix above was correct and
did fix `portal.spec.ts:1877`), but surfaced a _different_, pre-existing test:
`portal.spec.ts:425` ("lists, filters, and opens appointment details with history") failed with a
wrong `from` date. Not a new regression from anything in this session — `loadAppointments()`
always fires a second background request afterward (`loadCalendar()`, for the month-view grid)
against the same `/api/appointments` endpoint, using the padded start/end of the _current real
calendar month_ rather than the filter dates you typed. The test grabbed "whichever request
happened last" to check the filter, which only worked by coincidence when the calendar's computed
grid start happened to match the filter's start date — and stopped lining up as the real date
moved on. Fixed the test to find the request that actually carries the applied filter dates
instead of assuming it's the last one. Not an app bug; no app code changed for this one.

### Known follow-up (tracked, not started)

- None — this closes out the test-failure report. Let me know what's next.

## Modification #8 — Daily technician cap (no more appointment time), Salesmen / Sales Channel master data, fresh-test DB wipe

- **Date:** 2026-09-29
- **Status:** Partially complete — backend/DB/contracts/frontend for items 1, 3 (salesman only)
  and 4 done; two large pieces (item 2, item 3's branch/sales-order picker, and a technician
  management page) are explicitly **not started** — see "Known follow-up" below.
- **Scope:** DB schema, contracts, API, staff portal frontend

### Why

Your message asked for four things in one batch: (1) replace appointment scheduling with a
per-technician daily cap (admin-changeable, default 10) instead of a specific time, and remove
appointment time everywhere; (2) let staff create appointments directly from an email/request,
the same way the public complaint form works; (3) fix the Schedule appointment form so Sales
order no. / B2B Branch fields (and a new Salesman field) pick from real master-list data instead
of free text; (4) let job cards record a Salesman and a new super-admin-managed Sales Channel.
You confirmed: wipe all transactional data now, build a dedicated Salesmen master table, and
build a technician management page.

### What changed

**Item 1 — daily cap, no time (done, backend + frontend):**

- `technicians` gained `max_appointments_per_day` (default 10, admin-changeable via
  `PATCH /api/technicians/{id}`). `appointments.appointment_time` is dropped entirely — the
  column, its indexes, and every place that read or wrote it (contracts, DB queries, the ICS
  calendar-file generator, the Schedule appointment form, the reschedule form, the calendar grid,
  appointment/job-card detail views, and the whole test suite).
- Scheduling and rescheduling now check "has this technician already got
  `max_appointments_per_day` appointments on this date" instead of a time-window/exact-time
  conflict. Hitting the cap surfaces as a clear message wherever a 409 already shows up (the
  Schedule appointment card and the Reschedule card): _"Assignment limit for the day reached:
  <name> already has X of Y appointments on <date>."_
- The appointment calendar file download (`.ics`) now produces an all-day event instead of a
  timed one.
- **Not done:** an admin-facing technician management page (create/edit technicians, including
  the daily-cap field, from the UI). Today that field can only be set via the API directly
  (`PATCH /api/technicians/{id}` with `maxAppointmentsPerDay`) — there's no screen for it yet.

**Items 3 & 4 — Salesmen / Sales Channel master data (done, backend; partial, frontend):**

- New `salesmen` and `sales_channels` tables (`name`, `active`), each with its own
  read/write permission pair — write is admin-only for both, matching how Sales Channel was
  asked for ("super admin option"). `salesmen` is seeded from the salesman names already on file
  in the B2B branch master list, so the dropdown isn't empty on day one; `sales_channels` starts
  empty — you add entries yourself before end-to-end testing, as you said you would.
- New `GET/POST /api/salesmen` and `GET/POST /api/sales-channels` endpoints.
- The Schedule appointment form gained a **Salesman** dropdown (feeds `appointments.salesman`).
  Both job-card panels (create-from-appointment and edit) gained **Salesman** and **Sales
  channel** dropdowns (feed `service_job_cards.salesman` / `sales_channel`); creating a job card
  from a completed appointment now pre-fills Salesman from the appointment automatically.
- **Not done:** the Schedule form's Sales order no. / B2B Branch / School fields are still plain
  text — you asked for these to show and pick from the real table data too (the B2B branch part
  is very achievable, reusing the same master-list search already built for staff to match a
  complaint's branch — see modification #2). Ran out of scope for this pass.
- No admin screen to add/deactivate salesmen or sales channels either — same gap as technicians
  above; use the API directly for now (`POST /api/salesmen` / `POST /api/sales-channels`).

**Item 2 — staff-created appointments from an email/request — not started at all.** This needs
its own staff-facing intake form (like the public complaint form, but internal) that also links
to the branch/invoice master data and flows into job-card creation the way an appointment
scheduled from a complaint already does. Flagging it clearly rather than rushing a half version.

**Fresh-test DB wipe:** a one-time migration truncates every transactional table (complaints,
appointments, job cards, quotations, inspections, warranty approvals, customers, branches, audit
log, draft schedules, reference counters, legacy references, import batches) and leaves your
master data alone (profiles/roles/permissions, technicians, B2B branches, the new salesmen/sales
channels). This only runs once, the next time you run the migrator.

**Along the way, found and fixed two real bugs this change would otherwise have introduced:**
`packages/db/src/job-cards.ts` was still selecting `appointments.appointment_time` in its main
query (would have crashed every job-card list/detail fetch with a Postgres "column does not
exist" error the moment the migration ran), and the job-card create/update service was missing
the new `salesman`/`salesChannel` fields entirely (a TypeScript compile error I caught before it
shipped). Both fixed as part of this same change.

### Needs you

- **Run the migration** (`npm run db:migrate`) — this applies the schema changes _and_ the
  one-time data wipe, so make sure that's really what you want before running it.
- **Add your Sales Channel entries** before testing job-card creation with that dropdown (it
  starts empty on purpose).
- Restart `npm run dev` and re-run `npx playwright test` — I've updated every test file that
  referenced appointment time (`portal.spec.ts`, `phase4-scheduling.spec.ts`,
  `phase5-records.spec.ts`, `contracts.test.ts`, `tests/integration/*.test.ts`) to match, but I
  could not actually run the suite myself from this side (same `esbuild`/Windows-binary
  limitation as before), so this first real run is the actual check.
- A technician's daily cap and new salesmen/sales channels can only be managed via direct API
  calls until the admin screens below are built.

### Known follow-up (tracked, not started)

- Item 2: staff-facing "create appointment from email/request" intake page.
- A technician management page (create/edit, including the daily-cap field).
- An admin page (or reuse of one) to add/deactivate salesmen and sales channels from the UI.
- Schedule appointment form: turn Sales order no. / B2B Branch / School into real
  pickers against the master data (B2B branch part can reuse modification #2's search).

## Modification #9 — Technician management page, B2B branch / Sales order picker, LAN-access fix

- **Date:** 2026-09-29
- **Status:** Complete for the three items below. Closes out the "technician management page"
  and "Schedule form branch/sales-order picker" follow-ups from Modification #8.

### What changed

**Technician management page (new):**

- New nav item and workspace panel where an admin/management user can list, create, and edit
  technicians — name, region, phone, email, active flag, and the **daily appointment cap**
  (`maxAppointmentsPerDay`) that Modification #8 added to the schema but left API-only. This was
  the last piece needed to actually change a technician's cap without calling the API by hand.
- Same list/create/edit pattern as the other master-data workspaces already in the app: a table
  of existing technicians with an edit action, and a form underneath that switches between
  "create" and "edit" mode.

**Schedule appointment form — B2B Branch / School + Sales order no. picker (new):**

- The Schedule form's "Sales order no." and "B2B Branch / School" fields were still plain free
  text (flagged as a known gap in #8). They now sit behind a search box that queries the same
  staff B2B-branch master-list search already used on the complaint detail page's "B2B Branch
  match" tab (see Modification #2) — type a few letters of a school/branch name or cust code, pick
  a result, and it fills in the Branch/School name, the Sales order no. (from that branch's last
  known sales order number, when one is on file), and the Salesman dropdown, all from real master
  data instead of typed-in text.
- `packages/db/src/b2b-branches.ts`'s staff search now also returns `lastSalesOrderNumber` so the
  picker has something to prefill.
- Resetting the Schedule form (after submitting, or cancelling) now also clears this search box,
  its results list, and its status message, so a stale search doesn't linger into the next
  appointment you schedule.

**LAN/local-network access fix:**

- While testing over the LAN (`http://192.168.60.154:3100/...`), the portal logo, the public
  site, and `/complaints` all failed to load. Root cause: `helmet()`'s default security headers
  include a Content-Security-Policy with `upgrade-insecure-requests` and an HSTS header — both
  tell the browser to silently retry every request on the page over HTTPS. That's correct once
  this is deployed behind real TLS, but on a plain-HTTP dev/LAN server there's nothing listening
  on HTTPS, so the browser's silently-upgraded requests just fail with nothing served.
- Fixed by keeping the full `helmet()` policy in production, and relaxing just those two
  directives (`contentSecurityPolicy: false, hsts: false`) everywhere else, using the existing
  `isProduction()` check — no behavior change in production.

### Needs you

- Restart `npm run dev` to pick up the LAN-access fix and the new frontend code.
- After restarting, re-test over the LAN using **`http://`, not `https://`**, on port 3100 for
  all three entry points (`/`, `/portal/`, `/complaints`). If a browser still forces `https://`
  after that, it's likely a cached HSTS setting from before the fix — clear site data for that
  address or try a private window.
- Try the new Technician management page: add a technician, edit one's daily cap, confirm it's
  enforced the same way `maxAppointmentsPerDay` already was via the API.
- Try the new Schedule form branch picker: search for a known B2B branch/school, confirm it fills
  Branch/School, Sales order no. (where one exists), and Salesman correctly.

### Known follow-up (tracked, not started)

- Item 2: staff-facing "create appointment from email/request" intake page.
- An admin page (or reuse of one) to add/deactivate salesmen and sales channels from the UI —
  still API-only (`POST /api/salesmen` / `POST /api/sales-channels`).

## Modification #10 — Add teammate logins so your team can test

- **Date:** 2026-09-29
- **Status:** Complete.

### What changed

You asked: you only get one bootstrap token, so how do you create a second admin, or any other
account, so your team can actually test the portal? Bootstrap is (deliberately) a one-time-only
flow that creates exactly one administrator and then locks itself for the life of the running
server — it was never meant to be the way you add teammates.

- New admin-only endpoints: `POST /api/auth/users` (create another local-auth login — name,
  email, password, role) and `GET /api/auth/users` (list the ones created so far). Both require
  the `admin.users` permission, which only the `admin` role has — the same permission your
  bootstrapped account already carries.
- New **Team logins** page in the web UI's protected workspace (same place as Technicians),
  visible only to admins. Add a teammate's name, email, a password you choose, and a role
  (`user` / `sales` / `management` / `admin`); it appears in the list immediately. There's no
  invite email — you share the email/password with them directly.
- Every login created this way also gets a matching `profiles` row in Postgres with the chosen
  role, the same way bootstrap already did for the first admin — so their real permissions come
  from the same roles/permissions system every other account uses, not a shortcut.
- `packages/db/src/profiles.ts`'s `ensureLocalAdminProfile` is now a thin wrapper around a new,
  role-parameterized `ensureLocalProfile`, reused for every role instead of just `admin`.

### Needs you

- Restart `npm run dev` to pick this up.
- Same caveat as the rest of local auth: this list lives in the running server's memory, not the
  database. **Restarting the backend clears every teammate login** (their `profiles` row in
  Postgres stays, but the password does not) — if you restart, sign back in as admin and re-add
  them.
- Sign in as your existing admin account, open **Team logins**, and add one login per teammate
  who needs to test. Give each one a distinct password and the role that matches what you want
  them testing (e.g. `sales` to test scheduling, `admin` if they need full access).

### Known follow-up (tracked, not started)

- No way to edit, deactivate, or remove a teammate login from the UI or API yet — only add and
  list. If someone's role needs to change or an account needs to be revoked, that's still a gap.
- Item 2: staff-facing "create appointment from email/request" intake page.
- An admin page (or reuse of one) to add/deactivate salesmen and sales channels — still API-only.

## Modification #11 — Field hints as tooltips, not permanent text

- **Date:** 2026-09-29
- **Status:** Complete.

### What changed

You flagged that short field-level guidance (like "At least 12 characters. Share it with them
directly." under the Team logins password field) should be a hover/focus tooltip, not text that
sits permanently under the field — and that this should be the convention going forward, not a
one-off fix.

- Added a small reusable tooltip pattern: a "ⓘ" marker next to a field's label, using the native
  `title` attribute (shows on hover, and on focus for keyboard users, via `tabindex="0"` +
  `aria-label`). No new dependency — just a `.field-tip` CSS rule.
- Replaced the Team logins password field's visible hint paragraph with this tooltip.
- Noted as a standing UI convention so future field hints use this pattern instead of visible
  helper text by default.

### Needs you

- Restart `npm run dev` and confirm the Team logins password field shows the "ⓘ" tooltip on
  hover instead of the old text underneath it.

## Modification #12 — Staff-facing "New request" page (item 2)

- **Date:** 2026-09-29
- **Status:** Complete.

### What changed

This closes out item 2 from the original request: a staff-facing way to register a service
request when a customer calls or emails in, instead of the only option being the public request
form.

- New authenticated endpoint `POST /api/complaints` (gated on `complaints.write` -- management,
  sales, and admin already have it). Same validation and the same service function as the public
  `POST /api/public/complaints`, but not rate-limited, and it records which staff profile
  registered the request (`complaint.submitted` audit event now carries `actorProfileId` and a
  `source: 'staff'` vs `'public'` marker).
- New **New request** page in the staff portal (sidebar, same visibility rule as the rest of the
  complaint workflow: `complaints.write`). Same fields as the public form -- customer type, name,
  contact details, address/region, B2B branch/school and site contact fields, product details,
  and the issue description -- with the same conditional rule (contact number not required for a
  B2B corporate account).
- Unlike the public form, staff get a **B2B Branch / School lookup** against the real master list
  (the same search used on the Schedule form and the complaint detail page's B2B match tab) --
  type a few letters, pick a result, and it fills the branch name, customer number, and sales
  order no. together. The public form can only ever offer free text there (see modification.md
  #2), since it isn't authenticated.
- On success, the page shows the new complaint's reference with two actions: **Open in inbox**
  (jumps to the Complaint inbox pre-filtered to that reference) or **Register another**.
- A request registered this way flows through the rest of the app exactly like one submitted
  publicly -- it appears in the inbox, can be scheduled, notated, and turned into a job card the
  same way.

### Needs you

- Restart `npm run dev` and confirm **New request** appears for management/sales/admin logins.
- Register a test request, try the B2B branch lookup, and confirm it appears correctly in the
  Complaint inbox and can be scheduled through to a job card.

### Known follow-up (tracked, not started)

- An admin page (or reuse of one) to add/deactivate salesmen and sales channels -- still
  API-only.
- No edit/deactivate/remove for a teammate login yet -- add and list only (modification.md #10).

## Modification #13 — Edit and deactivate teammate logins

- **Date:** 2026-09-29
- **Status:** Complete.

### What changed

Modification #10 only let an admin add and list teammate logins. You flagged that not being able
to edit or turn one off was a real gap, so:

- New `PATCH /api/auth/users/{id}` (admin-only, `admin.users`), letting an admin change a
  teammate's role and/or turn their login on or off. You can't modify your own account through
  this endpoint (a 409 if you try) -- that's a guardrail against accidentally locking yourself
  out.
- Deactivating someone takes effect everywhere immediately: their bearer token stops working (the
  local-auth session layer now checks `active`, on top of the existing database profile check),
  and they can't log back in while deactivated.
- Their real Postgres `profiles` row is updated too (active flag and/or role), the same record
  every other permission check reads from -- not just an in-memory flag.
- The **Team logins** table now shows each teammate's current status (Active/Inactive), a role
  dropdown with a **Save role** button, and a **Deactivate**/**Reactivate** button per row. Your
  own row shows "(you)" instead of these controls.

### Needs you

- Restart `npm run dev`.
- Try changing a teammate's role and deactivating/reactivating a login; confirm a deactivated
  teammate can no longer sign in or use their existing session.

## Modification #14 — Salesmen & Sales channels admin page

- **Date:** 2026-09-29
- **Status:** Complete for what the backend already supports (add + list only).

### What changed

Closes the last "known follow-up" item carried since modification #8: there was no UI for
managing the Salesman and Sales Channel master lists that feed the Schedule form and job card
dropdowns -- only the API (`POST /api/salesmen` / `POST /api/sales-channels`).

- New **Salesmen & channels** page in the staff portal (admin-only, gated on `salesmen.write` --
  the same permission gate the backend already uses for writing either list). Two small
  sections, each with a table of existing entries and a one-field "Add" form.
- This only covered what the backend exposed at the time -- list and create. Edit/deactivate was
  added right after in modification #15.

### Needs you

- Restart `npm run dev` and try adding a salesman and a sales channel from the new page; confirm
  they show up in the Schedule form's Salesman dropdown and the job card's Sales channel dropdown.

### Known follow-up

- Edit/deactivate for a salesman or sales channel entry -- done in modification #15.

## Modification #15 — Edit/deactivate for salesmen & sales channels

- **Date:** 2026-09-29
- **Status:** Code complete — needs your test.

### What changed

Closes the follow-up gap from modification #14: the Salesmen & channels page could only add and
list entries. It can now edit and deactivate/reactivate them too, the same way Team logins
already works.

- **Backend:** `PATCH /api/salesmen/{id}` and `PATCH /api/sales-channels/{id}` -- update a name
  and/or toggle `active`, gated on the same `salesmen.write` / `sales_channels.write` permissions
  the create endpoints already use. A rename or deactivate is recorded in the audit log
  (`salesman.updated` / `sales_channel.updated`), same as every other change in this app.
- **Frontend:** each row in both the Salesmen and Sales channels tables now has an editable name
  field, a **Save** button, and a **Deactivate**/**Reactivate** button. A deactivated entry stays
  in the list (marked Inactive) rather than disappearing, so it can be brought back later; it also
  drops out of the Salesman/Sales channel dropdowns on the Schedule form and job cards while
  inactive, the same way an inactive technician already does.
- Updated the README's "Managing salesmen and sales channels" section to describe the new edit
  and deactivate controls instead of saying they don't exist yet.

### Needs you

- Restart `npm run dev`.
- On the **Salesmen & channels** page, try renaming a salesman or sales channel and clicking
  Save, then try Deactivate followed by Reactivate on each list.
- Confirm a deactivated salesman/sales channel drops out of the dropdown on the Schedule form and
  job card, and that reactivating it brings it back.

### Known follow-up

- None -- this closes the last open item from the original request list.

## Modification #16 — Fix "request body is invalid" on Technicians and Salesmen & channels tabs

- **Date:** 2026-09-29
- **Status:** Code complete — needs your test.

### What changed

Found while you were testing #15: opening the **Technicians** or **Salesmen & channels** tab
showed a "The request body is invalid." error with a Retry button.

- **Root cause:** those two tabs load their full list in a single request
  (`pageSize=200`, since neither has a pagination UI), but the server's validation only ever
  allowed `pageSize` up to 100 -- so every one of those requests was rejected before it reached
  the database.
- **Fix:** raised the allowed `pageSize` for the technicians and salesmen/sales-channels list
  endpoints to 500. Everywhere else (complaints, appointments, job cards, etc., which do have
  real pagination controls) is unchanged.

### Needs you

- Restart `npm run dev`.
- Open the **Technicians** tab and the **Salesmen & channels** tab and confirm both load their
  lists normally now, with no error banner.

## Modification #17 — Second sales channel (JDI), salesman/channel linking, and two bugs from testing

- **Date:** 2026-09-29
- **Status:** Code complete — needs your test and the two one-time commands below.

### What changed

- **Second sales channel loaded.** All existing salesmen and B2B branches (from the original
  CSIISI invoice data) are tagged `JER-C/INS`. A new batch of 45 B2B branches from the JDI
  invoice data you shared is ready to import as `JDI` (see "Loading the new JDI sales channel
  data" in the README — one migration + one import command, both one-time).
- **Salesmen updated for JDI:** DANISH ALAM and SAI RAVIKANTH are new (from the JDI invoice
  data), and VYSAKH is added manually (not in the invoice data, but sells for JDI). AFAQUE KHAN,
  JAMES T. PAUL, and SHIVA already existed from JER-C/INS and now move to JDI, since they sell
  under both channels but the data model links one channel per salesman.
- **Salesmen & channels page merged**, per your request — Sales channel is now a column on the
  Salesmen table (an editable dropdown + Save, same row as the name and Deactivate/Reactivate)
  instead of its own separate list. A small "Add a new sales channel name" box under the table
  still lets you add a brand-new channel name for that dropdown to offer.
- **Sales channel now flows to job cards automatically.** A job card's Sales channel field used
  to always be blank; it now defaults from whichever salesman is on the appointment (looked up
  against the Salesmen list), the same way Salesman already defaults. Still editable on the job
  card itself if it's wrong.
- **Fixed: "Customer number" was being filled with the wrong thing.** Picking a B2B branch on
  the New Request page was filling "Customer number" with the branch's internal account code
  (Cust_Code) — there's no actual mobile/phone number anywhere in the sales data, so that field
  is now left blank for staff to fill in by hand if they have it.
- **Fixed: New Request's B2C/B2B gating was incomplete.** Selecting B2C correctly greyed out
  "B2B Branch / School", "Site contact person", and "Site contact number", but left the "Look up
  B2B Branch / School" search box active. It's now included in the same gating.

### Needs you

- Run `npm run db:migrate`, then `node scripts/import-b2b-branches.mjs b2b_branches_jdi.json JDI`
  (see the README section for details) -- this only needs to be done once.
- Restart `npm run dev`.
- On **Salesmen & channels**, confirm AFAQUE KHAN, JAMES T. PAUL, and SHIVA show Sales channel =
  JDI, and that DANISH ALAM, SAI RAVIKANTH, and VYSAKH exist with Sales channel = JDI too. Try
  changing a salesman's channel and adding a brand-new channel name.
- On the New Request page, search the B2B branch lookup for a JDI branch (e.g. "AL BARSHA
  ELECTRONICS") to confirm it comes back; confirm Customer number stays blank after picking a
  branch; confirm selecting B2C now greys out the branch lookup box too.
- Complete an appointment and create its job card; confirm Sales channel is pre-filled from the
  appointment's salesman, and that you can still change it.

### Known follow-up

- None flagged.

## Modification #18 — Create a service job card directly from a Quotation

- **Date:** 2026-09-29
- **Status:** Code complete — needs your test and a one-time migration.

### What changed

You asked whether the live system's "quotations once created can be fetched and used to create a
service job card" logic exists here. It didn't -- only the appointment-based ("Scheduler") path did.
It's now built back in, matching the legacy behaviour:

- A saved Quotation can now be turned into a service job card. Open **Quotations**, open a
  quotation, and click **Create service job card**. This pulls in customer name, contact,
  address, technician, item description, and the complaint from the quotation into an editable
  job-card form -- nothing is created until you submit it, same as the existing appointment flow.
- A quotation doesn't capture Site contact person/number, Customer number, Brand, Salesman, or
  Sales channel, so those fields start blank on the pulled-up form -- fill them in by hand if you
  know them, or leave them blank. They're never disabled, matching how the old system treated
  them ("soft N/A").
- A quotation can only be used once. Once it has a job card, its detail page shows a link to that
  job card instead of the Create button, so you can't accidentally create a second one from the
  same quotation.
- Under the hood, a job card can now be linked to either a completed appointment or a quotation
  (never neither, never both) -- the existing appointment-based flow is completely unchanged.

### Needs you

- Run `npm run db:migrate` (adds migration 014) -- one-time, safe to re-run.
- Restart `npm run dev`.
- Open a saved Quotation and click **Create service job card**; confirm the pulled-in fields
  match the quotation, fill in the rest, and create it. Confirm it now shows up under **Job
  cards** and that the Quotation's detail page now shows a link to it instead of the Create
  button.
- Confirm the existing appointment-based "Create service job card" flow still works exactly as
  before.

### Known follow-up

- None flagged.

## Modification #19 — Complaint inbox: reference font size, Schedule-form Salesman default, and proper tooltips

- **Date:** 2026-09-29
- **Status:** Code complete — needs your test.

### What changed

- **Fixed: complaint reference wrapping in the Complaint inbox table.** A reference like
  `CMP-260929-002` was splitting onto two lines (e.g. "002" dropping to its own line) because the
  column was too narrow for it at the table's normal font size. The whole Complaint inbox table is
  now a size smaller, and the reference itself no longer wraps.
- **Schedule appointment now defaults the Salesman from the matched B2B Branch / School.** If a
  complaint's B2B Branch / School was already matched to the master list (e.g. GEMS Cambridge
  International Private School Sharjah, Cust_Code 167247), opening **Schedule appointment** now
  looks up that branch's salesman and pre-selects it in the Salesman dropdown automatically --
  same master data the B2B lookup box already uses, just applied without you having to search
  again. You can still change it by hand if it's wrong.
- **Real tooltips instead of always-visible text.** The Schedule appointment form's field hints
  (e.g. "Look up B2B Branch / School (picks the branch, sales order no. and salesman together)")
  used to sit as permanent text next to the label, taking up space. They're now the same hover/tap
  "i" tooltip already used on the New Request and Team account pages -- Salesman, Look up B2B
  Branch / School, Sales order no., B2B Branch / School, Site contact person, and Site contact
  number all got one.

### Needs you

- Restart `npm run dev`.
- Open the Complaint inbox and confirm references like `CMP-260929-002` now sit on one line.
- Open a "Ready for Scheduling" complaint that already has a matched B2B branch (e.g.
  CMP-260929-002 / GEMS Cambridge International Private School Sharjah) and click **Schedule
  appointment**; confirm the Salesman dropdown is already set to that branch's salesman, and that
  you can still change it.
- Hover (or tab to, then check) the "i" icons on the Schedule appointment form's fields and
  confirm the tooltip text shows and the layout looks clean, matching the New Request page.

### Known follow-up

- None flagged.

## Modification #20 — Team logins now persist across a backend restart

- **Date:** 2026-09-29
- **Status:** Code complete — needs your test and a one-time migration.

### What changed

You reported that every time you restart the server, teammate logins you created disappear, and
saving a role change doesn't stick either. Confirmed the cause: Team logins (email, password,
role, active/inactive) were stored only in the running server's memory — a plain list that resets
to empty every time `npm run dev` restarts. The permission side of this was already safe (it's
stored in the database and was never lost), but the login credential itself wasn't, so:

- Every teammate login you added had to be re-created after a restart.
- A role/active change you saved for a teammate was lost the same way — and if the server had
  restarted since you added them, saving it would even fail outright, since that teammate no
  longer existed anywhere to update.
- The one-time bootstrap admin setup could be run again after every restart (itself a symptom of
  the same bug), instead of only ever once.

**Fixed:** Team logins now live in a real database table (`local_auth_users`, migration 015) and
survive a restart. Only the signed-in _session_ itself stays temporary and ends on restart, which
is normal and expected — you just sign back in with the same email and password; you don't need
to recreate the account or its role.

### Needs you

- Run `npm run db:migrate` (adds migration 015) — one-time, safe to re-run.
- Restart `npm run dev`.
- Add a teammate login (or use one you already had before this fix — you'll need to add it once
  more since the old one only ever existed in memory), then restart the server again and confirm
  the teammate still shows up on **Team logins** and can still sign in.
- Change a teammate's role or active status, restart the server, and confirm the change is still
  there.

### Known follow-up

- None flagged.

## Modification #21 — Lock a Cancelled complaint's actions (Notes, Update status, B2B Branch match)

- **Date:** 2026-09-29
- **Status:** Code complete — needs your test.

### What changed

You flagged that a Cancelled complaint still let staff search and (re)link its B2B Branch /
School match from the master list. Confirmed, and also checked the other two edit actions on a
complaint's detail page:

- **Fixed** — a Cancelled complaint's detail page now hides all three edit actions (Notes,
  Update status, and B2B Branch match) entirely. It stays fully visible and read-only -- the
  detail grid and History timeline are unaffected -- staff just can't add a note, change the
  status, or link/unlink a B2B branch match any more once it's Cancelled.
- Cancelled already had no further status transitions defined, so Update status was already
  effectively a dead end -- it's now hidden outright instead of showing a disabled dropdown.
- Matches the same "lock everything once terminal" pattern service job cards and appointments
  already use.

### Needs you

- Restart `npm run dev`.
- Open a Cancelled complaint and confirm the Notes, Update status, and B2B Branch match tabs are
  gone (no way to edit), while the detail grid and History are still visible.
- Open a non-cancelled complaint and confirm all the usual actions still work as before.

### Known follow-up

- None flagged.

## Modification #22 — Fixed false "active appointment" conflicts (reference-numbering bug) + clearer bootstrap message

- **Date:** 2026-09-29
- **Status:** Code complete — verified working by you.

### What changed

You hit "The complaint already has an active appointment" while scheduling CMP-260929-003, even
though it had never been scheduled before. Traced it down to a real bug, not a scheduling
conflict:

- Appointment references are formatted `APT-YYYY-00001` — year only — but the counter that hands
  out the next number was keyed by the **exact appointment date**, not the year. Two appointments
  booked on different calendar dates in the same year each started counting from 1
  independently, so their formatted references collided (both became `APT-2026-00001`). The
  resulting database duplicate-key error was then mislabeled by the code as "already has an
  active appointment" — a misleading, unrelated explanation.
- **Fixed** — `packages/db/src/references.ts` now keys the appointment / job-card / quotation /
  inspection / warranty-approval counters by the 1st of January of the relevant year (matching
  what the reference format actually encodes). Complaint references were already fine (they
  encode the full date).
- Migration `016_fix_reference_counter_scope.sql` seeds the new year-keyed counters from whatever
  had already been issued, so numbering continues correctly instead of colliding.
- `apps/api/src/appointments/service.ts` — even if a reference collision were ever to recur, it's
  no longer mislabeled as "active appointment" conflict; it now reports the real problem instead.
- Also fixed the stale bootstrap error message ("Local bootstrap has already been consumed for
  this process") — it was leftover wording from the old in-memory bootstrap (Modification #20
  made it DB-backed and permanent, not per-process). It now says an administrator account already
  exists for this installation and to sign in with it instead.
- Also fixed a UI race: the Schedule-appointment form used a shared "current complaint" variable
  both to send the request and to decide which complaint's screen to update afterwards. If you
  navigated to a different complaint while an earlier request was still in flight, its
  success/error message could land on whatever complaint you were now viewing. The handler now
  only updates the screen if you're still looking at the complaint the request was actually for.

### Needs you

- Run `npm run db:migrate`, then restart `npm run dev`.
- Confirmed working: scheduling CMP-260929-003 now succeeds.

### Known follow-up

- None flagged.

## Modification #23 — Stop logging staff out on a browser refresh

- **Date:** 2026-09-30
- **Status:** Code complete — needs your test.

### What changed

You flagged that refreshing the browser (as admin or any user) always logged you out, forcing a
fresh sign-in every time.

- **Root cause** — the session token was only ever kept in a plain JavaScript variable in memory.
  A refresh reloads the page and re-runs the script from scratch, wiping that variable, so the
  app always started back at the sign-in screen even though the underlying server-side session
  (see below) was often still perfectly valid.
- **Fixed** — the token is now also kept in the browser's `sessionStorage` for that tab. On page
  load, the app checks for it and silently re-validates it against `/api/auth/me`; if it's still
  good, you land straight back in the workspace instead of the sign-in form. If it's no longer
  valid (expired, revoked, or the server restarted since), it falls through to the ordinary
  sign-in screen -- no error shown, since that's the expected outcome, not a failure.
- Deliberately `sessionStorage`, not `localStorage` -- it survives a refresh but still clears
  automatically when the tab/browser window is closed, matching what "session" should mean,
  rather than leaving a login token sitting around indefinitely.
- **On the auto-logout / timeout question** -- this already exists server-side and needed no
  change: every session already expires exactly 8 hours after signing in
  (`SESSION_TTL_MS` in `apps/api/src/auth/local-auth.ts`), regardless of activity. After that
  window, the next request naturally lands you back on the sign-in screen. Let me know if you'd
  rather this be shorter, longer, or based on idle time instead of a fixed 8 hours from login.

### Needs you

- Restart `npm run dev`, sign in, then refresh the browser and confirm you stay signed in instead
  of being sent back to the sign-in form.
- Sign out and confirm you land back on the sign-in form (and that refreshing afterward doesn't
  restore the old session).

### Known follow-up

- None flagged. (Separately, a _server_ restart still ends every active session immediately,
  since sessions themselves are still stored in memory, not the database -- only the login
  credentials were made persistent in Modification #20. Not something you've asked to change, but
  flagging it since it's the other way a "logout" can still happen.)

## Modification #24 — Professional full-page app shell for the staff workspace

- **Date:** 2026-09-30
- **Status:** Code complete — needs your visual review.

### What changed

You flagged that after signing in, the page still looked like the public marketing page (topbar
banner, big hero, "Public site"/"Customer complaints" links) with the actual workspace squeezed
into a narrow centered column below it, and that entry fields felt oversized while still
truncating their own content. Used the `ui-ux-pro-max` and `ui-styling` guidance for this
(enterprise/admin-panel layout conventions, the "Minimal Swiss" Inter typography pairing, and the
accessibility/touch-target checklist).

- **Signed-in view is now a real app shell, not a landing page.** Once you sign in, the topbar
  banner, hero, and public nav links ("Public site", "Customer complaints") disappear entirely --
  they're not "work" for a signed-in staff member -- and the workspace takes over the full page
  width, the way an internal admin console normally looks, instead of a narrow column with a
  hero above it.
- **Left navigation is now a proper full-height sidebar** (not a card floating in a page grid),
  and the work area to its right is much wider, with sensible padding instead of feeling cramped.
- **Typography standardized** -- the app already declared Inter as its intended font, but never
  actually loaded it, so every machine silently fell back to whatever system font it had
  installed. Inter is now loaded properly via Google Fonts, so it looks the same everywhere.
- **Entry fields tightened** -- inputs/selects had more padding than a typical professional admin
  tool while still not being wide enough (the Complaint inbox's search box was clipping its own
  placeholder text). Padding is slightly reduced across the board (still comfortably above the
  accessible minimum touch size) and the inbox's search/filter boxes are wider so typical text
  isn't cut off.
- Purely a CSS change plus two one-line additions in `app.js` (adding/removing an
  `is-authenticated` class on `<body>` on sign-in/out) -- no element IDs, JS logic, or the
  logged-out public pages (home, `/complaints`) were touched, so nothing else should look or
  behave differently.

### Needs you

- Restart `npm run dev`, sign in, and take a look. In particular:
  - Confirm the topbar/hero/public links are gone once signed in, and the workspace fills the
    page with the sidebar on the left.
  - Confirm the Complaint inbox's search box no longer clips its placeholder text.
  - Sign out and confirm the public home page still looks exactly as it did before (hero, topbar,
    etc. all still there for a logged-out visitor).
- This is a visual/subjective change more than most -- if anything about the new layout,
  spacing, or colors doesn't feel right, tell me specifically what to adjust rather than "make it
  more professional" so I can target the actual thing that's off.

### Known follow-up

- None flagged yet -- pending your review.

## Modification #25 — Refined CRM-pattern styling, color palettes, and dark mode

**Date:** 2026-09-30
**Status:** Confirmed working -- you reviewed and approved this on 2026-09-30. This is now the
design baseline: any new page, screen, or feature built from here on should match it (collapsible
icon sidebar, navy header/footer/sidebar tied to the palette tokens, palette + light/dark
switcher, the compact type scale) rather than the older look from before Modification #24.

### What changed

Follow-up to Modification #24, based on your feedback with the reference CRM screenshot: this
replaces the previous hand-picked navy/red look with a design-token system you can switch
yourself, closer to the pattern in the image you shared (dark grouped sidebar, compact type,
light/dark toggle, palette picker).

- **Smaller type across the whole app** — the base font size is reduced (~94% of before), and
  the workspace header/page titles are noticeably smaller and less oversized than in #24.
- **Sidebar rebuilt to match the reference pattern** — it's now a solid dark panel (instead of a
  plain list on a white card), split into labeled groups ("Overview", "Service desk", "Records",
  "Admin") the way the screenshot's sidebar groups "Overview / Commerce / Apps". Links are
  smaller, evenly padded, and properly aligned (fixing the "fonts too big, alignment not
  perfect" issue); the active page gets a slim colored bar on its left edge instead of a plain
  background tint. Sign out is pinned to the bottom of the panel.
- **Color palette switcher** — a small palette icon in the top bar (next to where the reference
  image has one) opens 5 preset color options: Navy Blue (the original), Emerald, Indigo, Teal,
  and Amber. Picking one recolors the accent consistently across the whole app in one shot (the
  pattern from sites like tweakcn.com's theme editor) — not just the sidebar: primary action
  buttons ("Sign in", "Save", "Create quotation", etc.), links, the selected-tab indicator on the
  login page, active dashboard tabs, and section headings all switch together, since they already
  shared the same underlying color variables. Status colors that carry a specific meaning (error
  text, the red "cancelled" marker, success green, warning amber) are left alone on purpose, the
  same way tweakcn keeps a "destructive" color separate from the picked theme color. Your choice
  is remembered (localStorage) and reapplied on your next visit, on that browser.
- **Light/dark theme toggle** — a sun/moon icon next to the palette picker switches the whole
  app between light and a proper dark theme (dark backgrounds, light text, adjusted borders and
  card colors) rather than just inverting colors. Also remembered per browser.
- Both controls only appear once you're signed in (they live in the top bar, which is hidden for
  anonymous visitors per #24) and apply instantly with no page reload.
- Under the hood: this works by re-pointing the same CSS variables (`--navy`, `--blue`, `--ink`,
  `--muted`, etc.) that the rest of the stylesheet already uses everywhere, via
  `[data-palette="…"]` / `[data-theme="dark"]` attributes on `<html>` — so it didn't require
  touching every individual component's CSS, and the record-type accent colors (appointments,
  job cards, quotations, warranty — Modification #6) are left as they were, since those identify
  a record type rather than the brand.
- A tiny inline script in `index.html`'s `<head>` applies your saved theme/palette before the
  page paints, so it never flashes the default look first.

### Needs you

- Restart `npm run dev`, sign in, and try the two new icons in the top bar (palette + sun/moon)
  in the sidebar area.
  - Pick a couple of the 5 palettes and confirm the sidebar/buttons/links all recolor together.
  - Toggle dark mode and check a few different pages (Complaint inbox, a detail view, a form)
    for anything that still looks like light mode underneath (a stray white background, etc.) —
    dark mode covers the main surfaces but this is a large app and something could be missed.
  - Refresh the page after choosing a palette/theme and confirm it's remembered.
- As with #24, this is a visual/subjective change — tell me specifically what to nudge (font
  size, a particular palette's shade, spacing) rather than "make it better" so I can target the
  actual thing.

### Follow-up fix (same day)

You reported two more things after trying it:

- **Sidebar only reached partway down the page** — it was sized to exactly one browser-window
  height and scrolled along with the page, so on a page taller than one window (or a shorter
  browser window) its dark background ran out before the page's footer, leaving a plain white
  gap. **Fixed** — the sidebar is now pinned to the browser window itself (top-to-bottom), so its
  color always fills the full height of your screen no matter how long the page is or how tall
  your window is; the page footer's text is shifted right so it no longer sits underneath it.
- **"Entire page should reflect the color selection, not just the sidebar"** (you pointed to
  tweakcn.com as the pattern to match) — added a soft tint of the chosen palette as the page's
  own background (behind the white content cards) and the top bar, in light mode, so picking a
  palette now recolors the whole page's look, not only the sidebar and buttons. (Dark mode keeps
  its own neutral dark background instead of a pastel tint, which would look washed-out there.)

### Second follow-up (same day)

Three more things you flagged, all fixed:

- **Sidebar's fixed positioning broke the workspace layout** — turning the sidebar into a
  viewport-pinned panel took it out of the grid's automatic layout, which made the content next
  to it get squeezed into the sidebar's own narrow column instead of the wide column meant for
  it. **Fixed** — the content area is now explicitly told which column it belongs in, regardless
  of what the sidebar is doing.
- **Header didn't line up with the sidebar, and the logo was indented compared to it** — the top
  bar was still using the old centered, width-capped layout from before the app-shell redesign,
  so the logo started well to the right of the sidebar's flush-left edge. **Fixed** — once
  signed in, the top bar now uses the same two-column split as the page below it (a
  sidebar-width zone on the left, holding the logo, and a content-width zone on the right, holding
  the palette/theme/account controls), so everything lines up top to bottom.
- **Moved the profile card and sign-out link out of the sidebar and into the top bar** — they now
  live behind a small avatar button on the right, matching where most admin dashboards put
  account controls (and the reference screenshot). Clicking it opens a small card with your name,
  email, role, and a sign-out button. The sidebar is now purely navigation.
- **Tried extending the accent tint into the workspace cards themselves** (not just the page's
  edges/gutters), per your ask — the white card holding the Complaint inbox table, for instance,
  now picks up a very light wash of the chosen palette too, so the whole visible working area
  reflects the color choice, not just the margins around it. This is a one-line, easily reversible
  change if it doesn't read well in practice -- say the word and I'll put the cards back to plain
  white.

### Third follow-up (same day)

- **Header and footer now match the sidebar's own navy fill**, not just a light tint of it, so
  the three read as one continuous colored frame around the page. Since all three share the same
  underlying color tokens, switching palettes recolors the header and footer right along with the
  sidebar. (They stay this color in both light and dark theme -- only the content area's own
  background changes with that toggle, same as before.)
- Gave the logo a small white plate of its own in the header, since the artwork was designed for
  a light bar and would have been hard to read directly on the new navy background.

### Fourth follow-up (same day) — collapsible sidebar

- **Sidebar can now collapse to icons only.** A small chevron button at the top of the sidebar
  toggles between the full sidebar (icon + label, current width) and a narrow icon-only strip;
  the workspace content area automatically widens to use the freed space, and back again, with a
  short animation. Your choice is remembered per browser.
- **Every navigation item now has its own icon** (Dashboard, Complaint inbox, Service requests,
  New request, Salesmen & channels, Service job cards, Quotations, Inspections, Warranty
  approvals, Technicians, Team logins, Appointments) — visible at all times, and the only thing
  shown once collapsed. Hovering a collapsed icon still shows its name as a tooltip.
- Built as a small reusable SVG icon set (one `<symbol>` per section, defined once near the top of
  the page) rather than one-off images, specifically so a future new section just needs one more
  `<symbol>` added there plus a reference to it on its nav button — no other part of this needs
  to change.
- On narrow/mobile screens the sidebar keeps behaving as before (a full stacked bar, no
  collapse toggle) — collapsing only makes sense once there's a fixed sidebar to shrink.

### Known follow-up

- Dark mode is applied broadly but not exhaustively verified against every screen in the app
  (there are dozens of forms/detail views) — flag any page where it looks off and I'll patch it.
- `appointments.b2b_branch_cust_code` carry-forward (tracked since Modification #2) — still
  unaddressed, unrelated to this change.

## Modification #26 — Phase 6: Commercial/pricing admin backend + Management admin pages

**Date:** 2026-09-30
**Status:** Built and verified (typecheck + build clean); needs your review before you rely on it
day-to-day.

### What changed

This starts Phase 6 (Commercial/pricing: AMC, VAS, rate cards, Thomson proposals, workbook
upload), scoped exactly as you asked: admin entry first, standalone (no Google Apps Script
dependency), and only the admin side for now — Thomson Proposal and Revenue Dashboard, and all
the user-facing quote calculators that would sit on top of this admin data, are intentionally not
built yet.

- **New "Management" section in the sidebar** with 5 admin pages: VAS Price Banding & Split,
  Rate Card Admin, D+I Admin Entry, AMC Admin Rate Section, and Thomson Pricing Admin — visible
  to anyone with the new `pricing_config.read` permission (admin and management roles).
- **A single generic pricing-config system backs all 5 pages** (7 domains total — VAS is 3
  domain cards: price bands, pricing parameters, and the sales/service GP split). Every domain
  works the same way:
  - **Loads from the Excel workbook by default** — the current master workbook
    (`Service_Budget_2027_AUG_13_TG_CAL_VAS_PROFIT_CENTERv4_thomson_pricing_change.xlsx`) was
    read directly and its values (VAS price bands and pricing params, the Sales/Service GP split
    assumptions, Rate Card activity rates, AMC plan percentages and visit tiers, D+I/Thomson
    region and appliance rates) became the built-in defaults, so there is no ongoing dependency
    on the spreadsheet once this is running.
  - **Admin can change any value and Save** — every field is editable inline; nothing is
    read-only except the 4 derived Thomson volume-tier rates (50+/150+/300+/500+), which are
    always calculated from the Base rate you enter, exactly the way the workbook derives them
    (matches its own formula, including the one exception: Built-in Hob rounds down at the 50+
    tier, everything else rounds up).
  - **Admin can always revert to the Excel default** with one click, per domain.
  - **Every Save and Revert is logged** (who, when, and the full values at that point), and the
    "History" button on each admin card lists past entries with a "Load this entry" action, so
    an admin can go back to any earlier saved version, not just the most recent one or the
    original default.
- **Backend**: a new `pricing_configs` table (current value per domain) plus reuse of the
  existing audit-log table for full version history — a new `pricing_config.read` /
  `pricing_config.write` permission pair, gated the same way as every other admin action in this
  app — and REST endpoints (`GET/PUT /api/pricing-config/{domain}`,
  `POST .../reset`, `GET .../history`, `POST .../restore`).
- **Frontend**: a small reusable rendering engine (scalar-field grids and editable add/remove-row
  tables) drives all 7 domain cards from one set of primitives, so each admin page is a
  description of its fields rather than a hand-built form; this keeps the 5 pages visually and
  behaviorally consistent and makes a future 6th pricing domain a small addition rather than a
  new page from scratch.
- One data correction was made along the way: the workbook's "Built-in Microwave Oven" appliance
  is new since the legacy reference file (12 appliances now, not 11) and Thomson Base rates in
  the current workbook are lower across the board than the old reference numbers — the new
  defaults reflect the current workbook, not the older file.

### Needs you

- **Run `npm run db:migrate` first** to pick up migration 017 (the new `pricing_configs` table) -- without it every page shows "Could not load current values for this section" since the table doesn't exist yet. Your `npm run dev` (tsx watch) already has the new API routes loaded, so no restart is needed -- just run the migration and refresh the browser.
- Sign in as an admin/management user, open each of the 5 new "Management" pages, and check the
  default values against the workbook for anything that looks off before relying on this for
  real quotes.
- Try Save, Revert to Excel default, and History → "Load this entry" on at least one page to
  confirm the change-tracking behaves the way you expect.
- Still pending, on purpose, per your original scope: Thomson Proposal, Revenue Dashboard, and
  the user-facing AMC/VAS/rate-card/Thomson quote calculators that will read from this admin data
  — say the word when you want those started.

## Modification #27 — Management admin pages: bug fixes + VAS split-wise layout

**Date:** 2026-09-30
**Status:** Built and verified (typecheck + build clean); needs your review.

### What changed

Three bugs you reported against the new Management pages (#26), plus the first pass of the
denser/tooltip/split-wise redesign, scoped to VAS Price Banding & Split as you asked, to be
extended to the other 4 pages only after you confirm this one looks right.

- **Fixed: pages loading with wrong values / blank cards.** Two independent causes, both
  fixed: (1) the browser was caching the pricing-config API responses and mis-handling the
  resulting "no change" (304) response as a failure; every pricing-config endpoint now sends
  `Cache-Control: no-store`. (2) the new rendering engine called an undefined `esc(...)` helper
  instead of the app's real `escapeHtml(...)` — fixed at all 10 call sites.
- **Fixed: Management panel stayed visible after switching to another sidebar section.**
  Leaving a Management page for Dashboard, Appointments, etc. now correctly hides it.
- **Fixed: entering a Management page from another section left that section's selection and
  "Refresh" button showing.** Coming from Appointments (or any other section) into a
  Management page had left the previous section's sidebar highlight and its header "Refresh"
  button still showing on top of the Management page. `activatePricingAdminMode()` now resets
  every other section's nav highlight and hides every other section's header "Refresh" button
  on entry.
- **VAS Price Banding & Split: denser layout, tooltips, side-by-side sub-sections.**
  - Smaller type and tighter spacing scoped to the Management pages only (nothing else in the
    app is affected).
  - Every field and table column that isn't self-explanatory now has a hover/focus tooltip
    (rounding, claim fees, deductibles, plan-split parameters, band boundaries).
  - "Split-wise" layout applied where VAS actually has more than one logical sub-section:
    Pricing Parameters is now two side-by-side boxed groups ("Rates & Minimum Fees" and "Claim &
    Deductible Rules"), and the Sales/Service GP Split card is now two side-by-side boxed groups
    ("Plan Economics Inputs" and "Plan-Level Split Parameters"). Value Bands stayed a single
    section — it's just the one table, so there was nothing to split.

### Needs you

- Refresh the Management → VAS Price Banding & Split page and check the new tighter/split-wise
  layout, and the two other bug fixes (switch between Appointments and Management, and between
  Management pages, a few times) look right on your screen sizes.
- Once VAS looks right, say so and the same tooltip + split-wise treatment will be applied to
  Rate Card Admin → D+I Admin Entry → AMC Admin Rate Section → Thomson Pricing Admin, in that
  order, one at a time.

## Modification #28 — Extend split-wise layout to all Management pages, drop "(AED)" from labels

**Date:** 2026-09-30
**Status:** Built and verified (typecheck + build clean); needs your review.

### What changed

- **Removed "(AED)" from every field/column label on all 5 Management pages** (VAS, Rate Card
  Admin, D+I Admin Entry, AMC Admin Rate Section, Thomson Pricing Admin) — the currency is now
  stated once, at the top of each page, instead of repeated on every field. Two labels that used
  "(AED, ...)" for an extra qualifier kept that qualifier and just dropped "AED" itself (e.g.
  "Cost per km (AED, round-trip)" → "Cost per km (round-trip)").
- **Added a small glowing "All Prices in AED" tip next to the page heading**, shown only while a
  Management page is open (it's hidden again the moment you switch to any other section).
- **Applied the same tooltip + "split-wise" side-by-side layout to the remaining 4 pages**,
  matching the treatment already confirmed on VAS Price Banding & Split:
  - **Rate Card Admin**: each rate section is already its own boxed card — those cards now lay
    out side by side instead of stacked, and the Activity/Rate columns have tooltips.
  - **D+I Admin Entry**: now 5 side-by-side boxed groups — "Common Master Inputs" (max units +
    all the crew/capacity/labor-minute fields), "Customer Groupings", "Regional Transport", and
    the D&I / Install rate cards — with tooltips on crew factors, load capacities, labor
    minutes, transport costs, batch/standard rates, and discount tiers. This is the layout you
    originally referenced with the old D+I screenshot.
  - **AMC Admin Rate Section**: the 17 flat fields are now two boxed groups ("Plan Percentages &
    Markups" and "Visit & Staffing Economics") side by side with the existing reactive-visit-tier
    and appliance-catalog cards, plus tooltips on risk uplift, overhead, profit markup, parts
    reserves, visit duration, and per-tier/appliance table columns.
  - **Thomson Pricing Admin**: the deployment-economics fields are now their own boxed card
    alongside Regions, Appliance Rates, and Additional Services, with tooltips on region
    distance/cost, the Base-rate-drives-everything relationship, and the Project Management Fee
    rate row.
  - Every one of these uses the same responsive `.pc-split-grid` CSS added for VAS — cards
    wrap to a single column automatically on narrow screens, nothing was hand-tuned per page.

### Needs you

- Refresh each of the 5 Management pages and confirm the "(AED)" removal, the "All Prices in
  AED" tip, and the new side-by-side layout look right — D+I Admin Entry in particular, since
  that's the one with the most sub-sections now.
- If anything reads awkwardly at your screen width, say which page/section and it can be
  adjusted (grid column widths are easy to retune per domain).

## Modification #29 — Remove VAS Sales/Service GP Split section; fix split-wise grid layout

**Date:** 2026-09-30
**Status:** Built and verified (typecheck + build clean); needs your review before you push.

### What changed

- **Removed the "VAS Sales / Service GP Split" section from VAS Price Banding & Split.** You
  were right to flag this — I traced it against the actual workbook and confirmed the problem:
  - The **"VAS Pricing"** sheet is fully self-contained (rates, min fees, deductibles, claim
    fees, and every value band all live in that one sheet, no other-sheet dependency) — this is
    exactly what `vas_price_bands` and `vas_pricing_params` cover, and it's all that remains on
    the VAS admin page now.
  - The **"VAS Sales-Service GP Split"** sheet is a separate, management-reference-only
    calculator: its `technicianVisitCost` input actually pulls from the `AMC-PMC-RM` sheet (a
    real cross-sheet dependency), and its real output — the suggested/applied Service vs Sales
    split, and the per-value-band AED split table — was never built into the admin page at all;
    only its editable input assumptions were, under a misleading "Plan-Level Split Parameters"
    heading. Since that whole sheet is reference-only and not part of VAS admin data entry, the
    section is removed rather than fixed.
  - Removed end-to-end: the `vas_profit_split` pricing-config domain, its Zod schema, its Excel
    default, its admin-page card, and its entry in the domain allow-list — plus a new migration
    (018) that drops any already-saved row for it and tightens the database CHECK constraint to
    match. VAS Price Banding & Split's page description was also corrected to say what it now
    actually admins (price banding and pricing parameters from the VAS Pricing sheet only).
- **Fixed the split-wise grid layout** on Rate Card Admin, D+I Admin Entry, AMC Admin Rate
  Section, and Thomson Pricing Admin — the previous `auto-fit` grid could pack 3+ narrow,
  uneven-height columns on a wide screen, which is what made it look congested:
  - The grid is now a fixed, responsive **2 cards per row** (1 column on narrow screens), and
    cards in the same row now stretch to match height, so nothing sits shorter/taller than its
    neighbor.
  - **D+I Admin Entry's "Common Master Inputs" card now spans the full row width** ("end to
    end") instead of being squeezed into a half-width column with 11+ fields wrapping
    awkwardly — the rest of its cards (Customer Groupings, Regional Transport, D&I Rates,
    Install Rates) fall into the 2-per-row grid below it.
  - Card padding was opened up slightly so the boxes read as less cramped.

### Needs you

- Refresh VAS Price Banding & Split and confirm the GP Split section is gone and the remaining
  two cards (price bands, pricing parameters) look right.
- Refresh Rate Card Admin, D+I Admin Entry, AMC Admin Rate Section, and Thomson Pricing Admin and
  check the new 2-per-row layout, especially D+I's full-width "Common Master Inputs" box.
- **Run `npm run db:migrate`** to apply migration 018 (drops the `vas_profit_split` domain from
  the database) before relying on the pricing-config admin pages again.

## Modification #30 — AMC Appliance Catalog: full-width card + wider Appliance column

**Date:** 2026-09-30
**Status:** Built and verified (typecheck + build clean); needs your review before you push.

### What changed

- **Appliance Catalog now gets its own full-width row** on AMC Admin Rate Section, the same
  treatment D+I's "Common Master Inputs" got — instead of being squeezed into a half-width
  column alongside the reactive-visit tiers card. It now renders first, with the tiers card
  following in whatever half-width slot is left.
- **The Appliance name column is now explicitly wider** (42% of the table width, vs. Qty 18% /
  Unit price 18% / Active 12%) so the appliance name is actually readable instead of being
  squeezed as narrow as the numeric columns beside it. This is a small new capability in the
  shared table renderer (`pcRenderTable`) — a column can now request `width` (used only where a
  renderer opts in; every other table on every other page is unaffected).

### Needs you

- Refresh AMC Admin Rate Section and confirm the Appliance Catalog table is now full-width and
  the appliance names are legible without needing to click into each field.

## Modification #31 — Thomson Pricing Admin: same full-width fix for Appliance Rates

**Date:** 2026-09-30
**Status:** Built and verified (typecheck + build clean); needs your review before you push.

### What changed

- Same fix as #30 (AMC Appliance Catalog), applied to Thomson Pricing Admin's **Appliance
  Rates** card: it now spans the full row instead of sharing a half-width column with
  Additional Services, and the Appliance name column is explicitly wider (38% of the table, vs.
  18% Base rate / 20% Avg install minutes / 12% Active) so appliance names are readable.
- **Additional Services** (Project Management Fee / Site Survey / Testing & Commissioning /
  Training) now also spans the full row, and its Note column is explicitly wider (44% of the
  table, vs. 20% Service / 18% Rate / 18% Technician hours) so the note text is actually
  readable instead of being cut off to a few characters.

### Needs you

- Refresh Thomson Pricing Admin and confirm Appliance Rates and Additional Services are both
  full-width and legible.

## Modification #32 — 4 stand-alone quote calculators (VAS, Rate Card, AMC, Thomson)

**Date:** 2026-09-30
**Status:** Built and verified (typecheck + build clean); needs your review before you push.

### What changed

Per your build order (quote calculators first, as stand-alone pricing tools, before Thomson
Proposal or the Revenue Dashboard), a new **Quote Calculators** section was added to the sidebar
with 4 pages. Every one of them reads the same admin-configured data as its matching Management
page (VAS Price Banding & Split, Rate Card Admin, AMC Admin Rate Section, Thomson Pricing Admin)
and computes a price live in the browser — **none of them save, create, or touch any record**.
Each formula was traced cell-by-cell against the master workbook before being written (the same
rigor that caught the vas_profit_split mistake in #29), not guessed:

- **VAS Quote Calculator** — enter an order value and pick a plan (1-Year EW / 2-Year EW / Damage
  Insurance / Premium); it looks up the matching price band, applies that band's midpoint to the
  plan's rate, rounds to the rounding step, and enforces the plan's minimum fee — exactly the
  workbook's `computeVasFee_` logic. Also shows the claim fee and deductible for the picked plan.
- **Rate Card Calculator** — pick a section and activity, enter a quantity, and add as many lines
  as needed; each line is quantity × rate, with a running grand total.
- **AMC Quote Calculator** — starts from AMC Admin's appliance catalog (only active appliances),
  editable per contract (quantity and unit value), and computes all 3 plans side by side (Basic
  RM / Standard PMC / Premium PMC): annual visits, labor cost, transport cost, parts reserve,
  direct cost, overhead, and the contract price excl. and incl. 5% VAT — matching the workbook's
  "Post-Warranty AMC / PMC Pricing Calculator" table exactly, including the reactive-visit tier
  lookup for Basic RM.
- **Thomson Quote Calculator** — add project lines (region + appliance + quantity + site
  visits + training sessions); each line's appliance rate is picked by the qty volume tier,
  install labor/cost is derived from avg install minutes and technician rate, testing/PM-fee/
  site-survey/training add-ons are priced from Thomson's Additional Services rates, and
  transport is derived from install days + visits + region round-trip cost. A "Customer transport
  share %" input controls how much of that transport cost is passed to the customer (workbook
  default: 0%, fully absorbed). Grand total row shows total price, total cost, margin and margin
  %, matching the workbook's "Project Pricing Calculator" section row-by-row.

No backend changes were needed — all 4 calculators reuse the existing read-only
`GET /api/pricing-config/:domain` endpoint (same permission, `pricing_config.read`) and compute
entirely client-side.

### Needs you

- Try all 4 calculators and sanity-check a few numbers against the workbook yourself.
- Say the word when you want Thomson Proposal or the Revenue Dashboard (live from the database,
  per your answer) started next.

## Modification #33 — VAS Pricing Master: rename, per-plan pricing table, missing fields

**Date:** 2026-09-30
**Status:** Built and verified (typecheck + build clean); needs your review before you push.

### What changed

- Renamed **VAS Price Banding & Split** to **VAS Pricing Master** in the Management sidebar
  and page heading — same page, same domains (`vas_price_bands` + `vas_pricing_params`), only
  the name changed.
- **VAS Plan Pricing Table**, replacing the old "Rates & Minimum Fees" / "Claim & Deductible
  Rules" field boxes (which were individual inputs, never an actual table — the gap you
  flagged). It's now one real table, one row per plan (1-Year EW / 2-Year EW / 1-Year DI /
  Premium), with columns Rate, Min fee, Deductible, Service fee, Claims allowed, and Coverage &
  terms.
- **3 fields were missing from the admin data entirely** — Service fee, Claims allowed, and
  Coverage & terms per plan — which the legacy VAS Pricing/VAS Sales pages showed but this
  portal never captured. Added all 12 (3 fields × 4 plans) as new admin-editable text fields,
  sourced verbatim from the workbook's "VAS Pricing" sheet PLAN DEFINITIONS table, e.g.:
  - 1-Year EW: "No service fee - parts & labour covered" / "Unlimited"
  - 1-Year DI: "AED 100 (items ≤ 1,499) / AED 200 (items ≥ 1,500) per claim" / "1 claim"
  - Premium: "No claim limit - priority service visits" / "-"
- Also added the workbook's **depreciation schedule** (Year 1/2/3, % of purchase price
  deducted on a total-loss settlement) as 3 new shared admin fields — needed for the upcoming
  VAS Sale certificate (next modification), grouped with the claim-fee rules below the table.

### Needs you

- Refresh VAS Pricing Master and confirm the plan table shows all 4 plans with the right
  numbers, and that the new Service fee / Claims allowed / Coverage & terms / Depreciation
  fields read correctly before you edit anything.
- Next up (per your list): the VAS Quote Calculator redesign (drop the matched-band line,
  show these same fields, add Quick Price for all 4 plans at once), then VAS Sale issuance +
  printable certificate.

## Modification #34 — VAS Quote Calculator: customer-facing redesign + Quick Price

**Date:** 2026-09-30
**Status:** Built and verified (typecheck + build clean); needs your review before you push.

### What changed

Redesigned the VAS Quote Calculator's result to match the legacy VAS Pricing / VAS Sales
pages' customer-facing card, using the new plan fields added in #33:

- Removed the internal "Matched band" detail row — this page is for front-line/customer use,
  not admin. The plan and value band still appear as a plain-language subtitle under the fee
  (e.g. "Premium Service (24hr SLA) — band 1,500 - 1,999.99"), same as the legacy page.
- The quote card now shows exactly the 5 fields you asked for: **Selling price, Deductible per
  claim, Service fee per claim, Claims allowed, Coverage & terms** — pulled from both what was
  "VAS Pricing" and "VAS Sales" in the old index.html (now unified into one VAS Pricing Master
  admin table).
- 1-Year Damage Insurance is the one plan whose Service fee is never the stored text — it's
  always computed live from the selling price against the claim-fee threshold (≤ AED 1,499 →
  AED 100/claim, ≥ AED 1,500 → AED 200/claim), exactly like the legacy calculator.
- Added **"Quick Price — All 4 Plans at Once"**: same selling price, one table showing every
  plan's fee, service fee and claims allowed side by side — ported from the legacy "QUICK PRICE
  — ALL 4 PLANS AT ONCE" feature.
- New styling for the quote card (dark header with the fee, plain rows below) to read like a
  customer quote rather than an admin form.

### Needs you

- Try a few selling prices across different bands and plans, and compare the numbers to the
  legacy VAS Pricing/VAS Sales pages.
- Next up: VAS Sale issuance + printable certificate (per plan), with the JDI logo in the print
  header.

## Modification #35 — Issue a VAS Sale: save + printable certificate (JDI logo)

**Date:** 2026-09-30
**Status:** Built and verified (typecheck + build clean); needs your review before you push. Adds a
new database table, so this one also needs a migration run.

### What changed

Added the "Issue a VAS Sale — Customer Certificate" section to the bottom of the VAS Quote
Calculator page, item (d)+(e) from your last message:

- **New `vas_sales` table** (`packages/db/migrations/019_vas_sales.sql`) — a normalized record of
  every VAS plan actually sold, matching the live system's `HEADERS_BY_TYPE['vas-sale']` field set
  (customer name, contact, address, invoice number, purchase date, item code/description, plan,
  selling price, plan fee, deductible, service fee, contract ref.), plus its own auto-generated
  reference (`VS-YYYY-NNNNN`, same allocator pattern as quotations/inspections). One field the
  legacy sheet didn't have — `plan_key` — was added so a reprinted certificate always finds the
  exact plan's legal text, instead of matching it by display label.
- **New `vas_sale.read` / `vas_sale.write` permissions**, granted to management + sales (same roles
  as quotations/inspections) — separate from `pricing_config.*`, since issuing a sale is a
  day-to-day sales action, not an admin one.
- **Save**: the section reuses whichever plan and selling price are currently selected in the
  calculator above, adds customer/appliance fields you fill in, and saves it via a new
  `POST /api/vas-sales` endpoint.
- **Print Certificate**: once saved, a certificate is generated with the exact legal text for that
  plan (Cover, Exclusions, Limit of Liability, Basis of Claim Settlement / depreciation table,
  Claims Process, Cancellations & Refund Schedule) — ported verbatim from the legacy
  index.html/code.gs terms for each of the 4 plans, so each VAS plan gets its own correct
  certificate wording, same as the legacy system.
- **Print header uses the JDI logo** (`assets/landing/jdi-logogt.png`), in the same print style/CSS
  shell already used for every other printed document (job card, quotation, inspection) — only this
  certificate's header swaps in the logo image; the other documents' headers are unchanged.

### Needs you

- Run the new migration (`019_vas_sales.sql`) before testing this — it adds the `vas_sales` table
  and the two new permission codes.
- Save a sale for each of the 4 plans and check the printed certificate against the legacy
  certificates you shared (terms text, depreciation %, refund schedule, logo).
- Confirm the "management" and "sales" roles are the right ones to issue VAS sales — same roles as
  quotations/inspections, but let me know if it should be different.

## Modification #36 — VAS Quote Calculator: workspace-hiding bug, Clear button, VAS Issued tab, dashboard tiles

**Date:** 2026-10-01
**Status:** Built and verified (typecheck + build clean). No new migration — reuses the `vas_sales`
table from #35.

### What changed

Fixed three issues you reported after testing #35's VAS sale save/print flow:

- **Workspace-hiding bug fixed** — switching from the VAS Quote Calculator to a Management admin
  page (Pricing Admin, Rate Card Admin, etc.) left the calculator showing underneath instead of
  being hidden. `activatePricingAdminMode()` was hiding every other admin page but never hid the
  Quote Calculator panels; it now does.
- **Clear button** added to the VAS Quote Calculator's price/plan inputs, resetting the selling
  price and plan back to their defaults.
- **New "VAS Issued" tab** inside the VAS Quote Calculator page itself (next to "Quote Calculator"),
  listing every saved VAS sale (reference, issued date, customer, plan, selling price, plan fee)
  with a **Print** button per row that reopens and reprints that exact certificate at any time.
- **Side-by-side tabs, no inner scrollbar** — "Quote Calculator" and "VAS Issued" now sit next to
  each other as a horizontal tab bar (they had been stacking vertically with a capped-height
  scrollable box, which is also why the Clear button looked missing — it was simply below the
  fold inside that inner scroll area). The intro note now sits above the tabs instead of buried
  inside the Quote Calculator panel.
- **Auto-clear on save** — once a VAS sale is saved, the customer/appliance form and the calculator
  inputs above it clear themselves automatically for the next sale. The certificate you just saved
  stays printable from the same page, and the "VAS Issued" tab refreshes itself if it's the one
  open.
- **Dashboard tile** — a new "VAS sales" group on the main Dashboard showing total VAS sales and
  this-month VAS sales, same shape as the existing Quotations & inspections tiles; clicking it jumps
  to the VAS Quote Calculator.

### Needs you

- Nothing new to migrate — this only adds UI and read queries against the `vas_sales` table #35
  already created.
- After you pull and restart the server, check: switching away from the VAS Quote Calculator now
  hides it properly; the Clear button resets the calculator; saving a VAS sale clears the form and
  shows it in the new "VAS Issued" tab with a working Print button; the Dashboard shows the new VAS
  sales tile.

## Modification #37 — VAS Quote Calculator: start empty, Clear should actually clear

**Date:** 2026-10-01
**Status:** Built and verified (typecheck + build clean). No migration.

### What changed

Fixed the selling-price field in the VAS Quote Calculator:

- **Starts empty** — the field used to load pre-filled with `1000`, which also meant a quote was
  shown immediately for that default value with nothing entered.
- **Clear now actually clears** — clicking Clear used to put `1000` back instead of emptying the
  field, so the quote card and Quick Price table underneath never actually disappeared.
- **Empty price = empty result** — leaving the field blank now clears the quote card and the Quick
  Price table instead of quietly quoting a 0 AED sale.
- **Save guard** — if you click "Save VAS sale" with the price field empty or at 0, it now stops
  and asks you to enter the selling price first, instead of saving a 0 AED sale record.

### Needs you

- Nothing to migrate — pull, restart, and confirm the price field is empty on load, Clear empties
  it (and the quote/Quick Price panels) instead of putting 1000 back, and trying to save with no
  price shows the new reminder message.

## Modification #38 — AMC: Issue a Contract

**Date:** 2026-10-01
**Status:** Built and verified (typecheck + build clean). Needs `npm run db:migrate` (new migration
`020_amc_contracts.sql`).

### What changed

Gave the AMC Quote Calculator the same save + printable certificate + "Issued" tab + dashboard tile
treatment VAS got in #33-#37.

**New backend (migration `020_amc_contracts.sql`):**

- New `amc_contracts` table: reference (`AC-YYYY-NNNNN`, same numbering style as VAS's `VS-YYYY-NNNNN`),
  the selected plan, contract/client/site details, a `jsonb` appliance schedule (AMC prices against a
  whole list of appliances, not a single item like VAS), and the full pricing breakdown
  (labor/transport/parts/direct/overhead/price excl. & incl. VAT).
- New `amc_contract.read` / `amc_contract.write` permissions, granted to `management` and `sales`.
- New reference-number allocator `allocateAmcContractReference` (mirrors `allocateVasSaleReference`).
- New `GET/POST /api/amc-contracts` and `GET /api/amc-contracts/{id}` endpoints, new
  `amc-contracts.ts`/`service.ts`/`routes.ts` (mirroring the VAS sales backend), wired into the route
  catalog and OpenAPI schema.
- Dashboard summary now also reports `amcContracts: { total, thisMonth }`.

**AMC Quote Calculator (frontend):**

- **Horizontal tabs** — "Quote Calculator" and "AMC Issued", side by side, using the same
  `.vc-tab-nav`/`.vc-tab-panels` layout introduced for VAS in #37 (no internal scrollbars).
- **Clear button** — resets every appliance's qty/price back to AMC Admin Rate Section's catalog
  defaults.
- **"Issue an AMC Contract — Customer Certificate"** — pick which of the 3 computed plans (Basic RM /
  Standard PMC / Premium PMC) the customer approved, fill in contract period / client / attention to /
  site / commencement date / contract ref., save it. Saving guards against an empty appliance list and
  reuses the exact numbers currently on screen for the selected plan.
- **Printable certificate** — ported verbatim from the legacy workbook's AMC contract certificate:
  contract details, approved plan & coverage text, full appliance schedule table, service inclusions /
  exclusions, payment terms, customer confirmation, fee box, and signature blocks.
- **"AMC Issued" tab** — lists every saved AMC contract with a working Print button that re-fetches
  that exact record and reprints its certificate.
- **Auto-clear on save** — saving a contract clears the appliance table and the contract form for the
  next customer, and refreshes "AMC Issued" if it's the tab currently open.
- **Dashboard tile** — a new "AMC contracts" group on the main Dashboard (total + this-month), same
  shape as the VAS sales tile; clicking it jumps to the AMC Quote Calculator.

Also fixed a stale static note on both the VAS and AMC Quote Calculator cards that still said "This
does not save or create any record" — left over from before #35/#38 added saving.

### Needs you

- Run `npm run db:migrate` to apply migration `020_amc_contracts.sql` before testing.
- After migrating and restarting the server, confirm: the AMC Quote Calculator shows the Quote
  Calculator / AMC Issued tabs side by side with no internal scrollbar; Clear resets the appliance
  table; picking a plan and saving an AMC contract works, shows up in "AMC Issued" with a working
  Print button, and the appliance table/form reset afterwards; the Dashboard shows the new "AMC
  contracts" tile.

## Modification #39 — AMC Quote Calculator: Excel-style manual entry, real Clear, print one plan at a time

**Date:** 2026-10-02
**Status:** Built and verified (typecheck + build clean). Needs `npm run db:migrate` (new migration
`021_amc_contracts_plans_jsonb.sql`).

### What changed

Reworked #38's AMC Quote Calculator to match the Excel workflow instead of the admin-catalog-prefill
approach it shipped with:

- **Appliances are user-entered only** — the appliance table no longer pre-loads from AMC Admin Rate
  Section's catalog. It starts empty; pick an appliance type from the dropdown and click
  **"+ Add appliance"** to add it to the schedule, starting at qty 0 / unit value 0. A **Remove**
  button on each row takes it back out.
- **Clear actually clears** — same bug as VAS's #37: Clear used to reload the appliances back to the
  admin catalog's numbers instead of emptying them. It now empties the appliance list completely, and
  the Plan pricing section goes back to its "add an appliance" placeholder — not a stale total.
- **Plan pricing is fully dynamic** — with no appliances (or a quantity of 0), the Plan pricing card
  shows nothing computed, same as VAS's empty-price behaviour from #37, instead of quietly pricing a
  0 AED contract.
- **Save now stores all 3 plans, not one chosen plan** — picking an "Approved plan" before saving is
  gone. Saving a contract now stores the appliance schedule plus the full computed numbers for Basic
  RM / Standard PMC / Premium PMC together, as one quote. Which plan to print is a separate decision,
  made afterwards.
- **Print one plan at a time, dynamically** — after saving, a **"Plan to print"** dropdown (showing
  each plan's price) + Print button appear; printing generates a certificate for only the selected
  plan, with that plan's coverage, visits and price — not all three. The same per-row plan picker is
  now in the **"AMC Issued"** tab too, so any saved contract can be reprinted for whichever plan the
  customer actually goes with, any time later (not just the plan chosen at save time, since none is
  any more).

### Needs you

- Run `npm run db:migrate` to apply migration `021_amc_contracts_plans_jsonb.sql` (drops the old
  single-plan columns on `amc_contracts` and adds a `plans` jsonb column holding all 3 plans).
- This changes the save payload shape — if you had already migrated `020_amc_contracts.sql` and saved
  any test AMC contracts under it, their old single-plan data is dropped by `021`; nothing production
  depends on it yet.
- After migrating and restarting the server, confirm: the appliance table starts empty on load; Clear
  truly empties it (not back to catalog defaults); adding/removing appliances updates Plan pricing
  live; saving a contract works without choosing a plan first; after saving, picking a different plan
  in "Plan to print" and clicking Print shows only that plan's certificate; and the "AMC Issued" tab's
  per-row plan dropdown + Print does the same for a previously saved contract.

## Modification #40 — AMC Quote Calculator: appliance row's own Total value wasn't live

**Date:** 2026-10-02
**Status:** Built and verified (typecheck + build clean). No migration.

### What changed

Fixed a bug from #39: typing a quantity or unit value into an added appliance row updated the Plan
pricing card below correctly, but the same row's own **"Total value (AED)"** column stayed frozen at
whatever it showed when the row was added (0.00), because that cell was only ever written once when
the table was built, never on keystroke. It now updates on every quantity/unit value change, same as
the rest of the page.

### Needs you

- No migration — pull, restart, and confirm typing a quantity and a unit value for an added appliance
  updates that row's own Total value column immediately, not just the Plan pricing card below it.

## Modification #41 — AMC print: mandatory General Terms and Conditions, and Service Scope for the selected plan only

**Date:** 2026-10-02
**Status:** Built and verified (typecheck + build clean). No migration (the existing `plans` jsonb
column already supports the new fields).

### What changed

The AMC Quote Calculator's printed certificate was missing two things from the Excel "Contract
Quotation" sheet:

- **"Service Scope — Inclusions & Exclusions" is now on every AMC print, for the selected plan
  only** — each plan (Basic RM / Standard PMC / Premium PMC) now carries its own Included / Not
  included wording, ported verbatim from the Excel sheet's section 4 scope table. The certificate
  shows this as a new section right before the appliance schedule, for whichever single plan was
  picked to print — not all 3 plans together like the legacy `index.html` sample. This text is saved
  per plan on the contract record (same as coverage/coverage detail already were), so a reprint later
  always shows exactly what applied when the contract was saved, even if the admin text changes.
- **"General Terms and Conditions" is now mandatory on every AMC print, regardless of plan** — a new
  section, ported verbatim from the Contract Quotation sheet's section 7 (service request process,
  response time, spare parts, client's responsibility, limitation of liability, contract validity,
  site access and safety, working hours, out-of-scope work, governing terms), is added after "Service
  exclusions" and before "Payment terms and validity" on every certificate. This text isn't
  plan-specific or contract-specific, so it isn't stored per-contract — it's the same boilerplate on
  every print, like the existing generic inclusions/exclusions paragraphs.

### Needs you

- No migration needed — `plans` is already a `jsonb` column from #39, so the new `included` /
  `notIncluded` fields need nothing beyond pulling the code and restarting.
- After pulling and restarting, confirm: printing any saved AMC contract's certificate (from either
  the Save screen or "AMC Issued") shows a "Service Scope — Inclusions & Exclusions" section with
  Included / Not included text for **only** the plan you picked to print, and a "General Terms and
  Conditions" section near the end that appears **on every plan's print**, not just one.

## Modification #42 — "Contract ref." field label was pushing its input box down

**Date:** 2026-10-02
**Status:** Built and verified (typecheck + build clean). No migration.

### What changed

On the VAS sale and AMC contract save forms, the "Contract ref." field's label read
**"Contract ref. (optional — auto-generated if blank)"** — long enough to wrap onto 2 lines inside
its grid cell. Since all fields in the same row of a `.field-grid` row share the same row height,
that 2-line label pushed only _that_ field's input box down, out of line with the other inputs next
to it in the same row.

Fixed by shortening the visible label back to **"Contract ref."** (so it never wraps) and moving the
"optional — auto-generated if blank" explanation into a hover tooltip (a native `title` attribute on
the label) instead. Applies to both the VAS sale form and the AMC contract form — same label, same
bug, same fix.

### Needs you

- No migration — pull and restart.
- Confirm the "Contract ref." input on both the VAS sale form and the AMC contract save form now
  lines up with the other inputs in its row, and hovering the label shows the "optional —
  auto-generated if blank" note as a tooltip.

## Modification #43 — Rate Card: Issue a Sale — printable quotation, "Rate Card Issued" tab, dashboard tile

**Date:** 2026-10-02
**Status:** Built and verified (typecheck + build clean). Needs `npm run db:migrate` (new migration
`022_rate_card_sales.sql`).

### What changed

Gave the Rate Card Calculator the same save + printable record + "Issued" tab + dashboard tile
treatment VAS (#35–37) and AMC (#38–42) already received — until now it was quote-only, with no way
to save a quote or print anything from it.

- **"Issue a Rate Card Sale — Printable Quotation"** — a new section below the quote lines. Fill in
  client / contact / site details and Save; this stores the exact quote lines on screen (section,
  activity, rate, qty) plus the total as one normalized `rate_card_sales` record, with its own
  reference number (`RC-YYYY-NNNNN`).
- **Printable quotation** — Print generates an A4 document (company header, quotation details, the
  full line-item table, the total value, and a signature block) from the saved record.
- **"Rate Card Issued" tab** — lists every saved Rate Card sale (reference, date, client, line count,
  total value) with a Print button that reprints that exact quotation later.
- **Clear button** — the quote-lines table didn't have one before; added so the next customer's quote
  starts empty, same as VAS/AMC.
- **Dashboard tile** — a new "Rate Card sales" group on the main Dashboard (total + this-month), same
  shape as the VAS/AMC tiles; clicking it jumps to the Rate Card Calculator.

### Needs you

- Run `npm run db:migrate` to apply migration `022_rate_card_sales.sql` before testing.
- After migrating and restarting the server, confirm: building a quote (add a few lines), filling in
  client details, and saving works; printing shows the right lines and total; "Rate Card Issued"
  lists the saved sale and reprints it; Clear empties the quote lines; and the Dashboard shows the new
  "Rate Card sales" tile.

## Modification #44 — Thomson: Issue a Sale — printable quotation, "Thomson Issued" tab, dashboard tile

**Date:** 2026-10-02
**Status:** Built and verified (typecheck + build clean). Needs `npm run db:migrate` (new migration
`023_thomson_sales.sql`).

### What changed

Gave the Thomson Calculator the same save + printable record + "Issued" tab + dashboard tile
treatment VAS (#35–37), AMC (#38–42) and Rate Card (#43) already received — until now it was
quote-only, with no way to save a project quote or print anything from it.

- **"Issue a Thomson Sale — Printable Quotation"** — a new section below the project line items. Fill
  in client / contact / site details and Save; this stores each line item's fully computed numbers
  (region, appliance, qty, site visits, training sessions, unit rate, appliance subtotal, add-on
  revenue, transport cost, total price, total cost, margin) — not just the raw inputs — plus the
  chosen "Customer transport share %" and the project totals, as one normalized `thomson_sales`
  record with its own reference number (`TH-YYYY-NNNNN`). Unlike Rate Card (where rate × qty is
  always reproducible later), a Thomson line's price depends on admin rates and team capacity that
  can change — so, matching the AMC `plans` precedent, each line item carries its own computed
  numbers, keeping a reprint months later accurate to what the customer was actually quoted.
- **Printable quotation** — Print generates an A4 document (company header, quotation details, the
  full line-item table, the total project price, and a signature block) from the saved record.
- **"Thomson Issued" tab** — lists every saved Thomson sale (reference, date, client, line count,
  total price, margin) with a Print button that reprints that exact quotation later.
- **Clear button** — the project line-items table didn't have one before; added so the next project's
  quote starts empty, same as VAS/AMC/Rate Card.
- **Dashboard tile** — a new "Thomson sales" group on the main Dashboard (total + this-month), same
  shape as the VAS/AMC/Rate Card tiles; clicking it jumps to the Thomson Calculator.

### Needs you

- Run `npm run db:migrate` to apply migration `023_thomson_sales.sql` before testing.
- After migrating and restarting the server, confirm: building a project quote (add a few lines),
  filling in client details, and saving works; printing shows the right lines, totals and margin;
  "Thomson Issued" lists the saved sale and reprints it; Clear empties the line items; and the
  Dashboard shows the new "Thomson sales" tile.

## Modification #45 — Thomson Quote Calculator: fixed overlapping table headers, added tier/base-rate shown per line

**Date:** 2026-10-02
**Status:** Built and verified (typecheck + build clean). No migration.

### What changed

- **Overlapping headers fixed.** The Thomson "Quote" table used `table-layout: fixed` with no
  column widths set, so all 11 columns were forced to an equal ~9% share regardless of content —
  long headers like "Appliance subtotal", "Add-on revenue" and "Transport cost" didn't wrap and
  spilled over their neighbors, making the header row unreadable. Gave each column an explicit
  width sized to what it actually needs, the same fix the VAS plan table and AMC appliances table
  already use.
- **Base rate + tier shown per line.** Each line's "Unit rate" cell now shows a small second line
  underneath: which quantity tier (`Base`, `50+`, `150+`, `300+`, `500+`) its rate was pulled from,
  and the un-discounted base rate it was discounted from — e.g. "Tier 150+ · base 74.00" — so the
  discount applied by that tier is visible directly in the calculator, matching the master workbook's
  tiered pricing. This is calculator-only (not shown on the printed customer quotation).

### Needs you

- No migration — pull and restart.
- Confirm on the Thomson Quote Calculator: the "Quote" table's header row reads cleanly with no
  overlapping text, and adding a line whose quantity crosses a tier threshold (e.g. 50, 150, 300, 500) shows the right tier and base rate under its unit rate.

## Modification #46 — Thomson Quote table: headers still overlapped after #45, allowed to wrap

**Date:** 2026-10-02
**Status:** Built and verified (typecheck + build clean). No migration.

### What changed

#45's fix (giving each column an explicit width) wasn't enough on its own — the global table style
still forced every header (`th { white-space: nowrap }`) onto a single line, so a long header like
"Appliance subtotal" still overflowed its column box and visually overlapped its neighbor whenever
the panel was narrower than the full un-wrapped header text needed.

Added a `.calc-quote-table` class (now on the Thomson Quote table) that lets its headers wrap onto
2 lines instead of overflowing sideways. Combined with #45's column widths, the header row now stays
within its own column at any panel width instead of spilling into the next one.

### Needs you

- No migration — pull and restart.
- Confirm the Thomson Quote Calculator's "Quote" table header row reads cleanly (wrapping onto 2
  lines where needed) with no overlapping text, including when the browser window/panel is narrower.

## Modification #47 — Thomson Quote Calculator: pulsing "Live" pill confirms dynamic updates

**Date:** 2026-10-02
**Status:** Built and verified (typecheck + build clean). No migration.

### What changed

Added a small "Live" pill on the right side of the "Quote" card heading in the Thomson Quote
Calculator. It pulses gently at rest (signaling the Quote table updates automatically), and flashes
more strongly for a moment every time the table actually re-renders — e.g. right after changing
"Customer transport share %", or adding/removing a line — so the dynamic update is visibly confirmed
rather than just assumed.

### Needs you

- No migration — pull and restart.
- Confirm on the Thomson Quote Calculator: the "Quote" card header shows a small pulsing "Live" pill
  on the right, and it flashes noticeably when you change the Transport share % or add/remove a line.

## Modification #48 — Thomson Calculator: "Additional Services" rates visible, admin can amend per quote

**Date:** 2026-10-02
**Status:** Built and verified (typecheck + build clean). No migration.

### What changed

The Thomson Quote Calculator now shows a new **"Additional Services"** card (Project Management Fee,
Site Survey, Testing & Commissioning, Training) with the exact rate / technician-hours / note values
currently set in Thomson Pricing Admin, so anyone using the calculator can see what's driving the
add-on revenue and cost in their quote.

- **Admin users** (`pricing_config.write` — matches who can already edit Thomson Pricing Admin) get
  editable Rate and Technician hours fields here. Changing one updates the Quote table immediately
  (the "Live" pill flashes, same as a Transport % change) — this is a **this-quote-only override**:
  it never writes back to the saved Thomson Pricing Admin defaults, so other quotes and future
  sessions are unaffected.
- A **"Reset to admin defaults"** button puts the values back to whatever Thomson Pricing Admin
  currently has, discarding the override.
- Everyone else (anyone with calculator access) sees the same rates as plain read-only values, so
  they know what's being used without being able to change it.
- Saving a Thomson sale captures whichever rates were in effect at Save time, same as every other
  computed number on the line — so a quote built with an amended rate reprints correctly later.

### Needs you

- No migration — pull and restart.
- Confirm as an admin: the "Additional Services" card shows editable Rate/Hours fields, changing one
  updates the Quote table's totals immediately, and "Reset to admin defaults" restores Thomson
  Pricing Admin's values.
- Confirm as a non-admin (management) user: the same card shows the rates as read-only text, with no
  Rate/Hours inputs and no Reset button.

## Modification #49 — Service Revenue Dashboard + Budget vs Actual (Excel-fed)

**Date:** 2026-10-05
**Status:** Built and verified (typecheck + build clean; workbook import and every dashboard query run against a real Postgres with your two master workbooks). Needs `npm install` and `npm run db:migrate` (024).

### What changed

Two new pages under **Management**, separate from the operational dashboard:

- **Service Revenue Dashboard** — Overview (revenue, jobs, units, average per job, top job type, monthly trend by year, revenue by job type / sales channel / salesperson / top customers) and Explorer (every job row, searchable, paged), with Year / Month / Job type / Channel filters.
- **Budget vs Actual** — monthly budget revenue and volume from the Service Budget workbook next to actual revenue and volume from the revenue data, variance and achievement %, year-to-date tiles, and the budget P&L (cost lines, OPEX, NOP, NP).

Until ERP gives us an API or table access, both are fed from your master workbooks. An admin uploads the **Service Dashboard master (.xlsm)** on the revenue page and the **Service Budget (.xlsx)** on the budget page. The server reads the "Revenue Source" sheet (the Excel-calculated Revenue is kept as-is — it is the canonical figure) and the budget "P&L -YTD" sheet. Each upload becomes a batch; the newest is active and older ones are kept as history. Management can view; only admin can upload (`revenue_dashboard.read` / `revenue_dashboard.write`).

### Under the hood

- Migration `024_revenue_dashboard.sql`: `revenue_import_batches`, `revenue_lines`, `budget_lines` + the two permissions.
- API: `POST /api/revenue-dashboard/import`, `GET /batches`, `/summary`, `/lines`, `/budget`.
- New dependency: `exceljs` (reads the workbooks on the server).
- Charts are plain SVG/CSS (no charting library; production CSP only allows same-origin scripts).

### Needs you

- `npm install`, `npm run db:migrate`, restart.
- As admin: upload the .xlsm on Service Revenue Dashboard and the .xlsx on Budget vs Actual; confirm the revenue total matches the workbook (AED 324,697 for the file you sent) and July–September volumes (444 / 573 / 299).
- As management: confirm you can view both pages but see no upload box.
- Data points worth a look in the source workbooks (shown as-is, not changed): about 58% of revenue has sales channel "REVIEW" (the remarks did not say HAA or INS), and the budget P&L's monthly OPEX (58,471) excludes Staff Travel and Staff Insurance while its own YTD column (723,734) includes them.


## Modification #50 — Service Revenue Dashboard: Reports tab, value labels, full drill-down

**Date:** 2026-10-05 · **Scope:** Management / Finance / Accounts · no new migration (uses 024) · `npm install`

**What changed**
- Service Revenue Dashboard now has Overview / Explorer / Reports tabs sharing one filter bar (Year, Month, Week, Job type, Sales channel, Cost status).
- Charts use the same Chart.js visuals as the legacy dashboard (self-hosted at `apps/web/src/vendor/chart.umd.js`, so the production CSP is unaffected). Monthly revenue trend shows the value (AED) on every stack; doughnut shows %; horizontal bars show AED at the bar end. Budget vs Actual has a labelled grouped chart.
- Reports: Drill-down (any dimension → any dimension → individual jobs with remarks), Monthly report (MoM %), Weekly report, Accounts Review (units pivot), Billing & cost, Customers (Pareto / concentration), Channel & sales, Exceptions (billing/channel/cost review, zero revenue, not approved, unmatched order, no customer, with AED at stake), Management summary (copyable text), Export to .xlsx (11 sheets).
- New API: GET /api/revenue-dashboard/group, /matrix, /exceptions, /export (revenue_dashboard.read).

**Needs you:** `npm install`, restart, `git push`. Open Service Revenue Dashboard → Reports and click through a drill-down to individual jobs.


## Modification #51 — Report export: full CSIDI-sheet columns on Jobs + "Revenue Logic" sheet

**Date:** 2026-10-05 · **Scope:** Management / Finance / Accounts · **migration 025** · re-upload the Service Dashboard workbook

**What changed**
- The Jobs sheet of the exported report now carries every column of the workbook's CSIDI sheet (Tranc, customer code, location, raw units, invoice status, derived type, calc qty, appliance category and its source, customer grouping, sites, trips, crew, discount tier/rate, base/net unit rate, transport, billing qty, proposed revenue, pricing status, review note and the eight "Before fix" columns), for CSIDI / CSIDO / CSIII jobs. Header colours separate the groups: navy = base job, teal = CSIDI sheet, brown = how the revenue is built, plum = what missing ERP data could change.
- New calculation columns per job: revenue basis, labour before discount, volume discount, AED 35 floor, labour after discount, transport, rebuilt revenue, workbook-minus-rebuilt (reconciles to 0.00 for all 849 CSIDI-sheet jobs in 2026), revenue per unit, change vs the 3 Oct fix.
- New "what if" columns: all units refrigerator/washer, all cooker, trips in Sharjah, not same customer/site, 3-person crew, CSIDO billed per unit; plus the assumptions behind each figure and Remarks flags (no activity wording, "only installation" wording, other products, models seen).
- New **Revenue Logic** sheet: current rules per job type, how the activity is classified, the rate masters in force (read from the workbook's Del+Install Pricing, Install Pricing and Calculation sheets), the AED value of every assumption (category, region, grouping/sites, crew, trips, CSIDO quantity basis, classification gaps, effect of the 3 Oct change), category-identification split, reconciliation, the Orion ERP fields still needed and the open management decisions.
- Upload now stores each CSIDI row against its revenue line (joined on Inv/Del No and job type; all 1,165 CSIDI/CSIDO/CSIII lines matched) and the rate masters on the batch.

**Needs you:** `npm run db:migrate` (025), restart, then **re-upload the .xlsm** on Service Revenue Dashboard (older uploads have no CSIDI columns; the Logic sheet shows built-in rates for them). Export a report and check the Jobs and Revenue Logic sheets.


## Modification #52 — Reports page: download service records as Excel

**Date:** 2026-10-05 · **Scope:** Sales / Management / Admin · migration 026 · no new package

**What changed**
- New **Reports** page under Records (the legacy portal's "Download service reports" tab): pick a record type, a date range (this month, last month, year to date, custom, all) and optional search text, preview the rows, then download a formatted Excel workbook.
- Record types: Quotations, Inspection Reports, AMC Contracts, Thomson Sales, VAS Sales, Rate Card Sales, Service Job Cards and Scheduler (appointments). Each type only appears if the user's role can already read that record type.
- Every download is written to the audit log (report, range, search, rows) so it shows on the Activity log.
- New API: GET /api/reports, GET /api/reports/{type}, GET /api/reports/{type}/export. Migration 026 gives sales and management the reports.read permission (admin already had it).

**Needs you:** `npm run db:migrate` (026), restart, open Reports, pull a report and open the downloaded file.
