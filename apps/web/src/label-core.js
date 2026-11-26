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
 *  - barcodeDocument(items, settings, ctx): barcode-only pages (modification #320).
 *      layout 'C': 4 x 6 in label with 5 rows (+ visit barcode), 6 or 8 cells
 *      layout 'D': A4 sticker sheet, 6 or 8 cells, first cell = settings.startCell
 *    Barcodes use the compact keys (compactJob / compactVisit / compactUnit, parseCompact reads them back).
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

  var START_C = 105;
  var CODE_C = 99;
  var CODE_B = 100;

  function isDigit(ch) {
    return ch >= '0' && ch <= '9';
  }

  // Symbol values of a Code 128 barcode. Set B only by default (A and B stickers stay as they are);
  // with compact = true runs of 4 or more digits use set C (two digits per symbol), which is what
  // lets the barcode label (options C and D) keep 3-dot bars.
  function code128Values(text, compact) {
    var s = printable(text);
    var values = [];
    var mode = 'B';
    var i = 0;
    function digitsAhead(k) {
      var n = 0;
      while (k + n < s.length && isDigit(s.charAt(k + n))) n++;
      return n;
    }
    if (compact && digitsAhead(0) >= 4) {
      values.push(START_C);
      mode = 'C';
    } else values.push(START_B);
    while (i < s.length) {
      var run = digitsAhead(i);
      if (compact && mode === 'B' && run >= 4) {
        values.push(CODE_C);
        mode = 'C';
      }
      if (mode === 'C') {
        if (run >= 2) {
          values.push(Number(s.substr(i, 2)));
          i += 2;
          continue;
        }
        values.push(CODE_B);
        mode = 'B';
      }
      values.push(s.charCodeAt(i) - 32);
      i++;
    }
    var sum = values[0];
    for (var k = 1; k < values.length; k++) sum += values[k] * k;
    values.push(sum % 103);
    return values;
  }

  function code128Modules(text, compact) {
    var values = code128Values(text, compact);
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
    if (!opts.moduleMm) {
      // Widest bars that still leave room for the number: 0.375 mm = 3 printer dots at 203 dpi, thicker and darker than 0.25 mm.
      var count = code128Modules(text, opts.compact).length + 20;
      var fit = Math.floor(((opts.maxWidthMm || 62) / count) * 8) / 8;
      moduleMm = Math.max(0.25, Math.min(0.375, fit));
    }
    var heightMm = opts.heightMm || 9.5;
    var quiet = 10;
    var modules = code128Modules(text, opts.compact);
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
      '<div class="lb-sticker' +
      (kind === 'install' ? '' : ' lb-r') +
      '">' +
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
    '.lb-sticker{position:relative;width:100mm;height:75mm;padding:2.8mm 2.5mm 1mm;font-size:9pt;line-height:1.12;display:flex;flex-direction:column;gap:0.8mm;overflow:hidden}' +
    '.lb-sticker+.lb-sticker{border-top:0.3mm dashed #555}' +
    '.lb-top{display:flex;justify-content:space-between;align-items:center}' +
    '.lb-brand{font-size:12pt;font-weight:700;line-height:1.05}.lb-brand small{display:block;font-size:7pt;font-weight:700;letter-spacing:.05em}' +
    '.lb-status{border:0.7mm solid #000;padding:0.6mm 2.5mm;font-size:12pt;font-weight:700;text-align:center;line-height:1.1}' +
    '.lb-code{display:flex;gap:3mm;align-items:center}.lb-bars{display:block}.lb-ref{font-size:14pt;font-weight:700;white-space:nowrap}' +
    '.lb-grid{display:grid;grid-template-columns:27mm 1fr;border-top:0.3mm solid #000;padding-top:0.8mm;row-gap:0.2mm}' +
    '.lb-k{font-weight:700;font-size:8pt;padding-top:0.3mm}.lb-v{font-weight:700;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;word-break:break-word}' +
    '.lb-date{border:0.6mm solid #000;padding:0.6mm 1.2mm;font-size:8.3pt;font-weight:700;display:flex;justify-content:space-between;white-space:nowrap;gap:1mm}' +
    '.lb-note{font-size:7pt;white-space:nowrap;font-weight:700;text-align:center}.lb-work{border-top:0.3mm solid #000;padding-top:0.8mm;font-size:10pt;font-weight:700}' +
    '.lb-contact{margin-top:auto;font-size:7.5pt;font-weight:700;text-align:center}' +
    '.lb-r{font-size:10.5pt}.lb-r .lb-k{font-size:9pt}.lb-r .lb-work{font-size:11pt}.lb-r .lb-contact{font-size:8pt}' +
    '.lb-cap{position:absolute;right:2.5mm;top:0.5mm;font-size:6pt;font-weight:700;color:#000}';

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

  // ---- Compact barcode keys (options C and D). Digits only, so Code 128 set C keeps 3-dot bars.
  //   JBC-2026-00301 -> J26000301   WI-2026-00112 -> V26000112   delivery note 16101431 unit 1 -> 1610143101
  // Scan a unit reads these and the long forms printed on the A and B stickers.
  function pad(value, width) {
    var s = String(value);
    while (s.length < width) s = '0' + s;
    return s;
  }
  function compactJob(reference) {
    var m = /^JBC-\d{2}(\d{2})-(\d{1,6})$/i.exec(String(reference || '').trim());
    return m ? 'J' + m[1] + pad(m[2], 6) : '';
  }
  function compactVisit(reference) {
    var m = /^WI-\d{2}(\d{2})-(\d{1,6})$/i.exec(String(reference || '').trim());
    return m ? 'V' + m[1] + pad(m[2], 6) : '';
  }
  // A delivery note field can hold several notes ("NAW-16150014,16150010"); the first one is the key.
  function noteTokens(deliveryNote) {
    return String(deliveryNote || '')
      .split(/[,;\s]+/)
      .map(function (t) {
        return t.trim();
      })
      .filter(Boolean);
  }
  // "NAW-16150014" and "16150014" both give 16150014 (letters before the number are dropped).
  function noteDigits(token) {
    var m = /^[A-Za-z]*-?(\d{8})$/.exec(String(token || '').trim());
    return m ? m[1] : '';
  }
  // True when the delivery note field (one or several notes) contains the scanned note.
  function noteMatches(deliveryNote, note) {
    var want = String(note || '')
      .trim()
      .toLowerCase();
    if (!want) return false;
    return noteTokens(deliveryNote).some(function (t) {
      return t.toLowerCase() === want || noteDigits(t) === want;
    });
  }
  function compactUnit(deliveryNote, unitNo) {
    var key = noteDigits(noteTokens(deliveryNote)[0]);
    var n = Number(unitNo);
    if (key && n >= 1 && n <= 99 && Math.floor(n) === n) return key + pad(n, 2);
    return '';
  }
  // The text a compact code stands for, or null when the text is not a compact code.
  function parseCompact(text) {
    var s = String(text || '').trim();
    var m = /^J(\d{2})(\d{6})$/i.exec(s);
    if (m) return { kind: 'job_card', reference: 'JBC-20' + m[1] + '-' + pad(Number(m[2]), 5) };
    m = /^V(\d{2})(\d{6})$/i.exec(s);
    if (m) return { kind: 'visit', reference: 'WI-20' + m[1] + '-' + pad(Number(m[2]), 5) };
    m = /^(\d{8})(\d{2})$/.exec(s);
    if (m && Number(m[2]) >= 1) return { kind: 'unit', note: m[1], unitNo: Number(m[2]) };
    return null;
  }

  // One barcode cell's data from the same item objects the A and B stickers use.
  function barcodeEntry(item) {
    var d = (item && item.data) || {};
    if (item && item.kind === 'install') {
      var tokens = noteTokens(d.deliveryNote);
      var first = tokens[0] || '';
      return {
        code: compactUnit(d.deliveryNote, d.unitNo) || first + '-' + d.unitNo,
        no:
          trim(first, 18) + '-' + d.unitNo + (tokens.length > 1 ? ' +' + (tokens.length - 1) : ''),
        line2: trim(d.itemCode || d.itemDesc, 24),
        line3: 'unit ' + d.unitNo + ' of ' + d.unitCount,
      };
    }
    var serial = String(d.serial || '').trim();
    var model = trim(d.model || d.itemDesc, 24);
    return {
      code: compactJob(d.reference) || String(d.reference || ''),
      no: String(d.reference || ''),
      line2: model,
      line3: serial
        ? 'S/N ' + (serial.length > 14 ? '...' + serial.slice(-8) : serial)
        : 'S/N missing',
    };
  }

  // How many labels / sheets and which cell is next free after printing count barcodes.
  function barcodePlan(count, settings) {
    settings = settings || {};
    var cells = barcodeCells(settings);
    var start = settings.layout === 'D' ? barcodeStart(settings, cells) : 1;
    var used = start - 1 + Math.max(0, Number(count) || 0);
    return {
      cellsPerPage: cells,
      startCell: start,
      pages: Math.max(1, Math.ceil(used / cells)),
      nextStartCell: (used % cells) + 1,
    };
  }
  function barcodeCells(settings) {
    if (settings.layout === 'D') return Number(settings.sheetCells) === 6 ? 6 : 8;
    var n = Number(settings.perLabel);
    return n === 5 || n === 8 ? n : 6;
  }
  function barcodeStart(settings, cells) {
    var s = Math.floor(Number(settings.startCell) || 1);
    return s >= 1 && s <= cells ? s : 1;
  }

  var BCSS =
    '*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif}' +
    '.bc-page{position:relative;overflow:hidden;break-after:page;page-break-after:always}' +
    '.bc-in{position:absolute;inset:0;padding:2.5mm;display:flex;flex-direction:column}' +
    '.bc-hdr{height:18mm;display:grid;grid-template-columns:1fr 47mm;column-gap:1mm;align-items:center;border-bottom:0.45mm solid #000;padding-bottom:1mm}' +
    '.bc-t{font-size:3.9mm;font-weight:700;line-height:1.1;overflow:hidden;max-height:9mm}.bc-s{font-size:2.8mm;font-weight:700;margin-top:0.8mm}' +
    '.bc-v{display:flex;flex-direction:column;align-items:center;font-size:3mm;font-weight:700}' +
    '.bc-row{height:23mm;display:grid;grid-template-columns:47mm 1fr;column-gap:1mm;align-items:center;border-bottom:0.25mm dashed #666}' +
    '.bc-row .bc-tx{padding-left:1.5mm;overflow:hidden}' +
    '.bc-grid{flex:1;display:grid;grid-template-columns:1fr 1fr}' +
    '.bc-cell{display:flex;flex-direction:column;align-items:center;justify-content:center;border-bottom:0.25mm dashed #666;padding:0 1mm;overflow:hidden}' +
    '.bc-cell:nth-child(odd){border-right:0.25mm dashed #666}' +
    '.bc-n{font-size:4mm;font-weight:700;margin-top:1mm;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}.bc-l{font-size:3.2mm;font-weight:700;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}.bc-l3{font-size:3mm;font-weight:700;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}' +
    '.bc-ft{height:8mm;display:flex;align-items:flex-end;font-weight:700;font-size:2.5mm;padding-top:1mm;overflow:hidden;white-space:nowrap}' +
    '.sh-in{position:absolute;display:grid;grid-template-columns:99mm 99mm}' +
    '.sh-cell{display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}' +
    '.sh-cell.test{outline:0.3mm dashed #777;outline-offset:-0.3mm}' +
    '.sh-n{font-size:5mm;font-weight:700;margin-top:1.5mm;white-space:nowrap}.sh-l{font-size:4mm;font-weight:700;white-space:nowrap}.sh-l3{font-size:3.6mm;font-weight:700;white-space:nowrap}';

  function entryCell(e, cls, barMm, maxMm, nCls, l2Cls, l3Cls) {
    return (
      '<div class="' +
      cls +
      '">' +
      barcodeSvg(e.code, { compact: true, heightMm: barMm, maxWidthMm: maxMm }) +
      '<div class="' +
      nCls +
      '">' +
      esc(e.no) +
      '</div><div class="' +
      l2Cls +
      '">' +
      esc(e.line2) +
      '</div><div class="' +
      l3Cls +
      '">' +
      esc(e.line3) +
      '</div></div>'
    );
  }

  // The printable pages for options C and D.
  //   C: Zebra 4 x 6 in label, 5 rows (+ visit barcode in the header), 6 or 8 cells.
  //   D: A4 sticker sheet, 6 or 8 cells, first used cell = settings.startCell.
  // ctx: { title, sub, visitCode (long WI- reference, optional), footer, test (draw cell outlines) }
  function barcodeDocument(items, settings, ctx) {
    settings = settings || {};
    ctx = ctx || {};
    var layout = settings.layout === 'D' ? 'D' : 'C';
    var dx = Number(settings.offsetX) || 0;
    var dy = Number(settings.offsetY) || 0;
    var cells = barcodeCells(settings);
    var entries = (items || []).map(barcodeEntry);
    var pages = '';
    var i;
    var pageW = layout === 'D' ? 210 : 100;
    var pageH = layout === 'D' ? 297 : 150;
    if (layout === 'C') {
      for (i = 0; i < entries.length || i === 0; i += cells) {
        var chunk = entries.slice(i, i + cells);
        var inner = '';
        if (cells === 5) {
          var visit = settings.visitBarcode === false ? '' : compactVisit(ctx.visitCode);
          inner =
            '<div class="bc-hdr"><div><div class="bc-t">' +
            esc(trim(ctx.title || '', 40)) +
            '</div><div class="bc-s">' +
            esc(ctx.sub || '') +
            '</div></div><div class="bc-v">' +
            (visit
              ? barcodeSvg(visit, { compact: true, heightMm: 11, maxWidthMm: 46 }) +
                '<span>' +
                esc(ctx.visitCode) +
                '</span>'
              : '') +
            '</div></div>' +
            chunk
              .map(function (e) {
                return (
                  '<div class="bc-row">' +
                  barcodeSvg(e.code, { compact: true, heightMm: 14, maxWidthMm: 46 }) +
                  '<div class="bc-tx"><div class="bc-n" style="margin-top:0;font-size:4mm">' +
                  esc(e.no) +
                  '</div><div class="bc-l">' +
                  esc(e.line2) +
                  '</div><div class="bc-l3">' +
                  esc(e.line3) +
                  '</div></div></div>'
                );
              })
              .join('') +
            '<div style="flex:1"></div><div class="bc-ft">' +
            esc(visit ? 'Scan the visit code to list all jobs' : ctx.footer || '') +
            '</div>';
        } else {
          var barMm = cells === 6 ? 15 : 11;
          inner =
            '<div class="bc-grid" style="grid-template-rows:repeat(' +
            cells / 2 +
            ',1fr)">' +
            chunk
              .map(function (e) {
                return entryCell(e, 'bc-cell', barMm, 44, 'bc-n', 'bc-l', 'bc-l3');
              })
              .join('') +
            '</div><div class="bc-ft">' +
            esc(ctx.footer || '') +
            '</div>';
        }
        pages +=
          '<div class="bc-page" style="width:100mm;height:150mm"><div class="bc-in" style="transform:translate(' +
          dx +
          'mm,' +
          dy +
          'mm)">' +
          inner +
          '</div></div>';
        if (!entries.length) break;
      }
    } else {
      var cellH = cells === 6 ? 93 : 68;
      var topMm = (297 - cellH * (cells / 2)) / 2;
      var first = barcodeStart(settings, cells) - 1;
      var slots = [];
      for (i = 0; i < first; i++) slots.push(null);
      entries.forEach(function (e) {
        slots.push(e);
      });
      var pageCount = Math.max(1, Math.ceil(slots.length / cells));
      for (var p = 0; p < pageCount; p++) {
        var body = '';
        for (var c = 0; c < cells; c++) {
          var e2 = slots[p * cells + c];
          var cellStyle = 'width:99mm;height:' + cellH + 'mm';
          body += e2
            ? entryCell(
                e2,
                'sh-cell' + (ctx.test ? ' test' : ''),
                cells === 6 ? 22 : 18,
                70,
                'sh-n',
                'sh-l',
                'sh-l3',
              ).replace('class=', 'style="' + cellStyle + '" class=')
            : '<div class="sh-cell' +
              (ctx.test ? ' test' : '') +
              '" style="' +
              cellStyle +
              '"></div>';
        }
        pages +=
          '<div class="bc-page" style="width:210mm;height:297mm"><div class="sh-in" style="left:' +
          (6 + dx) +
          'mm;top:' +
          (topMm + dy) +
          'mm">' +
          body +
          '</div></div>';
      }
    }
    return (
      '<!doctype html><html><head><meta charset="utf-8"><title>' +
      esc(ctx.documentTitle || 'Barcode labels') +
      '</title><style>@page{size:' +
      (layout === 'D' ? 'A4' : '100mm 150mm') +
      ';margin:0}' +
      BCSS +
      '</style></head><body>' +
      pages +
      '</body></html>'
    );
  }

  // Sample jobs for "Print a test label / sheet" in Label settings.
  function testBarcodeItems(settings) {
    var n = barcodeCells(settings || {});
    var out = [];
    for (var i = 1; i <= n; i++) {
      out.push({
        kind: 'repair',
        data: {
          reference: 'JBC-2026-' + pad(300 + i, 5),
          model: 'TEST MODEL',
          serial: 'TESTSERIAL' + i,
          customerName: 'Test customer',
          receivedDate: '2026-01-01',
        },
      });
    }
    return out;
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
    barcodeDocument: barcodeDocument,
    barcodePlan: barcodePlan,
    barcodeCells: barcodeCells,
    barcodeEntry: barcodeEntry,
    testBarcodeItems: testBarcodeItems,
    compactJob: compactJob,
    compactVisit: compactVisit,
    compactUnit: compactUnit,
    noteMatches: noteMatches,
    parseCompact: parseCompact,
    testItem: testItem,
    dateText: dateText,
  };
});
