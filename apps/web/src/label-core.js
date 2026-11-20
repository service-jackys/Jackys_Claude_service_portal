/* Unit stickers -- pure helpers shared by the portal and its unit test
 * (tests/unit/label-core.test.ts). No DOM, no network: plain data in, strings out.
 *
 *  - code128Modules(text): Code 128 (set B) as a string of 1 (bar) / 0 (space) modules.
 *  - barcodeSvg(text, opts): that barcode as an inline SVG, sized in millimetres so one
 *    module is a whole number of printer dots (0.25 mm = 2 dots at 203 dpi, the Zebra GK420t).
 *  - missingDetails(kind, data): the fields a sticker needs that are still empty.
 *  - labelDocument(items, settings): the full printable page(s).
 *      layout 'A': 4 x 6 in label (100 x 150 mm), two stickers per label (unit copy + customer copy)
 *      layout 'B': 100 x 75 mm label, one sticker per label
 * Kinds: 'repair' (a service job card), 'install' (a Delivery & Installation unit).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JdLabel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Code 128 bar/space widths for symbol values 0..106 (106 is the stop symbol, 7 elements).
  var PATTERNS = (
    '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 ' +
    '221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 ' +
    '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 ' +
    '212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 ' +
    '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 ' +
    '231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 ' +
    '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 ' +
    '112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
    '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 ' +
    '214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 ' +
    '114131 311141 411131 211412 211214 211232 2331112'
  ).split(' ');
  var START_B = 104;
  var STOP = 106;

  function printable(text) {
    // Code 128 set B carries ASCII 32..126; anything else becomes a space.
    var out = '';
    var s = String(text == null ? '' : text);
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      out += c >= 32 && c <= 126 ? s.charAt(i) : ' ';
    }
    return out;
  }

  function code128Modules(text) {
    var s = printable(text);
    var values = [START_B];
    var sum = START_B;
    for (var i = 0; i < s.length; i++) {
      var v = s.charCodeAt(i) - 32;
      values.push(v);
      sum += v * (i + 1);
    }
    values.push(sum % 103);
    values.push(STOP);
    var modules = '';
    for (var k = 0; k < values.length; k++) {
      var widths = PATTERNS[values[k]];
      for (var j = 0; j < widths.length; j++) {
        modules += (j % 2 === 0 ? '1' : '0').repeat(Number(widths.charAt(j)));
      }
    }
    return modules;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function barcodeSvg(text, opts) {
    opts = opts || {};
    var moduleMm = opts.moduleMm || 0.25;
    var heightMm = opts.heightMm || 9;
    var quiet = 10;
    var modules = code128Modules(text);
    var total = modules.length + quiet * 2;
    var bars = '';
    var i = 0;
    while (i < modules.length) {
      if (modules.charAt(i) === '1') {
        var start = i;
        while (i < modules.length && modules.charAt(i) === '1') i++;
        bars += 'M' + (quiet + start) + ' 0h' + (i - start) + 'v1h-' + (i - start) + 'z';
      } else i++;
    }
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" class="lb-bars" width="' +
      (total * moduleMm).toFixed(2) +
      'mm" height="' +
      heightMm +
      'mm" viewBox="0 0 ' +
      total +
      ' 1" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="Barcode ' +
      esc(printable(text)) +
      '"><path d="' +
      bars +
      '" fill="#000"/></svg>'
    );
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dateText(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    if (!m) return '';
    return Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1];
  }

  var REPAIR_STATUS = {
    'Repair Completed': 'REPAIRED',
    WIP: 'IN SERVICE',
    'Spare pending': 'SPARE PENDING',
    BER: 'BER',
    Rejected: 'REJECTED',
    Cancelled: 'CANCELLED',
    'Customer approval pending': 'AWAITING APPROVAL',
  };

  var ACTIVITY = {
    CSIDI: { box: 'DELIVERED<br>+ INSTALLED', date: 'INSTALLED ON' },
    CSIII: { box: 'INSTALLED', date: 'INSTALLED ON' },
    CSIDO: { box: 'DELIVERED', date: 'DELIVERED ON' },
  };

  // The fields a sticker cannot be printed without. Returned as plain labels for the pop-up.
  function missingDetails(kind, d) {
    var missing = [];
    function need(value, label) {
      if (!String(value == null ? '' : value).trim()) missing.push(label);
    }
    d = d || {};
    if (kind === 'install') {
      need(d.deliveryNote, 'ERP delivery note');
      need(d.customerName, 'Customer name');
      if (String(d.customerType || '').toUpperCase() === 'B2C')
        need(d.customerPhone, 'Customer phone number');
      need(d.itemCode || d.itemDesc, 'Item code or description');
      need(d.brand, 'Brand');
      need(d.serviceDate, 'Service date');
    } else {
      need(d.reference, 'Job card number');
      need(d.model || d.itemDesc, 'Model or item description');
      need(d.customerName, 'Customer name');
      need(d.receivedDate, 'Job card date');
    }
    return missing;
  }

  function row(label, value) {
    var text = String(value == null ? '' : value).trim();
    if (!text) return '';
    return '<div class="lb-k">' + esc(label) + '</div><div class="lb-v">' + esc(text) + '</div>';
  }

  var CONTACT = 'For service enquiries contact: +971 4 336 1695 · service@jackys.com';

  function trim(text, max) {
    var s = String(text == null ? '' : text).trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  // One sticker (100 x 75 mm). caption: the small line for layout A ("Copy 1", ...), or ''.
  function stickerBlock(kind, d, caption) {
    var head = '';
    var rows = '';
    var code = '';
    var tail = '';
    if (kind === 'install') {
      var act = ACTIVITY[d.activity] || ACTIVITY.CSIDI;
      var date = dateText(d.serviceDate);
      code = d.deliveryNote + '-' + d.unitNo;
      head = act.box;
      rows =
        row('BRAND', d.brand) +
        row('MODEL / CODE', d.itemCode) +
        row('DESCRIPTION', trim(d.itemDesc, 70)) +
        row('CATEGORY', trim([d.groupName, d.subGroup].filter(Boolean).join(' / '), 48)) +
        row(
          'CUSTOMER',
          trim(d.customerName + (d.customerPhone ? ' · ' + d.customerPhone : ''), 70),
        ) +
        row(
          'DELIVERY NOTE',
          'DN ' + d.deliveryNote + ' · unit ' + d.unitNo + ' of ' + d.unitCount,
        ) +
        row('TECHNICIAN', d.technician);
      tail =
        '<div class="lb-date"><span>' +
        act.date +
        ': ' +
        esc(date.toUpperCase()) +
        '</span><span>WARRANTY STARTS: ' +
        esc(date.toUpperCase()) +
        '</span></div>' +
        '<div class="lb-note">Warranty: 1 year from the start date, unless a VAS plan was bought with the unit.</div>';
    } else {
      code = d.reference;
      head = REPAIR_STATUS[d.status] || String(d.status || 'IN SERVICE').toUpperCase();
      rows =
        row('MODEL', trim(d.model || d.itemDesc, 48)) +
        row('SERIAL', d.serial) +
        row('OWNER', trim(d.customerName + (d.customerPhone ? ' · ' + d.customerPhone : ''), 70)) +
        row('WARRANTY', d.warranty) +
        row(
          'RECEIVED',
          dateText(d.receivedDate) + (d.technician ? ' · Tech: ' + d.technician : ''),
        ) +
        row('STATUS AS AT', dateText(d.printDate));
      tail =
        '<div class="lb-work"><b>WORK DONE:</b> ' +
        esc(trim(d.serviceRendered || '-', 90)) +
        '<br><b>PARTS:</b> ' +
        esc(trim(d.parts || '-', 70)) +
        '</div>';
    }
    return (
      '<div class="lb-sticker">' +
      '<div class="lb-top"><div class="lb-brand">Jacky’s Distribution<small>' +
      (kind === 'install' ? 'SERVICE CENTRE NAH, DUBAI' : 'SERVICE CENTRE NAH, DUBAI') +
      '</small></div><div class="lb-status">' +
      head +
      '</div></div>' +
      '<div class="lb-code">' +
      barcodeSvg(code) +
      '<span class="lb-ref">' +
      esc(code) +
      '</span></div>' +
      '<div class="lb-grid">' +
      rows +
      '</div>' +
      tail +
      '<div class="lb-contact">' +
      esc(CONTACT) +
      '</div>' +
      (caption ? '<div class="lb-cap">' + esc(caption) + '</div>' : '') +
      '</div>'
    );
  }

  var CSS =
    '*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif}' +
    '.lb-page{position:relative;overflow:hidden;page-break-after:always;break-after:page}' +
    '.lb-sticker{position:relative;width:100mm;height:75mm;padding:3.2mm 4mm 1.5mm;font-size:8.5pt;line-height:1.12;display:flex;flex-direction:column;gap:0.8mm;overflow:hidden}' +
    '.lb-sticker+.lb-sticker{border-top:0.3mm dashed #555}' +
    '.lb-top{display:flex;justify-content:space-between;align-items:center}' +
    '.lb-brand{font-size:11pt;font-weight:700;line-height:1.05}.lb-brand small{display:block;font-size:6.5pt;font-weight:700;letter-spacing:.05em}' +
    '.lb-status{border:0.7mm solid #000;padding:0.6mm 2.5mm;font-size:11pt;font-weight:700;text-align:center;line-height:1.1}' +
    '.lb-code{display:flex;gap:3mm;align-items:center}.lb-bars{display:block}.lb-ref{font-size:13pt;font-weight:700;white-space:nowrap}' +
    '.lb-grid{display:grid;grid-template-columns:25mm 1fr;border-top:0.3mm solid #000;padding-top:0.8mm;row-gap:0.2mm}' +
    '.lb-k{font-weight:700;font-size:7.5pt;padding-top:0.3mm}.lb-v{font-weight:700;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;word-break:break-word}' +
    '.lb-date{border:0.6mm solid #000;padding:0.6mm 2mm;font-size:8pt;font-weight:700;display:flex;justify-content:space-between;white-space:nowrap;gap:2mm}' +
    '.lb-note{font-size:6.3pt;white-space:nowrap;font-weight:700;text-align:center}.lb-work{border-top:0.3mm solid #000;padding-top:0.8mm;font-size:8pt;font-weight:700}' +
    '.lb-contact{margin-top:auto;font-size:6.8pt;font-weight:700;text-align:center}' +
    '.lb-cap{position:absolute;right:4mm;top:0.8mm;font-size:6pt;font-weight:700;color:#000}';

  function labelDocument(items, settings) {
    settings = settings || {};
    var layout = settings.layout === 'B' ? 'B' : 'A';
    var dx = Number(settings.offsetX) || 0;
    var dy = Number(settings.offsetY) || 0;
    var heightMm = layout === 'A' ? 150 : 75;
    var pages = (items || [])
      .map(function (item) {
        var inner =
          layout === 'A'
            ? stickerBlock(item.kind, item.data, 'Copy 1: stick on the unit') +
              stickerBlock(item.kind, item.data, 'Copy 2: customer copy')
            : stickerBlock(item.kind, item.data, '');
        return (
          '<div class="lb-page" style="width:100mm;height:' +
          heightMm +
          'mm"><div style="transform:translate(' +
          dx +
          'mm,' +
          dy +
          'mm)">' +
          inner +
          '</div></div>'
        );
      })
      .join('');
    return (
      '<!doctype html><html><head><meta charset="utf-8"><title>' +
      esc(settings.title || 'Unit stickers') +
      '</title><style>@page{size:100mm ' +
      heightMm +
      'mm;margin:0}' +
      CSS +
      '</style></head><body>' +
      pages +
      '</body></html>'
    );
  }

  function testItem() {
    return {
      kind: 'install',
      data: {
        activity: 'CSIDI',
        deliveryNote: 'TEST0001',
        unitNo: 1,
        unitCount: 1,
        brand: 'Test brand',
        itemCode: 'TEST-CODE',
        itemDesc: 'Test sticker: check size and position',
        groupName: 'Test group',
        subGroup: 'Test sub group',
        customerName: 'Test customer',
        customerPhone: '',
        technician: 'Technician',
        serviceDate: new Date().toISOString().slice(0, 10),
      },
    };
  }

  return {
    code128Modules: code128Modules,
    barcodeSvg: barcodeSvg,
    missingDetails: missingDetails,
    stickerBlock: stickerBlock,
    labelDocument: labelDocument,
    testItem: testItem,
    dateText: dateText,
  };
});
