/* D+I quantity-discount tiers -- pure helper for D+I Admin Entry and its unit
 * test (tests/unit/dandi-tiers.test.js). When "Maximum units per quote" changes,
 * the tier table is re-split to match:
 *   - a bigger maximum adds new ranges after the last tier, 10 units wide
 *     (51-60, 61-70, ... up to the maximum). Each new range's discount goes up
 *     2 points on the previous one and stops at the largest whole % that keeps
 *     the unit price at or above the Minimum charge per unit (worked out from
 *     the lowest batch rate: lowest batch x (1 - discount) >= minimum);
 *   - a smaller maximum drops tiers beyond it and trims the last one.
 * Every percentage can be edited afterwards. No DOM, no network.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JdDandiTiers = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var STEP = 10;
  var RISE = 0.02;
  var AUTO_LABEL = /^\d+(–\d+)? units?$/;

  function rangeLabel(min, max) {
    return min === max ? min + ' unit' : min + '–' + max + ' units';
  }

  function round4(n) {
    return Math.round(n * 10000) / 10000;
  }

  // The biggest discount (whole %) that keeps lowestBatchRate x (1 - discount)
  // at or above the minimum charge per unit. 0 when there is no room.
  function maxDiscount(minUnitRate, lowestBatchRate) {
    var low = Number(lowestBatchRate);
    var min = Number(minUnitRate) || 0;
    if (!(low > 0) || low <= min) return 0;
    return Math.floor((1 - min / low) * 100 + 1e-9) / 100;
  }

  // tiers: [{min, max, label, rate}]  ->  { tiers, added, cap }
  //   added = number of new ranges; cap = the largest discount the minimum allows
  // opts: { minUnitRate, lowestBatchRate }  (without them new ranges carry the last discount)
  function resplit(tiers, maxUnits, opts) {
    var hasCap = !!opts && Number(opts.lowestBatchRate) > 0;
    var cap = hasCap ? maxDiscount(opts.minUnitRate, opts.lowestBatchRate) : null;
    var limit = Math.max(1, Math.floor(Number(maxUnits)) || 1);
    var sorted = (tiers || [])
      .map(function (t) {
        return {
          min: Number(t.min),
          max: Number(t.max),
          label: t.label,
          rate: Number(t.rate) || 0,
        };
      })
      .filter(function (t) {
        return isFinite(t.min) && isFinite(t.max) && t.min >= 1 && t.max >= t.min;
      })
      .sort(function (a, b) {
        return a.min - b.min;
      });
    var out = [];
    sorted.forEach(function (t) {
      if (t.min > limit) return;
      var max = Math.min(t.max, limit);
      var label = t.label;
      if (max !== t.max && (!label || AUTO_LABEL.test(String(label))))
        label = rangeLabel(t.min, max);
      out.push({ min: t.min, max: max, label: label || rangeLabel(t.min, max), rate: t.rate });
    });
    if (!out.length)
      return { tiers: [{ min: 1, max: limit, label: rangeLabel(1, limit), rate: 0 }], added: 1 };
    var last = out[out.length - 1];
    var added = 0;
    var start = last.max + 1;
    while (start <= limit) {
      var end = Math.min(start + STEP - 1, limit);
      var prev = out[out.length - 1].rate;
      var rate = hasCap ? Math.max(prev, Math.min(round4(prev + RISE), cap)) : prev;
      out.push({ min: start, max: end, label: rangeLabel(start, end), rate: rate });
      added += 1;
      start = end + 1;
    }
    return { tiers: out, added: added, cap: cap };
  }

  return {
    STEP: STEP,
    RISE: RISE,
    rangeLabel: rangeLabel,
    maxDiscount: maxDiscount,
    resplit: resplit,
  };
});
