/* Thomson project timeline -- pure schedule maths (modification #218).
 * No DOM, no network: plain data in, plain data out, so it is unit-tested in
 * Node (tests/unit/thomson-schedule.test.ts) and reused by the calculator's
 * Project timeline tab and the Smart advice card.
 *
 * Install hours for a line = qty x avgMin / 60. The team works
 * technicians x hours-per-day hours each working day.
 *   continuous : all lines share the team, rounded up to whole days once.
 *   phased     : every phase is rounded up on its own (minimum 1 day), and a
 *                readiness gap (calendar days, nobody on site) sits between
 *                phases.
 * Site-survey and training trips are separate days and are added in both modes.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JdThomsonSchedule = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function num(value) {
    var n = Number(value);
    return isFinite(n) ? n : 0;
  }

  function capacityPerDay(techCount, hoursDay) {
    return Math.max(0, num(techCount) * num(hoursDay));
  }

  // days needed for `hours` of install work; a phase that has work is >= 1 day.
  function daysFor(hours, capacity) {
    if (!(hours > 0) || !(capacity > 0)) return 0;
    return Math.max(1, Math.ceil(hours / capacity - 1e-9));
  }

  /**
   * lines : [{ hoursPerUnit, qty, extraDays }]  (extraDays = survey + training trips)
   * phases: [{ name, qty: [qty for each line], gapDays }]  -- only when mode='phased'
   * returns { mode, capacity, totalHours, installDays, extraDays, workingDays,
   *           gapDays, calendarDays, phases: [{ name, hours, days, gapDays }] }
   */
  function computeSchedule(input) {
    var lines = input.lines || [];
    var capacity = capacityPerDay(input.techCount, input.hoursDay);
    var extraDays = lines.reduce(function (sum, l) {
      return sum + num(l.extraDays);
    }, 0);
    var mode = input.mode === 'phased' ? 'phased' : 'continuous';
    var totalHours = lines.reduce(function (sum, l) {
      return sum + num(l.qty) * num(l.hoursPerUnit);
    }, 0);
    var phases = [];
    var installDays;
    var gapDays = 0;
    if (mode === 'phased') {
      var list = input.phases || [];
      list.forEach(function (phase, index) {
        var hours = lines.reduce(function (sum, l, i) {
          return sum + num((phase.qty || [])[i]) * num(l.hoursPerUnit);
        }, 0);
        var gap = index === 0 ? 0 : Math.max(0, num(phase.gapDays));
        phases.push({
          name: phase.name || 'Phase ' + (index + 1),
          hours: hours,
          days: daysFor(hours, capacity),
          gapDays: gap,
          gapSource: phase.gapSource || 'default',
        });
      });
      installDays = phases.reduce(function (sum, p) {
        return sum + p.days;
      }, 0);
      gapDays = phases.reduce(function (sum, p) {
        return sum + p.gapDays;
      }, 0);
    } else {
      installDays = daysFor(totalHours, capacity);
    }
    var workingDays = installDays + extraDays;
    return {
      mode: mode,
      capacity: capacity,
      totalHours: totalHours,
      installDays: installDays,
      extraDays: extraDays,
      workingDays: workingDays,
      gapDays: gapDays,
      calendarDays: workingDays + gapDays,
      phases: phases,
    };
  }

  /**
   * Spreads the project's installation days over its lines, so the transport
   * cost matches the schedule: the days are worked out for the whole team once
   * and every line carries its share by install hours (a day is in one region
   * at a time). The shares add up to exactly the project's installation days.
   * hours: install hours per line (continuous), or per phase when `phaseHours`
   * is given ([phase][line]); each phase is rounded up on its own.
   */
  function allocateInstallDays(hours, capacity, phaseHours) {
    var shares = hours.map(function () {
      return 0;
    });
    var groups = phaseHours && phaseHours.length ? phaseHours : [hours];
    groups.forEach(function (group) {
      var total = group.reduce(function (sum, h) {
        return sum + num(h);
      }, 0);
      var days = daysFor(total, capacity);
      if (!(total > 0)) return;
      group.forEach(function (h, i) {
        shares[i] += (days * num(h)) / total;
      });
    });
    return shares;
  }

  /** Add `days` working days to an ISO date (YYYY-MM-DD), skipping Saturday
   *  and Sunday (UAE private-sector week; Friday is a working day). */
  function addWorkingDays(startIso, days) {
    var d = new Date(startIso + 'T00:00:00Z');
    var left = Math.max(0, Math.ceil(num(days)));
    while (left > 0) {
      d.setUTCDate(d.getUTCDate() + 1);
      var dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) left -= 1;
    }
    return d.toISOString().slice(0, 10);
  }

  return {
    capacityPerDay: capacityPerDay,
    daysFor: daysFor,
    computeSchedule: computeSchedule,
    allocateInstallDays: allocateInstallDays,
    addWorkingDays: addWorkingDays,
  };
});
