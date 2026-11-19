/* D+I quantity-discount tiers -- pure helper for D+I Admin Entry and its unit
 * test (tests/unit/dandi-tiers.test.js). When "Maximum units per quote" changes,
 * the tier table is re-split to match:
 *   - a bigger maximum adds new ranges after the last tier, 10 units wide
 *     (51-60, 61-70, ... up to the maximum), each starting with the previous
 *     tier's discount so saving without editing changes no price;
 *   - a smaller maximum drops tiers beyond it and trims the last one.
 * The percentages are always the user's to set. No DOM, no network.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JdDandiTiers = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var STEP = 10;
  var AUTO_LABEL = /^\d+(–\d+)? units?$/;

  function rangeLabel(min, max) {
    return min === max ? min + ' unit' : min + '–' + max + ' units';
  }

  // tiers: [{min, max, label, rate}]  ->  { tiers, added }  (added = number of new ranges)
  function resplit(tiers, maxUnits) {
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
      out.push({ min: start, max: end, label: rangeLabel(start, end), rate: last.rate });
      added += 1;
      start = end + 1;
    }
    return { tiers: out, added: added };
  }

  return { STEP: STEP, rangeLabel: rangeLabel, resplit: resplit };
});
