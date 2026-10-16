import type { ImportBatch } from '../../../../packages/db/src/revenue-dashboard.js';
import {
  csidoFlatCharge,
  DEFAULT_PRICING_RULES,
  enrichLine,
  type PricingRules,
  type SheetPricing,
} from './pricing-logic.js';

// Data behind the "Logic applied" tab of the Service Revenue Dashboard: the
// rules in force (read from the uploaded workbook), live figures for the whole
// upload, a plain-language reading of the zero-revenue jobs, one worked
// example taken from the data, and how the workbook compares with the rules.

export type LogicSummaryLine = {
  jobType: string;
  invDelNo: string | null;
  customer: string | null;
  orderDate: string | null;
  qty: number;
  unitPrice: number;
  revenue: number;
  remarks: string | null;
  billingCode: string | null;
  pricing: SheetPricing | null;
};

type TypeFigure = {
  jobType: string;
  description: string;
  lines: number;
  invoices: number;
  qty: number;
  revenue: number;
  zeroLines: number;
};

export type ExampleLine = {
  jobType: string;
  item: string;
  qty: number;
  revenue: number;
  how: string;
};

export type LogicSummary = {
  batch: { id: string; fileName: string; uploadedAt: string };
  logicVersion: 2 | 3;
  rulesSource: 'workbook' | 'built-in';
  rates: PricingRules['rates'];
  csidoFlat: number;
  deliveryInstall: PricingRules['deliveryInstall'];
  install: PricingRules['install'];
  totals: { lines: number; invoices: number; qty: number; revenue: number };
  byType: TypeFigure[];
  zeroRevenue: {
    lines: number;
    /** Extra CSIDO lines whose invoice has exactly one paid CSIDO line. */
    explainedLines: number;
    /** Zero-revenue lines of any other kind (these are the real surprises). */
    otherLines: number;
    invoices: number;
    byMonth: { period: string; lines: number }[];
  };
  example: {
    invoice: string;
    customer: string | null;
    date: string | null;
    lines: ExampleLine[];
    total: number;
  } | null;
  reconciliation: {
    matchedLines: number;
    differingLines: number;
    differenceAmount: number;
    causes: { cause: string; lines: number; amount: number }[];
  };
};

const money = (n: number) =>
  'AED ' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round(n * 100) / 100;

function exampleLineText(line: LogicSummaryLine): ExampleLine {
  const p = line.pricing;
  const item =
    [p?.applianceCategory, p?.erpModels].filter((v) => v && String(v).trim()).join(' - ') ||
    p?.erpCategory ||
    'Item';
  let how = '';
  if (line.jobType === 'CSIDI' || line.jobType === 'CSIII') {
    const base = p?.baseUnitRate;
    const net = p?.netUnitRate ?? line.unitPrice;
    const discount = p?.discountRate ?? 0;
    how =
      `${line.qty} x ${money(net)}` +
      (base && discount
        ? ` (base ${money(base)} less ${Math.round(discount * 100)}% volume discount)`
        : base
          ? ` (base ${money(base)})`
          : '');
    if (p?.transportCharge) how += ` + ${money(p.transportCharge)} transport (once per invoice)`;
  } else if (line.jobType === 'CSIDO') {
    how =
      line.revenue > 0
        ? 'The invoice’s one flat delivery charge, placed on its first delivery-only line'
        : 'Covered by the flat charge on the first delivery-only line, so it shows 0';
  } else {
    how = `${line.qty} x ${money(line.unitPrice)}`;
  }
  return { jobType: line.jobType, item, qty: line.qty, revenue: line.revenue, how };
}

export function buildLogicSummary(batch: ImportBatch, lines: LogicSummaryLine[]): LogicSummary {
  const stored = (batch.summary as { pricingRules?: PricingRules }).pricingRules;
  const rules: PricingRules = stored?.deliveryInstall ? stored : DEFAULT_PRICING_RULES;
  const describe = new Map(rules.rates.map((r) => [r.jobType, r.description]));
  const invoicesOf = (set: LogicSummaryLine[]) =>
    new Set(set.map((l) => l.invDelNo).filter(Boolean)).size;

  const order = ['CSIJW', 'CSIJO', 'CSIDI', 'CSIII', 'CSIDO'];
  const types = [...new Set([...order, ...lines.map((l) => l.jobType)])].filter((t) =>
    lines.some((l) => l.jobType === t),
  );
  const byType: TypeFigure[] = types.map((jobType) => {
    const set = lines.filter((l) => l.jobType === jobType);
    return {
      jobType,
      description: describe.get(jobType) ?? jobType,
      lines: set.length,
      invoices: invoicesOf(set),
      qty: set.reduce((s, l) => s + l.qty, 0),
      revenue: round2(set.reduce((s, l) => s + l.revenue, 0)),
      zeroLines: set.filter((l) => l.revenue === 0).length,
    };
  });

  // Zero-revenue lines: which are the "extra CSIDO lines" the flat charge covers.
  const paidCsido = new Map<string, number>();
  for (const l of lines)
    if (l.jobType === 'CSIDO' && l.revenue > 0 && l.invDelNo)
      paidCsido.set(l.invDelNo, (paidCsido.get(l.invDelNo) ?? 0) + 1);
  const zero = lines.filter((l) => l.revenue === 0);
  const explained = zero.filter(
    (l) => l.jobType === 'CSIDO' && l.invDelNo && paidCsido.get(l.invDelNo) === 1,
  );
  const months = new Map<string, number>();
  for (const l of zero) {
    const period = l.orderDate ? l.orderDate.slice(0, 7) : 'unknown';
    months.set(period, (months.get(period) ?? 0) + 1);
  }

  // One worked example: an invoice with CSIDI and several CSIDO lines.
  const groups = new Map<string, LogicSummaryLine[]>();
  for (const l of lines) {
    if (!l.invDelNo) continue;
    groups.set(l.invDelNo, [...(groups.get(l.invDelNo) ?? []), l]);
  }
  let example: LogicSummary['example'] = null;
  const candidates = [...groups.entries()]
    .filter(([, set]) => {
      const csido = set.filter((l) => l.jobType === 'CSIDO');
      return (
        set.some((l) => l.jobType === 'CSIDI') &&
        csido.length >= 2 &&
        csido.filter((l) => l.revenue > 0).length === 1 &&
        set.length <= 8
      );
    })
    .sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], undefined, { numeric: true }),
    );
  if (candidates[0]) {
    const [invoice, set] = candidates[0];
    const ordered = [...set].sort(
      (a, b) => order.indexOf(a.jobType) - order.indexOf(b.jobType) || b.revenue - a.revenue,
    );
    example = {
      invoice,
      customer: set[0]?.customer ?? null,
      date: set[0]?.orderDate ?? null,
      lines: ordered.map(exampleLineText),
      total: round2(set.reduce((s, l) => s + l.revenue, 0)),
    };
  }

  // Compare the workbook with the rules.
  const rebuilt = lines
    .filter((l) => ['CSIDI', 'CSIII', 'CSIDO'].includes(l.jobType) && l.pricing)
    .map((l) => ({
      line: l,
      e: enrichLine(rules, {
        jobType: l.jobType,
        qty: l.qty,
        unitPrice: l.unitPrice,
        revenue: l.revenue,
        remarks: l.remarks,
        billingCode: l.billingCode,
        pricing: l.pricing,
      }),
    }))
    .filter((x) => x.e.rebuilt !== null);
  const differing = rebuilt.filter((x) => Math.abs(x.e.reconcileDiff ?? 0) > 0.01);
  const causes = new Map<string, { lines: number; amount: number }>();
  for (const x of differing) {
    const key = x.e.diffCause || 'Rate or quantity';
    const c = causes.get(key) ?? { lines: 0, amount: 0 };
    c.lines += 1;
    c.amount += x.e.reconcileDiff ?? 0;
    causes.set(key, c);
  }

  return {
    batch: {
      id: batch.id,
      fileName: batch.fileName,
      uploadedAt: batch.uploadedAt.toISOString(),
    },
    logicVersion: rules.logicVersion === 3 ? 3 : 2,
    rulesSource: rules.source,
    rates: rules.rates,
    csidoFlat: csidoFlatCharge(rules),
    deliveryInstall: rules.deliveryInstall,
    install: rules.install,
    totals: {
      lines: lines.length,
      invoices: invoicesOf(lines),
      qty: lines.reduce((s, l) => s + l.qty, 0),
      revenue: round2(lines.reduce((s, l) => s + l.revenue, 0)),
    },
    byType,
    zeroRevenue: {
      lines: zero.length,
      explainedLines: explained.length,
      otherLines: zero.length - explained.length,
      invoices: invoicesOf(explained),
      byMonth: [...months.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([period, count]) => ({ period, lines: count })),
    },
    example,
    reconciliation: {
      matchedLines: rebuilt.length,
      differingLines: differing.length,
      differenceAmount: round2(differing.reduce((s, x) => s + (x.e.reconcileDiff ?? 0), 0)),
      causes: [...causes.entries()].map(([cause, c]) => ({
        cause,
        lines: c.lines,
        amount: round2(c.amount),
      })),
    },
  };
}
