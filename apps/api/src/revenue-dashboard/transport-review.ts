// Transport review (test), modification #249.
//
// Applies the NEW transport rule to the CSIDI sheet of the active master workbook upload and
// compares it with what the workbook charges today. Read-only: nothing here changes stored
// revenue, the parser or any existing report. The same rule is calculated in the test workbook
// ('Trip Calc (Test)' / 'Dashboard (New)'), and both must give the same figures.
//
// The rule (decided with the Head of Service, 10 Nov 2026):
// - Every CSIDI or CSIDO invoice is one trip. An invoice with any CSIDI line is charged the
//   regional trip rate (Dubai / Sharjah); a delivery-only invoice (only CSIDO lines) is charged
//   the CSIDO fee, which is its trip charge.
// - Per salesperson per day only the `maxTrips` highest trip charges are charged (equal charges:
//   lower invoice number first). Every other trip that day is not charged. A CSIDI invoice that is
//   not charged still pays its unit prices; a delivery-only invoice that is not charged pays nothing.
// - CSIII never has transport and is never a trip. Unit prices do not change.
// - Transport is reported as its own line instead of inside the first CSIDI row or the CSIDO line.

export interface TransportSettings {
  dubai: number;
  sharjah: number;
  csidoFee: number;
  maxTrips: number;
}

export interface SheetRow {
  rowNo: number;
  data: Record<string, unknown>;
}

export interface RepairRevenue {
  jobType: 'CSIJW' | 'CSIJO';
  month: number; // YYYYMM
  revenue: number;
}

type InvoiceType = 'CSIDI' | 'CSIDI + CSIDO' | 'CSIDO only' | 'CSIII only';

interface Line {
  invoice: string | number;
  date: string;
  month: number;
  salesperson: string;
  jobType: string;
  sharjah: boolean;
  qty: number;
  revenue: number; // current revenue of the line (Proposed Revenue)
  transport: number; // current transport on the line (Transport Charge)
}

export interface TripRow {
  invoice: string;
  invoiceType: InvoiceType;
  region: 'Dubai' | 'Sharjah';
  qty: number;
  unitRevenue: number; // CSIDI + CSIII unit prices of the invoice (unchanged by the rule)
  charge: number; // trip charge candidate
  rank: number;
  charged: boolean;
  currentTransportAndFee: number;
  newTransportAndFee: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const money = (v: number) => Math.round(v * 100) / 100;

function readLines(rows: SheetRow[]): Line[] {
  const lines: Line[] = [];
  for (const { data } of [...rows].sort((a, b) => a.rowNo - b.rowNo)) {
    const invoice = data['Inv/Del No'];
    const date = data['Date'];
    if (invoice === undefined || invoice === null || invoice === '') continue;
    if (typeof date !== 'string' || !DATE.test(date)) continue;
    const city = String(data['ERP City / Region'] ?? '').toUpperCase();
    lines.push({
      invoice: typeof invoice === 'number' ? invoice : String(invoice),
      date,
      month: Number(date.slice(0, 4)) * 100 + Number(date.slice(5, 7)),
      salesperson: String(data['Salesman'] ?? ''),
      jobType: String(data['Pricing Type'] ?? ''),
      sharjah: city.includes('SHARJAH') || city.includes('SHJ'),
      qty: num(data['Calc Qty']),
      revenue: num(data['Proposed Revenue']),
      transport: num(data['Transport Charge']),
    });
  }
  return lines;
}

// Same order as the workbook's COUNTIFS(..., "<"&invoice): numbers by value, otherwise as text.
function invoiceBefore(a: string | number, b: string | number) {
  if (typeof a === 'number' && typeof b === 'number') return a < b;
  return String(a).toLowerCase() < String(b).toLowerCase();
}

interface Invoice {
  key: string;
  invoice: string | number;
  first: Line;
  lines: Line[];
  type: InvoiceType;
  charge: number;
  rank: number;
  charged: boolean;
}

interface Totals {
  current: number;
  new: number;
  csidiUnits: number;
  csiii: number;
  csidoFeeCurrent: number;
  csidoFeeNew: number;
  transportCurrent: number;
  transportNew: number;
  candidates: number;
  charged: number;
  dropped: number;
  daysOverCap: number;
  invoices: number;
}

const emptyTotals = (): Totals => ({
  current: 0,
  new: 0,
  csidiUnits: 0,
  csiii: 0,
  csidoFeeCurrent: 0,
  csidoFeeNew: 0,
  transportCurrent: 0,
  transportNew: 0,
  candidates: 0,
  charged: 0,
  dropped: 0,
  daysOverCap: 0,
  invoices: 0,
});

export function buildTransportReview(
  rows: SheetRow[],
  settings: TransportSettings,
  options: { month?: number | null; repairs?: RepairRevenue[]; maxDays?: number } = {},
) {
  const lines = readLines(rows);
  const byKey = new Map<string, Invoice>();
  for (const line of lines) {
    const key = String(line.invoice);
    const inv = byKey.get(key);
    if (inv) inv.lines.push(line);
    else
      byKey.set(key, {
        key,
        invoice: line.invoice,
        first: line,
        lines: [line],
        type: 'CSIII only',
        charge: 0,
        rank: 0,
        charged: false,
      });
  }
  const invoices = [...byKey.values()];
  for (const inv of invoices) {
    const types = new Set(inv.lines.map((l) => l.jobType));
    inv.type = types.has('CSIDI')
      ? types.has('CSIDO')
        ? 'CSIDI + CSIDO'
        : 'CSIDI'
      : types.has('CSIDO')
        ? 'CSIDO only'
        : 'CSIII only';
    inv.charge = inv.type.startsWith('CSIDI')
      ? inv.first.sharjah
        ? settings.sharjah
        : settings.dubai
      : inv.type === 'CSIDO only'
        ? settings.csidoFee
        : 0;
  }
  // Rank the trips of each salesperson's day (date and salesperson of the invoice's first line).
  const days = new Map<string, Invoice[]>();
  for (const inv of invoices) {
    if (inv.charge <= 0) continue;
    const key = `${inv.first.date}|${inv.first.salesperson}`;
    (days.get(key) ?? days.set(key, []).get(key)!).push(inv);
  }
  for (const trips of days.values()) {
    for (const inv of trips) {
      inv.rank =
        1 +
        trips.filter(
          (o) =>
            o.charge > inv.charge ||
            (o.charge === inv.charge && invoiceBefore(o.invoice, inv.invoice)),
        ).length;
      inv.charged = inv.rank <= settings.maxTrips;
    }
  }

  // Per-invoice money, split the way the dashboard shows it.
  const money_ = (inv: Invoice) => {
    let units = 0;
    let csiii = 0;
    let current = 0;
    let transportCurrent = 0;
    let feeCurrent = 0;
    for (const l of inv.lines) {
      current += l.revenue;
      if (l.jobType === 'CSIDI') {
        units += l.revenue - l.transport;
        transportCurrent += l.transport;
      } else if (l.jobType === 'CSIII') csiii += l.revenue;
      else if (l.jobType === 'CSIDO') {
        if (inv.type === 'CSIDI + CSIDO') transportCurrent += l.revenue;
        else feeCurrent += l.revenue;
      }
    }
    const transportNew = inv.charged && inv.type.startsWith('CSIDI') ? inv.charge : 0;
    const feeNew = inv.charged && inv.type === 'CSIDO only' ? inv.charge : 0;
    return {
      units,
      csiii,
      current,
      transportCurrent,
      feeCurrent,
      transportNew,
      feeNew,
      new: units + csiii + transportNew + feeNew,
    };
  };

  const add = (t: Totals, inv: Invoice) => {
    const m = money_(inv);
    t.current += m.current;
    t.new += m.new;
    t.csidiUnits += m.units;
    t.csiii += m.csiii;
    t.csidoFeeCurrent += m.feeCurrent;
    t.csidoFeeNew += m.feeNew;
    t.transportCurrent += m.transportCurrent;
    t.transportNew += m.transportNew;
    t.invoices += 1;
    if (inv.charge > 0) {
      t.candidates += 1;
      if (inv.charged) t.charged += 1;
      else t.dropped += inv.charge;
    }
  };

  const period = options.month || null;
  const inPeriod = (month: number) => period === null || month === period;
  const repairs = options.repairs ?? [];
  const repairSum = (jobType: 'CSIJW' | 'CSIJO', month?: number) =>
    repairs
      .filter(
        (r) =>
          r.jobType === jobType && (month === undefined ? inPeriod(r.month) : r.month === month),
      )
      .reduce((s, r) => s + r.revenue, 0);

  // Month list: every month that has delivery / installation or repair revenue.
  const monthKeys = [
    ...new Set([...invoices.map((i) => i.first.month), ...repairs.map((r) => r.month)]),
  ].sort((a, b) => a - b);
  const monthTotals = new Map(monthKeys.map((m) => [m, emptyTotals()]));
  for (const inv of invoices) add(monthTotals.get(inv.first.month)!, inv);
  const overCapByMonth = new Map<number, number>();
  for (const trips of days.values()) {
    if (trips.length > settings.maxTrips) {
      const m = trips[0].first.month;
      overCapByMonth.set(m, (overCapByMonth.get(m) ?? 0) + 1);
    }
  }
  const months = monthKeys.map((month) => {
    const t = monthTotals.get(month)!;
    const rep = repairSum('CSIJW', month) + repairSum('CSIJO', month);
    return {
      month,
      current: money(rep + t.current),
      new: money(rep + t.new),
      change: money(t.new - t.current),
      transportFeeCurrent: money(t.transportCurrent + t.csidoFeeCurrent),
      transportFeeNew: money(t.transportNew + t.csidoFeeNew),
      tripsCharged: t.charged,
      tripsNotCharged: t.candidates - t.charged,
      droppedCharges: money(t.dropped),
      daysOverCap: overCapByMonth.get(month) ?? 0,
    };
  });

  // Selected period.
  const P = emptyTotals();
  for (const inv of invoices) if (inPeriod(inv.first.month)) add(P, inv);
  for (const trips of days.values())
    if (inPeriod(trips[0].first.month) && trips.length > settings.maxTrips) P.daysOverCap += 1;
  const csijw = repairSum('CSIJW');
  const csijo = repairSum('CSIJO');
  const currentTotal = csijw + csijo + P.current;
  const newTotal = csijw + csijo + P.new;

  const byJobType = [
    {
      key: 'CSIJW',
      label: 'CSIJW - Warranty repairs',
      current: csijw,
      new: csijw,
      note: 'Not affected by the transport rule.',
    },
    {
      key: 'CSIJO',
      label: 'CSIJO - Non-warranty repairs',
      current: csijo,
      new: csijo,
      note: 'Not affected by the transport rule.',
    },
    {
      key: 'CSIDI',
      label: 'CSIDI - Delivery + installation (unit prices)',
      current: P.csidiUnits,
      new: P.csidiUnits,
      note: 'Same unit prices (standard / batch rate and discount). Transport is taken out and shown separately.',
    },
    {
      key: 'CSIII',
      label: 'CSIII - Installation only',
      current: P.csiii,
      new: P.csiii,
      note: 'Never has transport.',
    },
    {
      key: 'CSIDO',
      label: 'CSIDO - Delivery-only fee',
      current: P.csidoFeeCurrent,
      new: P.csidoFeeNew,
      note: `A delivery-only invoice is one trip. Its fee is dropped when it is beyond the ${settings.maxTrips} charged trips of the day.`,
    },
    {
      key: 'TRANSPORT',
      label: 'Transport - trip charges (own line)',
      current: P.transportCurrent,
      new: P.transportNew,
      note: `Current: inside the first CSIDI row or the CSIDO line. New: own line, at most ${settings.maxTrips} charged trips per salesperson per day.`,
    },
  ].map((r) => ({
    ...r,
    current: money(r.current),
    new: money(r.new),
    change: money(r.new - r.current),
  }));

  // Salespeople (delivery and installation only).
  const people = new Map<string, Totals>();
  for (const inv of invoices) {
    if (!inPeriod(inv.first.month)) continue;
    const name = inv.first.salesperson;
    add(people.get(name) ?? people.set(name, emptyTotals()).get(name)!, inv);
  }
  for (const trips of days.values())
    if (inPeriod(trips[0].first.month) && trips.length > settings.maxTrips)
      people.get(trips[0].first.salesperson)!.daysOverCap += 1;
  const salespeople = [...people.entries()]
    .map(([name, t]) => ({
      name,
      invoices: t.invoices,
      tripsCharged: t.charged,
      tripsNotCharged: t.candidates - t.charged,
      daysOverCap: t.daysOverCap,
      transportFeeCurrent: money(t.transportCurrent + t.csidoFeeCurrent),
      transportFeeNew: money(t.transportNew + t.csidoFeeNew),
      change: money(t.transportNew + t.csidoFeeNew - t.transportCurrent - t.csidoFeeCurrent),
    }))
    .sort((a, b) => b.invoices - a.invoices || a.name.localeCompare(b.name));

  // Salesperson-days with their trips (newest first).
  const dayList = [...days.entries()]
    .filter(([, trips]) => inPeriod(trips[0].first.month))
    .map(([, trips]) => {
      const list: TripRow[] = [...trips]
        .sort((a, b) => a.rank - b.rank)
        .map((inv) => {
          const m = money_(inv);
          return {
            invoice: inv.key,
            invoiceType: inv.type,
            region: inv.first.sharjah ? ('Sharjah' as const) : ('Dubai' as const),
            qty: inv.lines.reduce((s, l) => s + l.qty, 0),
            unitRevenue: money(m.units + m.csiii),
            charge: inv.charge,
            rank: inv.rank,
            charged: inv.charged,
            currentTransportAndFee: money(m.transportCurrent + m.feeCurrent),
            newTransportAndFee: money(m.transportNew + m.feeNew),
          };
        });
      return {
        date: trips[0].first.date,
        salesperson: trips[0].first.salesperson,
        trips: list.length,
        overCap: list.length > settings.maxTrips,
        chargedTotal: money(list.filter((t) => t.charged).reduce((s, t) => s + t.charge, 0)),
        droppedTotal: money(list.filter((t) => !t.charged).reduce((s, t) => s + t.charge, 0)),
        currentTransportAndFee: money(list.reduce((s, t) => s + t.currentTransportAndFee, 0)),
        list,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.salesperson.localeCompare(b.salesperson));
  const maxDays = options.maxDays ?? 400;

  return {
    settings,
    period,
    kpis: {
      currentTotal: money(currentTotal),
      newTotal: money(newTotal),
      change: money(newTotal - currentTotal),
      changePct: currentTotal
        ? Math.round(((newTotal - currentTotal) / currentTotal) * 10000) / 100
        : 0,
      transportNew: money(P.transportNew),
      tripsCharged: P.charged,
      tripsNotCharged: P.candidates - P.charged,
      droppedCharges: money(P.dropped),
      daysOverCap: P.daysOverCap,
      deliveryInstallCurrent: money(P.current),
    },
    byJobType,
    months,
    salespeople,
    days: dayList.slice(0, maxDays),
    daysTotal: dayList.length,
  };
}

export type TransportReview = ReturnType<typeof buildTransportReview>;
