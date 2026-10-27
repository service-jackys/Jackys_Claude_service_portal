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
import type { DandiPricingInput } from '../../../../packages/contracts/src/index.js';
import { masterRates } from '../revenue-dashboard/logic-summary.js';
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
};

/** The rate tables the engine needs, read from the D+I Admin Entry pricing master. */
export function engineMasterFromDandi(dandi: DandiPricingInput): EngineMaster {
  const rates = masterRates(dandi, DEFAULT_PRICING_RULES);
  return {
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
    | 'delivery-only-installable';
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
  const sumQty = (type: DandiLineType) =>
    input.lines.reduce((n, l, i) => (valid[i] && l.type === type ? n + l.qty : n), 0);
  const csidiQty = sumQty('CSIDI');
  const csiiiQty = sumQty('CSIII');
  const csidoLines = input.lines.filter((l, i) => valid[i] && l.type === 'CSIDO').length;
  const hasCsido = csidoLines > 0;

  const seen: Record<DandiLineType, number> = { CSIDI: 0, CSIDO: 0, CSIII: 0 };
  const results: EngineLineResult[] = input.lines.map((line, index) => {
    if (!valid[index]) return blockedLine(line, 'Not priced: fix the error on this line.');
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
    const netRate = Math.max(cat.minimumRate, baseRate * (1 - tier.discount));
    let transport = 0;
    if (line.type === 'CSIDI' && first && !hasCsido && csidiQty > 1) {
      transport = regionRow?.roundTrip ?? 0;
    }
    const labour = netRate * line.qty;
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
      discountTier: tier.tier,
      discountRate: tier.discount,
      netRate: round2(netRate),
      labour: round2(labour),
      transport,
      charge: 0,
      revenue: round2(labour + transport),
      note: `${batch ? 'Batch' : 'Standard'} rate ${baseRate} (${tierQty} unit${tierQty === 1 ? '' : 's'} on the note), ${tier.discount * 100}% discount (${tier.tier}). ${reason}`,
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
