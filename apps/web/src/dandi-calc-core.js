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

  function requiredTrips(total) {
    if (total <= 0) return 0;
    return total <= ONE_TRIP_UNITS ? 1 : 2;
  }

  // input: { mode: 'dandi'|'install', region, grouping, sites, plannedTrips,
  //          crew, transport: 'Yes'|'No' (Installation Only), qty: {fridge, washer, cooker} }
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
    var total = qty.fridge + qty.washer + qty.cooker;
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

    var lines = KINDS.map(function (k) {
      var rs = mode.rates[k.key];
      var rate = eligible ? num(rs.batch) : num(rs.standard);
      var unit =
        overLimit || !total ? 0 : Math.max(num(cfg.minUnitRate), rate * (1 - num(discount.rate)));
      var labour = qty[k.key] * unit;
      return {
        key: k.key,
        label: k.label,
        qty: qty[k.key],
        listRate: rate,
        // Price of one unit after the quantity discount (before the crew factor).
        unit: unit,
        // Price of one unit the customer pays (after the crew factor), so
        // qty x chargedUnit = lineTotal.
        chargedUnit: unit * crewFactor,
        listTotal: qty[k.key] * rate * crewFactor,
        lineTotal: labour * crewFactor,
      };
    });

    var listTotal = lines.reduce(function (s, l) {
      return s + l.listTotal;
    }, 0);
    var crewAdjusted = lines.reduce(function (s, l) {
      return s + l.lineTotal;
    }, 0);
    var discountAmount = listTotal - crewAdjusted;
    var transport =
      region && transportYes && !overLimit ? plannedTrips * num(region.roundTripCost) : 0;
    var valid = !!region && total > 0 && !overLimit && tripsSufficient;
    var totalCharge = valid ? crewAdjusted + transport : 0;

    // Internal view (D+I only, as in the original): labour cost + transport.
    var labourMinutes = lines.reduce(function (s, l) {
      return s + l.qty * num((cfg.laborMinutes || {})[l.key]);
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
      transport: transport,
      totalCharge: totalCharge,
      averagePerUnit: valid && total ? totalCharge / total : 0,
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
    compute: compute,
  };
});
