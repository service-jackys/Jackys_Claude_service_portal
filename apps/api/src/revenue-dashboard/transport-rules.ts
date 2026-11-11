// Transport rules (2-trip daily cap), modification #249.
//
// The master workbook carries the rule decided with the Head of Service on 11 Nov 2026 (the "new
// master"): a CSIDI invoice with more than 1 unit pays the regional trip charge (Dubai 60 / Sharjah 90),
// a single-unit CSIDI invoice pays no transport (its standard rate includes it), a mixed CSIDI + CSIDO
// invoice pays one regional charge on its CSIDO line, a delivery-only invoice pays its fee; per
// salesperson per day only the 2 highest installation transport charges are charged, delivery-only
// invoices are outside that cap. The new master keeps the old figures in the CSIDI columns
// "Transport Before Cap" / "Revenue Before Cap". An older master has no such columns: its Transport
// Charge / Proposed Revenue ARE the old figures.
//
// The portal lets an admin switch three toggles for the whole dashboard. This module works out, per
// invoice, the transport the workbook charged ("actual") and the transport under the toggles
// ("scenario"); the difference is applied to the invoice's carrying revenue line.

export interface TransportRules {
  dailyCap: boolean;
  deliveryOnlyCap: boolean;
  mixedInvoiceTransport: boolean;
  maxTrips: number;
}

export const NEW_MASTER_RULES: TransportRules = {
  dailyCap: true,
  deliveryOnlyCap: false,
  mixedInvoiceTransport: true,
  maxTrips: 2,
};

export type RulesPreset = 'new_master' | 'old_master' | 'custom';

/** Which master workbook logic a set of toggles reproduces. */
export function presetOf(r: TransportRules): RulesPreset {
  if (r.dailyCap && !r.deliveryOnlyCap && r.mixedInvoiceTransport && r.maxTrips === 2)
    return 'new_master';
  if (!r.dailyCap && r.mixedInvoiceTransport) return 'old_master';
  return 'custom';
}

export interface SheetRow {
  rowNo: number;
  data: Record<string, unknown>;
}

type Kind = 'installation' | 'delivery' | 'none';
type Carrier = 'CSIDI' | 'CSIDO' | null;

export interface InvoiceTransport {
  invoice: string;
  date: string;
  salesperson: string;
  kind: Kind;
  carrier: Carrier;
  csidiQty: number;
  mixedSingle: boolean;
  unitRevenue: number; // CSIDI unit prices + CSIII (never changed by the rules)
  carrierUnits: number; // unit prices on the carrying CSIDI row (its revenue minus transport); 0 for CSIDO
  charge: number; // trip charge before the cap, under the toggles
  rank: number | null; // rank within the salesperson's day, when the trip is subject to the cap
  charged: boolean;
  actual: number; // transport / delivery fee the workbook charged on the carrying line(s)
  scenario: number; // transport / delivery fee under the toggles
  delta: number; // scenario - actual, applied to the carrying line
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const money = (v: number) => Math.round(v * 100) / 100;

function before(data: Record<string, unknown>, newMaster: boolean) {
  return {
    transport: num(newMaster ? data['Transport Before Cap'] : data['Transport Charge']),
    revenue: num(newMaster ? data['Revenue Before Cap'] : data['Proposed Revenue']),
  };
}

function invoiceBefore(a: string | number, b: string | number) {
  if (typeof a === 'number' && typeof b === 'number') return a < b;
  return String(a).toLowerCase() < String(b).toLowerCase();
}

export function computeTransport(rows: SheetRow[], rules: TransportRules) {
  const ordered = [...rows].sort((a, b) => a.rowNo - b.rowNo);
  const workbookRule: 'new' | 'old' = ordered.some((r) => 'Revenue Before Cap' in r.data)
    ? 'new'
    : 'old';
  const newMaster = workbookRule === 'new';
  interface Line {
    invoice: string | number;
    date: string;
    salesperson: string;
    type: string;
    qty: number;
    bTransport: number;
    bRevenue: number;
    aTransport: number;
    aRevenue: number;
  }
  const byInvoice = new Map<string, Line[]>();
  for (const { data } of ordered) {
    const inv = data['Inv/Del No'];
    const date = data['Date'];
    if (inv === undefined || inv === null || inv === '') continue;
    if (typeof date !== 'string' || !DATE.test(date)) continue;
    const b = before(data, newMaster);
    const line: Line = {
      invoice: typeof inv === 'number' ? inv : String(inv),
      date,
      salesperson: String(data['Salesman'] ?? ''),
      type: String(data['Pricing Type'] ?? ''),
      qty: num(data['Calc Qty']),
      bTransport: b.transport,
      bRevenue: b.revenue,
      aTransport: num(data['Transport Charge']),
      aRevenue: num(data['Proposed Revenue']),
    };
    const key = String(line.invoice);
    (byInvoice.get(key) ?? byInvoice.set(key, []).get(key)!).push(line);
  }

  const invoices: (InvoiceTransport & { _inv: string | number })[] = [];
  for (const [key, lines] of byInvoice) {
    const first = lines[0];
    const types = new Set(lines.map((l) => l.type));
    const csidiQty = lines.filter((l) => l.type === 'CSIDI').reduce((s, l) => s + l.qty, 0);
    const csidiLines = lines.filter((l) => l.type === 'CSIDI');
    const csidoLines = lines.filter((l) => l.type === 'CSIDO');
    const unitRevenue =
      csidiLines.reduce((s, l) => s + l.bRevenue - l.bTransport, 0) +
      lines.filter((l) => l.type === 'CSIII').reduce((s, l) => s + l.bRevenue, 0);
    let kind: Kind = 'none';
    let carrier: Carrier = null;
    let charge = 0;
    let actual = 0;
    let carrierUnits = 0;
    const csidiTransport = csidiLines.reduce((s, l) => s + l.bTransport, 0);
    const csidoBefore = csidoLines.reduce((s, l) => s + l.bRevenue, 0);
    if (types.has('CSIDI') && csidiTransport > 0) {
      kind = 'installation';
      carrier = 'CSIDI';
      charge = csidiTransport;
      actual = csidiLines.reduce((s, l) => s + l.aTransport, 0);
      const row = csidiLines[0];
      carrierUnits = row.bRevenue - row.bTransport;
    } else if (types.has('CSIDI') && csidoBefore > 0) {
      kind = 'installation';
      carrier = 'CSIDO';
      charge = csidoBefore;
      actual = csidoLines.reduce((s, l) => s + l.aRevenue, 0);
    } else if (!types.has('CSIDI') && csidoBefore > 0) {
      kind = 'delivery';
      carrier = 'CSIDO';
      charge = csidoBefore;
      actual = csidoLines.reduce((s, l) => s + l.aRevenue, 0);
    }
    const mixedSingle = types.has('CSIDI') && types.has('CSIDO') && csidiQty <= 1;
    if (kind === 'installation' && mixedSingle && !rules.mixedInvoiceTransport) charge = 0;
    invoices.push({
      _inv: first.invoice,
      invoice: key,
      date: first.date,
      salesperson: first.salesperson,
      kind,
      carrier,
      csidiQty,
      mixedSingle,
      unitRevenue: money(unitRevenue),
      carrierUnits: money(carrierUnits),
      charge,
      rank: null,
      charged: true,
      actual: money(actual),
      scenario: 0,
      delta: 0,
    });
  }

  // The cap: rank the trips of each salesperson's day.
  const days = new Map<string, typeof invoices>();
  if (rules.dailyCap) {
    for (const inv of invoices) {
      const capped =
        (inv.kind === 'installation' || (inv.kind === 'delivery' && rules.deliveryOnlyCap)) &&
        inv.charge > 0;
      if (!capped) continue;
      const k = `${inv.date}|${inv.salesperson}`;
      (days.get(k) ?? days.set(k, []).get(k)!).push(inv);
    }
    for (const trips of days.values())
      for (const inv of trips) {
        inv.rank =
          1 +
          trips.filter(
            (o) =>
              o.charge > inv.charge || (o.charge === inv.charge && invoiceBefore(o._inv, inv._inv)),
          ).length;
        inv.charged = inv.rank <= rules.maxTrips;
      }
  }
  for (const inv of invoices) {
    inv.scenario = money(inv.charged ? inv.charge : 0);
    inv.delta = money(inv.scenario - inv.actual);
  }
  const clean = invoices.map(({ _inv, ...rest }) => rest);
  return {
    workbookRule,
    invoices: clean,
    capDays: [...days.values()].map((t) => t.map((i) => i.invoice)),
  };
}

export type TransportComputation = ReturnType<typeof computeTransport>;

/** Revenue split for one period: what the workbook charged and what the toggles give. */
export function summarise(
  calc: TransportComputation,
  repairs: { CSIJW: number; CSIJO: number },
  inPeriod: (date: string) => boolean,
  maxTrips: number,
) {
  const inv = calc.invoices.filter((i) => inPeriod(i.date));
  const sum = (f: (i: InvoiceTransport) => number) => money(inv.reduce((s, i) => s + f(i), 0));
  const units = (type: 'CSIDI' | 'CSIII') => type; // documentation helper
  void units;
  const transportActual = sum((i) => (i.kind === 'installation' ? i.actual : 0));
  const transportNew = sum((i) => (i.kind === 'installation' ? i.scenario : 0));
  const feeActual = sum((i) => (i.kind === 'delivery' ? i.actual : 0));
  const feeNew = sum((i) => (i.kind === 'delivery' ? i.scenario : 0));
  const unitRevenue = sum((i) => i.unitRevenue);
  const workbookTotal = money(
    repairs.CSIJW + repairs.CSIJO + unitRevenue + transportActual + feeActual,
  );
  const currentTotal = money(repairs.CSIJW + repairs.CSIJO + unitRevenue + transportNew + feeNew);
  const capped = inv.filter((i) => i.rank !== null);
  const dayKeys = new Map<string, number>();
  for (const i of capped)
    dayKeys.set(`${i.date}|${i.salesperson}`, (dayKeys.get(`${i.date}|${i.salesperson}`) ?? 0) + 1);
  return {
    workbookTotal,
    currentTotal,
    change: money(currentTotal - workbookTotal),
    tripsNotCharged: capped.filter((i) => !i.charged).length,
    droppedCharges: sum((i) => (i.charged ? 0 : i.charge)),
    daysOverCap: [...dayKeys.values()].filter((n) => n > maxTrips).length,
    byJobType: [
      {
        key: 'CSIJW',
        label: 'CSIJW - Warranty repairs',
        workbook: repairs.CSIJW,
        current: repairs.CSIJW,
      },
      {
        key: 'CSIJO',
        label: 'CSIJO - Non-warranty repairs',
        workbook: repairs.CSIJO,
        current: repairs.CSIJO,
      },
      {
        key: 'CSIDI_CSIII',
        label: 'CSIDI + CSIII - unit prices',
        workbook: unitRevenue,
        current: unitRevenue,
      },
      { key: 'CSIDO', label: 'CSIDO - Delivery-only fees', workbook: feeActual, current: feeNew },
      {
        key: 'TRANSPORT',
        label: 'Transport - trip charges',
        workbook: transportActual,
        current: transportNew,
      },
    ].map((r) => ({
      ...r,
      workbook: money(r.workbook),
      current: money(r.current),
      change: money(r.current - r.workbook),
    })),
  };
}

/**
 * Revenue line adjustments for one upload. The transport the workbook charged is read from the
 * stored revenue lines themselves (so a workbook whose Revenue Source was not recalculated in Excel
 * is still handled correctly): the carrying CSIDI line holds unit prices + transport, a carrying CSIDO
 * line holds the regional charge or the delivery fee. Lines must be in workbook order.
 */
export function lineAdjustments(
  calc: TransportComputation,
  lines: { id: string; invDelNo: string | null; jobType: string; workbookRevenue: number }[],
) {
  const byKey = new Map<string, typeof lines>();
  for (const l of lines) {
    if (!l.invDelNo || (l.jobType !== 'CSIDI' && l.jobType !== 'CSIDO')) continue;
    const k = `${l.invDelNo}|${l.jobType}`;
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(l);
  }
  const out: { id: string; revenue: number }[] = [];
  let unmatched = 0;
  for (const inv of calc.invoices) {
    if (!inv.carrier) continue;
    const set = byKey.get(`${inv.invoice}|${inv.carrier}`);
    if (!set?.length) {
      unmatched += 1;
      continue;
    }
    const charged =
      inv.carrier === 'CSIDI'
        ? set[0].workbookRevenue - inv.carrierUnits
        : set.reduce((s, l) => s + l.workbookRevenue, 0);
    const delta = money(inv.scenario - charged);
    if (Math.abs(delta) >= 0.005)
      out.push({ id: set[0].id, revenue: money(set[0].workbookRevenue + delta) });
  }
  return { updates: out, unmatched };
}
