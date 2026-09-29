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
