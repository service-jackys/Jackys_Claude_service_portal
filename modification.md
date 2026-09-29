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

### What changed

1. New `b2b_branches` master table, seeded from the sales invoice export you attached (last 365
   days: `Cust_Code`, `Customer`, `Salesman`, `Inv/Del No`) — 567 unique branches, deduplicated by
   `Cust_Code` using each branch's most recent invoice for its name/salesman/last sales order
   number.
   - Seed data: `packages/db/seed/b2b_branches.json`
   - Import script (re-runnable, upserts by `Cust_Code`): `scripts/import-b2b-branches.mjs`
2. The public form's "B2B Branch / School" field is now an autocomplete against that master
   list, backed by a new public `GET /api/public/b2b-branches` endpoint (branch name + Cust_Code
   only — salesman is never sent to the public form). If the customer picks a recognized branch,
   its Cust_Code is stored on the complaint (`b2b_branch_cust_code`); free text that doesn't match
   anything is still accepted as before, left blank for staff to identify and link later.
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

### Known follow-up (tracked, not started — will be its own modification)

- Surfacing a linked branch's **Salesman** in the staff Appointment and Service Job Card views
  (you asked for this explicitly — needs the branch link carried from complaint → appointment →
  job card, and a place in those screens to show it).
- `appointments.b2b_branch_cust_code` carry-forward from the complaint when an appointment is
  created isn't wired yet (only the complaint stores the link so far).
