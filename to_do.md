# Jacky's Service Portal Migration TODO

This checklist tracks the phase-by-phase migration from the existing Google Apps Script service system to the new service portal. The migration project is still local development and testing work. Google Apps Script remains production and rollback infrastructure until formal cutover approval.

## Completed

- [x] Phase 0: Establish the migration project foundation and local development boundaries.
- [x] Phase 1: Add PostgreSQL schema, migrations, contracts, API foundation, and local startup documentation.
- [x] Phase 2: Add complaint workflow APIs, validation, history, audit events, and integration coverage.
- [x] Phase 3: Add scheduling operations, appointments, technicians, assignment, draft schedules, promotion, and calendar output.
- [x] Phase 4 first web slice: serve the web UI from Express at `/portal/`.
- [x] Phase 4 first web slice: add the public complaint registration form and confirmation state.
- [x] Phase 4 first web slice: add development-only staff bootstrap and sign-in.
- [x] Phase 4 first web slice: add protected complaint inbox, detail, and history views.
- [x] Phase 4 first web slice: keep the browser bearer token in memory only.
- [x] Phase 4 first web slice: preserve server-authoritative authentication and permissions.
- [x] Phase 4 first web slice: add Playwright browser coverage for page rendering, validation, and unauthenticated protected access.
- [x] Add beginner-friendly local testing instructions in `testing_guide.md`.

## Current Phase 4 work

The first browser slice is complete. The next work should extend the service operations experience without changing the existing production Apps Script deployment.

- [x] Add complaint notes controls to the staff complaint detail view.
- [x] Add complaint status update controls with server-authoritative transition handling.
- [x] Add a new service-request workspace for staff follow-up.
- [x] Add appointment scheduling for ready complaints with technician availability lookup.
- [x] Add technician assignment and unassignment UI.
- [x] Add the protected appointment list view and authenticated calendar-file download.
- [x] Add browser tests for authenticated staff workflows.
- [x] Add more role-gated navigation tests for sales, management, and admin permissions.
- [x] Add browser coverage for complaint detail, notes, status changes, scheduling, and assignment.
- [x] Add clear loading, empty, error, unauthorized, forbidden, not-found, conflict, and retry recovery states for protected views.
- [x] Add calendar month/week views and drag-and-drop scheduling through server-authoritative rescheduling.
- [x] Add accessible appointment rescheduling with terminal-state protection, conflict handling, and authoritative refreshes.

## Phase 0-4 parity fixes required before Phase 5 continues — 2026-09-28

Full detail: `docs/PARITY_REVIEW_2026-09-28.md`. Confirmed against today's live `code.gs`, `Index.html`,
and the new `ComplaintRegistration_26.html`. Implemented 2026-09-28 and pushed to
`https://github.com/service-jackys/Jackys_Claude_service_portal`.

- [x] Added `b2b_branch_school`, `school_contact_person`, `school_contact_number`, `customer_number` to
      `complaints` and `appointments` (migration `004_b2b_parity_fields.sql`); accepted in
      `publicComplaintSchema` and `appointmentCreateSchema`. (`branch_id` already existed on both tables
      from migration 001 — this was a field-capture gap, not a missing relation.)
- [x] Surfaced `salesOrderNumber` as an actual input on the public complaint form and the staff scheduling
      screen (`#scheduleForm`); staff input now overrides the linked complaint's value when both exist.
- [x] Replaced `customerType` enum (`individual/company/b2b`) with the live system's three values
      (`B2C/B2B/B2B-SalesChannel`) end to end — migration, contracts, OpenAPI, and the public form's
      `<select>`. Migration 004 remaps any existing local rows before tightening the CHECK constraint.
- [x] Replaced the free-text `region` input on the public form with the fixed 8-emirate select (Dubai,
      Sharjah, Ajman, Ras Al Khaimah, Fujairah, Umm Al Quwain, Abu Dhabi, Al Ain) used live. (`region`
      stays free text at the DB/contract layer, matching the live backend, which never validates it
      server-side either — only its UI select constrains it.)
- [x] Added a `sub_group` column + field on `appointments` (product/item category). Populated by manual
      staff entry for now — wiring it to an automatic Stock Master lookup by Item Code is Phase 6/7 work
      (Stock Master import doesn't exist yet in this project).
- [ ] Re-run the Phase 4 Playwright suite after the schema/contract changes. **Not done in this pass** —
      needs Docker Desktop + the local Postgres container, which aren't available in the environment this
      change was made from. Run `npm run db:migrate` (applies migration 004 — this also had an ordering
      bug that was fixed on 2026-09-28, see `docs/BUILD_STATUS.md`), then
      `npm test -- --test-concurrency=1` and `npm run test:e2e` on your machine before treating this as
      verified. `npm run typecheck`, `npm run build`, and `npm run format:check` were all run and pass.

Also fixed while in this code (same root cause, not tracked as a separate parity gap, but worth noting):
the public complaint form's client-side submit handler sent blank optional fields as empty strings
(`""`) instead of omitting them, which fails every optional Zod field's `.min(1)` the moment it's
present — this would have broken submissions with any blank optional field (address, region, brand,
model, serial/item code, email), not just the new B2B fields. Fixed once in `formDataObject()` in
`apps/web/src/app.js` for all optional fields, old and new.

## Later phases

### Phase 5: Service operations parity

- [ ] Reproduce the remaining service-center workflows needed for operational parity.
- [ ] Complete customer, branch, technician, appointment, complaint, and service-history journeys.
- [ ] Confirm role and permission behavior against the existing service-center responsibilities.
- [ ] Verify exports and operational reports without exposing live data during development.

#### Phase 5 checkpoint — 2026-09-26

- [x] Add the append-only service job-card migration with one-card-per-appointment uniqueness.
- [x] Add the `JBC-YYYY-NNNNN` reference allocator.
- [x] Add strict job-card status contracts and the explicit lifecycle: Open, In Progress, Completed, and Cancelled.
- [x] Add transactional job-card creation, status history, finalization metadata, and audit events.
- [x] Add protected job-card API routes, including the paginated/searchable queue endpoint.
- [x] Add contract and integration coverage for the job-card lifecycle.
- [x] Confirm TypeScript type checking passes after the backend queue work.
- [x] Build the protected job-card queue and detail workspace in `apps/web/src/`.
- [x] Add focused Playwright coverage for job-card permissions, creation, transitions, terminal locks, and recovery states.
- [x] Run focused formatting, type checking, build, contract tests, and browser verification.
- [ ] Complete manual Phase5 browser verification using `testing_guide.md`.
- [ ] Run the full integration suite after safely resolving the existing `001_initial_schema.sql` migration checksum mismatch; do not edit migration history or delete the database volume.

**Resume first:** complete manual Phase5 verification, record the results, then inspect the uncommitted diff before committing or pushing.

#### Phase 5 checkpoint — 2026-09-28: job-card creation logic fixed to match live system

Found and fixed a business-logic inversion reported via manual walkthrough: the job-card feature only
allowed creating a job card from a non-terminal (Scheduled/In Progress) appointment and rejected
Completed ones outright — the opposite of the live system, where a job card is created FROM a completed
appointment with its data pulled into an editable form first. Full detail in `README.md`'s "What we've
done so far" log; pushed to GitHub.

- [x] Migration `005_job_card_live_parity.sql`: full job-card content field set from the live system
      (customer/item/warranty, complaint, service rendered, parts, period/time-consumed, costs/totals,
      invoice/delivery, technician, `jobFinalStatus`).
- [x] `GET /api/appointments/{id}/job-card/prefill` — pulls defaults from a completed appointment.
- [x] `POST /api/appointments/{id}/job-card` — now requires `Completed`, accepts edited content.
- [x] `PATCH /api/job-cards/{id}` — edits a non-terminal job card's content; totals/time-consumed always
      computed server-side.
- [x] Web app: create button only shows once `Completed`; opens the editable prefill form instead of
      creating immediately; job-card detail view has an editable content form with a parts table.
- [x] `npm run typecheck`, `npm run build`, and `prettier --check` all pass.
- [ ] **Not done yet — needs you:** run `npm run db:migrate` on your machine to apply migration 005, then
      walk the flow end to end (complaint → appointment → mark Completed → create job card → edit →
      save) using `testing_guide.md`, and report back anything that doesn't match what you expect from
      the live system.
- [ ] Re-run the Playwright suite for the job-card feature after the above manual check passes — the
      existing Phase 5 browser tests were written against the old (inverted) creation flow and will need
      updating to the new prefill → create flow.

#### Phase 5 checkpoint — 2026-09-28: quotation and inspection records added

- [x] Migration `006_quotations_inspections.sql`: `quotations` and `inspections` tables matching the live
      system's field sets (`docs/code.gs` `HEADERS_BY_TYPE['quotation']` / `['inspection']`), plus
      granting the already-seeded `quotation.*`/`inspection.*` permissions to management/sales (they
      existed since Phase 1 but were never granted to any role but admin).
- [x] `GET/POST /api/quotations`, `GET/PATCH /api/quotations/{id}` — products + parts line-item tables,
      grand total always computed server-side (products + parts + labour), matching `recalcQuotation()`.
- [x] `GET/POST /api/inspections`, `GET/PATCH /api/inspections/{id}` — products + faulty-parts tables,
      free-text `Ref. Quotation No.` field (matches live: not a real FK there either).
- [x] Neither has a workflow-lock status, matching the live system — Prepared/Approved and
      Inspected/Reviewed by/date are plain editable fields, not an enforced state machine, so records
      stay editable (no "terminal" lock like job cards).
- [x] Web app: new "Quotations" and "Inspections" nav items, list + search, a create panel, and an
      always-editable detail form with add/remove line-item tables (reused the job-card parts-table
      code, generalized into `renderLineItemsTable`).
- [x] `npm run typecheck`, `npm run build`, and `prettier --write` all pass.
- [ ] **Not done yet — needs you:** `npm run db:migrate` on your machine (applies migration 006), then
      walk through creating a quotation and an inspection via the web app.
- [ ] Quotation-sourced job cards (live system's `pullJobCardFromQuotation`) are still out of scope —
      `service_job_cards.source_type` is still constrained to `'Scheduler'` only. Revisit once quotations
      are verified working.
- [ ] Playwright coverage for quotations/inspections not yet written.

#### Phase 5 checkpoint — 2026-09-28: job-card attachments added

- [x] Migration `007_job_card_attachments.sql`: `job_card_attachments` table (file name, content type,
      size, opaque UUID-based `storage_key`, uploader, timestamp), `ON DELETE CASCADE` from
      `service_job_cards`, size capped at 20 MB.
- [x] Private local-disk storage (`storage/attachments/`, gitignored), addressed only by opaque
      `storage_key` -- deliberately the swap-point for Supabase Storage in Phase 8 without changing the
      DB schema shape.
- [x] Upload validated server-side against an allow-list (`image/jpeg`, `image/png`, `image/webp`,
      `image/heic`, `application/pdf`) and the 20 MB size cap; rejected files never reach disk.
- [x] Downloads use a signed, time-limited URL (HMAC-SHA256 over attachment id + expiry, verified with a
      constant-time comparison) instead of a permission-gated route, so an `<img src>`/direct link works
      without sending an auth header; secret comes from `ATTACHMENT_URL_SECRET` (dev-only insecure
      fallback, throws if unset in production).
- [x] `POST/GET /api/job-cards/{jobCardId}/attachments`, `GET /api/attachments/{id}/download` (signed
      token, no permission check), `DELETE /api/attachments/{id}` (removes DB row, disk file, and logs an
      audit event).
- [x] Web app: job-card detail panel has a file picker + upload button (writable, non-terminal job cards
      only) and an attachments list with download/remove links.
- [x] `npm run typecheck`, `npm run build`, and `prettier --write` all pass.
- [ ] **Not done yet — needs you:** `npm run db:migrate` on your machine (applies migration 007), then
      upload/download/remove a file against a real job card to confirm the signed-URL flow works end to
      end.
- [ ] Playwright coverage for attachments not yet written.
- [ ] Swap local disk storage for Supabase Storage before production (Phase 8) — the `storage_key`
      design already anticipates this; only `storage.ts` should need to change.

#### Phase 5 checkpoint — 2026-09-28: print views and legacy-reference field added

- [x] Migration `008_print_legacy_reference.sql`: adds an optional `legacy_reference` text column to
      `service_job_cards`, `quotations`, and `inspections` — a place to record a matching document's
      reference from the old Google Sheets/Apps Script system, printed alongside this project's own
      auto-generated reference. Free text, not a foreign key (the legacy system's references pre-date
      this project's reference allocator).
- [x] `POST`/`PATCH` job-card, quotation, and inspection endpoints accept an optional `legacyReference`
      field; each create/edit form has a "Legacy reference" input.
- [x] Web app: each of the job card, quotation, and inspection detail panels gained a "Print" button
      that opens a clean, self-contained printable document (matching the live system's per-document
      "Print / PDF" buttons) in a new tab and triggers the browser's print dialog — no server round
      trip, works entirely from already-loaded detail data.
- [x] `npm run typecheck`, `npm run build`, and `prettier --write` all pass.
- [ ] **Not done yet — needs you:** `npm run db:migrate` on your machine (applies migration 008), then
      open a job card/quotation/inspection and try "Print" — confirm your browser's print dialog opens
      with a clean, correctly laid-out document, and that a pop-up blocker doesn't silently swallow it
      (the button shows a message if the window was blocked).
- [ ] The full historical-import side of "legacy-reference preservation" (auto-populating this field from
      an authorized export) is Phase 7 scope, not this item — for now the field is filled in by hand.
- [ ] Playwright coverage for print/legacy-reference not yet written.

#### Phase 5 checkpoint — 2026-09-28: out-of-warranty approval flow and customer-facing links added

- [x] Migration `009_warranty_approvals.sql`: new `warranty_approvals` table (approval reference
      `WA-YYYY-NNNNN`, linked to exactly one of a job card or an inspection), two new permissions
      (`warranty_approval.read`/`.write`, granted to admin/management/sales), and a widened
      `reference_counters` namespace check. This is new functionality, not live-system parity — the
      live Apps Script system has no equivalent workflow.
- [x] Staff side: `POST/GET /api/warranty-approvals`, `GET /api/warranty-approvals/{id}` — raise a
      request against a job card or inspection ID (exactly one required), with customer/item/warranty
      details pulled from the source record when not given explicitly. A new "Warranty approvals" nav
      tab lists requests and shows each one's status plus a copyable customer approval link.
- [x] Customer side: `GET/POST /api/public/warranty-approvals/{token}[/decision]` — unauthenticated,
      token-authorized (an opaque, non-expiring access token, not the short-lived HMAC signed URLs used
      for attachment downloads, since the customer has no staff account and no session to keep alive).
      A decision can only be submitted once — a Pending request moves to Approved/Declined and stays
      there.
- [x] New standalone page `apps/web/src/approve.html` — the actual customer-facing link target,
      served alongside the staff SPA at `/portal/approve.html?token=...`. Self-contained (no shared auth
      state with the staff app), shows the item/warranty/cost details and, while Pending, an
      approve/decline form; once decided, shows who decided and when instead.
- [x] `npm run typecheck`, `npm run build`, and `prettier --write` all pass.
- [ ] **Not done yet — needs you:** `npm run db:migrate` on your machine (applies migration 009), then
      create a job card or inspection, raise a warranty approval request against it from the "Warranty
      approvals" tab, copy the link, open it in a private/incognito window (to confirm it needs no staff
      sign-in), and submit a decision.
- [ ] No rate limiting on the public decision endpoint yet, unlike the public complaint form — worth
      adding before this is exposed outside a trusted network.
- [ ] Playwright coverage for warranty approvals not yet written.

#### Phase 5 checkpoint — 2026-09-28: operational dashboard and a service report added

This closes out every item planned for Phase 5 in `docs/DEVELOPMENT_PLAN.md`.

- [x] `GET /api/dashboard/summary` (permission `dashboard.read`, already seeded since Phase 1 and granted
      to every staff role) — counts by status for complaints, appointments (plus a "today" count), and
      service job cards; totals and month-to-date totals for quotations and inspections; counts by status
      for warranty approvals. Deliberately operational only — revenue/pricing reporting is Phase 6 scope
      (`docs/DEVELOPMENT_PLAN.md`'s "reports, exports, and dashboard reconciliation").
- [x] New "Dashboard" nav tab renders these as tile groups, rendering whatever statuses the API returns
      rather than a hardcoded list, so a status this page doesn't already know about still shows up as a
      tile instead of silently vanishing.
- [x] A "service report": an "Export CSV" button on the service job cards list downloads the
      currently-loaded (filtered) list as a CSV — reference, appointment, customer, contact, status,
      technician, job final status, costs/totals, created/updated — entirely client-side from
      already-loaded data, the same approach the print views use, so it needed no new API endpoint.
- [x] `npm run typecheck`, `npm run build`, and `prettier --write` all pass.
- [ ] **Not done yet — needs you:** open the "Dashboard" tab and confirm the counts match what you see
      in the Complaint inbox / Appointments / Service job cards / Quotations / Inspections / Warranty
      approvals lists; open the job cards list and try "Export CSV".
- [ ] Only job cards get a CSV export for now — quotations/inspections/warranty approvals could get the
      same treatment later if it's useful.
- [ ] Playwright coverage for the dashboard and CSV export not yet written.

**All six Phase 5 items from `docs/DEVELOPMENT_PLAN.md` are now built** (job cards + locks; quotations/
inspections; attachments; print views + legacy reference; out-of-warranty approvals; dashboard + service
report). None of migrations 005–009 have been applied against a real database yet — run
`npm run db:migrate` and walk through each feature per its checkpoint above before treating Phase 5 as
verified. The Phase 5 gate in `docs/DEVELOPMENT_PLAN.md` ("accepted against representative legacy
scenarios") also still needs updated/new Playwright coverage across all of the above, which is listed as
outstanding in each checkpoint.

#### Front-end redesign checkpoint — 2026-09-28: split landing / customer / staff experiences

The previous single SPA mixed the public complaint form with the internal staff tools in one
`apps/web/src/index.html`. This is now three separate pages, all reusing the same brand tokens
(`apps/web/src/assets/landing/brand.css`) and the crest-only Jacky's logo (no header wordmark text,
per the customer's direct feedback), and styled toward a cleaner enterprise-CRM look (left sidebar
navigation, card-based panels, a contextual workflow stepper).

- [x] Added `apps/web/src/landing.html` — a new public marketing/overview page (served at `/`): hero,
      "how it works" 3-step section, service capability/proof showcase using the real Jacky's service
      photography, a brand-partner logo strip (Thomson, Philips, Venus), a dual "choose your access"
      section (Customer & Sales Channel → `/complaints`, Internal Service Team → `/portal/`), a stats
      bar, and a final CTA. Structurally modeled on the reference landing page the customer shared;
      colors/typography reuse Jacky's own existing brand tokens, not the reference file's palette.
- [x] Added `apps/web/src/complaints.html` + `apps/web/src/complaints.js` — the public complaint
      registration form extracted into its own standalone page (served at `/complaints`), with no
      shared staff auth, modeled on the existing `approve.html` standalone-page pattern. Submits to the
      same complaint API the old embedded form used — no API contract changes.
- [x] Rebuilt `apps/web/src/index.html` as the staff-only portal (served at `/portal/`): the public
      complaint form was removed from it entirely. Its section nav is a proper left sidebar
      (`.dashboard-nav`, 270px fixed column, collapses to a top stack on narrow screens) instead of a
      top button row.
- [x] Added a workflow-stepper component (`.workflow-stepper` CSS + `renderWorkflowStepper()` in
      `app.js`) that visualizes the Complaint → Scheduling/Appointment → Job Card → Completion pipeline
      and highlights the current stage; wired contextually into the complaint, appointment, and job-card
      detail views (not static — computed per record's actual status).
- [x] Copied the customer's brand/photography assets into `apps/web/src/assets/landing/` (from their
      `service-jackys.github.io/landing_page_images` folder) and renamed them to URL-safe filenames.
- [x] Wired Express routing in `apps/api/src/app.ts`: `/` serves `landing.html`, `/complaints` (and
      `/complaints/`) serves `complaints.html`, `/portal/` continues serving the staff SPA exactly as
      before. No existing API routes were touched.
- [x] Typecheck, build, `node --check` on both JS files, and a div-balance/duplicate-id check on all
      three HTML files all pass; files formatted with `npx prettier --write`.
- [x] Manual visual review of the landing page in a real browser is done — several follow-up fixes
      came out of it: a header-logo cleanup, a real (previously CSP-blocked) rendering bug, and image
      sizing/selection fixes across the hero and capability cards. See the git log for
      2026-09-28 for the individual commits.

#### Playwright coverage checkpoint — 2026-09-28: unparked, redesign coverage added

- [x] Moved the old embedded-complaint-form tests out of `portal.spec.ts` (they targeted markup that no
      longer exists at `/portal/`) into a new `tests/e2e/complaints.spec.ts` targeting `/complaints`:
      renders the standalone form, required-field validation, outbound links to the landing page and
      staff portal, and the trailing-slash route.
- [x] Added `tests/e2e/landing.spec.ts`: hero renders with both access-path links, every image on the
      page actually loads (not just present in markup), and — as a direct regression test for the
      inline-script CSP bug fixed the same day — every `.reveal` section below the hero actually
      becomes visible on scroll instead of staying at `opacity: 0`.
- [x] `npx playwright test --list` and `npm run typecheck`/`npm run build` all pass with the new/moved
      spec files (37 tests across 4 files). **Not actually executed against a running server in this
      pass** — this environment has no reachable Docker/Postgres/dev server, only static
      parse/type-checking. Run `npm run test:e2e` yourself (see `testing_guide.md` §13 — this checkout
      needs `E2E_BASE_URL=http://localhost:3100` set first) and report back any real failures.
- [x] Documented the `E2E_BASE_URL=http://localhost:3100` requirement in `testing_guide.md` — the guide
      previously only mentioned the port-3000 default, which doesn't match this checkout's ports.
- [x] `portal.spec.ts`'s existing staff-workspace tests were not touched beyond removing the old
      public-journey block — confirmed passing against the new sidebar markup by the real 37/37 run
      above.
- [x] Added `tests/e2e/phase5-records.spec.ts` (14 tests) closing the Phase 5 Playwright gap:
      quotations (nav permission gating, list + create + print), inspections (same), warranty approvals
      (nav permission gating, the client-side "exactly one of job card/inspection" guard with zero
      network calls, create + customer link), the operational dashboard (summary tiles), service
      job-card attachments (upload + list + download href + delete), a dedicated job-card print test,
      the workflow-stepper component (current/done stage labels for a closed complaint, the single
      "Cancelled" marker), and the customer-facing `approve.html` decision page (approve flow with the
      client-side name-required guard, and an invalid-token error state) — the last of these needs no
      staff sign-in, matching how a real customer reaches it.
- [x] `npm run typecheck`, `npm run build`, and `npx prettier --check` all pass; `npx playwright test
--list` resolves 51 tests across 5 files with no parse errors (was 37 across 4).
- [ ] **Not yet run against a live server** — same limitation as every other Playwright checkpoint in
      this file. Please run `npm run test:e2e` (with `E2E_BASE_URL=http://localhost:3100`) after you've
      applied migrations 005-009 and walked the manual Phase 5 checklist below, since these tests read
      real Phase 5 markup (quotation/inspection field prefixes, the attachment upload panel, the
      warranty-approval link field) that has never been exercised by an actual browser run before now.

#### Playwright failure fixes — 2026-09-28: real `npm run test:e2e` run reported 18/37 failures, diagnosed and fixed

- [x] Root-caused via the real `test-results/**/error-context.md` accessibility-tree snapshots (no live
      server reachable from this environment, so diagnosis was entirely from the user's pasted output
      and generated error-context files): the `.dashboard-link::before { content: '\25CF'; }` CSS
      bullet is included in the Chromium-computed accessible name (e.g. "● Dashboard" instead of
      "Dashboard"), breaking every `getByRole('button', { name: ..., exact: true })` query against the
      staff sidebar nav. This alone accounted for most of the 18 failures (`phase4-scheduling.spec.ts`
      and many `portal.spec.ts` tests going through the sidebar). Fixed by adding explicit
      `aria-label` attributes to all 9 `.dashboard-link` buttons in `apps/web/src/index.html`, which
      override the content-based accessible name.
- [x] Fixed a strict-mode `getByLabel('Notes', { exact: true })` collision: both `#complaintNotes` and
      `#waNotes` used the literal label text "Notes". Renamed the warranty-approval field's label to
      "Approval notes" in `apps/web/src/index.html`.
- [x] Fixed a strict-mode `getByRole('link', { name: 'Internal Service Team' })` collision in
      `tests/e2e/complaints.spec.ts:40`: the nav link "Internal Service Team" and the footer link
      "Internal Service Team sign in" both matched (substring, not exact-text issue — `exact: true`
      wasn't set on this query). Scoped the locator to `page.locator('nav').getByRole('link', ...)`
      instead of changing the footer link text.
- [x] Re-ran `npm run typecheck`, `npm run build`, a div/duplicate-id structural check, and
      `npx prettier --write` on both touched files; all pass. `npx playwright test --list` still
      resolves all 37 tests across 4 files with no parse errors.
- [x] Real run confirmed: 35/37 passing after the fixes above, down from 19/37. The remaining 2
      failures (`portal.spec.ts:1463` and `portal.spec.ts:1661`, both "service job-card workspace")
      were a genuine test/app mismatch, not a redesign regression: `createJobCard()` in `app.js` first
      calls `GET /api/appointments/:id/job-card/prefill` to open an editable review panel, and only
      the panel's own submit button ("Create job card", `#submitJobCardCreateButton`) actually POSTs
      the job card — the tests clicked "Create service job card" once and expected the POST to have
      already happened. The unmocked prefill request fell through to the real backend, got a 401 for
      the fake test token, and the app signed itself out ("Your session has expired"), which is what
      the timeouts were actually waiting on. Fixed both tests in `tests/e2e/portal.spec.ts` to mock the
      prefill GET and click through the two-step flow (open panel → submit), and updated the first
      test's body assertion to check the submitted `customerName` instead of asserting a `null` body
      that no longer matches how the app submits job-card creation.
- [x] Confirmed via a real `npm run test:e2e` run: **37/37 passing.** All redesign coverage
      (`landing.spec.ts`, `complaints.spec.ts`) and all existing staff-workspace coverage
      (`portal.spec.ts`, `phase4-scheduling.spec.ts`) are green. A few other duplicate labels exist
      elsewhere in `index.html` ("Next status" x3, "Technician" x2) that weren't exercised by any
      current test — flag if a future test surfaces them.

#### Bug fix — 2026-09-28: reopening a Scheduled complaint left a stale "active" appointment behind

Reported via manual walkthrough: a complaint (`CMP-260928-002`) showing `Ready for Scheduling` refused
a new appointment with "The complaint already has an active appointment."

- [x] Root cause: `complaintSchedulingTransitions` (packages/contracts) deliberately allows a manual
      `Scheduled` → `Ready for Scheduling` complaint-status transition as an explicit staff recovery
      action (asserted by `tests/contracts.test.ts`) — but `changeStatus()` in
      `apps/api/src/complaints/service.ts` only updated the complaint row; it never cancelled the
      still-`Scheduled` appointment underneath it. `findActiveAppointmentForComplaint()` treats any
      non-`Cancelled` appointment as active, so the old appointment kept blocking every new one even
      though the complaint itself looked schedulable again.
- [x] Fix: when `changeStatus()` performs that specific transition, it now looks up the complaint's
      active appointment (if any) and cancels it in the same transaction — same appointment-history and
      audit-event trail a normal appointment cancellation gets. No API contract or schema change; the
      staff UI needs no changes since it already calls the same status-update endpoint.
- [x] Added `tests/integration/scheduling.test.ts`: "reopening a Scheduled complaint to Ready for
      Scheduling cancels its active appointment" — creates a complaint, schedules it, reopens
      scheduling, confirms the first appointment is now `Cancelled` with a history entry, then confirms
      a second appointment can be created without the conflict error. Requires a live Postgres
      (`DATABASE_URL`) to actually run, same as the rest of that file — not run in this pass.
- [x] `npm run typecheck`, `npm run build`, and `prettier --write` all pass.
- [ ] **To unblock `CMP-260928-002` right now**, without waiting for a deploy: open the Appointments
      tab, find its existing appointment (search by the complaint's customer name or contact number —
      appointment search doesn't index by complaint reference), and cancel it from there. That
      immediately clears the conflict and this fix stops it from recurring for every complaint after
      this deploy.
- [ ] Not verified against a live run — needs `npm run db:migrate`-current Postgres and either the new
      integration test or a manual repeat of the original repro (reopen a `Scheduled` complaint, then
      try to schedule it again).

#### Playwright fixes — 2026-09-28: real run of the new Phase 5 spec found 6/51 failing

- [x] 4 were a strict-mode locator collision in the new spec itself: `getByRole('button', { name:
'Quotations' })` (and Inspections/Warranty approvals/Dashboard) matched both the sidebar nav
      button and that workspace's hidden "Refresh X" button, since "Refresh quotations" contains
      "quotations" and Playwright's default name matching isn't exact. Added `exact: true` to all four,
      matching the convention already used elsewhere (e.g. `'Appointments'`).
- [x] The job-card print test (and, transitively, the quotation/inspection print assertions once the
      locator fix let them run) asserted `popup.getByText(...).toBeVisible()`, which timed out even
      though the print popup opened. Switched to polling `popup.content()` for the reference string
      after waiting for the popup's load state — checks the DOM/HTML directly rather than depending on
      visibility/layout timing in a freshly opened window, which is the more likely thing to be flaky
      about a `window.open('', ...)` popup, not the app's print code itself.
- [x] `npm run typecheck` and `prettier` pass; `playwright test --list` still resolves 51/5.
- [ ] **Not yet re-run** — please run `npm run test:e2e` again (`E2E_BASE_URL=http://localhost:3100`) to
      confirm all 51 are green now, especially the print-popup fix, which is a best-effort guess at the
      failure mode rather than a confirmed root cause.

#### Bug fix — 2026-09-28: the Print button never actually printed in any real browser

The best-effort print-popup fix above wasn't enough — the real re-run showed `popup.content()` polling
against a completely empty `<html><head></head><body></body></html>` on all 3 print tests, which is a
much more specific and useful signal than the earlier timeout.

- [x] Root cause: `openPrintWindow()` in `apps/web/src/app.js` called
      `window.open('', '_blank', 'noopener')`. Modern Chromium returns `null` from `window.open()`
      whenever the `noopener` window feature is set, even though the tab still physically opens — so
      `printWindow` was always `null`, and the function's own `if (!printWindow)` guard was silently
      firing every single time, before `document.write(html)` ever ran. This has been true for every
      real user of the Print button since it was added (Phase 5 checkpoint "print views and
      legacy-reference field"), not just under test — manual verification of Print was still an open
      "needs you" item in that checkpoint, so nobody had caught it yet.
- [x] Fix: dropped `noopener` from the `window.open()` call. It was never doing anything useful here —
      `noopener` protects against an untrusted third-party page reaching back into the opener via
      `window.opener`; this window only ever receives same-origin, app-generated HTML, so there's
      nothing for it to protect against, and it was the only thing breaking the return reference the
      function needs to actually write content into the window.
- [x] `npm run typecheck`, `npm run build`, `node --check apps/web/src/app.js`, and `prettier` all pass.
- [ ] **Not yet verified against a live run.** Please re-run `npm run test:e2e` once more — this should
      be the real fix (confirmed by the exact symptom matching: an untouched blank document is exactly
      what `window.open()` returning `null` plus a swallowed early-return would produce), and also try
      Print by hand once on a job card, quotation, and inspection per the original Phase 5 checkpoint's
      manual-verification item, since this was never actually confirmed working end to end before now.

### Phase 6: Commercial and pricing features

- [ ] Define the approved pricing and quotation contracts.
- [ ] Add commercial, warranty, extended-warranty, delivery, installation, and service-charge workflows where approved.
- [ ] Add pricing and workbook-related screens only after the operational workflow is stable.
- [ ] Add calculations and integration tests using controlled test fixtures.

### Phase 7: Historical migration and reconciliation

- [x] Define the approved historical data scope and ownership. (Technicians, appointments, job cards, quotations, inspections, Thomson proposals from the live "Jackys Distribution" sheet; AMC, VAS, complaints, B2B, users, logs and config tabs are out of scope.)
- [x] Prepare a documented import and reconciliation process. (`npm run import:sheets`, `npm run db:clear-test-data`, `docs/migration/GOOGLE_SHEET_MIGRATION.md`; modification #77.)
- [x] Validate source data quality, duplicates, identifiers, dates, and status mappings. (Profiled the real export; every fix is listed in the importer's issues report.)
- [ ] Import only approved data into a controlled staging environment first.
- [ ] Reconcile counts and key records with the Apps Script source.
- [ ] Run the real import: only after end-to-end testing is finished and test entries are cleared (parked by the owner on 2026-10-08).

### Phase 8: Security, staging, and production readiness

- [ ] Replace or formally approve the local-development authentication approach for staging and production.
- [ ] Evaluate Supabase Auth or another approved production identity provider; production Supabase Auth is not started.
- [ ] Configure production secrets outside the repository.
- [ ] Keep OpenAPI and Swagger documentation fail-closed in production.
- [ ] Add rate limiting, monitoring, backups, alerting, recovery procedures, and security review.
- [ ] Run staging acceptance tests with non-production data.
- [ ] Complete dependency, access-control, and infrastructure review.
- [ ] Keep production deployment not started until readiness approval.

### Phase 9: Acceptance, cutover, and rollback

- [ ] Obtain business and service-team acceptance for the completed workflows.
- [ ] Define the cutover date, owners, communication plan, and support process.
- [ ] Document rollback criteria and the tested rollback procedure.
- [ ] Run a controlled production migration only after formal approval.
- [ ] Preserve Google Apps Script as the rollback path until the new system is proven stable.
- [ ] Cut over customer and staff links only after acceptance and release approval.
- [ ] Mark the Apps Script system read-only or retire it only after the approved transition plan is complete.

## Explicitly not started

- [ ] Historical customer-data import.
- [ ] Production Supabase authentication.
- [ ] Production deployment.
- [ ] Production cutover.
- [ ] Changes to the live Apps Script deployment or redirect destinations.

## Recommended next review and testing order

1. Read `testing_guide.md` and confirm that Docker Desktop, Node.js, and npm are available.
2. Start the local PostgreSQL container and run `npm run db:migrate`.
3. Start the backend with `npm run dev`.
4. Open `http://localhost:3000/portal/` and test the public complaint form with fake local data.
5. Test the local first-time staff setup, sign-in, complaint inbox, complaint detail, and sign-out flow.
6. Run `npm test -- --test-concurrency=1`.
7. Run `npm run test:e2e` while the backend is running.
8. Run `npm run typecheck`, `npm run build`, and `npm run format:check`.
9. Review the changed files and local commit before pushing anything to GitHub.
10. After the first web slice is accepted, prioritize complaint notes/status controls, then appointments and technician assignment.

## Migration guardrails

- Google Apps Script remains production and rollback/read-only infrastructure until formal cutover approval.
- Do not alter `/complaints/` or `/portal/` production redirect destinations as part of local migration work.
- Do not import live customer data into local development.
- Do not commit passwords, API keys, bootstrap tokens, `.env` files, customer exports, deployment URLs, Drive IDs, Supabase service-role keys, or other secrets.
- Do not push or deploy this local migration project without reviewing the environment, authentication, data, and rollback implications.

#### Investigation — 2026-09-29: CMP-260928-004 "already has an active appointment" false alarm

While manually testing, scheduling a brand-new complaint (CMP-260928-004, status "Ready for
Scheduling", zero appointment rows in the DB) failed with "The complaint already has an active
appointment." This looked like a second instance of the stale-appointment bug fixed above, but it
wasn't.

- [x] Read-only diagnostic script queried the live DB directly (`complaints`, `appointments`,
      `complaint_status_history`) for both CMP-260928-002 and CMP-260928-004: no active appointment
      existed anywhere for either complaint, and only one appointment ever existed in the whole
      database (`APT-2026-00001`, tied to the already-`Closed` CMP-260928-001).
- [x] Since the client always displays the server's own `error.message` verbatim (never a hardcoded
      string), the error had to be coming from the live server process, not from stale front-end JS.
- [x] Root cause: the running `npm run dev` process was stale/holding old state (most likely started in
      a terminal session or against a DB connection from before the test complaints were reset) --
      **not a code bug.** A full stop + fresh terminal + `npm run dev` restart resolved it immediately;
      scheduling CMP-260928-004 then worked.
- [x] No code change needed. Lesson for future manual testing sessions: if a scheduling/appointment
      error looks inconsistent with what a direct DB check shows, restart the dev server from a clean
      terminal before assuming it's a data or logic bug.
