/* Thomson quotation print wording (modification #302).
 * Pure text/number logic, no DOM and no network, so it is unit-tested in Node
 * (tests/unit/thomson-terms-core.test.ts) and used by the printed quotation in
 * app.js. It builds, from a saved sale:
 *   - the price lines with transport folded into "Services" (the customer never
 *     sees transport named; the portal keeps the split),
 *   - the VAT lines,
 *   - the "Services in this quotation" section from the ticked add-ons,
 *   - the "Phased work and site visits" box,
 *   - the numbered Terms and conditions.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JdThomsonTerms = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VAT_RATE = 0.05;
  var HANDOVER_DAYS = 3;
  var RESCHEDULE_NOTICE_DAYS = 14;
  var VALIDITY_DAYS = 30;

  function num(value) {
    var n = Number(value);
    return isFinite(n) ? n : 0;
  }

  function round2(value) {
    return Math.round(num(value) * 100) / 100;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isSingle(lineItems) {
    return (lineItems || []).some(function (li) {
      return li.quoteMode === 'single';
    });
  }

  // Everything charged beyond the equipment: services plus the customer's share
  // of transport (or, on a single-unit quote, the round trip and call-out).
  function servicesCharged(li) {
    return Math.max(0, round2(num(li.totalPrice) - num(li.applianceSubtotal)));
  }

  function totals(sale) {
    var items = sale.lineItems || [];
    var excl = round2(num(sale.totalPrice));
    var vat = round2(excl * VAT_RATE);
    return {
      qty: items.reduce(function (t, li) {
        return t + num(li.qty);
      }, 0),
      applianceSubtotal: round2(
        items.reduce(function (t, li) {
          return t + num(li.applianceSubtotal);
        }, 0),
      ),
      services: round2(
        items.reduce(function (t, li) {
          return t + servicesCharged(li);
        }, 0),
      ),
      excl: excl,
      vat: vat,
      incl: round2(excl + vat),
    };
  }

  // The amount charged for each extra site visit in a phased project:
  // share % x round trip; 0% and 100% both mean the full round trip.
  function extraVisitAmount(roundTrip, sharePercent) {
    var rt = num(roundTrip);
    var share = num(sharePercent);
    if (!(rt > 0)) return 0;
    if (share > 0 && share < 100) return round2((rt * share) / 100);
    return round2(rt);
  }

  function addonByName(editorState, name) {
    var list = (editorState && editorState.addons) || [];
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
    return null;
  }

  function sumField(editorState, field) {
    return ((editorState && editorState.lines) || []).reduce(function (t, l) {
      return t + num(l[field]);
    }, 0);
  }

  function plural(n, one, many) {
    return n === 1 ? one : many;
  }

  // Wording for each service: printed as Included when ticked, Not included when not.
  function serviceRows(editorState, lineItems, fmt) {
    var pm = addonByName(editorState, 'Project Management Fee');
    var survey = addonByName(editorState, 'Site Survey');
    var testing = addonByName(editorState, 'Testing & Commissioning');
    var training = addonByName(editorState, 'Training (End User)');
    var visits = sumField(editorState, 'siteVisits');
    var sessions = sumField(editorState, 'trainingSessions');
    var units = (lineItems || []).reduce(function (t, li) {
      return t + num(li.qty);
    }, 0);
    var rows = [];
    function pct(rate) {
      return String(Math.round(num(rate) * 10000) / 100) + '%';
    }
    if (survey)
      rows.push({
        name: 'Site Survey',
        on: !!survey.on,
        count: survey.on ? visits + ' ' + plural(visits, 'visit', 'visits') : '',
        charge: 'AED ' + fmt(survey.rate) + ' per site visit',
        text: survey.on
          ? 'Before installation our technician visits the site and checks that it is ready: kitchen opening sizes, power, ducting and water points, access, lift and parking. Any issue found is reported to you in writing so it can be fixed before the installation team arrives.'
          : 'No survey visit. The client confirms the site is ready and the measurements are correct; a visit later is charged separately.',
      });
    if (pm)
      rows.push({
        name: 'Project Management Fee',
        on: !!pm.on,
        count: '',
        charge: pct(pm.rate) + ' of the equipment price',
        text: pm.on
          ? 'A named coordinator plans and schedules the phases, liaises with your site team, reports progress and prepares the handover documents.'
          : 'No project coordinator is assigned. Planning, phase scheduling and progress reporting are handled by your team; we attend the visits in the schedule only.',
      });
    if (testing)
      rows.push({
        name: 'Testing & Commissioning',
        on: !!testing.on,
        count: testing.on ? units + ' ' + plural(units, 'unit', 'units') : '',
        charge: 'AED ' + fmt(testing.rate) + ' per unit installed',
        text: testing.on
          ? 'Each unit is connected, powered and run through its basic operating checks, then signed off on a commissioning checklist at handover.'
          : 'Units are installed and connected only, without individual operating checks or a commissioning checklist. A test visit requested later is charged separately.',
      });
    if (training)
      rows.push({
        name: 'Training (End User)',
        on: !!training.on,
        count: training.on ? sessions + ' ' + plural(sessions, 'session', 'sessions') : '',
        charge: 'AED ' + fmt(training.rate) + ' per training session',
        text: training.on
          ? 'A demonstration for your staff or residents on safe use, cleaning and care, and basic troubleshooting, for each session in the quotation.'
          : "No user training. The manufacturer's instruction manual is provided with each unit.",
      });
    return rows;
  }

  function servicesSectionHtml(sale, fmt) {
    if (isSingle(sale.lineItems)) return '';
    var rows = serviceRows(sale.editorState, sale.lineItems, fmt);
    if (!rows.length) return '';
    var body = rows
      .map(function (r) {
        var style = r.on ? '' : ' style="color:#555;"';
        return (
          '<tr' +
          style +
          '><td><strong>' +
          esc(r.name) +
          '</strong></td><td><strong>' +
          (r.on ? 'Included' : 'Not included') +
          '</strong>' +
          (r.count ? '<br>' + esc(r.count) : '') +
          '</td><td>' +
          esc(r.charge) +
          '</td><td>' +
          esc(r.text) +
          '</td></tr>'
        );
      })
      .join('');
    return (
      '<h2>Services in this quotation</h2>' +
      '<p style="font-size:10.5px;color:#444;margin:0 0 6px;">Each service below is either included in the price or not. What is not included is not part of this quotation.</p>' +
      '<table><thead><tr><th style="width:15%">Service</th><th style="width:11%">Status</th><th style="width:19%">How it is charged</th><th>What it means for you</th></tr></thead><tbody>' +
      body +
      '</tbody></table>'
    );
  }

  function isPhased(sale) {
    return !!(sale.schedule && sale.schedule.workMode === 'phased') && !isSingle(sale.lineItems);
  }

  function phasedBoxHtml(sale, fmt) {
    if (!isPhased(sale)) return '';
    var amount = num(sale.schedule && sale.schedule.extraVisitAmount);
    var price =
      amount > 0
        ? '<strong>AED ' + fmt(amount) + ' per visit</strong>'
        : 'the visit rate agreed with us';
    return (
      '<h2>Phased work and site visits</h2>' +
      '<div style="border:1px solid #888;padding:8px 11px;background:#f6f8fa;text-align:justify;font-size:11px;">' +
      '<strong>Each phase is a separate site visit period.</strong> If a phase is added, split or moved, or a visit is needed beyond the visits planned in the schedule above, that visit is charged at ' +
      price +
      '. Waiting between phases is not charged as long as the schedule above is kept.' +
      '</div>'
    );
  }

  // Numbered terms. Groups with no clauses are dropped and letters/numbers follow.
  function termGroups(sale, fmt) {
    var single = isSingle(sale.lineItems);
    var phased = isPhased(sale);
    var amount = num(sale.schedule && sale.schedule.extraVisitAmount);
    var visitCharge = phased
      ? 'the per-visit rate stated under "Phased work and site visits" above'
      : amount > 0
        ? 'AED ' + fmt(amount) + ' per visit'
        : 'the visit rate agreed with us';
    var groups = [];

    groups.push({
      title: 'Scope of work',
      clauses: [
        [
          'Scope and price.',
          single
            ? 'The price covers the appliance, quantity and services listed in this quotation only. Anything not listed is excluded and, if needed, will be quoted separately.'
            : 'The price covers the appliances, quantities and services listed in this quotation only. Anything marked "Not included" is excluded and, if needed, will be quoted separately.',
        ],
        [
          'What installation means.',
          'Installation is placing, levelling, fixing and connecting each appliance to services that are already in place, and checking that it switches on. It does not include building or civil work, carpentry or worktop cut-outs, new electrical, plumbing, gas or ducting lines, making good of walls or ceilings, or removal of old appliances, unless listed above.',
        ],
      ],
    });

    groups.push({
      title: 'Site readiness and access',
      clauses: [
        [
          'Site ready.',
          'Before each visit the client ensures the area is complete, clean and safe: floors and walls finished, kitchen units and openings ready, and power, ducting, water and drain points in place and compliant with local regulations. Licensed electrical, gas or plumbing work is the client’s responsibility.',
        ],
        [
          'Access.',
          'The client provides clear access for the team and the appliances: lifts, loading and parking, gate passes and building management approvals, and an authorised representative on site. Work is carried out in normal working hours unless agreed otherwise.',
        ],
        [
          'Storage.',
          'Appliances delivered to the site before installation are stored by the client in a secure, dry place. The client is responsible for loss or damage to them after delivery is signed for.',
        ],
      ],
    });

    if (!single) {
      var visits = [];
      if (phased)
        visits.push([
          'Phased work.',
          'Each phase is a separate mobilisation. The schedule is valid only if each phase is ready on the date it is released. Waiting days shown are assumptions, and a phase that is not ready moves the later phases and the completion date.',
        ]);
      visits.push([
        'Additional visits.',
        'A visit beyond those planned in the schedule, or a visit that cannot be completed because the site' +
          (phased ? ' or phase' : '') +
          ' is not ready, is charged at ' +
          visitCharge +
          '.',
      ]);
      groups.push({
        title: phased ? 'Phased work and visits' : 'Visits',
        clauses: visits,
      });
    }

    groups.push({
      title: 'Changes and delays',
      clauses: [
        [
          'Changes to the order.',
          'A change to quantities, models, locations or phasing must be confirmed in writing. The price and schedule are then updated, and unit rates follow the final quantity of each appliance type, so a lower quantity can move a rate to a lower volume tier.',
        ],
        [
          'Delays.',
          'We are not liable for delay or extra cost caused by the site not being ready, late deliveries by others, approvals from authorities or building management, or events beyond our reasonable control.',
        ],
      ],
    });

    groups.push({
      title: 'Handover, warranty and liability',
      clauses: [
        [
          'Handover.',
          'At the end of each phase we hand over the completed units with a handover note. The client or its representative signs it, or notes any defects, within ' +
            HANDOVER_DAYS +
            ' working days. Units in use after that are treated as accepted.',
        ],
        [
          'Warranty.',
          'The appliances carry the warranty stated in the sales terms under which they were supplied. Jacky’s Distribution does not give any warranty in addition to it, including on installation work. That warranty does not cover misuse, power surges, changes by others, or faults in the building’s services.',
        ],
        [
          'Liability.',
          'We take reasonable care of the site and the units while we work. We are not liable for existing defects, hidden services or structural conditions, or for indirect loss or loss of profit. Our liability is limited to the value of the phase concerned.',
        ],
      ],
    });

    groups.push({
      title: 'General',
      clauses: [
        [
          'Cancellation and rescheduling.',
          'Work can be rescheduled free of charge with at least ' +
            RESCHEDULE_NOTICE_DAYS +
            ' days’ written notice. If a project or phase is cancelled, the client pays for work done, materials and appliances already ordered, and mobilisation already incurred.',
        ],
        [
          'Validity and law.',
          'This quotation is valid for ' +
            VALIDITY_DAYS +
            ' days from the date shown unless agreed otherwise in writing. It is governed by the laws of the United Arab Emirates.',
        ],
      ],
    });
    return groups;
  }

  function termsHtml(sale, fmt) {
    var groups = termGroups(sale, fmt);
    var n = 0;
    var out = '<h2>Terms and conditions</h2>';
    groups.forEach(function (g, gi) {
      out +=
        '<div style="font-weight:700;color:#12304f;background:#eef1f4;padding:3px 7px;margin:9px 0 5px;font-size:11px;page-break-after:avoid;">' +
        String.fromCharCode(65 + gi) +
        '. ' +
        esc(g.title) +
        '</div>';
      g.clauses.forEach(function (c) {
        n += 1;
        out +=
          '<div style="display:flex;gap:7px;margin-bottom:5px;text-align:justify;font-size:10.5px;page-break-inside:avoid;"><strong style="flex:none;width:18px;">' +
          n +
          '.</strong><span><strong>' +
          esc(c[0]) +
          '</strong> ' +
          esc(c[1]) +
          '</span></div>';
      });
    });
    return out;
  }

  return {
    VAT_RATE: VAT_RATE,
    HANDOVER_DAYS: HANDOVER_DAYS,
    RESCHEDULE_NOTICE_DAYS: RESCHEDULE_NOTICE_DAYS,
    VALIDITY_DAYS: VALIDITY_DAYS,
    servicesCharged: servicesCharged,
    totals: totals,
    extraVisitAmount: extraVisitAmount,
    serviceRows: serviceRows,
    servicesSectionHtml: servicesSectionHtml,
    phasedBoxHtml: phasedBoxHtml,
    termGroups: termGroups,
    termsHtml: termsHtml,
    isPhased: isPhased,
    isSingle: isSingle,
  };
});
