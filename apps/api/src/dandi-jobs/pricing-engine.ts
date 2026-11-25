// Pricing of one delivery note (one ERP Ref Inv) for Delivery + Installation
// (CSIDI), Delivery only (CSIDO) and Installation only (CSIII) lines. It is a
// pure function so the entry screen, the revenue feed and the tests all use the
// same arithmetic. The rules are those of the master workbook's Net Sale Current
// sheet (formulas AV:BG, Pricing Logic Guide section 4), with one difference:
// the type of every line is CHOSEN by the user instead of derived from the ERP
// billing item code.
//
//  CSIDI : Qty x Net rate + one transport charge per delivery note, only when
//          the note has more than 1 CSIDI unit and no CSIDO line.
//          Base rate = batch rate when the note has more than 1 CSIDI unit (all
//          categories together), else the standard rate; the discount tier is
//          looked up on the note's total CSIDI quantity;
//          Net = MAX(minimum rate, Base x (1 - discount)).
//  CSIII : the same with the installation-only master, on the note's total CSIII
//          quantity, and never any transport.
//  CSIDO : one charge per note, on its first CSIDO line (the others show 0): the
//          regional transport rate (Dubai / Sharjah) when the note also has a
//          CSIDI unit, otherwise the flat CSIDO rate. The quantity does not change
//          the charge.
//
// New fridge and plug logic (modification #312), when the fridge settings are passed in switched on:
//  - Fridge lines (Freestanding Refrigerator) of CSIDI and CSIII are priced as a group per job type and
//    size (400 L and under / over 400 L; litres come from the Stock Master, 400 L and a warning when
//    unknown) with the same groupLabour rule the dashboard and the quote calculator use, and no
//    discount tiers. Other categories keep their rates and tiers; fridge units still count towards the
//    note's quantity for those tiers, for the batch rate and for transport.
//  - A 13A/15A plug line (item REPAIR-MATERIAL) on CSIDI or CSIII is charged the plug amount x its
//    quantity, no discount; it is not a unit, a trip or transport, and is never a CSIDO line.
import type { DandiPricingInput } from '../../../../packages/contracts/src/index.js';
import { masterRates } from '../revenue-dashboard/logic-summary.js';
import {
  DEFAULT_CAPACITY_LITRES,
  FRIDGE_LARGE_THRESHOLD_LITRES,
} from '../../../../packages/db/src/capacity-litres.js';
import {
  FRIDGE_CATEGORY,
  groupLabour,
  type FridgeScenario,
} from '../revenue-dashboard/fridge-scenario.js';
import {
  DEFAULT_PRICING_RULES,
  type CategoryRate,
  type DiscountTier,
  type PricingMaster,
} from '../revenue-dashboard/pricing-logic.js';

/** The highest tier whose minimum the quantity reaches (the workbook's LOOKUP). */
function discountFor(tiers: DiscountTier[], qty: number): DiscountTier {
  let hit = tiers[0]!;
  for (const tier of tiers) if (qty >= tier.minimum) hit = tier;
  return hit;
}

export type DandiLineType = 'CSIDI' | 'CSIDO' | 'CSIII';

export type EngineMaster = {
  deliveryInstall: Pick<PricingMaster, 'categories' | 'discounts'>;
  install: Pick<PricingMaster, 'categories' | 'discounts'>;
  transport: { region: string; roundTrip: number }[];
  csidoFlat: number;
  /** The saved fridge and plug settings (Rate card / Pricing Masters). Absent or off = old logic. */
  fridge?: FridgeScenario & { enabled: boolean };
};

/** The rate tables the engine needs, read from the D+I Admin Entry pricing master. */
export function engineMasterFromDandi(
  dandi: DandiPricingInput,
  fridge?: FridgeScenario & { enabled: boolean },
): EngineMaster {
  const rates = masterRates(dandi, DEFAULT_PRICING_RULES);
  return {
    ...(fridge ? { fridge } : {}),
    deliveryInstall: rates.deliveryInstall,
    install: rates.install,
    transport: rates.transport,
    csidoFlat: rates.jobRates.find((r) => r.jobType === 'CSIDO')?.price ?? 0,
  };
}

export type EngineLineInput = {
  qty: number;
  type: DandiLineType;
  /** Pricing category of the item's group (Category Mapping); null when unmapped. */
  pricingCategory: string | null;
  /** Category Mapping: true / false, or null when the item's group is not linked yet. */
  installable: boolean | null;
  /** The ERP item REPAIR-MATERIAL: a 13A/15A plug line. */
  isPlug?: boolean;
  /** Fridge capacity from the Stock Master; null / absent when the item has none. */
  litres?: number | null;
};

export type EngineIssue = {
  level: 'error' | 'warning';
  /** Zero-based index of the line, or null when the issue is about the whole note. */
  line: number | null;
  code:
    | 'region'
    | 'qty'
    | 'not-installable'
    | 'unmapped'
    | 'no-pricing-category'
    | 'delivery-only-installable'
    | 'plug-delivery-only'
    | 'plug-old-logic'
    | 'fridge-litres-default';
  message: string;
};

export type EngineLineResult = {
  type: DandiLineType;
  qty: number;
  /** An error on the line keeps it out of the price. */
  blocked: boolean;
  rateKind: 'batch' | 'standard' | 'flat' | 'regional' | null;
  baseRate: number | null;
  discountTier: string | null;
  discountRate: number | null;
  netRate: number | null;
  labour: number;
  transport: number;
  /** CSIDO charge for the note (carried by its first CSIDO line only). */
  charge: number;
  revenue: number;
  note: string;
  /** Litres used for a fridge line priced by the new logic; null otherwise. */
  litres?: number | null;
  /** True for a 13A/15A plug line. */
  plug?: boolean;
};

export type EngineResult = {
  region: string;
  lines: EngineLineResult[];
  note: { csidiQty: number; csiiiQty: number; csidoLines: number; hasCsido: boolean };
  totals: { CSIDI: number; CSIDO: number; CSIII: number; total: number };
  issues: EngineIssue[];
  /** False while any line has an error: the figure is then incomplete. */
  ok: boolean;
};

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const blockedLine = (line: EngineLineInput, note: string): EngineLineResult => ({
  type: line.type,
  qty: line.qty,
  blocked: true,
  rateKind: null,
  baseRate: null,
  discountTier: null,
  discountRate: null,
  netRate: null,
  labour: 0,
  transport: 0,
  charge: 0,
  revenue: 0,
  note,
});

export function priceDeliveryNote(
  master: EngineMaster,
  input: { region: string; lines: EngineLineInput[] },
): EngineResult {
  const issues: EngineIssue[] = [];
  const regionRow = master.transport.find(
    (t) => t.region.toLowerCase() === input.region.trim().toLowerCase(),
  );
  if (!regionRow) {
    issues.push({
      level: 'error',
      line: null,
      code: 'region',
      message: `Choose the region (${master.transport.map((t) => t.region).join(' or ')}); transport is priced by region.`,
    });
  }
  const region = regionRow?.region ?? input.region;

  // Validate every line first; blocked lines are left out of the note's totals.
  const blocked = new Set<number>();
  input.lines.forEach((line, index) => {
    const fail = (code: EngineIssue['code'], message: string) => {
      blocked.add(index);
      issues.push({ level: 'error', line: index, code, message });
    };
    if (!Number.isInteger(line.qty) || line.qty < 1) {
      fail('qty', 'Enter a whole quantity of 1 or more.');
      return;
    }
    if (line.isPlug) {
      if (line.type === 'CSIDO') {
        fail(
          'plug-delivery-only',
          'A 13A/15A plug (REPAIR-MATERIAL) goes on a Delivery + Installation or Installation only line, not Delivery only.',
        );
      } else if (!master.fridge?.enabled) {
        issues.push({
          level: 'warning',
          line: index,
          code: 'plug-old-logic',
          message:
            'The old fridge logic is switched on (Revenue Rate card), so the 13A/15A plug is not charged.',
        });
      }
      return;
    }
    if (line.type === 'CSIDO') {
      if (line.installable === true) {
        issues.push({
          level: 'warning',
          line: index,
          code: 'delivery-only-installable',
          message:
            'This item is installable in the category mapping, but the line is Delivery only (CSIDO). Change it to Delivery + Installation if it is installed.',
        });
      }
      return;
    }
    const what = line.type === 'CSIDI' ? 'Delivery + Installation' : 'Installation only';
    if (line.installable === false) {
      fail(
        'not-installable',
        `This item cannot be installed, so it can only be Delivery only (CSIDO), not ${what}.`,
      );
    } else if (line.installable === null) {
      fail(
        'unmapped',
        `The item group is not linked in the category mapping, so ${what} cannot be priced. Ask the admin to link it.`,
      );
    } else {
      const side = line.type === 'CSIDI' ? master.deliveryInstall : master.install;
      if (!side.categories.some((c) => c.category === line.pricingCategory)) {
        fail(
          'no-pricing-category',
          `The pricing category "${line.pricingCategory ?? ''}" of this item is not in the pricing master.`,
        );
      }
    }
  });

  const valid = input.lines.map((_, i) => !blocked.has(i));
  // A plug is not a unit: it never counts towards the note's quantity, batch rate, tiers or transport.
  const sumQty = (type: DandiLineType) =>
    input.lines.reduce((n, l, i) => (valid[i] && !l.isPlug && l.type === type ? n + l.qty : n), 0);
  const csidiQty = sumQty('CSIDI');
  const csiiiQty = sumQty('CSIII');
  const csidoLines = input.lines.filter(
    (l, i) => valid[i] && !l.isPlug && l.type === 'CSIDO',
  ).length;
  const hasCsido = csidoLines > 0;

  // New fridge logic: the labour of each fridge size group, shared over its lines by quantity.
  const fridgeLabour = new Map<number, { labour: number; rule: string; litres: number }>();
  const fs = master.fridge;
  if (fs?.enabled) {
    const groups = new Map<string, { indexes: number[]; large: boolean; type: DandiLineType }>();
    input.lines.forEach((line, i) => {
      if (!valid[i] || line.isPlug || line.type === 'CSIDO') return;
      if (line.pricingCategory !== FRIDGE_CATEGORY) return;
      const known = typeof line.litres === 'number' && line.litres > 0;
      const litres = known ? (line.litres as number) : DEFAULT_CAPACITY_LITRES;
      if (!known) {
        issues.push({
          level: 'warning',
          line: i,
          code: 'fridge-litres-default',
          message: `No litres in the Stock Master for this fridge, so it is priced as ${DEFAULT_CAPACITY_LITRES} L. Add the capacity in the Stock Master.`,
        });
      }
      const large = litres > FRIDGE_LARGE_THRESHOLD_LITRES;
      const key = `${line.type}|${large}`;
      const group = groups.get(key) ?? { indexes: [], large, type: line.type };
      group.indexes.push(i);
      groups.set(key, group);
      fridgeLabour.set(i, { labour: 0, rule: '', litres });
    });
    for (const group of groups.values()) {
      const side = group.type === 'CSIDI' ? master.deliveryInstall : master.install;
      const cat = side.categories.find((c) => c.category === FRIDGE_CATEGORY) as CategoryRate;
      const units = group.indexes.reduce((n, i) => n + input.lines[i]!.qty, 0);
      const { total, rule } = groupLabour(
        units,
        group.large,
        { market: cat.standardRate, special: cat.batchRate, minimum: cat.minimumRate },
        fs,
      );
      let given = 0;
      group.indexes.forEach((i, k) => {
        const last = k === group.indexes.length - 1;
        const share = last ? round2(total - given) : round2((total * input.lines[i]!.qty) / units);
        given += share;
        const entry = fridgeLabour.get(i)!;
        entry.labour = share;
        entry.rule = rule;
      });
    }
  }

  const seen: Record<DandiLineType, number> = { CSIDI: 0, CSIDO: 0, CSIII: 0 };
  const results: EngineLineResult[] = input.lines.map((line, index) => {
    if (!valid[index]) return blockedLine(line, 'Not priced: fix the error on this line.');
    if (line.isPlug) {
      const on = !!fs?.enabled;
      const labour = on ? line.qty * fs.plugAmount : 0;
      return {
        ...blockedLine(line, ''),
        blocked: false,
        plug: true,
        netRate: on ? fs.plugAmount : 0,
        labour: round2(labour),
        revenue: round2(labour),
        note: on
          ? `13A/15A plug: ${fs.plugAmount} x ${line.qty}, no discount, not a unit, trip or transport.`
          : 'Old fridge logic: the plug is not charged.',
      };
    }
    const first = seen[line.type] === 0;
    seen[line.type] += 1;

    if (line.type === 'CSIDO') {
      if (!first) {
        return {
          ...blockedLine(line, 'Covered by the Delivery only charge on the first such line.'),
          blocked: false,
          rateKind: null,
        };
      }
      const mixed = csidiQty > 0;
      const charge = mixed ? (regionRow?.roundTrip ?? 0) : master.csidoFlat;
      return {
        ...blockedLine(line, ''),
        blocked: false,
        rateKind: mixed ? 'regional' : 'flat',
        charge,
        revenue: round2(charge),
        note: mixed
          ? `One ${region} transport charge for the note, because it also has Delivery + Installation units.`
          : 'One flat Delivery only charge for the note, whatever the quantity.',
      };
    }

    const side = line.type === 'CSIDI' ? master.deliveryInstall : master.install;
    const tierQty = line.type === 'CSIDI' ? csidiQty : csiiiQty;
    const cat = side.categories.find((c) => c.category === line.pricingCategory) as CategoryRate;
    const tier = discountFor(side.discounts, tierQty);
    const batch = tierQty > 1;
    const baseRate = batch ? cat.batchRate : cat.standardRate;
    const fridge = fridgeLabour.get(index);
    const netRate = fridge
      ? fridge.labour / line.qty
      : Math.max(cat.minimumRate, baseRate * (1 - tier.discount));
    let transport = 0;
    if (line.type === 'CSIDI' && first && !hasCsido && csidiQty > 1) {
      transport = regionRow?.roundTrip ?? 0;
    }
    const labour = fridge ? fridge.labour : netRate * line.qty;
    const reason =
      line.type === 'CSIDI'
        ? hasCsido
          ? 'No transport: the note also has Delivery only, whose charge covers the visit.'
          : csidiQty <= 1
            ? 'No transport: a single unit.'
            : first
              ? `Transport charged once for the note (${region}).`
              : 'Transport sits on the first Delivery + Installation line.'
        : 'No transport on installation only.';
    return {
      type: line.type,
      qty: line.qty,
      blocked: false,
      rateKind: batch ? 'batch' : 'standard',
      baseRate,
      discountTier: fridge ? 'No discount tiers' : tier.tier,
      discountRate: fridge ? 0 : tier.discount,
      netRate: round2(netRate),
      labour: round2(labour),
      transport,
      charge: 0,
      revenue: round2(labour + transport),
      note: fridge
        ? `${fridge.rule} (${fridge.litres} L). ${reason}`
        : `${batch ? 'Batch' : 'Standard'} rate ${baseRate} (${tierQty} unit${tierQty === 1 ? '' : 's'} on the note), ${tier.discount * 100}% discount (${tier.tier}). ${reason}`,
      ...(fridge ? { litres: fridge.litres } : {}),
    };
  });

  const totals = { CSIDI: 0, CSIDO: 0, CSIII: 0, total: 0 };
  for (const r of results) totals[r.type] += r.revenue;
  totals.CSIDI = round2(totals.CSIDI);
  totals.CSIDO = round2(totals.CSIDO);
  totals.CSIII = round2(totals.CSIII);
  totals.total = round2(totals.CSIDI + totals.CSIDO + totals.CSIII);

  return {
    region,
    lines: results,
    note: { csidiQty, csiiiQty, csidoLines, hasCsido },
    totals,
    issues,
    ok: !issues.some((i) => i.level === 'error'),
  };
}
