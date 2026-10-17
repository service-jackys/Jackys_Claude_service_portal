/* Weekly ROI (Results / Objectives / Issues-Innovation) -- pure logic and email
 * markup shared by the Tasks tab and the Service Revenue Reports pill. No DOM,
 * no network: everything here takes plain data in and returns plain data or
 * strings out, so it can be unit-tested in Node (tests/unit/roi-core.test.ts).
 *
 * Dates are YYYY-MM-DD strings in the Dubai calendar (UTC+4, no daylight
 * saving); weeks are ISO weeks (Monday to Sunday) and a ROI is dated on the
 * Friday of its week, as in the existing "Weekly ROI: Week 40 02-OCT-2026" mails.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JdRoi = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  var MONTH_NAMES = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  var STATUS_LABELS = {
    not_started: 'Not Started',
    in_progress: 'In Progress',
    on_hold: 'On Hold',
    completed: 'Completed',
  };
  var PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
  var KIND_LABELS = { task: 'Task', issue: 'Issue', innovation: 'Innovation', request: 'Request' };
  var PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };
  var STATUS_RANK = { in_progress: 0, on_hold: 1, not_started: 2, completed: 3 };

  // ------------------------------------------------------------------ dates
  function parseDay(day) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '');
    if (!m) throw new Error('Not a YYYY-MM-DD date: ' + day);
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  function dayString(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }
  function addDays(day, n) {
    return dayString(parseDay(day) + n * 86400000);
  }
  function daysBetween(a, b) {
    return Math.round((parseDay(b) - parseDay(a)) / 86400000);
  }
  // Today (or any instant) as a Dubai calendar day.
  function dubaiDay(instant) {
    var ms = instant instanceof Date ? instant.getTime() : new Date(instant).getTime();
    return dayString(ms + 4 * 3600000);
  }

  // ISO week of a day: { year, week, start (Mon), end (Sun), friday }.
  function isoWeek(day) {
    var ms = parseDay(day);
    var weekday = (new Date(ms).getUTCDay() + 6) % 7; // Monday = 0
    var monday = ms - weekday * 86400000;
    var thursday = monday + 3 * 86400000;
    var year = new Date(thursday).getUTCFullYear();
    var week1Thursday = Date.UTC(year, 0, 4);
    week1Thursday -= ((new Date(week1Thursday).getUTCDay() + 6) % 7) * 86400000 - 3 * 86400000;
    var week = 1 + Math.round((thursday - week1Thursday) / (7 * 86400000));
    return {
      year: year,
      week: week,
      start: dayString(monday),
      end: dayString(monday + 6 * 86400000),
      friday: dayString(monday + 4 * 86400000),
    };
  }
  // The Monday-to-Sunday range of ISO week `week` in `year`.
  function isoWeekRange(year, week) {
    var jan4 = Date.UTC(year, 0, 4);
    var mondayOfWeek1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * 86400000;
    var monday = mondayOfWeek1 + (week - 1) * 7 * 86400000;
    return isoWeek(dayString(monday));
  }
  function shiftWeek(day, weeks) {
    return isoWeek(addDays(day, weeks * 7));
  }

  // 2026-10-02 -> 02-OCT-2026
  function formatRoiDate(day) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    return m ? m[3] + '-' + MONTHS[Number(m[2]) - 1] + '-' + m[1] : String(day || '');
  }
  function formatShortDate(day) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '');
    return m
      ? Number(m[3]) +
          ' ' +
          MONTHS[Number(m[2]) - 1].charAt(0) +
          MONTHS[Number(m[2]) - 1].slice(1).toLowerCase()
      : '';
  }

  // ----------------------------------------------------------- task grouping
  function bySort(a, b) {
    return (
      (STATUS_RANK[a.status] || 0) - (STATUS_RANK[b.status] || 0) ||
      (PRIORITY_RANK[a.priority] == null ? 2 : PRIORITY_RANK[a.priority]) -
        (PRIORITY_RANK[b.priority] == null ? 2 : PRIORITY_RANK[b.priority]) ||
      (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31') ||
      Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
    );
  }

  // Splits a user's tasks into the three ROI sections for one ISO week.
  //  results    -- tasks completed inside the week
  //  objectives -- open tasks that have started by the end of the week
  //  issues     -- open issues, innovations and requests
  function groupForWeek(tasks, week) {
    var results = [];
    var objectives = [];
    var issues = [];
    (tasks || []).forEach(function (task) {
      var kind = task.kind || 'task';
      if (kind !== 'task') {
        if (task.status !== 'completed') issues.push(task);
        return;
      }
      if (task.status === 'completed') {
        var done = task.completedAt ? dubaiDay(task.completedAt) : null;
        if (done && done >= week.start && done <= week.end) results.push(task);
        return;
      }
      if (!task.startDate || task.startDate <= week.end) objectives.push(task);
    });
    results.sort(function (a, b) {
      return String(a.completedAt).localeCompare(String(b.completedAt));
    });
    objectives.sort(bySort);
    issues.sort(bySort);
    return { results: results, objectives: objectives, issues: issues };
  }

  // ------------------------------------------------------------ budget maths
  // The budget is monthly, so a week's share is pro-rated by the calendar days
  // the week spends inside that month. `weeks` is [{ key, week, actual, jobs, qty }].
  function weeklyBudget(monthBudget, year, month, weeks) {
    var first = year + '-' + String(month).padStart(2, '0') + '-01';
    var daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    var last =
      year + '-' + String(month).padStart(2, '0') + '-' + String(daysInMonth).padStart(2, '0');
    return (weeks || []).map(function (w) {
      var range = isoWeekRange(year, Number(w.week));
      var from = range.start < first ? first : range.start;
      var to = range.end > last ? last : range.end;
      var days = Math.max(0, daysBetween(from, to) + 1);
      var budget = (Number(monthBudget) || 0) * (days / daysInMonth);
      return {
        week: Number(w.week),
        from: from,
        to: to,
        days: days,
        budget: budget,
        actual: Number(w.actual) || 0,
        jobs: Number(w.jobs) || 0,
        qty: Number(w.qty) || 0,
        variance: (Number(w.actual) || 0) - budget,
        achievement: budget ? ((Number(w.actual) || 0) / budget) * 100 : null,
      };
    });
  }

  // ------------------------------------------------------------- html helpers
  var NAVY = '#12305c';
  var INK = '#1f2933';
  var MUTED = '#667085';
  var LINE = '#e4e7ec';
  var GREEN = '#15803d';
  var RED = '#b42318';
  var FONT = "font-family:'Segoe UI',Calibri,Arial,Helvetica,sans-serif;";

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function nl2br(value) {
    return esc(value).replace(/\r?\n/g, '<br>');
  }
  function money(value) {
    return Math.round(Number(value) || 0).toLocaleString('en-US');
  }
  function pct(part, whole) {
    return whole ? ((part / whole) * 100).toFixed(1) + '%' : '--';
  }

  // A coloured heading band.
  function band(title, color) {
    return (
      '<tr><td style="padding:22px 28px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td bgcolor="' +
      color +
      '" style="background:' +
      color +
      ';padding:9px 14px;' +
      FONT +
      'font-size:13px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#ffffff;">' +
      esc(title) +
      '</td></tr></table></td></tr>'
    );
  }
  // Wraps table rows (already <tr>..</tr>) in the standard content table.
  function wrap(inner) {
    return (
      '<tr><td style="padding:4px 28px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;' +
      FONT +
      'font-size:13px;color:' +
      INK +
      ';">' +
      inner +
      '</table></td></tr>'
    );
  }
  function td(content, opts) {
    opts = opts || {};
    return (
      '<td' +
      (opts.align ? ' align="' + opts.align + '"' : '') +
      (opts.width ? ' width="' + opts.width + '"' : '') +
      ' valign="top" style="padding:8px ' +
      (opts.align === 'right' ? '0 8px 12px' : '8px 8px 0') +
      ';border-bottom:1px solid ' +
      LINE +
      ';' +
      (opts.style || '') +
      '">' +
      content +
      '</td>'
    );
  }
  function th(label, opts) {
    return td(esc(label), {
      align: opts && opts.align,
      width: opts && opts.width,
      style:
        ((opts && opts.style) || '') +
        'color:' +
        MUTED +
        ';font-size:11px;text-transform:uppercase;letter-spacing:.5px;font-weight:600;border-bottom:2px solid ' +
        LINE +
        ';',
    });
  }
  function kpi(label, value, width) {
    return (
      '<td width="' +
      (width || '33%') +
      '" valign="top" style="padding:0 4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f8fc;border:1px solid ' +
      LINE +
      ';border-top:3px solid ' +
      NAVY +
      ';"><tr><td style="padding:12px 10px;' +
      FONT +
      '"><div style="font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:' +
      MUTED +
      ';">' +
      esc(label) +
      '</div><div style="font-size:20px;font-weight:700;color:' +
      NAVY +
      ';padding-top:4px;">' +
      esc(value) +
      '</div></td></tr></table></td>'
    );
  }
  function note(html) {
    return (
      '<tr><td style="padding:8px 28px 0;' +
      FONT +
      'font-size:13px;line-height:1.55;color:' +
      INK +
      ';">' +
      html +
      '</td></tr>'
    );
  }
  function pill(text, color, bg) {
    return (
      '<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:600;color:' +
      color +
      ';background:' +
      bg +
      ';">' +
      esc(text) +
      '</span>'
    );
  }
  function statusPill(status) {
    var label = STATUS_LABELS[status] || status;
    if (status === 'completed') return pill(label, '#116530', '#dcfce7');
    if (status === 'in_progress') return pill(label, '#1d4ed8', '#dbeafe');
    if (status === 'on_hold') return pill(label, '#92400e', '#fef3c7');
    return pill(label, '#475467', '#eef1f5');
  }

  // ------------------------------------------------------ the three sections
  function resultRows(results) {
    if (!results.length) {
      return note('<span style="color:' + MUTED + ';">No tasks were completed this week.</span>');
    }
    return wrap(
      '<tr>' +
        th('Task Description', { width: '36%' }) +
        th('Status', { width: '96' }) +
        th('%', { align: 'right', width: '52' }) +
        th('Remarks / Next Action', { style: 'padding-left:16px;' }) +
        '</tr>' +
        results
          .map(function (t) {
            return (
              '<tr>' +
              td('<strong>' + nl2br(t.title) + '</strong>') +
              td(statusPill(t.status)) +
              td(esc(t.percentComplete) + '%', { align: 'right', style: 'white-space:nowrap;' }) +
              td(nl2br(t.remarks || ''), { style: 'padding-left:16px;' }) +
              '</tr>'
            );
          })
          .join(''),
    );
  }

  function objectiveRows(objectives) {
    if (!objectives.length) {
      return note('<span style="color:' + MUTED + ';">No open objectives.</span>');
    }
    return wrap(
      '<tr>' +
        th('Task Description', { width: '38%' }) +
        th('Target') +
        th('Status') +
        th('Due') +
        th('Next Action') +
        '</tr>' +
        objectives
          .map(function (t) {
            return (
              '<tr>' +
              td('<strong>' + nl2br(t.title) + '</strong>') +
              td(esc(t.percentComplete) + '% &rarr; 100%', { style: 'white-space:nowrap;' }) +
              td(statusPill(t.status)) +
              td(esc(t.dueDate ? formatShortDate(t.dueDate) : ''), {
                style: 'white-space:nowrap;',
              }) +
              td(nl2br(t.remarks || '')) +
              '</tr>'
            );
          })
          .join(''),
    );
  }

  function issueRows(issues) {
    if (!issues.length) {
      return note('<span style="color:' + MUTED + ';">Nothing to report this week.</span>');
    }
    return wrap(
      issues
        .map(function (t) {
          return (
            '<tr>' +
            td(pill(KIND_LABELS[t.kind] || t.kind, '#7c2d12', '#ffedd5'), { width: '90' }) +
            td(
              '<strong>' +
                nl2br(t.title) +
                '</strong>' +
                (t.remarks
                  ? '<div style="color:' +
                    MUTED +
                    ';padding-top:2px;">' +
                    nl2br(t.remarks) +
                    '</div>'
                  : ''),
            ) +
            '</tr>'
          );
        })
        .join(''),
    );
  }

  // ----------------------------------------------- management summary block
  // data = {
  //   monthLabel, totals: { jobs, qty, revenue },
  //   byType: [{ code, label, jobs, revenue }],
  //   weeks: [{ label, jobs, qty, revenue }],
  //   budget: null | { monthLabel, monthBudget, monthActual, achievement,
  //                    weeks: weeklyBudget(...) result, ytd: { budget, actual } | null },
  //   source, uploadedAt
  // }
  function summaryRows(data) {
    if (!data) return '';
    var t = data.totals || {};
    var out = band('Management summary: ' + data.monthLabel, '#1d5fa8');
    out +=
      '<tr><td style="padding:14px 24px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
      kpi('Total jobs', money(t.jobs)) +
      kpi('Total quantity', money(t.qty)) +
      kpi('Effective revenue', 'AED ' + money(t.revenue)) +
      '</tr></table></td></tr>';

    if (data.byType && data.byType.length) {
      out += note('<strong style="color:' + NAVY + ';">Revenue by job type</strong>');
      out += wrap(
        '<tr>' +
          th('Code') +
          th('Activity') +
          th('Jobs', { align: 'right' }) +
          th('Revenue', { align: 'right' }) +
          '</tr>' +
          data.byType
            .map(function (r) {
              return (
                '<tr>' +
                td(esc(r.code), { style: 'font-weight:600;' }) +
                td(esc(r.label)) +
                td(money(r.jobs), { align: 'right' }) +
                td('AED ' + money(r.revenue), { align: 'right', style: 'font-weight:600;' }) +
                '</tr>'
              );
            })
            .join(''),
      );
    }

    if (data.weeks && data.weeks.length) {
      out += note('<strong style="color:' + NAVY + ';">Weekly management summary</strong>');
      out += wrap(
        '<tr>' +
          th('Week') +
          th('Jobs', { align: 'right' }) +
          th('Qty', { align: 'right' }) +
          th('Revenue', { align: 'right' }) +
          '</tr>' +
          data.weeks
            .map(function (w) {
              return (
                '<tr>' +
                td(esc(w.label), { style: 'font-weight:600;' }) +
                td(money(w.jobs), { align: 'right' }) +
                td(money(w.qty), { align: 'right' }) +
                td('AED ' + money(w.revenue), { align: 'right', style: 'font-weight:600;' }) +
                '</tr>'
              );
            })
            .join(''),
      );
    }

    var b = data.budget;
    if (b && b.monthBudget) {
      out += band('Achievement against budget', '#0f766e');
      out +=
        '<tr><td style="padding:14px 24px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
        kpi('Budget ' + b.monthLabel, 'AED ' + money(b.monthBudget)) +
        kpi('Actual revenue', 'AED ' + money(b.monthActual)) +
        kpi('Achievement', pct(b.monthActual, b.monthBudget)) +
        '</tr></table></td></tr>';
      if (b.weeks && b.weeks.length) {
        out += wrap(
          '<tr>' +
            th('Week') +
            th('Budget', { align: 'right' }) +
            th('Actual', { align: 'right' }) +
            th('Variance', { align: 'right' }) +
            th('Achieved', { align: 'right' }) +
            '</tr>' +
            b.weeks
              .map(function (w) {
                var color = w.variance >= 0 ? GREEN : RED;
                return (
                  '<tr>' +
                  td(
                    'W' +
                      w.week +
                      ' <span style="color:' +
                      MUTED +
                      ';">(' +
                      esc(formatShortDate(w.from)) +
                      '&ndash;' +
                      esc(formatShortDate(w.to)) +
                      ')</span>',
                  ) +
                  td('AED ' + money(w.budget), { align: 'right' }) +
                  td('AED ' + money(w.actual), { align: 'right', style: 'font-weight:600;' }) +
                  td((w.variance >= 0 ? '+' : '&minus;') + money(Math.abs(w.variance)), {
                    align: 'right',
                    style: 'font-weight:600;color:' + color + ';',
                  }) +
                  td(w.achievement == null ? '&ndash;' : w.achievement.toFixed(0) + '%', {
                    align: 'right',
                    style: 'color:' + color + ';',
                  }) +
                  '</tr>'
                );
              })
              .join(''),
        );
        out += note(
          '<span style="color:' +
            MUTED +
            ';font-size:12px;">Weekly budget is the monthly budget shared by the calendar days each week falls in the month.</span>',
        );
      }
      if (b.ytd && b.ytd.budget) {
        out += note(
          'Year to date: actual <strong>AED ' +
            money(b.ytd.actual) +
            '</strong> against budget <strong>AED ' +
            money(b.ytd.budget) +
            '</strong> (' +
            pct(b.ytd.actual, b.ytd.budget) +
            ').',
        );
      }
    }
    return out;
  }

  // ------------------------------------------------------------- full email
  // input = {
  //   week: isoWeek(), name, title, greeting, intro, groups: groupForWeek(),
  //   summary: summary data or null, signature
  // }
  function buildRoiHtml(input) {
    var week = input.week;
    var groups = input.groups;
    var heading = 'Week ' + week.week + ' — ' + formatRoiDate(week.friday);
    var html =
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
      esc('Weekly ROI ' + heading) +
      '</title></head><body style="margin:0;padding:0;background:#eef1f5;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;"><tr><td align="center" style="padding:24px 10px;">' +
      '<table role="presentation" width="720" cellpadding="0" cellspacing="0" style="width:100%;max-width:720px;background:#ffffff;border:1px solid ' +
      LINE +
      ';">' +
      '<tr><td bgcolor="' +
      NAVY +
      '" style="background:' +
      NAVY +
      ';padding:24px 28px;' +
      FONT +
      '"><div style="font-size:12px;letter-spacing:1.4px;text-transform:uppercase;color:#a9c2e6;">Weekly ROI &middot; Results, Objectives, Issues / Innovation</div>' +
      '<div style="font-size:24px;font-weight:700;color:#ffffff;padding-top:6px;">' +
      esc(heading.toUpperCase()) +
      '</div>' +
      (input.name
        ? '<div style="font-size:14px;color:#d6e3f5;padding-top:6px;">' +
          esc(input.name) +
          (input.title ? ' &middot; ' + esc(input.title) : '') +
          '</div>'
        : '') +
      '</td></tr>' +
      '<tr><td style="padding:20px 28px 0;' +
      FONT +
      'font-size:14px;line-height:1.55;color:' +
      INK +
      ';">' +
      esc(input.greeting || 'Dear Sir,') +
      '<br>' +
      (input.intro ? '<br>' + nl2br(input.intro) : '<br>For your information,') +
      '</td></tr>' +
      band('Result', '#15803d') +
      resultRows(groups.results) +
      summaryRows(input.summary) +
      band('Objective', '#1d5fa8') +
      objectiveRows(groups.objectives) +
      band('Issues / Innovation', '#b45309') +
      issueRows(groups.issues) +
      '<tr><td style="padding:26px 28px 24px;' +
      FONT +
      'font-size:13px;line-height:1.55;color:' +
      INK +
      ';">' +
      (input.signature ? nl2br(input.signature) : esc(input.name || '')) +
      '</td></tr>' +
      (input.summary
        ? '<tr><td bgcolor="#f5f8fc" style="background:#f5f8fc;border-top:1px solid ' +
          LINE +
          ';padding:12px 28px;' +
          FONT +
          'font-size:11px;line-height:1.5;color:' +
          MUTED +
          ';">Revenue figures are the Revenue calculated in the master Service Dashboard workbook' +
          (input.summary.source ? ' (' + esc(input.summary.source) + ')' : '') +
          '; management analysis, not an ERP ledger extract.</td></tr>'
        : '') +
      '</table></td></tr></table></body></html>';
    return html;
  }

  function line(value) {
    return String(value == null ? '' : value)
      .replace(/\s*\n\s*/g, ' ')
      .trim();
  }
  function buildRoiText(input) {
    var week = input.week;
    var g = input.groups;
    var out = [];
    out.push('WEEK ' + week.week + ' — ' + formatRoiDate(week.friday), '');
    out.push(input.greeting || 'Dear Sir,', '');
    out.push(input.intro ? input.intro : 'For your information,', '');
    out.push('RESULT');
    if (!g.results.length) out.push('  No tasks were completed this week.');
    g.results.forEach(function (t) {
      out.push(
        '  - ' +
          line(t.title) +
          ' [' +
          (STATUS_LABELS[t.status] || t.status) +
          ', ' +
          t.percentComplete +
          '%]' +
          (t.remarks ? ' ' + line(t.remarks) : ''),
      );
    });
    var s = input.summary;
    if (s) {
      out.push('', 'MANAGEMENT SUMMARY: ' + s.monthLabel.toUpperCase());
      out.push(
        '  Total jobs: ' +
          money(s.totals.jobs) +
          ' | Total quantity: ' +
          money(s.totals.qty) +
          ' | Effective revenue: AED ' +
          money(s.totals.revenue),
      );
      (s.byType || []).forEach(function (r) {
        out.push(
          '  - ' + r.code + ' ' + r.label + ': ' + money(r.jobs) + ' jobs, AED ' + money(r.revenue),
        );
      });
      if (s.weeks && s.weeks.length) {
        out.push('  Weekly:');
        s.weeks.forEach(function (w) {
          out.push(
            '  - ' +
              w.label +
              ': ' +
              money(w.jobs) +
              ' jobs, ' +
              money(w.qty) +
              ' qty, AED ' +
              money(w.revenue),
          );
        });
      }
      if (s.budget && s.budget.monthBudget) {
        out.push(
          '  Budget ' +
            s.budget.monthLabel +
            ': AED ' +
            money(s.budget.monthBudget) +
            ' | Actual: AED ' +
            money(s.budget.monthActual) +
            ' | ' +
            pct(s.budget.monthActual, s.budget.monthBudget),
        );
        (s.budget.weeks || []).forEach(function (w) {
          out.push(
            '  - W' +
              w.week +
              ': budget AED ' +
              money(w.budget) +
              ', actual AED ' +
              money(w.actual) +
              (w.achievement == null ? '' : ' (' + w.achievement.toFixed(0) + '%)'),
          );
        });
      }
    }
    out.push('', 'OBJECTIVE');
    if (!g.objectives.length) out.push('  No open objectives.');
    g.objectives.forEach(function (t) {
      out.push(
        '  - ' +
          line(t.title) +
          ' [' +
          t.percentComplete +
          '% -> 100%, ' +
          (STATUS_LABELS[t.status] || t.status) +
          (t.dueDate ? ', due ' + formatShortDate(t.dueDate) : '') +
          ']' +
          (t.remarks ? ' ' + line(t.remarks) : ''),
      );
    });
    out.push('', 'ISSUES / INNOVATION');
    if (!g.issues.length) out.push('  Nothing to report this week.');
    g.issues.forEach(function (t) {
      out.push(
        '  * ' +
          (KIND_LABELS[t.kind] || t.kind) +
          ': ' +
          line(t.title) +
          (t.remarks ? ' - ' + line(t.remarks) : ''),
      );
    });
    out.push('', input.signature || input.name || '');
    return out.join('\n');
  }

  function subjectFor(name, week) {
    var who = line(name || '').toUpperCase();
    return (
      (who ? who + '-' : '') + 'Weekly ROI: Week ' + week.week + ' ' + formatRoiDate(week.friday)
    );
  }

  // ----------------------------------------------------------------- .eml
  // X-Unsent makes Outlook open it as an editable draft with To / Cc filled in.
  function encodeWord(value) {
    // RFC 2047 for non-ASCII subjects.
    if (/^[\x20-\x7e]*$/.test(value)) return value;
    var bytes = new TextEncoder().encode(value);
    var bin = '';
    bytes.forEach(function (b) {
      bin += String.fromCharCode(b);
    });
    return '=?UTF-8?B?' + btoa(bin) + '?=';
  }
  function b64(value) {
    var bytes = new TextEncoder().encode(value);
    var bin = '';
    bytes.forEach(function (b) {
      bin += String.fromCharCode(b);
    });
    return btoa(bin).replace(/(.{76})/g, '$1\r\n');
  }
  function buildEml(opts) {
    var boundary = '=_jd_' + Date.now().toString(36);
    var lines = ['X-Unsent: 1'];
    if (opts.to && opts.to.length) lines.push('To: ' + opts.to.join('; '));
    if (opts.cc && opts.cc.length) lines.push('Cc: ' + opts.cc.join('; '));
    lines.push(
      'Subject: ' + encodeWord(opts.subject),
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="' + boundary + '"',
      '',
      '--' + boundary,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64(opts.text),
      '--' + boundary,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64(opts.html),
      '--' + boundary + '--',
      '',
    );
    return lines.join('\r\n');
  }

  function parseEmails(text) {
    return String(text || '')
      .split(/[\s,;]+/)
      .map(function (v) {
        return v.trim();
      })
      .filter(Boolean);
  }
  function isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  return {
    MONTH_NAMES: MONTH_NAMES,
    STATUS_LABELS: STATUS_LABELS,
    PRIORITY_LABELS: PRIORITY_LABELS,
    KIND_LABELS: KIND_LABELS,
    addDays: addDays,
    daysBetween: daysBetween,
    dubaiDay: dubaiDay,
    isoWeek: isoWeek,
    isoWeekRange: isoWeekRange,
    shiftWeek: shiftWeek,
    formatRoiDate: formatRoiDate,
    formatShortDate: formatShortDate,
    groupForWeek: groupForWeek,
    weeklyBudget: weeklyBudget,
    summaryRows: summaryRows,
    buildRoiHtml: buildRoiHtml,
    buildRoiText: buildRoiText,
    subjectFor: subjectFor,
    buildEml: buildEml,
    parseEmails: parseEmails,
    isEmail: isEmail,
  };
});
