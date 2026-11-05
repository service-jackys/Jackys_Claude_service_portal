/* AMC pricing v2 -- pure calculation shared by the AMC Quote Calculator (New)
 * and its unit test (tests/unit/amc-v2-core.test.ts). No DOM, no network:
 * plain data in, plain data out. Every number comes from the saved
 * "amc_pricing_v2" configuration (AMC Admin Rates (New)); nothing is fixed here.
 *
 * Per appliance line and plan, per year:
 *   planned visits    = plannedVisits x (cost per visit + transport) / appliances per visit
 *   breakdown cost    = calls per unit x cost per call x age risk factor
 *   parts reserve     = parts % x reference value x age risk factor
 *   break-even cost   = (those) x (1 + overhead)
 *   target (cost-plus) rate = break-even x (1 + profit markup)
 * Basic RM is a retainer per appliance (call-outs are charged separately).
 * Quote total = sum(qty x unit rate) -> volume discount by total quantity ->
 * capped at the plan's cap % of total equipment value (cap wins) -> + 5% VAT.
 * Shortfalls against cost are reported as warnings, never blocked.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JdAmcV2 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PLANS = [
    { key: 'basic', label: 'Basic RM' },
    { key: 'standard', label: 'Standard PMC' },
    { key: 'premium', label: 'Premium PMC' },
  ];
  var VAT = 0.05;

  function num(value) {
    var n = Number(value);
    return isFinite(n) ? n : 0;
  }

  // Cost of one technician-team visit (labour only).
  function costPerVisit(cfg) {
    var l = cfg.labour;
    var perHour = (num(l.salary) * num(l.technicians)) / num(l.workingDays) / num(l.hoursPerDay);
    return perHour * num(l.visitHours);
  }

  // Cost of one planned visit attributed to one appliance.
  function visitCostPerAppliance(cfg) {
    var l = cfg.labour;
    return (costPerVisit(cfg) + num(l.transportPerVisit)) / (num(l.handledPerVisit) || 1);
  }

  function discountFor(cfg, totalQty) {
    var pct = 0;
    var best = 0;
    cfg.volumeLadder.forEach(function (step) {
      if (totalQty >= step.minQty && step.minQty >= best) {
        best = step.minQty;
        pct = num(step.discountPct);
      }
    });
    return pct;
  }

  function overrideFor(cfg, name, planKey) {
    var row = (cfg.rateOverrides || []).find(function (r) {
      return String(r.name).toLowerCase() === String(name).toLowerCase();
    });
    if (!row) return null;
    var v = row[planKey];
    return v === null || v === undefined || v === '' || num(v) === 0 ? null : num(v);
  }

  // lines: [{ name, qty, refValue }]; ageIndex: index into cfg.ageBands.
  function computeQuote(cfg, lines, ageIndex) {
    var band = cfg.ageBands[ageIndex] || cfg.ageBands[0];
    var ageFactor = num(band.riskFactor);
    var live = (lines || []).filter(function (l) {
      return num(l.qty) > 0;
    });
    var totalQty = live.reduce(function (s, l) {
      return s + num(l.qty);
    }, 0);
    var totalValue = live.reduce(function (s, l) {
      return s + num(l.qty) * num(l.refValue);
    }, 0);
    var discountPct = discountFor(cfg, totalQty);
    var visitCost = visitCostPerAppliance(cfg);
    var breakdown =
      num(cfg.breakdown.callsPerUnitPerYear) * num(cfg.breakdown.costPerCall) * ageFactor;
    var missingValue = live.some(function (l) {
      return !(num(l.refValue) > 0);
    });

    var plans = PLANS.map(function (plan) {
      var p = cfg.plans[plan.key];
      var rows = live.map(function (l) {
        var direct;
        if (plan.key === 'basic') {
          direct = num(p.adminCostPerUnit);
        } else {
          direct =
            num(p.plannedVisits) * visitCost +
            breakdown +
            num(p.partsReservePct) * num(l.refValue) * ageFactor;
        }
        var breakEven = direct * (1 + num(cfg.overhead));
        var target = breakEven * (1 + num(cfg.profitMarkup));
        var override = overrideFor(cfg, l.name, plan.key);
        var rate =
          override !== null ? override : plan.key === 'basic' ? num(p.retainerPerUnit) : target;
        return {
          name: l.name,
          qty: num(l.qty),
          refValue: num(l.refValue),
          unitRate: rate,
          overridden: override !== null,
          lineTotal: rate * num(l.qty),
          breakEvenTotal: breakEven * num(l.qty),
          targetTotal: target * num(l.qty),
        };
      });
      var listTotal = rows.reduce(function (s, r) {
        return s + r.lineTotal;
      }, 0);
      var breakEvenTotal = rows.reduce(function (s, r) {
        return s + r.breakEvenTotal;
      }, 0);
      var targetTotal = rows.reduce(function (s, r) {
        return s + r.targetTotal;
      }, 0);
      var discounted = listTotal * (1 - discountPct);
      var capTotal = num(p.capPct) > 0 && totalValue > 0 ? num(p.capPct) * totalValue : null;
      var capApplied = capTotal !== null && discounted > capTotal;
      var price = capApplied ? capTotal : discounted;
      var perUnit = totalQty > 0 ? price / totalQty : 0;
      var flags = [];
      if (totalQty > 0) {
        if (price < breakEvenTotal - 0.005) {
          flags.push({
            level: 'red',
            code: 'below-cost',
            text: 'Below minimum margin: price is under break-even cost',
            shortfall: breakEvenTotal - price,
          });
        } else if (price < targetTotal - 0.005) {
          flags.push({
            level: 'amber',
            code: 'below-target',
            text: 'Below the target profit margin',
            shortfall: targetTotal - price,
          });
        }
        if (perUnit < num(cfg.corridor.minPerUnit) - 0.005) {
          flags.push({
            level: 'amber',
            code: 'corridor-low',
            text: 'Price per appliance is under the usual range',
          });
        } else if (
          num(cfg.corridor.maxPerUnit) > 0 &&
          perUnit > num(cfg.corridor.maxPerUnit) + 0.005
        ) {
          flags.push({
            level: 'amber',
            code: 'corridor-high',
            text: 'Price per appliance is above the usual range',
          });
        }
        if (missingValue && plan.key !== 'basic') {
          flags.push({
            level: 'amber',
            code: 'missing-value',
            text: 'Some appliances have no reference value, so parts and the cap are understated',
          });
        }
      }
      return {
        planKey: plan.key,
        planLabel: plan.label,
        lines: rows,
        listTotal: listTotal,
        discountPct: discountPct,
        discountedTotal: discounted,
        capPct: num(p.capPct),
        capTotal: capTotal,
        capApplied: capApplied,
        priceExclVat: price,
        priceInclVat: price * (1 + VAT),
        perUnit: perUnit,
        pctOfValue: totalValue > 0 ? price / totalValue : 0,
        breakEvenTotal: breakEvenTotal,
        targetTotal: targetTotal,
        plannedVisitsTotal: plan.key === 'basic' ? 0 : num(p.plannedVisits) * totalQty,
        flags: flags,
      };
    });

    return {
      ageLabel: band.label,
      ageFactor: ageFactor,
      totalQty: totalQty,
      totalValue: totalValue,
      discountPct: discountPct,
      plans: plans,
      callOut: {
        labourCharge: num(cfg.callOut.labourCharge),
        basicRate: num(cfg.callOut.labourCharge) * (1 - num(cfg.callOut.basicDiscountPct)),
        handlingCharge: num(cfg.callOut.handlingCharge),
      },
    };
  }

  // The ORIGINAL AMC calculation (amc_pricing), re-implemented here only so the
  // new calculator can show the old prices for the same appliances. The original
  // calculator's own code is untouched.
  function computeOld(old, totalQty, totalValue) {
    if (!(totalQty > 0)) return [];
    var cpv = ((old.salary * old.technicians) / old.workingDays / old.hoursPerDay) * old.visitHours;
    var tiers = old.basicVisitTiers.slice().sort(function (a, b) {
      return a[0] - b[0];
    });
    var basicVisits = 0;
    tiers.forEach(function (t) {
      if (totalQty >= t[0]) basicVisits = t[1];
    });
    function plan(label, visits, reserve, pct) {
      var labor = visits * cpv;
      var transport = visits * old.transportPerVisit;
      var parts = Math.max(totalValue * (reserve || 0), 0);
      var direct = labor + transport + parts;
      var overhead = direct * old.overhead;
      var excl = Math.max(
        direct + overhead + (direct + overhead) * old.profitMarkup,
        totalValue * pct,
      );
      return { label: label, priceExclVat: excl, priceInclVat: excl * (1 + VAT) };
    }
    var standardVisits = Math.ceil(
      (totalQty * old.standardPct * (1 + old.riskUplift) * old.standardVisits) /
        old.handledPerVisit,
    );
    var premiumVisits = Math.ceil(
      (totalQty * old.premiumPct * (1 + old.riskUplift) * old.premiumVisits) / old.handledPerVisit,
    );
    return [
      plan('Basic RM', basicVisits, 0, old.basicPct),
      plan('Standard PMC', standardVisits, old.standardPartsReserve, old.standardPct),
      plan('Premium PMC', premiumVisits, old.premiumPartsReserve, old.premiumPct),
    ];
  }

  return {
    PLANS: PLANS,
    costPerVisit: costPerVisit,
    visitCostPerAppliance: visitCostPerAppliance,
    discountFor: discountFor,
    computeQuote: computeQuote,
    computeOld: computeOld,
  };
});
