// Daily trip cap note for the job entry Live price (display only).
//
// Billing, Budget vs actual and the dashboard cap transport per salesperson per service date:
// only the highest `maxTrips` trips of the day are charged (ties: lower ERP delivery note first).
// Job entry prices one note at a time, so it cannot apply the cap. This works out where the note
// being typed would rank among the salesperson's COMPLETED notes of that day, so the screen can warn.
// The Live price figure itself is not changed.

export interface TripRules {
  dailyCap: boolean;
  deliveryOnlyCap: boolean;
  mixedInvoiceTransport: boolean;
  maxTrips: number;
}

export interface TripPricedLine {
  type: 'CSIDI' | 'CSIDO' | 'CSIII';
  qty: number;
  transport: number;
  charge: number;
}

export interface OtherTrip {
  reference: string;
  deliveryNoteRef: string | null;
  charge: number;
}

export interface TripNote {
  /** This note's position among the day's capped trips (1 = highest charge). */
  rank: number;
  /** Capped trips that day including this note. */
  trips: number;
  maxTrips: number;
  /** The transport this note would add before the cap. */
  charge: number;
  /** True when this note's transport is within the cap. */
  charged: boolean;
  /** Other notes of that day that the cap leaves uncharged once this note is counted. */
  pushedOut: OtherTrip[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The transport (or delivery-only charge) this note brings as a trip, and whether the cap applies to it. */
export function tripOfNote(
  lines: TripPricedLine[],
  rules: TripRules,
): { charge: number; capped: boolean } {
  const csidiQty = lines.filter((l) => l.type === 'CSIDI').reduce((s, l) => s + l.qty, 0);
  const csidiTransport = lines
    .filter((l) => l.type === 'CSIDI')
    .reduce((s, l) => s + (l.transport || 0), 0);
  const csidoCharge = lines
    .filter((l) => l.type === 'CSIDO')
    .reduce((s, l) => s + (l.charge || 0), 0);
  const carrierIsCsido = csidiTransport <= 0 && csidoCharge > 0;
  const kind: 'installation' | 'delivery' | null =
    csidiTransport > 0 || (csidiQty > 0 && csidoCharge > 0)
      ? 'installation'
      : csidoCharge > 0
        ? 'delivery'
        : null;
  if (!kind) return { charge: 0, capped: false };
  let charge = csidiTransport > 0 ? csidiTransport : csidoCharge;
  // Mixed-invoice transport OFF: one installed unit plus delivery-only items pays nothing extra.
  if (kind === 'installation' && carrierIsCsido && csidiQty <= 1 && !rules.mixedInvoiceTransport)
    charge = 0;
  const capped =
    rules.dailyCap &&
    charge > 0 &&
    (kind === 'installation' || (kind === 'delivery' && rules.deliveryOnlyCap));
  return { charge: round2(charge), capped };
}

/** Same tie-break as the database view: numeric ERP delivery notes compare as numbers. */
function noteKey(ref: string | null): string {
  const text = (ref ?? '').trim();
  return /^[0-9]+$/.test(text) ? text.padStart(30, '0') : text.toLowerCase();
}

/**
 * Where this note ranks among the salesperson's completed capped trips of the day.
 * Returns null when there is nothing to tell: cap off, no trip, or the note is still well within the limit.
 */
export function buildTripNote(
  mine: { charge: number; capped: boolean; deliveryNoteRef: string | null },
  others: OtherTrip[],
  maxTrips: number,
): TripNote | null {
  if (!mine.capped) return null;
  const myKey = noteKey(mine.deliveryNoteRef);
  const order = (a: { charge: number; key: string }, b: { charge: number; key: string }) =>
    b.charge - a.charge || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const all = [
    ...others.map((o) => ({ charge: o.charge, key: noteKey(o.deliveryNoteRef), other: o })),
    // A new note with an equal charge and equal key goes last, as the later job id would.
    { charge: mine.charge, key: myKey, other: null as OtherTrip | null },
  ];
  const mineEntry = all[all.length - 1]!;
  const sorted = [...all].sort((a, b) => {
    const result = order(a, b);
    if (result !== 0) return result;
    return a === mineEntry ? 1 : b === mineEntry ? -1 : 0;
  });
  const rank = sorted.indexOf(mineEntry) + 1;
  const pushedOut = sorted
    .slice(maxTrips)
    .filter((entry) => entry.other)
    .map((entry) => entry.other!);
  const charged = rank <= maxTrips;
  // Nothing to say while this is below the last allowed trip and nobody is pushed out.
  if (charged && rank < maxTrips && pushedOut.length === 0) return null;
  return {
    rank,
    trips: sorted.length,
    maxTrips,
    charge: mine.charge,
    charged,
    pushedOut,
  };
}
