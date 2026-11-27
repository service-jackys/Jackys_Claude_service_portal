/* D+I quote calculation -- pure maths shared by the D+I Quote Calculator page
 * and its unit test (tests/unit/dandi-calc-core.test.ts). No DOM, no network:
 * plain data in, plain data out. Every rate, discount, region and factor comes
 * from the saved "dandi_pricing" configuration (D+I Admin Entry); nothing is
 * fixed here except the rule that one trip carries up to 17 units.
 *
 * It follows the original Apps Script D+I calculator exactly, so both portals
 * give the same price for the same inputs:
 *   - a quantity discount (and the batch rate) applies only when the quote is
 *     for one customer at one site with more than one unit;
 *   - the unit price is never below the minimum unit rate;
 *   - the crew factor multiplies the labour charge;
 *   - transport is charged per planned trip at the region's round-trip cost
 *     (always for D+I with more than one unit; a Yes/No choice for
 *     Installation Only);
 *   - D+I needs enough planned trips (up to 17 units = 1 trip, more = 2).
 *
 * Extra discount (an admin option on the page, not part of the old calculator):
 * a % or an AED amount off the appliance charges (never the transport). It is
 * limited so that no unit price drops below the Minimum charge per unit: each
 * line can give up at most qty x (unit price - minimum), the discount is shared
 * across the lines in proportion to that room, and anything asked for beyond
 * the total room is cut back to it (reported as capped).
 *
 * New fridge and plug logic (modification #312). When the saved fridge settings
 * are passed in as input.fridgeLogic and switched on, a quote has two fridge
 * boxes (400 L and under / over 400 L) priced as a group with no discount tiers,
 * and a 13A/15A plug box. The group rule is the same one the Service Revenue
 * Dashboard and the D+I Billing engine use (a test keeps the three equal):
 *   400 L and under: 1 unit = market rate; 2-10 = base; above 10 = second tier
 *                    (Option B: only the units above 10; Option A: every unit);
 *                    never below the fridge minimum;
 *   over 400 L:      1 unit = market rate; 2 or more = special rate;
 *   plug:            amount x quantity, no discount, not a unit, trip or crew-adjusted.
 * Market and special are the mode's standard and batch rates for the fridge.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JdDandiCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var SAME_SITE = 'Same customer / same site';
  var ONE_TRIP_UNITS = 17;
  var KINDS = [
    { key: 'fridge', label: 'Refrigerator' },
    { key: 'washer', label: 'Washing Machine' },
    { key: 'cooker', label: 'Cooker' },
    { key: 'dishwasher', label: 'Dishwasher' },
  ];

  function num(value) {
    var n = Number(value);
    return isFinite(n) ? n : 0;
  }

  function round2(value) {
    return Math.round((num(value) + Number.EPSILON) * 100) / 100;
  }

  // The discount row for a quantity: the last row whose minimum is reached.
  function discountFor(mode, total) {
    var rows = (mode && mode.discounts) || [];
    var match = rows[0] || { label: '1 unit', rate: 0 };
    rows.forEach(function (row) {
      if (total >= num(row.min)) match = row;
    });
    return match;
  }

  // Group labour of `units` fridges of one size group (same rule as groupLabour in
  // apps/api/src/revenue-dashboard/fridge-scenario.ts). rates: {market, special, minimum}.
  // noteUnits: all units of the job on the note (every category). One fridge on a note of 2 or more units
  // takes the batch rate; only a note with a single unit in total pays the market rate.
  function fridgeGroupLabour(units, large, rates, f, noteUnits) {
    if (units <= 0) return { total: 0, rule: '' };
    var clubbed = units === 1 && num(noteUnits) >= 2;
    var onNote = clubbed ? '1 fridge on a note of ' + noteUnits + ' units' : units + ' units';
    if (large) {
      if (units === 1 && !clubbed)
        return {
          total: Math.max(num(rates.minimum), num(rates.market)),
          rule: 'Over 400 L, 1 unit: market rate',
        };
      return {
        total: units * Math.max(num(rates.minimum), num(rates.special)),
        rule: 'Over 400 L, ' + onNote + ': special rate, no discount tiers',
      };
    }
    var min = num(f.smallMinimum);
    if (units === 1 && !clubbed)
      return {
        total: Math.max(min, num(rates.market)),
        rule: '400 L and under, 1 unit: market rate',
      };
    var base = Math.max(min, num(f.smallBase));
    var over = Math.max(min, num(f.smallOver10));
    if (units <= 10)
      return {
        total: units * base,
        rule: '400 L and under, ' + onNote + ': base rate, no discount tiers',
      };
    if (f.optionB)
      return {
        total: 10 * base + (units - 10) * over,
        rule:
          '400 L and under, ' +
          units +
          ' units: first 10 at base, ' +
          (units - 10) +
          ' above 10 at second tier',
      };
    return {
      total: units * over,
      rule: '400 L and under, ' + units + ' units: all units at second tier',
    };
  }

  function requiredTrips(total) {
    if (total <= 0) return 0;
    return total <= ONE_TRIP_UNITS ? 1 : 2;
  }

  // input: { mode: 'dandi'|'install', region, grouping, sites, plannedTrips,
  //          crew, transport: 'Yes'|'No' (Installation Only), qty: {fridge, washer, cooker, dishwasher} }
  function compute(cfg, input) {
    var modeKey = input.mode === 'install' ? 'install' : 'dandi';
    var mode = cfg.modes[modeKey];
    var sites = Math.max(0, Math.floor(num(input.sites)));
    var plannedTrips = Math.max(0, Math.floor(num(input.plannedTrips)));
    var crew = Math.max(0, Math.floor(num(input.crew))) || 2;
    var qty = {};
    KINDS.forEach(function (k) {
      qty[k.key] = Math.max(0, Math.floor(num(input.qty && input.qty[k.key])));
    });
    var fl = input.fridgeLogic || null;
    var newFridge = !!(fl && fl.enabled);
    qty.fridgeLarge = Math.max(0, Math.floor(num(input.qty && input.qty.fridgeLarge)));
    // Without the new logic there is one fridge box: both sizes are plain fridges at the market rate.
    if (!newFridge) {
      qty.fridge += qty.fridgeLarge;
      qty.fridgeLarge = 0;
    }
    var plugQty = newFridge ? Math.max(0, Math.floor(num(input.qty && input.qty.plug))) : 0;
    var plugAmount = newFridge ? Math.max(0, num(fl.plugAmount)) : 0;
    var total = qty.fridge + qty.fridgeLarge + qty.washer + qty.cooker + qty.dishwasher;
    var region = (cfg.regions || []).filter(function (r) {
      return String(r.name) === String(input.region);
    })[0];
    var maxUnits = num(cfg.maxUnits);
    var overLimit = total > maxUnits;

    var eligible = total > 1 && total <= maxUnits && input.grouping === SAME_SITE && sites === 1;
    var tier = discountFor(mode, Math.min(total, maxUnits));
    var discount = eligible
      ? tier
      : { label: overLimit ? 'Over limit' : total ? 'No discount' : '—', rate: 0 };

    var needTrips = requiredTrips(total);
    var transportYes = modeKey === 'dandi' ? total > 1 : input.transport === 'Yes';
    var tripsSufficient = modeKey !== 'dandi' || plannedTrips >= needTrips;
    var crewFactor = num((cfg.crewFactors || {})[crew]) || 1;

    var lineKinds = KINDS.slice();
    if (newFridge) lineKinds.splice(1, 0, { key: 'fridgeLarge', label: 'Refrigerator over 400 L' });
    var lines = lineKinds.map(function (k) {
      var isFridge = newFridge && (k.key === 'fridge' || k.key === 'fridgeLarge');
      var rs = mode.rates[k.key === 'fridgeLarge' ? 'fridge' : k.key];
      var rate = eligible ? num(rs.batch) : num(rs.standard);
      var label = isFridge && k.key === 'fridge' ? 'Refrigerator, 400 L and under' : k.label;
      if (isFridge) {
        // Group price: only when the quote is one customer / one site with more than one unit;
        // otherwise every fridge is a single unit at the market rate. No discount tiers either way.
        var units = qty[k.key];
        var g =
          overLimit || !total
            ? { total: 0, rule: '' }
            : eligible
              ? fridgeGroupLabour(
                  units,
                  k.key === 'fridgeLarge',
                  {
                    market: rs.standard,
                    special: rs.batch,
                    minimum: cfg.minUnitRate,
                  },
                  fl,
                  total,
                )
              : {
                  total:
                    units *
                    Math.max(
                      k.key === 'fridge' ? num(fl.smallMinimum) : num(cfg.minUnitRate),
                      num(rs.standard),
                    ),
                  rule: 'Not one customer at one site: market rate per unit',
                };
        var floor = k.key === 'fridge' ? num(fl.smallMinimum) : num(cfg.minUnitRate);
        return {
          key: k.key,
          label: label,
          qty: units,
          listRate: num(rs.standard),
          unit: units ? g.total / units : 0,
          chargedUnit: units ? (g.total / units) * crewFactor : 0,
          listTotal: g.total * crewFactor,
          lineTotal: g.total * crewFactor,
          floor: floor,
          rule: g.rule,
          fridgeGroup: true,
        };
      }
      var unit =
        overLimit || !total ? 0 : Math.max(num(cfg.minUnitRate), rate * (1 - num(discount.rate)));
      var labour = qty[k.key] * unit;
      return {
        key: k.key,
        label: label,
        qty: qty[k.key],
        listRate: rate,
        // Price of one unit after the quantity discount (before the crew factor).
        unit: unit,
        // Price of one unit the customer pays (after the crew factor), so
        // qty x chargedUnit = lineTotal.
        chargedUnit: unit * crewFactor,
        listTotal: qty[k.key] * rate * crewFactor,
        lineTotal: labour * crewFactor,
        floor: num(cfg.minUnitRate),
        rule: '',
        fridgeGroup: false,
      };
    });

    var minRate = num(cfg.minUnitRate);
    var subtotal = lines.reduce(function (s, l) {
      return s + l.lineTotal;
    }, 0);
    lines.forEach(function (l) {
      l.room = l.qty > 0 && l.chargedUnit > l.floor ? l.qty * (l.chargedUnit - l.floor) : 0;
    });
    var maxExtra = lines.reduce(function (s, l) {
      return s + l.room;
    }, 0);
    var extraIn = input.extra || {};
    var extraType = extraIn.type === 'amount' ? 'amount' : 'percent';
    var extraValue = Math.max(0, num(extraIn.value));
    var requested = extraType === 'percent' ? (subtotal * extraValue) / 100 : extraValue;
    var applied = Math.min(requested, maxExtra);
    var capped = requested > maxExtra + 1e-9;
    lines.forEach(function (l) {
      l.extraDiscount = maxExtra > 0 ? (applied * l.room) / maxExtra : 0;
      l.netTotal = l.lineTotal - l.extraDiscount;
      l.netUnit = l.qty ? l.netTotal / l.qty : 0;
    });
    var lowestNetUnit = lines
      .filter(function (l) {
        return l.qty > 0;
      })
      .reduce(function (m, l) {
        return Math.min(m, l.netUnit);
      }, Infinity);
    if (!isFinite(lowestNetUnit)) lowestNetUnit = 0;

    var listTotal = lines.reduce(function (s, l) {
      return s + l.listTotal;
    }, 0);
    var crewAdjusted = subtotal;
    var discountAmount = listTotal - crewAdjusted;
    var transport =
      region && transportYes && !overLimit ? plannedTrips * num(region.roundTripCost) : 0;
    var valid = !!region && total > 0 && !overLimit && tripsSufficient;
    // 13A/15A plugs: amount x quantity on top, no discount, never crew-adjusted, not a unit or trip.
    var plugTotal = valid ? plugQty * plugAmount : 0;
    var totalCharge = valid ? crewAdjusted - applied + transport + plugTotal : 0;

    // Internal view (D+I only, as in the original): labour cost + transport.
    var labourMinutes = lines.reduce(function (s, l) {
      return s + l.qty * num((cfg.laborMinutes || {})[l.key === 'fridgeLarge' ? 'fridge' : l.key]);
    }, 0);
    var labourCost =
      modeKey === 'dandi' ? (labourMinutes / 60) * num(cfg.laborCostPerHour) * crewFactor : 0;
    var estimatedCost = modeKey === 'dandi' ? labourCost + transport : 0;

    var blocked = overLimit
      ? 'Maximum ' + maxUnits + ' units per quote — split this quote.'
      : total === 0
        ? 'Enter appliance quantities.'
        : !region
          ? 'Select a valid region.'
          : !tripsSufficient
            ? 'Planned trips are insufficient. Required trips: ' + needTrips + '.'
            : '';

    return {
      modeKey: modeKey,
      modeLabel: mode.label,
      region: region || null,
      grouping: input.grouping || '',
      sites: sites,
      plannedTrips: plannedTrips,
      crew: crew,
      crewFactor: crewFactor,
      qty: qty,
      total: total,
      eligible: eligible,
      discount: discount,
      requiredTrips: needTrips,
      tripsSufficient: tripsSufficient,
      transportYes: transportYes,
      lines: lines,
      listTotal: listTotal,
      discountAmount: discountAmount,
      crewAdjusted: crewAdjusted,
      extra: {
        type: extraType,
        value: extraValue,
        requested: requested,
        applied: applied,
        max: maxExtra,
        maxPercent: subtotal ? (maxExtra / subtotal) * 100 : 0,
        capped: capped,
        lowestNetUnit: lowestNetUnit,
        minUnitRate: minRate,
      },
      netUnitsTotal: crewAdjusted - applied,
      transport: transport,
      totalCharge: totalCharge,
      newFridge: newFridge,
      plug: { qty: plugQty, amount: plugAmount, total: plugTotal },
      averagePerUnit: valid && total ? (totalCharge - plugTotal) / total : 0,
      estimatedCost: estimatedCost,
      margin: totalCharge - estimatedCost,
      marginPct: totalCharge ? (totalCharge - estimatedCost) / totalCharge : 0,
      valid: valid,
      blocked: blocked,
    };
  }

  return {
    SAME_SITE: SAME_SITE,
    KINDS: KINDS,
    round2: round2,
    discountFor: discountFor,
    requiredTrips: requiredTrips,
    fridgeGroupLabour: fridgeGroupLabour,
    compute: compute,
  };
});
