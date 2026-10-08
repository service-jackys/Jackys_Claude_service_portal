# Google Sheet migration runbook

This is the step-by-step for loading the live "Jackys Distribution" Google Sheet into the portal. It is **prepared but parked**: run it only after end-to-end testing is finished and the test entries have been cleared.

Real customer data must only go into **staging or production**, never a developer database. Both tools below refuse to write unless you type the database name.

## What is migrated

| Sheet tab | Goes to | Notes |
|---|---|---|
| Technicians | Technician master | Matched by name. Only missing technicians are created. |
| Schedules | Appointments | Keeps the sheet's `APT-YYYY-NNNNN` number as the portal reference. |
| ServiceJobCards | Service job cards | Gets a new `JBC-` number (or `WJC-` for walk-ins). The old `JC-nnn` is kept as the legacy reference. |
| Quotations | Quotations | New `QO-` number, old number kept as the legacy reference. |
| Inspections | Inspections | New `IR-` number, old number kept as the legacy reference. |
| ThomsonProposals | Thomson sales | New `TH-` number. |

Not migrated, on purpose: Customer_Complaints, B2BCustomers, Users, RoleAccess, ActivityLog, AMCQuotes, AMCContracts, VASSales, AwaitingSchedules and the five `*_Admin` pricing tabs.

## How problems in the sheet are handled

Every fix is written to the issues report. Nothing is changed silently.

| Problem in the sheet | What the importer does |
|---|---|
| Job card JSON in the wrong column | Finds the JSON by content, so the column position does not matter. |
| Two date formats | Reads both. Sheet times are treated as Dubai time. |
| Job card with no date | Uses the date of the sheet's own timestamp and flags it. |
| Phone numbers missing the leading 0, extra spaces, two numbers in one cell | Standardises to local format (`0501234567`), keeps both numbers joined with " / ". Anything it cannot place is kept as typed and flagged. |
| Money typed as text ("AED 325.50") | Converted to numbers. |
| "Under Warranty" / "Out of Warranty" | Mapped to In Warranty / Out Warranty. Billing type is set from it (CSIJW / CSIJO). |
| Technician spelling (SIVA, LATHEEF) | Mapped to the master name (Siva, Latif). |
| Brand spelling (Venus, VENUS) | Upper-cased. The placeholder "DEFAULT" is blanked and flagged. |
| Junk in Invoice No ("NA", "OOW", "AMC", "C/O …", "DN …") | Left blank and flagged, so the job is not treated as invoiced. Real invoice numbers are kept. |
| Completed or cancelled appointment with no close time | Close time is estimated from the appointment date and noted. |
| Job card with a delivery date and a finished status | Imported as Delivered. |
| Job card whose appointment already has another job card | The portal allows one per appointment. The extra card is imported as an unlinked walk-in and flagged as a possible duplicate. Use `--duplicates skip` to leave such cards out instead. |
| Photos and files on job cards | Not copied. The Google Drive links are added to the job card's condition notes. |
| Appointment with no contact number | Contact is set to "N/A" and flagged. |

The old sheet has no payer or bill-to information, so imported job cards have those blank. Accounts fill them in from the Billing page.

## Steps

All commands run from the project folder. On Windows use `npm.cmd` instead of `npm`.

1. **Export the sheet.** In Google Sheets: File, Download, Microsoft Excel (.xlsx). Save it outside the project folder or in `exports/` (both are git-ignored).
2. **Dry run (writes nothing).**
   ```
   npm run import:sheets -- --file "C:\path\Jackys_Distribution.xlsx"
   ```
   It prints a summary and saves `exports/import-report/import-issues.csv` and `import-summary.json`. Open the CSV and review every `error` and `warn` row. Errors must be zero before applying.
3. **See what the test-data cleaner would remove (writes nothing).**
   ```
   npm run db:clear-test-data
   ```
4. **Clear the test entries** (target database only). This removes complaints, appointments, job cards, quotations, inspections, warranty approvals, AMC, VAS, rate card and Thomson sales, customers, audit events and reference counters. It keeps logins, roles, the B2B branch master, salesmen, sales channels, pricing, billing rules, the stock master and the budget and revenue workbook data. Add `--technicians` to also remove the technician master, which the import recreates.
   ```
   npm run db:clear-test-data -- --apply --confirm <database name> --technicians
   ```
   Uploaded photos on disk (`storage/attachments`) are not removed.
5. **Import.** Everything is written in one transaction. If any check fails, nothing is saved.
   ```
   npm run import:sheets -- --file "C:\path\Jackys_Distribution.xlsx" --apply --confirm <database name> --as <admin email>
   ```
6. **Verify.** The import already compares counts and money totals between the sheet and the database and rolls back on a mismatch. You can repeat the check any time:
   ```
   npm run import:sheets -- --file "C:\path\Jackys_Distribution.xlsx" --verify
   ```
7. **Spot-check in the portal.** Open a few job cards, the Billing page, and the Out-of-warranty section on the dashboard.

Running step 5 twice is safe: records already imported are skipped.

## Undo

Before go-live, run step 4 again and repeat step 5. After go-live there is no automatic undo, so take a database backup before step 5.

## After the import

- Imported open job cards (WIP, Spare pending) continue in the portal. Out-of-warranty ones need a payer, invoice and payment before they can be delivered.
- Create portal logins for staff. The sheet's Users tab is not imported.
- Customer records are not created from the sheet. They build up as new work is entered.
