// Runs the scenario (modification #304): the live figures next to the figures under the new fridge logic.
import {
  computeRevenue,
  overlayRates,
  ratesOf,
  type RateSet,
  type RevenueInputs,
} from './rate-overrides.js';
import type { PricingRules } from './pricing-logic.js';
import {
  priceFridgeLines,
  plugKey,
  PLUG_ITEM_CODE,
  type FridgeLineResult,
  type FridgeScenario,
  type Litres,
} from './fridge-scenario.js';

export interface ScenarioSettings {
  rates: RateSet;
  fridge: FridgeScenario;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export interface ScenarioRow {
  key: string;
  label: string;
  jobs: number;
  units: number;
  current: number;
  scenario: number;
  change: number;
}

export interface ScenarioInvoiceRow {
  invoice: string | null;
  date: string | null;
  salesPerson: string | null;
  customer: string | null;
  jobType: string;
  category: string;
  units: number;
  litres: number | null;
  litresSource: string | null;
  defaultLitres: boolean;
  rule: string;
  current: number;
  scenario: number;
  change: number;
}

/**
 * Revenue of every line under the new fridge logic: the fridge lines re-priced (everything else as on
 * the given rates), and the 13A plug amount on the first revenue line of its invoice and job type.
 * Used by the scenario test and, once the new logic is switched on, by the live dashboard.
 */
export function fridgeRevenue(
  inputs: RevenueInputs,
  base: PricingRules,
  rates: RateSet,
  fridgeSettings: FridgeScenario,
  lookup: Map<string, Litres>,
  plugQty: Map<string, number> = new Map(),
) {
  const nextRules = overlayRates(base, rates);
  const step = computeRevenue(inputs, base, nextRules).revenue;
  const fridge = priceFridgeLines(inputs.lines, base, nextRules, fridgeSettings, lookup);
  const scenario = new Map<string, number>();
  for (const l of inputs.lines) {
    const f = fridge.get(l.id);
    let value = step.get(l.id) ?? l.workbookRevenue;
    if (f) value = value - f.oldLabour + f.newLabour;
    scenario.set(l.id, r2(value));
  }
  const plugOf = new Map<string, number>();
  const plugUnits = new Map<string, number>();
  const used = new Set<string>();
  for (const l of inputs.lines) {
    if (l.jobType !== 'CSIDI' && l.jobType !== 'CSIII') continue;
    const key = plugKey(l.invDelNo ?? '', l.jobType);
    const qty = plugQty.get(key);
    if (!qty || used.has(key)) continue;
    used.add(key);
    plugOf.set(l.id, r2(qty * fridgeSettings.plugAmount));
    plugUnits.set(l.id, qty);
  }
  const unmatchedPlugs = [...plugQty.keys()].filter((k) => !used.has(k));
  const revenue = new Map<string, number>();
  for (const [id, v] of scenario) revenue.set(id, r2(v + (plugOf.get(id) ?? 0)));
  return { revenue, scenario, fridge, plugOf, plugUnits, unmatchedPlugs };
}

export function runScenario(
  inputs: RevenueInputs,
  base: PricingRules,
  liveRates: RateSet | null,
  settings: ScenarioSettings,
  lookup: Map<string, Litres>,
  plugQty: Map<string, number> = new Map(),
) {
  const liveRules = liveRates ? overlayRates(base, liveRates) : base;
  const live = computeRevenue(inputs, base, liveRules).revenue;
  const { scenario, fridge, plugOf, plugUnits, unmatchedPlugs } = fridgeRevenue(
    inputs,
    base,
    settings.rates,
    settings.fridge,
    lookup,
    plugQty,
  );

  const rows = new Map<string, ScenarioRow>();
  const bump = (key: string, label: string, units: number, cur: number, next: number) => {
    const row = rows.get(key) ?? {
      key,
      label,
      jobs: 0,
      units: 0,
      current: 0,
      scenario: 0,
      change: 0,
    };
    row.jobs += 1;
    row.units += units;
    row.current += cur;
    row.scenario += next;
    rows.set(key, row);
  };
  const people = new Map<string, ScenarioRow>();
  const types = new Map<string, ScenarioRow>();
  const invoices: ScenarioInvoiceRow[] = [];
  let defaultLines = 0;
  let defaultUnits = 0;
  let fridgeLines = 0;
  let fridgeUnits = 0;
  const notInMaster = new Set<string>();
  const sizeLabel = (f: FridgeLineResult) =>
    f.large ? 'Refrigerator, over 400 L' : 'Refrigerator, 400 L and under';

  for (const l of inputs.lines) {
    const cur = live.get(l.id) ?? l.workbookRevenue;
    const nextBase = scenario.get(l.id) ?? cur;
    const plug = plugOf.get(l.id) ?? 0;
    const next = nextBase + plug;
    const f = fridge.get(l.id);
    const p = l.pricing as { applianceCategory?: string | null; erpModels?: string | null } | null;
    const isDI = l.jobType === 'CSIDI' || l.jobType === 'CSIII';
    let key = 'other';
    let label = 'Other job types (not changed)';
    if (f) {
      key = f.large ? 'fridge-large' : 'fridge-small';
      label = sizeLabel(f);
    } else if (isDI) {
      const cat = p?.applianceCategory ?? 'Default';
      key = 'cat:' + cat;
      label = cat.replace('Freestanding ', '');
    }
    bump(key, label, isDI ? l.qty : 0, cur, nextBase);
    if (plug) bump('plugs', '13A plugs (new)', plugUnits.get(l.id) ?? 0, 0, plug);
    const t = types.get(l.jobType) ?? {
      key: l.jobType,
      label: l.jobType,
      jobs: 0,
      units: 0,
      current: 0,
      scenario: 0,
      change: 0,
    };
    t.jobs += 1;
    t.units += l.qty;
    t.current += cur;
    t.scenario += next;
    types.set(l.jobType, t);
    const who = l.salesPerson?.trim() || '(none)';
    const pe = people.get(who) ?? {
      key: who,
      label: who,
      jobs: 0,
      units: 0,
      current: 0,
      scenario: 0,
      change: 0,
    };
    pe.jobs += 1;
    pe.units += isDI ? l.qty : 0;
    pe.current += cur;
    pe.scenario += next;
    people.set(who, pe);
    if (f) {
      fridgeLines += 1;
      fridgeUnits += l.qty;
      if (f.defaultLitres) {
        defaultLines += 1;
        defaultUnits += l.qty;
      }
      if (f.litresSource === 'not-in-master')
        String(p?.erpModels ?? '')
          .split(/[,;/]/)
          .map((m) => m.trim())
          .filter(Boolean)
          .forEach((m) => notInMaster.add(m));
    }
    if (plug) {
      invoices.push({
        invoice: l.invDelNo,
        date: l.orderDate ?? null,
        salesPerson: l.salesPerson ?? null,
        customer: l.customer ?? null,
        jobType: l.jobType,
        category: '13A plug',
        units: plugUnits.get(l.id) ?? 0,
        litres: null,
        litresSource: null,
        defaultLitres: false,
        rule: `13A plug line (${PLUG_ITEM_CODE}): ${plugUnits.get(l.id)} x ${settings.fridge.plugAmount}, no discount, not a unit or trip`,
        current: 0,
        scenario: plug,
        change: plug,
      });
    }
    if (Math.abs(nextBase - cur) >= 0.005 || (f && f.defaultLitres)) {
      invoices.push({
        invoice: l.invDelNo,
        date: l.orderDate ?? null,
        salesPerson: l.salesPerson ?? null,
        customer: l.customer ?? null,
        jobType: l.jobType,
        category: f ? sizeLabel(f) : (p?.applianceCategory ?? 'Default'),
        units: l.qty,
        litres: f ? f.litres : null,
        litresSource: f ? f.litresSource : null,
        defaultLitres: !!f?.defaultLitres,
        rule: f ? f.rule : 'Rate change on the same logic',
        current: r2(cur),
        scenario: r2(nextBase),
        change: r2(nextBase - cur),
      });
    }
  }
  const finish = (list: Iterable<ScenarioRow>) =>
    [...list].map((x) => ({
      ...x,
      current: r2(x.current),
      scenario: r2(x.scenario),
      change: r2(x.scenario - x.current),
    }));
  const total = (m: Map<string, number>) => r2([...m.values()].reduce((a, b) => a + b, 0));
  const current = total(live);
  const next = r2(total(scenario) + [...plugOf.values()].reduce((a, b) => a + b, 0));
  const order = ['fridge-small', 'fridge-large'];
  const byCategory = finish(rows.values()).sort((a, b) => {
    const ia = order.indexOf(a.key);
    const ib = order.indexOf(b.key);
    if (a.key === 'other') return 1;
    if (b.key === 'other') return -1;
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return a.label.localeCompare(b.label);
  });
  return {
    current,
    scenario: next,
    change: r2(next - current),
    changePct: current ? r2(((next - current) / current) * 100) : 0,
    byCategory,
    byJobType: finish(types.values()).sort((a, b) => a.key.localeCompare(b.key)),
    bySalesperson: finish(people.values())
      .filter((x) => Math.abs(x.change) >= 0.005)
      .sort((a, b) => a.change - b.change),
    invoices: invoices.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)),
    fridges: {
      lines: fridgeLines,
      units: fridgeUnits,
      defaultLines,
      defaultUnits,
      modelsNotInMaster: [...notInMaster].sort(),
    },
    plugs: {
      invoices: plugOf.size,
      units: [...plugUnits.values()].reduce((a, b) => a + b, 0),
      amount: settings.fridge.plugAmount,
      total: r2([...plugOf.values()].reduce((a, b) => a + b, 0)),
      itemCode: PLUG_ITEM_CODE,
      unmatched: unmatchedPlugs,
    },
    liveRates: ratesOf(liveRates ? overlayRates(base, liveRates) : base),
  };
}

export type ScenarioResult = ReturnType<typeof runScenario>;
