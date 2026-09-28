# Phase 0-4 Field & Logic Parity Review

**Date:** 2026-09-28
**Reviewed against (live production, as of today):**

- `code.gs` (sep_26_code.gs.txt) — Apps Script backend
- `Index.html` (index_sep_26_new.html) — Scheduler/Job Card/Admin frontend
- `ComplaintRegistration_26.html` — new standalone public complaint intake form

**New project code reviewed:** `packages/db/migrations/001-003`, `packages/contracts/src/index.ts`,
`apps/api/src/{complaints,appointments,branches,customers,schedules,technicians}`, `apps/web/src/{index.html,app.js}`.

Scope: everything through Phase 4 (foundation, persistence, complaint workflow, scheduling, first web
journeys). Phase 5 job-card backend is out of scope here — it's already known/tracked as incomplete.

## Why this review

The live system added a **standalone Customer Complaint Registration form** and a full B2B branch/school
workflow (auto-fill from a branch master, always-editable fallback) after the new project's Phase 1-2 data
model was designed. This review checks whether that workflow made it into the migration, field by field.

## Confirmed gaps (must close before Phase 5 continues)

### 1. Five B2B/operational fields are missing end-to-end — not in the DB schema, not in the Zod

contracts, not in the web UI.

Verified absent from `packages/db/migrations/001_initial_schema.sql`, `packages/contracts/src/index.ts`,
`apps/web/src/index.html`, and `apps/web/src/app.js` (grepped for `b2bBranch`, `schoolContact`, exact zero
matches outside one unrelated `customerNumber` field on the branch-master admin form):

| Live field (Schedules/Complaints sheet) | Used for                                                | New project                                                                                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `B2B Branch / School`                   | Which school/branch site the job is at                  | Missing from `complaints`/`appointments` tables and both Zod schemas                                                                                                                                         |
| `School Contact Person`                 | Site-level contact, separate from account holder        | Missing everywhere                                                                                                                                                                                           |
| `School Contact Number`                 | Site-level phone, separate from account holder's        | Missing everywhere                                                                                                                                                                                           |
| `Customer Number`                       | Account/loyalty number used for warranty & AMC lookups  | Exists only on the branch-master admin form (`branchWriteSchema.customerNumber`); never captured on a complaint or an appointment                                                                            |
| `Sales Order No`                        | Ties a job to a sales order for VAS/warranty validation | Column exists on `complaints`/`appointments` tables, but **no Zod schema accepts it at intake** (`publicComplaintSchema` doesn't have it) and **no web UI field exists** to enter it even at scheduling time |

**Impact:** a B2B or school customer using the new public complaint form, or a CCE scheduling their job
in the new web UI, has no way to record which branch/site the job is for, who the on-site contact is, or
their account number — the exact three-field auto-fill workflow already live in the Scheduler today.

**Recommended fix:** add `branchId` (preferred — reuse the already-existing `branches` table via FK,
matching how `appointmentCreateSchema` already accepts an optional `branchId`) plus free-text fallback
fields for walk-in/unregistered sites, mirroring the live system's "select branch, or type it in manually,
never gated" rule. Surface `salesOrderNumber` as an actual input in both the public form and the staff
scheduling screen — the backend already has the column, it's just not reachable.

### 2. `Sub Group` (item/product category) is missing entirely

Live `Schedules` sheet carries `Sub Group` (populated from the Stock Master) alongside `Item Code`, used
for product-category-level reporting. Not present in the new `appointments` table, contracts, or UI at
all. Low urgency compared to #1, but worth a column now while the schema is still open, since it's an
append-only migration pattern in both codebases (least painful time to add a column is before real rows
exist).

### 3. Customer-type enum dropped a tier: `B2B-SalesChannel`

Live: `B2C / B2B / B2B-SalesChannel` (three types; the Revenue Dashboard's CSIII job-type reporting reads
this third value directly).
New: `individual / company / b2b` (three types, but no sales-channel distinction).

**Impact:** if source data or reporting logic ever needs to distinguish a Sales Channel job from a direct
B2B job (they have different margin/commission treatment in the live Revenue Dashboard), this mapping is
lossy in both directions — there's nowhere to put the value today, and no `'company'` equivalent exists
in the live system either, so the meaning of `'company'` in the new enum is itself undefined against the
live source of truth. Recommend replacing `individual/company/b2b` with the live three values verbatim
(`B2C/B2B/B2B-SalesChannel`) rather than inventing a new taxonomy — this is a reporting-critical enum, not
a cosmetic one.

### 4. `region` is free text in the new public form; it's a fixed list live

Live: `<select>` with exactly 8 UAE emirates (Dubai, Sharjah, Ajman, Ras Al Khaimah, Fujairah, Umm Al
Quwain, Abu Dhabi, Al Ain).
New: plain `<input id="region">` — any string.

**Impact:** free text will fragment region-based reporting ("Dubai" / "dubai" / "DXB" all become different
buckets) the moment real customers start typing it. This is a one-line UI fix (swap the input for a select
with the same 8 values) and is worth doing before any real submissions happen, since cleaning up free-text
region data after the fact is much more expensive than preventing it.

## What's already solid or improved (no action needed)

- Complaint status set (`New → Under Review → Pending Information → Ready for Scheduling → Scheduled →
Closed/Cancelled`) is carried over exactly, including the same transition graph.
- Appointment status set (`Scheduled / In Progress / Completed / Cancelled`) matches exactly.
- Complaint → appointment linkage, one-active-appointment-per-complaint constraint, and status/audit
  history are all _more_ rigorous than the live sheet-scan-and-lock approach.
- Technician availability is modeled per-weekday (`technician_availability`: weekday + start + end), which
  is strictly more capable than the live system's single daily shift window applied every day — a genuine
  improvement worth keeping.
- The B2B branch master itself (`branches` table: name, contact person, contact number, customer number,
  region) already has the right shape to support gap #1 — the missing piece is wiring it into the
  complaint/appointment intake, not redesigning the table.
- Draft scheduling (idempotent promotion) is a solid, more robust replacement for the live "AwaitingSchedules"
  placeholder sheet.

## Recommended order of work before Phase 5 continues

1. Add `branch_id` (FK) + fallback free-text branch/site fields to `complaints` and `appointments`, and
   accept them in `publicComplaintSchema` / `appointmentCreateSchema`.
2. Add `salesOrderNumber` as an actual input on both the public form and the staff scheduling screen.
3. Replace the `customerType` enum values with the live system's three values (`B2C/B2B/B2B-SalesChannel`).
4. Replace the free-text `region` input with the fixed 8-emirate select on the public form.
5. Add `sub_group` column + field, populated the same way the live Scheduler does (from the Stock Master
   lookup by Item Code).
6. Re-run Phase 4's Playwright suite after the schema/contract changes (new columns are additive, so
   existing tests shouldn't break, but the new fields need their own coverage).

None of these require touching the live Apps Script system or committed Phase 0-3 work structurally —
they're additive columns and additive form fields on top of what's already built.
