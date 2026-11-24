// Scenario test of the new fridge pricing (modification #304). Nothing here changes the live dashboard:
// it re-prices a copy of the figures and reports the difference.
//
// New logic, fridges only (CSIDI and CSIII alike); every other category keeps today's logic:
//   fridge 400 L and under : 1 unit = market rate; 2-10 units = base; over 10 = second tier
//                            (Option B: only the units above 10; Option A: all units); no discount tiers
//   fridge over 400 L      : 1 unit = market rate; 2 or more = special rate; no discount tiers
// Units are counted per invoice, per job type and per size group. Litres come from the Stock Master.
import {
  DEFAULT_CAPACITY_LITRES,
  FRIDGE_LARGE_THRESHOLD_LITRES,
} from '../../../../packages/db/src/capacity-litres.js';
import { crewLoading, enrichLine, type PricingRules } from './pricing-logic.js';
import { toLike } from './rate-overrides.js';
import type { RateLine } from '../../../../packages/db/src/revenue-rate-overrides.js';

export const FRIDGE_CATEGORY = 'Freestanding Refrigerator';

export interface FridgeScenario {
  /** 2 to 10 units of a fridge 400 L and under, per unit. */
  smallBase: number;
  /** Units above 10 (Option B) or every unit when over 10 (Option A). */
  smallOver10: number;
  /** Floor for a fridge 400 L and under. */
  smallMinimum: number;
  /** true = Option B (only the units above 10 get the second tier). */
  optionB: boolean;
  /** Amount charged per 13A plug line (ERP wording still to come; no plug line is counted yet). */
  plugAmount: number;
}

export const DEFAULT_FRIDGE_SCENARIO: FridgeScenario = {
  smallBase: 30,
  smallOver10: 20,
  smallMinimum: 20,
  optionB: true,
  plugAmount: 15,
};

export type Litres = { litres: number; source: string };

export interface FridgeRates {
  market: number;
  special: number;
  minimum: number;
}

/** Group labour for `units` fridges of one size group. */
export function groupLabour(
  units: number,
  large: boolean,
  rates: FridgeRates,
  s: FridgeScenario,
): { total: number; rule: string } {
  if (units <= 0) return { total: 0, rule: '' };
  if (large) {
    if (units === 1)
      return {
        total: Math.max(rates.minimum, rates.market),
        rule: 'Over 400 L, 1 unit: market rate',
      };
    return {
      total: units * Math.max(rates.minimum, rates.special),
      rule: `Over 400 L, ${units} units: special rate, no discount tiers`,
    };
  }
  if (units === 1)
    return {
      total: Math.max(s.smallMinimum, rates.market),
      rule: '400 L and under, 1 unit: market rate',
    };
  const base = Math.max(s.smallMinimum, s.smallBase);
  const over = Math.max(s.smallMinimum, s.smallOver10);
  if (units <= 10)
    return {
      total: units * base,
      rule: `400 L and under, ${units} units: base rate, no discount tiers`,
    };
  if (s.optionB)
    return {
      total: 10 * base + (units - 10) * over,
      rule: `400 L and under, ${units} units: first 10 at base, ${units - 10} above 10 at second tier`,
    };
  return {
    total: units * over,
    rule: `400 L and under, ${units} units: all units at second tier`,
  };
}

/** Litres of a line from its model text (one or more models); several models take the largest. */
export function litresOfModels(
  models: string | null | undefined,
  lookup: Map<string, Litres>,
): { litres: number; source: string; models: string[] } {
  const list = String(models ?? '')
    .split(/[,;/]/)
    .map((m) => m.trim().toUpperCase())
    .filter(Boolean);
  const hits = list.map((m) => lookup.get(m)).filter((h): h is Litres => !!h);
  if (!hits.length)
    return { litres: DEFAULT_CAPACITY_LITRES, source: 'not-in-master', models: list };
  const best = hits.reduce((a, b) => (b.litres > a.litres ? b : a));
  const flag = hits.find((h) => h.source === 'default' || h.source === 'check');
  return {
    litres: best.litres,
    source: flag && flag.litres === best.litres ? flag.source : best.source,
    models: list,
  };
}

export interface FridgeLineResult {
  id: string;
  litres: number;
  litresSource: string;
  large: boolean;
  /** Labour of the line under the new fridge logic (before transport). */
  newLabour: number;
  /** Labour of the same line under the logic of the scenario rates (today's logic). */
  oldLabour: number;
  rule: string;
  defaultLitres: boolean;
}

export function priceFridgeLines(
  lines: RateLine[],
  baseRules: PricingRules,
  nextRules: PricingRules,
  scenario: FridgeScenario,
  lookup: Map<string, Litres>,
): Map<string, FridgeLineResult> {
  type Item = {
    line: RateLine;
    labour: number;
    loading: number;
    litres: ReturnType<typeof litresOfModels>;
  };
  const items: Item[] = [];
  for (const line of lines) {
    if (line.jobType !== 'CSIDI' && line.jobType !== 'CSIII') continue;
    const p = line.pricing as {
      applianceCategory?: string | null;
      erpModels?: string | null;
      crewSize?: number | null;
    } | null;
    if (!p || p.applianceCategory !== FRIDGE_CATEGORY) continue;
    const rebuiltNext = enrichLine(nextRules, toLike(line)).labourAfterDiscount;
    const rebuiltBase = enrichLine(baseRules, toLike(line)).labourAfterDiscount;
    if (rebuiltNext === null || rebuiltBase === null) continue;
    // The labour sitting inside the figure today: what the workbook charged (its own net unit rate x
    // quantity x crew loading, which is not always what the rules rebuild), plus any scenario rate change.
    const master0 = line.jobType === 'CSIDI' ? baseRules.deliveryInstall : baseRules.install;
    const net = (line.pricing as { netUnitRate?: number | null } | null)?.netUnitRate;
    const crew0 = (line.pricing as { crewSize?: number | null } | null)?.crewSize ?? 2;
    const workbookLabour =
      typeof net === 'number' ? line.qty * net * crewLoading(master0, crew0) : rebuiltBase;
    const old = workbookLabour + (rebuiltNext - rebuiltBase);
    const master = line.jobType === 'CSIDI' ? nextRules.deliveryInstall : nextRules.install;
    items.push({
      line,
      labour: old,
      loading: crewLoading(master, p.crewSize ?? 2),
      litres: litresOfModels(p.erpModels, lookup),
    });
  }
  const groups = new Map<string, Item[]>();
  for (const it of items) {
    const key = `${it.line.invDelNo ?? it.line.id}|${it.line.jobType}|${it.litres.litres > FRIDGE_LARGE_THRESHOLD_LITRES ? 'L' : 'S'}`;
    const g = groups.get(key);
    if (g) g.push(it);
    else groups.set(key, [it]);
  }
  const out = new Map<string, FridgeLineResult>();
  for (const group of groups.values()) {
    const first = group[0]!;
    const large = first.litres.litres > FRIDGE_LARGE_THRESHOLD_LITRES;
    const master = first.line.jobType === 'CSIDI' ? nextRules.deliveryInstall : nextRules.install;
    const cat = master.categories.find((c) => c.category === FRIDGE_CATEGORY);
    const rates: FridgeRates = {
      market: cat?.standardRate ?? 0,
      special: cat?.batchRate ?? 0,
      minimum: cat?.minimumRate ?? 0,
    };
    const units = group.reduce((t, i) => t + i.line.qty, 0);
    const { total, rule } = groupLabour(units, large, rates, scenario);
    for (const it of group) {
      const share = units > 0 ? it.line.qty / units : 0;
      out.set(it.line.id, {
        id: it.line.id,
        litres: it.litres.litres,
        litresSource: it.litres.source,
        large,
        newLabour: total * share * it.loading,
        oldLabour: it.labour,
        rule,
        defaultLitres: ['default', 'not-in-master', 'check'].includes(it.litres.source),
      });
    }
  }
  return out;
}

/** ERP item code of the 13A plug line (value 0 in ERP; the portal charges the plug amount per unit). */
export const PLUG_ITEM_CODE = 'REPAIR-MATERIAL';

/** Plug quantity per invoice and job type, read from the ERP lines of the master ("Net Sale Current"). */
export function plugQuantities(rows: { data: Record<string, unknown> }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const { data } of rows) {
    const code = String(data['Invi Item Code'] ?? '')
      .trim()
      .toUpperCase();
    if (code !== PLUG_ITEM_CODE) continue;
    const job = String(data['Txn Code'] ?? '')
      .trim()
      .toUpperCase();
    if (job !== 'CSIDI' && job !== 'CSIII') continue;
    const inv = String(data['Inv No'] ?? '').trim();
    const qty = Number(data['QTY'] ?? data['Qty'] ?? 0);
    if (!inv || !Number.isFinite(qty) || qty <= 0) continue;
    const key = plugKey(inv, job);
    out.set(key, (out.get(key) ?? 0) + qty);
  }
  return out;
}

export const plugKey = (invoice: string, jobType: string) =>
  `${invoice.trim()}|${jobType.trim().toUpperCase()}`;
