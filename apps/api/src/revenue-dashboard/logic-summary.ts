import type { DandiPricingInput } from '../../../../packages/contracts/src/index.js';
import type { ImportBatch } from '../../../../packages/db/src/revenue-dashboard.js';
import {
  applyFlatRates,
  csidoFlatCharge,
  DEFAULT_PRICING_RULES,
  enrichLine,
  type CategoryRate,
  type DiscountTier,
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
  description?: string | null;
  /** Actual job value from ERP for an original job (CSIJO); revenue is that amount, not rate x qty. */
  originalJobValue?: number | null;
  /** Ref DocNo from the CSIJW / CSIJO sheet (repair jobs); install lines carry it in pricing. */
  refDocNo?: string | null;
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
  /** Set when the rules rebuild a different figure than the workbook shows. */
  check?: string;
};

export type WorkedExample = {
  invoice: string;
  customer: string | null;
  date: string | null;
  /** The workbook's Ref DocNo for this invoice (a CSOSC order, "Direct", ...), when it has one. */
  refDocNo: string | null;
  lines: ExampleLine[];
  total: number;
  /** How the invoice-level rules were applied to this invoice, in plain words. */
  notes: string[];
};

/**
 * Rates shown on the "Logic applied" tab, read from the pricing master
 * (Management > Pricing Masters > D+I Admin Entry) instead of the uploaded
 * workbook. All prices include VAT (rate basis of 15 Oct 2026).
 */
export type MasterRates = {
  source: 'pricing-master';
  vatIncluded: true;
  minUnitRate: number;
  deliveryInstall: { categories: CategoryRate[]; discounts: DiscountTier[] };
  install: { categories: CategoryRate[]; discounts: DiscountTier[] };
  transport: { region: string; roundTrip: number }[];
  /** Flat per-job rates: CSIJW, CSIDO, CSIJO and RWR / BER. */
  jobRates: { jobType: string; label: string; description: string; price: number }[];
};

// The flat job-type rates (CSIJW, CSIJO, CSIDO, RWR / BER) are entered in D+I
// Admin Entry (#114) and replace the uploaded workbook's values everywhere the
// logic is shown.
export function masterRates(dandi: DandiPricingInput, workbookRules: PricingRules): MasterRates {
  const rules = applyFlatRates(workbookRules, dandi.flatRates);
  const names = {
    fridge: 'Freestanding Refrigerator',
    washer: 'Freestanding Washing Machine',
    cooker: 'Freestanding Cooker',
  } as const;
  const side = (mode: DandiPricingInput['modes']['dandi']) => ({
    categories: (Object.keys(names) as (keyof typeof names)[]).map((k) => ({
      category: names[k],
      batchRate: mode.rates[k].batch,
      standardRate: mode.rates[k].standard,
      minimumRate: dandi.minUnitRate,
    })),
    discounts: mode.discounts.map((t) => ({
      minimum: t.min,
      maximum: t.max,
      tier: t.label,
      discount: t.rate,
    })),
  });
  const rate = (code: string) => {
    const base = rules.rates.find((r) => r.jobType === code);
    return {
      price: base?.price ?? 0,
      description: base?.description ?? code,
    };
  };
  return {
    source: 'pricing-master',
    vatIncluded: true,
    minUnitRate: dandi.minUnitRate,
    deliveryInstall: side(dandi.modes.dandi),
    install: side(dandi.modes.install),
    transport: dandi.regions.map((r) => ({ region: r.name, roundTrip: r.roundTripCost })),
    jobRates: [
      { jobType: 'CSIJW', label: 'CSIJW' },
      { jobType: 'CSIDO', label: 'CSIDO' },
      { jobType: 'CSIJO', label: 'CSIJO' },
      { jobType: 'RWR', label: 'RWR / BER' },
    ].map((j) => ({ ...j, ...rate(j.jobType) })),
  };
}

export type LogicSummary = {
  master: MasterRates;
  batch: { id: string; fileName: string; uploadedAt: string };
  logicVersion: 2 | 3;
  rulesSource: 'workbook' | 'built-in';
  rates: PricingRules['rates'];
  csidoFlat: number;
  /** A delivery-only line on an invoice with a CSIDI line is charged the regional transport rate. */
  csidoMixedRegional: boolean;
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
  example: WorkedExample | null;
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

function exampleLineText(rules: PricingRules, line: LogicSummaryLine): ExampleLine {
  const p = line.pricing;
  const item =
    [p?.applianceCategory, p?.erpModels].filter((v) => v && String(v).trim()).join(' - ') ||
    p?.erpCategory ||
    (line.description && line.description.trim()) ||
    'Item';
  let how = '';
  if (line.jobType === 'CSIDI' || line.jobType === 'CSIII') {
    const base = p?.baseUnitRate;
    const net = p?.netUnitRate ?? line.unitPrice;
    // Read the discount from base and net: older workbook rows kept a stale
    // discount % next to a corrected net rate.
    const pct = base && net < base ? Math.round((1 - net / base) * 100) : 0;
    const invoiceUnits = line.jobType === 'CSIDI' ? (p?.invoiceCsidiQty ?? null) : line.qty;
    const rateWord = invoiceUnits !== null && invoiceUnits > 1 ? 'batch rate' : 'standard rate';
    how =
      `${line.qty} x ${money(net)}` +
      (base ? ` (${rateWord} ${money(base)}${pct ? ` less ${pct}% volume discount` : ''})` : '');
    if (p?.transportCharge)
      how += ` + ${money(p.transportCharge)} transport (once per invoice, on its first line)`;
  } else if (line.jobType === 'CSIDO') {
    how =
      line.revenue > 0
        ? rules.csidoMixedRegional && p?.invoiceHasCsidi
          ? 'The invoice’s one delivery charge: the regional transport rate, because the invoice also has a delivery + installation line (placed on its first delivery-only line)'
          : 'The invoice’s one flat delivery charge, placed on its first delivery-only line'
        : 'Covered by the flat charge on the first delivery-only line, so it shows 0';
  } else {
    const flat =
      /\b(BER|RWR)\b|NOT REPAIRABLE|NON REPAIRABLE|UNREPAIRABLE|BEYOND (ECONOMIC )?REPAIR|CANNOT BE REPAIRED|IRREPARABLE/i.test(
        line.remarks ?? '',
      );
    const erpValue = Number(line.originalJobValue ?? 0);
    how =
      erpValue > 0 && Math.abs(line.revenue - line.qty * line.unitPrice) > 0.01
        ? `Actual ERP job value ${money(line.revenue)} (original job; not rate x quantity)`
        : flat && line.qty > 0 && Math.abs(line.revenue - line.qty * line.unitPrice) > 0.01
          ? `Flat ${money(line.revenue / line.qty)} per job (BER / RWR)`
          : `${line.qty} x ${money(line.unitPrice)}` +
            (line.jobType === 'CSIJW' || line.jobType === 'CSIJO' ? ' per job' : '');
  }
  return { jobType: line.jobType, item, qty: line.qty, revenue: line.revenue, how };
}

/** The invoice's Ref DocNo: the distinct values on its lines, most often just one. */
function refDocNoOf(set: LogicSummaryLine[]): string | null {
  const values = new Set<string>();
  for (const l of set) {
    const v = (l.pricing?.refDocNo ?? l.refDocNo ?? '').toString().trim();
    if (v) values.add(v);
  }
  return values.size ? [...values].join(', ') : null;
}

const JOB_ORDER = ['CSIJW', 'CSIJO', 'CSIDI', 'CSIII', 'CSIDO'];

/** Worked example for one invoice: all its lines, in job-type order, with a check against the rules. */
export function buildWorkedExample(
  rules: PricingRules,
  invoice: string,
  set: LogicSummaryLine[],
): WorkedExample {
  const ordered = [...set].sort(
    (a, b) => JOB_ORDER.indexOf(a.jobType) - JOB_ORDER.indexOf(b.jobType) || b.revenue - a.revenue,
  );
  return {
    invoice,
    customer: set[0]?.customer ?? null,
    date: set[0]?.orderDate ?? null,
    refDocNo: refDocNoOf(set),
    lines: ordered.map((l) => {
      const out = exampleLineText(rules, l);
      if (['CSIDI', 'CSIII', 'CSIDO'].includes(l.jobType) && l.pricing) {
        const e = enrichLine(rules, {
          jobType: l.jobType,
          qty: l.qty,
          unitPrice: l.unitPrice,
          revenue: l.revenue,
          remarks: l.remarks,
          billingCode: l.billingCode,
          pricing: l.pricing,
        });
        if (e.rebuilt !== null && Math.abs(e.reconcileDiff ?? 0) > 0.01)
          out.check =
            `Rules give ${money(e.rebuilt)}; the workbook shows ${money(l.revenue)}` +
            (CAUSE_TEXT[e.diffCause] ? ` — ${CAUSE_TEXT[e.diffCause]}` : '');
      }
      return out;
    }),
    total: round2(set.reduce((s, l) => s + l.revenue, 0)),
    notes: invoiceNotes(rules, ordered),
  };
}

const CAUSE_TEXT: Record<string, string> = {
  'CSIDO flat charge':
    'a delivery-only line kept at an older amount than the current rule (flat charge, or regional transport when the invoice also has a delivery + installation line)',
  'CSIDI transport': 'the once-per-invoice transport is missing from the workbook row',
  'Rate or quantity': 'a locked row kept at an older rate or quantity',
};

/**
 * Plain-language reading of the invoice-level rules for the reviewer: which
 * quantity decided the rate and discount tier, and where the once-per-invoice
 * charges sit.
 */
function invoiceNotes(rules: PricingRules, set: LogicSummaryLine[]): string[] {
  const notes: string[] = [];
  const di = set.filter((l) => l.jobType === 'CSIDI');
  const doLines = set.filter((l) => l.jobType === 'CSIDO');
  if (di.length) {
    const units = di[0]?.pricing?.invoiceCsidiQty ?? di.reduce((s, l) => s + l.qty, 0);
    const tier = rules.deliveryInstall.discounts.find(
      (t) => units >= t.minimum && units <= t.maximum,
    );
    const many = di.length > 1;
    notes.push(
      units > 1
        ? `Rate: the invoice has ${units} delivery + installation units in total${many ? ' across its ' + di.length + ' lines' : ''}, so ${many ? 'every line is priced at' : 'the line is priced at'} the batch rate${many ? ' (even a line of 1 unit)' : ''} and the volume-discount tier is read on ${units} units` +
            (tier ? ` (${tier.tier}: ${Math.round(tier.discount * 1000) / 10}%).` : '.')
        : 'Rate: a single delivery + installation unit on the invoice, so the standard rate applies with no volume discount.',
    );
    const withTransport = di.find((l) => (l.pricing?.transportCharge ?? 0) > 0);
    if (doLines.length)
      notes.push(
        rules.csidoMixedRegional
          ? `Transport: not added to the CSIDI lines; the invoice also has a delivery-only line, which is charged the regional transport rate instead of the flat ${money(csidoFlatCharge(rules))} (the visit is shared).`
          : `Transport: not added to the CSIDI lines, because the invoice also has a delivery-only line whose flat ${money(csidoFlatCharge(rules))} covers the visit.`,
      );
    else if (units <= 1)
      notes.push('Transport: none, because the invoice has only one delivery + installation unit.');
    else if (withTransport)
      notes.push(
        `Transport: ${money(withTransport.pricing?.transportCharge ?? 0)} is charged once for the invoice (more than 1 unit, no delivery-only line), on its first delivery + installation line${di.length > 1 ? ' — the other lines carry none' : ''}.`,
      );
    else
      notes.push(
        'Transport: the rules add one transport charge to the first delivery + installation line (more than 1 unit, no delivery-only line), but this workbook row carries none.',
      );
  }
  if (set.some((l) => l.jobType === 'CSIII'))
    notes.push(
      'Installation only: each line is priced on its own quantity; no transport is added.',
    );
  if (doLines.length)
    notes.push(
      `Delivery only: one flat ${money(csidoFlatCharge(rules))} per invoice sits on its first delivery-only line; the other delivery-only lines show 0.` +
        (rules.csidoMixedRegional
          ? ' If the invoice also has a delivery + installation line, that one charge is the regional transport rate instead (Dubai / Sharjah).'
          : ''),
    );
  return notes;
}

export function rulesOfBatch(batch: ImportBatch): PricingRules {
  const stored = (batch.summary as { pricingRules?: PricingRules }).pricingRules;
  return stored?.deliveryInstall ? stored : DEFAULT_PRICING_RULES;
}

export function buildLogicSummary(
  batch: ImportBatch,
  lines: LogicSummaryLine[],
  dandi: DandiPricingInput,
): LogicSummary {
  const rules = applyFlatRates(rulesOfBatch(batch), dandi.flatRates);
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
    example = buildWorkedExample(rules, invoice, set);
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
    master: masterRates(dandi, rules),
    batch: {
      id: batch.id,
      fileName: batch.fileName,
      uploadedAt: batch.uploadedAt.toISOString(),
    },
    logicVersion: rules.logicVersion === 3 ? 3 : 2,
    rulesSource: rules.source,
    rates: rules.rates,
    csidoFlat: csidoFlatCharge(rules),
    csidoMixedRegional: !!rules.csidoMixedRegional,
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
