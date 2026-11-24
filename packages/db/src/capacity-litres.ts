/**
 * Fridge capacity (litres) read from the ERP Item Listing (modification #303).
 *
 * Pure text logic, no database: the stock-master upload and the "Recalculate"
 * button call `deriveCapacity` for fridge and freezer items, and the new
 * D+I fridge pricing (400 L and under / over 400 L) reads the stored value.
 */

/** A fridge over this many litres is priced as "over 400 L". */
export const FRIDGE_LARGE_THRESHOLD_LITRES = 400;
/** Used when an item description carries no litres. */
export const DEFAULT_CAPACITY_LITRES = 400;
const LITRES_PER_CUBIC_FOOT = 28.3168;
const MIN_TRUSTED_LITRES = 20;
const MAX_TRUSTED_LITRES = 1500;

export type CapacitySource =
  /** one litre figure written in the description */
  | 'description'
  /** gross and net both written: the gross figure is used */
  | 'gross'
  /** only cubic feet written, converted */
  | 'cft'
  /** read from a sub group name such as "FRIDGE 501-950LTRS." */
  | 'range'
  /** nothing found: 400 */
  | 'default'
  /** typed by an admin; uploads keep it */
  | 'manual'
  /** a figure was found but is below 20 L or above 1,500 L: kept, flagged for review */
  | 'check';

export const CAPACITY_SOURCES: CapacitySource[] = [
  'description',
  'gross',
  'cft',
  'range',
  'default',
  'manual',
  'check',
];

export type Capacity = { litres: number; source: CapacitySource };

/** Items the capacity is worked out for (ERP group names). */
export function isCapacityGroup(groupName: string | null | undefined): boolean {
  const group = (groupName ?? '').trim().toUpperCase();
  return group === 'FRIDGE' || group === 'FREEZER';
}

const LITRE_TOKEN = /(\d+(?:[.,]\d+)?)\s*(?:LITRES|LITERS|LITRE|LITER|LTRS|LTR|LTS|LT|L)\b/gi;
const CFT_TOKEN = /(\d+(?:\.\d+)?)\s*(?:CFT|CU\.?\s*FT|CUBIC\s*FE+T)\b/i;
const RANGE_IN_SUBGROUP = /(\d{2,4})\s*-\s*(\d{2,4})\s*(?:LTRS?|LITRES?|L)\b/i;

type Label = 'gross' | 'net' | null;

/** "GROSS 546LTR" / "NET CAP: 183L" label the number after them; "454 L GROSS" labels
 *  the number before it. A label after a comma ("263L, NET CAPACITY 202L") belongs to the next number. */
function labelFor(text: string, start: number, end: number): Label {
  const before = text.slice(Math.max(0, start - 18), start);
  const beforeMatch = /(GROSS|NET)\s*(?:CAP(?:ACITY)?\.?)?\s*[:=-]?\s*$/i.exec(before);
  if (beforeMatch) return beforeMatch[1].toUpperCase() === 'GROSS' ? 'gross' : 'net';
  const after = text.slice(end, end + 12);
  const afterMatch = /^\s*(GROSS|NET)\b/i.exec(after);
  if (afterMatch) return afterMatch[1].toUpperCase() === 'GROSS' ? 'gross' : 'net';
  return null;
}

function toNumber(value: string): number {
  return Number(value.replace(',', '.'));
}

/** The capacity for one stock item: litres and where the number came from. */
export function deriveCapacity(input: {
  itemDesc: string | null | undefined;
  subGroup?: string | null;
}): Capacity {
  const desc = (input.itemDesc ?? '').replace(/ /g, ' ');
  const found: { value: number; label: Label }[] = [];
  for (const match of desc.matchAll(LITRE_TOKEN)) {
    const value = toNumber(match[1]);
    if (!Number.isFinite(value) || value <= 0) continue;
    const start = match.index ?? 0;
    found.push({ value, label: labelFor(desc, start, start + match[0].length) });
  }
  if (found.length > 0) {
    const best = (label: Label) => {
      const values = found.filter((item) => item.label === label).map((item) => item.value);
      return values.length ? Math.max(...values) : null;
    };
    const gross = best('gross');
    const plain = best(null);
    const net = best('net');
    const hasNet = net !== null;
    let litres: number;
    let source: CapacitySource = 'description';
    if (gross !== null) {
      litres = gross;
      if (hasNet) source = 'gross';
    } else if (plain !== null) {
      litres = plain;
    } else {
      litres = net as number;
    }
    if (litres < MIN_TRUSTED_LITRES || litres > MAX_TRUSTED_LITRES) source = 'check';
    return { litres, source };
  }
  const cft = CFT_TOKEN.exec(desc);
  if (cft) {
    const litres = Math.round(Number(cft[1]) * LITRES_PER_CUBIC_FOOT);
    if (litres > 0) {
      return {
        litres,
        source: litres < MIN_TRUSTED_LITRES || litres > MAX_TRUSTED_LITRES ? 'check' : 'cft',
      };
    }
  }
  const range = RANGE_IN_SUBGROUP.exec(input.subGroup ?? '');
  if (range) {
    return { litres: Math.min(Number(range[1]), Number(range[2])), source: 'range' };
  }
  return { litres: DEFAULT_CAPACITY_LITRES, source: 'default' };
}

/** True when the fridge is priced as "over 400 L". */
export function isLargeFridge(litres: number | null | undefined): boolean {
  const value = Number(litres);
  return Number.isFinite(value) && value > FRIDGE_LARGE_THRESHOLD_LITRES;
}
