// Custom rates for the Service Revenue Dashboard (modification #290).
//
// The master workbook gives every revenue line a figure at its own rates. An admin can lock a different
// set of rates; this module works out what each line would earn under them and applies ONLY the
// difference to the workbook figure, using the portal's own copy of the workbook's pricing rules
// (priceInstallLine / enrichLine, the same code behind the "Logic applied" tab). Nothing else changes:
// discount-tier boundaries, trips, the daily cap, which lines carry a once-per-invoice charge and any
// line the rules cannot rebuild (an actual ERP job value, for example) stay exactly as they are.
// With no custom rates, every figure is the workbook figure plus the transport rules, as before.
import type { DandiPricingInput } from '../../../../packages/contracts/src/index.js';
import type { RateLine } from '../../../../packages/db/src/revenue-rate-overrides.js';
import {
  csidoFlatCharge,
  enrichLine,
  transportPerTrip,
  type PricingRules,
  type SheetPricing,
} from './pricing-logic.js';
import {
  computeTransport,
  lineAdjustments,
  type SheetRow,
  type TransportRules,
} from './transport-rules.js';

export interface CategoryRates {
  category: string;
  batchRate: number;
  standardRate: number;
  minimumRate: number;
}

/** Every rate an admin can edit. Discounts are listed in the order of the workbook's tiers. */
export interface RateSet {
  jobRates: { CSIJW: number; CSIJO: number; CSIDO: number; RWR: number };
  transport: { Dubai: number; Sharjah: number };
  deliveryInstall: { categories: CategoryRates[]; discounts: number[] };
  install: { categories: CategoryRates[]; discounts: number[] };
}

export const JOB_RATE_KEYS = ['CSIJW', 'CSIJO', 'CSIDO', 'RWR'] as const;
const money = (v: number) => Math.round(v * 100) / 100;

function rateOf(rules: PricingRules, jobType: string, fallback = 0) {
  return rules.rates.find((r) => r.jobType === jobType)?.price ?? fallback;
}

/** The editable rates of a rule set (the workbook's, for a stored upload). */
export function ratesOf(rules: PricingRules): RateSet {
  const master = (m: PricingRules['deliveryInstall']) => ({
    categories: m.categories.map((c) => ({
      category: c.category,
      batchRate: c.batchRate,
      standardRate: c.standardRate,
      minimumRate: c.minimumRate,
    })),
    discounts: m.discounts.map((d) => d.discount),
  });
  return {
    jobRates: {
      CSIJW: rateOf(rules, 'CSIJW'),
      CSIJO: rateOf(rules, 'CSIJO'),
      CSIDO: rateOf(rules, 'CSIDO'),
      RWR: rateOf(rules, 'RWR', 60),
    },
    transport: {
      Dubai: transportPerTrip(rules, 'Dubai'),
      Sharjah: transportPerTrip(rules, 'Sharjah'),
    },
    deliveryInstall: master(rules.deliveryInstall),
    install: master(rules.install),
  };
}

/** The rule set with the rates replaced. Anything that is not a rate is carried over untouched. */
export function overlayRates(rules: PricingRules, set: RateSet): PricingRules {
  const master = (m: PricingRules['deliveryInstall'], s: RateSet['install']) => ({
    ...m,
    categories: m.categories.map((c) => {
      const hit = s.categories.find((x) => x.category === c.category);
      return hit
        ? {
            ...c,
            batchRate: hit.batchRate,
            standardRate: hit.standardRate,
            minimumRate: hit.minimumRate,
          }
        : c;
    }),
    discounts: m.discounts.map((d, i) => ({
      ...d,
      discount: s.discounts[i] === undefined ? d.discount : s.discounts[i]!,
    })),
  });
  const rates = rules.rates.map((r) =>
    (JOB_RATE_KEYS as readonly string[]).includes(r.jobType)
      ? { ...r, price: set.jobRates[r.jobType as (typeof JOB_RATE_KEYS)[number]] }
      : r,
  );
  if (!rates.some((r) => r.jobType === 'RWR'))
    rates.push({ jobType: 'RWR', description: 'BER/RWR Flat Charge', price: set.jobRates.RWR });
  const di = master(rules.deliveryInstall, set.deliveryInstall);
  di.transport = di.transport.map((t) =>
    t.region === 'Dubai' || t.region === 'Sharjah'
      ? { ...t, roundTrip: set.transport[t.region] }
      : t,
  );
  return {
    ...rules,
    rates,
    deliveryInstall: di,
    install: master(rules.install, set.install),
  };
}

/** What differs between two rate sets, one row per changed value (for the screen and the audit trail). */
export function diffRates(base: RateSet, next: RateSet) {
  const out: { key: string; label: string; from: number; to: number }[] = [];
  const add = (key: string, label: string, from: number, to: number) => {
    if (Math.abs(from - to) > 1e-9) out.push({ key, label, from, to });
  };
  for (const k of JOB_RATE_KEYS) add(`jobRates.${k}`, k, base.jobRates[k], next.jobRates[k]);
  for (const r of ['Dubai', 'Sharjah'] as const)
    add(`transport.${r}`, `Transport ${r}`, base.transport[r], next.transport[r]);
  for (const [key, name] of [
    ['deliveryInstall', 'D+I'],
    ['install', 'Install only'],
  ] as const) {
    base[key].categories.forEach((c, i) => {
      const n = next[key].categories.find((x) => x.category === c.category) ?? c;
      add(`${key}.${i}.batch`, `${name} ${c.category} batch`, c.batchRate, n.batchRate);
      add(`${key}.${i}.standard`, `${name} ${c.category} standard`, c.standardRate, n.standardRate);
      add(`${key}.${i}.minimum`, `${name} ${c.category} minimum`, c.minimumRate, n.minimumRate);
    });
    base[key].discounts.forEach((d, i) =>
      add(`${key}.disc.${i}`, `${name} discount tier ${i + 1}`, d, next[key].discounts[i] ?? d),
    );
  }
  return out;
}

const toLike = (l: RateLine) => ({
  jobType: l.jobType,
  qty: l.qty,
  unitPrice: l.unitPrice,
  revenue: l.workbookRevenue,
  remarks: l.remarks,
  billingCode: l.billingCode,
  originalJobValue: l.originalJobValue,
  pricing: l.pricing as SheetPricing | null,
});

/** Per-line revenue difference from the unit prices, repair rates and flat charges. */
export function unitAdjustments(lines: RateLine[], base: PricingRules, next: PricingRules) {
  const out = new Map<string, number>();
  const b = ratesOf(base).jobRates;
  const n = ratesOf(next).jobRates;
  for (const l of lines) {
    let delta = 0;
    if (l.jobType === 'CSIDI' || l.jobType === 'CSIII') {
      if (!l.pricing) continue;
      const eb = enrichLine(base, toLike(l)).labourAfterDiscount;
      const en = enrichLine(next, toLike(l)).labourAfterDiscount;
      if (eb !== null && en !== null) delta = en - eb;
    } else if (l.jobType === 'CSIJW' || l.jobType === 'CSIJO') {
      const rate = b[l.jobType];
      const flat = Math.abs(l.workbookRevenue - l.qty * l.unitPrice) > 0.01;
      if (flat && l.originalJobValue <= 0 && Math.abs(l.workbookRevenue - b.RWR) < 0.01)
        delta = n.RWR - b.RWR;
      else if (
        !flat &&
        Math.abs(l.unitPrice - rate) < 0.01 &&
        Math.abs(l.workbookRevenue - l.qty * rate) < 0.01
      )
        delta = l.qty * (n[l.jobType] - rate);
    }
    if (Math.abs(delta) >= 0.005) out.set(l.id, delta);
  }
  return out;
}

/** Turns a charge the workbook made (60 / 90 trip, 100 flat) into the charge under the new rates. */
export function chargeMapper(base: PricingRules, next: PricingRules) {
  const b = ratesOf(base);
  const n = ratesOf(next);
  return (kind: 'installation' | 'delivery', charge: number) => {
    if (kind === 'delivery')
      return Math.abs(charge - b.jobRates.CSIDO) < 0.005 ? n.jobRates.CSIDO : charge;
    if (Math.abs(charge - b.transport.Dubai) < 0.005) return n.transport.Dubai;
    if (Math.abs(charge - b.transport.Sharjah) < 0.005) return n.transport.Sharjah;
    return charge;
  };
}

export interface RevenueInputs {
  lines: RateLine[];
  /** CSIDI / CSIDO lines in workbook order with their workbook revenue. */
  transportLines: {
    id: string;
    invDelNo: string | null;
    jobType: string;
    workbookRevenue: number;
  }[];
  sheetRows: SheetRow[];
  transportRules: TransportRules;
}

/**
 * Revenue of every line: the workbook figure, plus the transport rules, plus (when custom rates are
 * given) the rate difference. With `next` equal to `base`, this is exactly what the dashboard held
 * before custom rates existed.
 */
export function computeRevenue(inputs: RevenueInputs, base: PricingRules, next: PricingRules) {
  const same = JSON.stringify(ratesOf(base)) === JSON.stringify(ratesOf(next));
  const out = new Map<string, number>(inputs.lines.map((l) => [l.id, l.workbookRevenue]));
  let unmatched = 0;
  if (inputs.sheetRows.length) {
    const calc = computeTransport(
      inputs.sheetRows,
      inputs.transportRules,
      same ? undefined : chargeMapper(base, next),
    );
    const adj = lineAdjustments(calc, inputs.transportLines);
    unmatched = adj.unmatched;
    for (const u of adj.updates) out.set(u.id, u.revenue);
  }
  if (!same)
    for (const [id, delta] of unitAdjustments(inputs.lines, base, next))
      out.set(id, money((out.get(id) ?? 0) + delta));
  return { revenue: out, unmatched };
}

/** Revenue totals by job type and month for a revenue map. */
export function totalsOf(lines: RateLine[], revenue: Map<string, number>) {
  const byType = new Map<string, number>();
  const byMonth = new Map<number, number>();
  for (const l of lines) {
    const v = revenue.get(l.id) ?? l.workbookRevenue;
    byType.set(l.jobType, (byType.get(l.jobType) ?? 0) + v);
    if (l.year && l.monthNo) {
      const m = l.year * 100 + l.monthNo;
      byMonth.set(m, (byMonth.get(m) ?? 0) + v);
    }
  }
  return { byType, byMonth };
}

export { csidoFlatCharge };

// ---- Pricing Masters (D+I Admin Entry) <-> the revenue rate card ----------------------------------

const MASTER_CATEGORY = {
  fridge: 'Freestanding Refrigerator',
  washer: 'Freestanding Washing Machine',
  cooker: 'Freestanding Cooker',
} as const;

/**
 * The D+I pricing master with the rate card's rates written into it. Only values the master holds are
 * touched: flat job rates, Dubai / Sharjah trip cost, the three appliances' batch and standard rates for
 * D+I and Installation Only, the discount of every tier whose first unit matches, and the minimum unit
 * rate (when the three appliances share one). Anything the master cannot hold is listed in `skipped`.
 */
export function mastersFromRates(current: DandiPricingInput, set: RateSet, rules: PricingRules) {
  const next: DandiPricingInput = JSON.parse(JSON.stringify(current));
  const skipped: string[] = [];
  next.flatRates = { ...(next.flatRates ?? { CSIJW: 100, CSIJO: 125, CSIDO: 100, RWR: 60 }) };
  for (const k of JOB_RATE_KEYS) next.flatRates[k] = set.jobRates[k];
  for (const r of next.regions)
    if (r.name === 'Dubai' || r.name === 'Sharjah') r.roundTripCost = set.transport[r.name];
  const mins = new Set<number>();
  for (const [mode, key] of [
    ['dandi', 'deliveryInstall'],
    ['install', 'install'],
  ] as const) {
    const m = next.modes[mode];
    for (const [k, cat] of Object.entries(MASTER_CATEGORY) as [
      keyof typeof MASTER_CATEGORY,
      string,
    ][]) {
      const hit = set[key].categories.find((c) => c.category === cat);
      if (!hit) continue;
      m.rates[k] = { batch: hit.batchRate, standard: hit.standardRate };
      mins.add(hit.minimumRate);
    }
    const workbookTiers = (key === 'deliveryInstall' ? rules.deliveryInstall : rules.install)
      .discounts;
    workbookTiers.forEach((tier, i) => {
      const d = set[key].discounts[i];
      const row = m.discounts.find((x) => x.min === tier.minimum);
      if (d === undefined) return;
      if (row) row.rate = d;
      else
        skipped.push(
          `${m.label}: no discount range starts at ${tier.minimum} unit(s) in Pricing Masters`,
        );
    });
  }
  if (mins.size === 1) next.minUnitRate = [...mins][0]!;
  else
    skipped.push(
      'Minimum rate differs between appliances; Pricing Masters holds a single minimum, so it was left as it is',
    );
  return { payload: next, skipped };
}

/** The rate values currently in the D+I master, in the shape of the rate card (for the confirmation table). */
export function ratesFromMasters(current: DandiPricingInput, rules: PricingRules): RateSet {
  const set = ratesOf(rules);
  const flat = current.flatRates;
  if (flat)
    for (const k of JOB_RATE_KEYS) if (typeof flat[k] === 'number') set.jobRates[k] = flat[k];
  for (const r of current.regions)
    if (r.name === 'Dubai' || r.name === 'Sharjah') set.transport[r.name] = r.roundTripCost;
  for (const [mode, key] of [
    ['dandi', 'deliveryInstall'],
    ['install', 'install'],
  ] as const) {
    const m = current.modes[mode];
    for (const [k, cat] of Object.entries(MASTER_CATEGORY) as [
      keyof typeof MASTER_CATEGORY,
      string,
    ][]) {
      const c = set[key].categories.find((x) => x.category === cat);
      if (c) {
        c.batchRate = m.rates[k].batch;
        c.standardRate = m.rates[k].standard;
        c.minimumRate = current.minUnitRate;
      }
    }
    const tiers = (key === 'deliveryInstall' ? rules.deliveryInstall : rules.install).discounts;
    set[key].discounts = tiers.map(
      (t, i) => m.discounts.find((x) => x.min === t.minimum)?.rate ?? set[key].discounts[i]!,
    );
  }
  return set;
}
