// One-off corrections agreed with the business for specific sheet records.
// Keyed by the record's reference. Remove an entry once the sheet itself is fixed.

/** Appointment contact numbers, kept exactly as written here. */
export const PHONE_OVERRIDES: Record<string, string> = {
  'APT-2026-00016': '+971551235678',
};

/** Job card grand totals (AED). */
export const GRAND_TOTAL_OVERRIDES: Record<string, number> = {
  'JC-039': 0,
};
