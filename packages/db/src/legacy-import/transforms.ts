// Pure value transforms for the Google Sheet import. No database access, so
// every rule can be unit tested. Each transform returns the cleaned value and,
// when it had to guess or drop something, a note the importer turns into a
// row-level warning. Nothing here throws on bad data.

export type Note = { level: 'info' | 'warn'; message: string };
export type Cleaned<T> = { value: T; notes: Note[] };

const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;

export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    const t = value.trim();
    return t === '' || t === 'None' || t === 'null' || t === 'undefined';
  }
  return false;
}

export function text(value: unknown, max?: number): string | null {
  if (isBlank(value)) return null;
  let t = String(value).replace(/\r\n/g, '\n').trim();
  if (max && t.length > max) t = t.slice(0, max);
  return t;
}

const pad = (n: number) => String(n).padStart(2, '0');

// A calendar date with no time. ExcelJS hands back dates as UTC midnight of the
// cell's face value, so the UTC parts are the date the user sees in the sheet.
export function toDate(value: unknown): string | null {
  if (isBlank(value)) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  const s = String(value).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s);
  if (m) return validDate(+m[3], +m[2], +m[1]); // dd/MM/yyyy
  return null;
}

function validDate(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d)
    return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

// A moment in time. The sheet stores wall-clock Dubai time with no zone, so the
// face value is read as UTC+4 and converted to a real instant.
export function toTimestamp(value: unknown): Date | null {
  if (isBlank(value)) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getTime() - DUBAI_OFFSET_MS);
  }
  const s = String(value).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (m) return wall(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (m) return wall(+m[3], +m[2], +m[1], +m[4], +m[5], +(m[6] ?? 0));
  const dateOnly = toDate(s);
  return dateOnly
    ? wall(+dateOnly.slice(0, 4), +dateOnly.slice(5, 7), +dateOnly.slice(8, 10), 0, 0, 0)
    : null;
}

function wall(y: number, mo: number, d: number, h: number, mi: number, s: number): Date | null {
  if (!validDate(y, mo, d)) return null;
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s) - DUBAI_OFFSET_MS);
}

// Calendar date (in Dubai) of an instant, used when a date column is blank and
// the row timestamp is the fallback.
export function dubaiDate(instant: Date): string {
  const d = new Date(instant.getTime() + DUBAI_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// "AED 1,234.50", "50.3%", 12, "" -> number | null
export function toMoney(value: unknown): number | null {
  if (isBlank(value)) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value)
    .replace(/aed/gi, '')
    .replace(/[,%\s]/g, '');
  if (cleaned === '' || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

export function toNumber(value: unknown): number | null {
  return toMoney(value);
}

/** Stand-in for a missing or unusable phone number (agreed with the business). */
export const PHONE_PLACEHOLDER = '+971501234568';

// UAE phone numbers. Sheets drop the leading 0, mix separators and sometimes
// hold two numbers in one cell. Returns every number found in a standard local
// form, joined with " / ". Numbers it cannot place are kept and flagged.
export function normalisePhone(value: unknown): Cleaned<string | null> {
  const notes: Note[] = [];
  if (isBlank(value)) return { value: null, notes };
  const raw = String(value).trim();
  const parts = raw
    .split(/\s*(?:\/|,|;|\n|\bor\b|&)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  const junk: string[] = [];
  for (const part of parts) {
    let digits = part.replace(/\D/g, '');
    if (digits.startsWith('00971')) digits = digits.slice(5);
    else if (digits.startsWith('971') && digits.length >= 11) digits = digits.slice(3);
    else if (digits.startsWith('0')) digits = digits.slice(1);
    // After stripping any country code or trunk 0, UAE numbers are 8 or 9 digits.
    if (digits.length === 9 && /^5/.test(digits)) out.push(`0${digits}`);
    else if (digits.length === 8 && /^[2-9]/.test(digits)) {
      // UAE landline: one area digit (2-4, 6, 7, 9) plus seven digits, missing its 0.
      out.push(`0${digits}`);
    } else if (digits.length === 9 && /^[2-4679]/.test(digits)) {
      out.push(`0${digits}`);
    } else {
      // Not a usable UAE number (foreign, too short, or no digits): drop it.
      junk.push(part);
    }
  }
  const unique = [...new Set(out)];
  if (unique.length === 0) {
    notes.push({
      level: 'warn',
      message: `Phone "${junk.join(' / ') || raw}" is not a usable number; replaced with ${PHONE_PLACEHOLDER}.`,
    });
    return { value: PHONE_PLACEHOLDER, notes };
  }
  if (junk.length)
    notes.push({
      level: 'warn',
      message: `Phone part "${junk.join(' / ')}" is not a usable number; dropped.`,
    });
  return { value: unique.join(' / ').slice(0, 50), notes };
}

export function mapWarranty(value: unknown): Cleaned<'In Warranty' | 'Out Warranty' | null> {
  if (isBlank(value)) return { value: null, notes: [] };
  const s = String(value).trim().toLowerCase();
  if (/^(under|in)\s*warranty$|^yes$/.test(s)) return { value: 'In Warranty', notes: [] };
  if (/^(out(\s*of)?|no)\s*warranty$|^no$|^out of warranty$/.test(s))
    return { value: 'Out Warranty', notes: [] };
  return { value: null, notes: [{ level: 'warn', message: `Unknown warranty value "${value}".` }] };
}

// Invoice numbers typed into the sheet include placeholders and delivery notes.
// A real invoice reference has digits and is not one of the known non-invoices.
const NOT_AN_INVOICE = /^(na|n\/a|nil|none|oow|amc|warranty|foc|-+)$|^c\/o\b|^dn\b|^do\b/i;
export function cleanInvoiceNo(value: unknown): Cleaned<string | null> {
  const t = text(value, 120);
  if (!t) return { value: null, notes: [] };
  if (NOT_AN_INVOICE.test(t) || !/\d{3,}/.test(t)) {
    return {
      value: null,
      notes: [
        {
          level: 'warn',
          message: `Legacy invoice text "${t}" is not an invoice number; left blank.`,
        },
      ],
    };
  }
  return { value: t, notes: [] };
}

// Alias spellings that must resolve to one technician.
export function technicianKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (_, a: string, b: string) => `${a}${b.toUpperCase()}`);
}

export function cleanBrand(value: unknown): Cleaned<string | null> {
  const t = text(value, 120);
  if (!t) return { value: null, notes: [] };
  const upper = t.toUpperCase();
  if (upper === 'DEFAULT') {
    return {
      value: null,
      notes: [{ level: 'warn', message: 'Brand "DEFAULT" is a placeholder; left blank.' }],
    };
  }
  return { value: upper, notes: [] };
}

// "Model: VW550, Desc: VENUS FRIDGE" style summary columns are ignored; the
// DataJSON array is the source. Product rows carry model/serial/warranty; the
// portal stores products as { partNo, description, qty, unitPrice }.
export function productRow(p: Record<string, unknown>): {
  partNo: string;
  description: string;
  qty: number;
  unitPrice: number;
} {
  const model = text(p.model, 120) ?? '';
  const desc = text(p.desc ?? p.description, 300) ?? '';
  const serial = text(p.serial, 80);
  const description = serial ? `${desc}${desc ? ' ' : ''}(S/N ${serial})`.slice(0, 300) : desc;
  return { partNo: model, description, qty: 1, unitPrice: 0 };
}

export function partRow(p: Record<string, unknown>): {
  partNo: string;
  description: string;
  qty: number;
  unitPrice: number;
} {
  return {
    partNo: text(p.partNo ?? p.part_no, 120) ?? '',
    description: text(p.description ?? p.desc, 300) ?? '',
    qty: Math.max(0, toNumber(p.qty) ?? 0),
    unitPrice: Math.max(0, toNumber(p.unitPrice ?? p.price) ?? 0),
  };
}

export type QuotationUnitRow = {
  unitKey: string;
  partNo: string;
  description: string;
  brand: string;
  serialNo: string;
  warranty: string;
  location: string;
  complaint: string;
  diagnosis: string;
  qty: number;
  unitPrice: number;
};
export type QuotationChargeRow = {
  unitKey: string;
  type: 'Part' | 'Labour' | 'Service' | 'Other';
  partNo: string;
  description: string;
  qty: number;
  unitPrice: number;
};

/** One appliance of an old quotation. The old "Sub Group" box held the complaint and the villa /
 *  address typed together, so it is kept word for word as the complaint; location is left for
 *  the user to split. Brand, serial and warranty are kept as typed. */
export function quotationUnitRow(p: Record<string, unknown>, index: number): QuotationUnitRow {
  return {
    unitKey: `u${index + 1}`,
    partNo: text(p.itemCode ?? p.model ?? p.partNo, 120) ?? '',
    description: text(p.description ?? p.desc, 300) ?? '',
    brand: text(p.brand, 120) ?? '',
    serialNo: text(p.serial, 80) ?? '',
    warranty: text(p.warranty, 20) ?? '',
    location: '',
    complaint: text(p.subGroup, 2000) ?? '',
    diagnosis: '',
    qty: 1,
    unitPrice: 0,
  };
}

export function quotationChargeRow(p: Record<string, unknown>): QuotationChargeRow {
  return {
    unitKey: '',
    type: 'Part',
    partNo: text(p.partNo ?? p.part_no, 120) ?? '',
    description: text(p.description ?? p.desc, 300) ?? '',
    qty: Math.max(0, toNumber(p.qty) ?? 0),
    unitPrice: Math.max(0, toNumber(p.unitPrice ?? p.price) ?? 0),
  };
}

const normalise = (v: string) =>
  v
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
function longestCommon(a: string, b: string): number {
  let best = 0;
  const row = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = a[i - 1] === b[j - 1] ? prev + 1 : 0;
      if (row[j] > best) best = row[j];
      prev = tmp;
    }
  }
  return best;
}

/** Links each charge line to its unit.
 *  1. By text: the line repeats the unit's complaint / address / name (12+ characters in common,
 *     no tie).
 *  2. By order: the old portal listed units and charges row for row. When the lines still free
 *     and the units still without a line are the same number, they are paired in order, but only
 *     if every pair is confirmed by the unit's model code appearing in the line (or there is
 *     just one of each).
 *  A line that is still unclear stays on the whole quotation. */
export function linkChargesToUnits(
  units: QuotationUnitRow[],
  charges: QuotationChargeRow[],
): { unlinked: number; byOrder: number } {
  for (const charge of charges) {
    const c = normalise(charge.description);
    let best = 0;
    let bestUnit: string | null = null;
    let tie = false;
    for (const unit of units) {
      const score = longestCommon(
        c,
        normalise(unit.complaint || unit.location || unit.description),
      );
      if (score > best) {
        best = score;
        bestUnit = unit.unitKey;
        tie = false;
      } else if (score === best && score > 0) tie = true;
    }
    if (bestUnit && best >= 12 && !tie) charge.unitKey = bestUnit;
  }
  let byOrder = 0;
  const freeCharges = charges.filter((c) => !c.unitKey);
  const freeUnits = units.filter((u) => !charges.some((c) => c.unitKey === u.unitKey));
  if (freeCharges.length > 0 && freeCharges.length === freeUnits.length) {
    const confirmed =
      freeUnits.length === 1 ||
      freeCharges.every((c, i) => {
        const code = normalise(freeUnits[i].partNo);
        return code.length >= 3 && normalise(c.description).includes(code);
      });
    if (confirmed) {
      freeCharges.forEach((c, i) => {
        c.unitKey = freeUnits[i].unitKey;
      });
      byOrder = freeCharges.length;
    }
  }
  return { unlinked: charges.filter((c) => !c.unitKey).length, byOrder };
}
