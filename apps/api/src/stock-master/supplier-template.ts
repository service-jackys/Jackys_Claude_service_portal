import ExcelJS from 'exceljs';
import type {
  BrandCatalogueRow,
  BrandProductRow,
} from '../../../../packages/db/src/stock-master.js';

const NAVY = 'FF1F3A5F';
const GREY = 'FFEEF2F7';
const YELLOW = 'FFFFF8E1';

/** Brands the company owns, pre-filled as "Own brand". Philips is own only for air conditioners,
 *  so it carries a note instead of a value. */
const OWN_BRANDS = new Set(['VENUS', 'THOMSON']);

type Column = {
  header: string;
  band: string;
  width: number;
  tip: string;
  list?: string[];
};

const OWNERSHIP = ['Own brand', 'Supplier brand'];
const WARRANTY_BY = ["Jacky's (own brand)", 'Manufacturer', 'Supplier / distributor'];
const CHANNELS = [
  'Phone / call center',
  'Email',
  'Online portal',
  'WhatsApp',
  'Walk in to service center',
];

/** Columns the sales team fills, in sheet order. The first four are pre-filled from the portal. */
const COLUMNS: Column[] = [
  {
    header: 'Brand',
    band: 'From the portal (do not change)',
    width: 22,
    tip: 'Brand as held in the Stock Master.',
  },
  {
    header: 'Category',
    band: 'From the portal (do not change)',
    width: 12,
    tip: 'MDA = major domestic appliances, SDA = small domestic appliances.',
  },
  {
    header: 'Product groups supplied',
    band: 'From the portal (do not change)',
    width: 44,
    tip: 'What we sell under this brand.',
  },
  {
    header: 'Items in portal',
    band: 'From the portal (do not change)',
    width: 11,
    tip: 'Number of item codes under this brand.',
  },
  {
    header: 'Brand type',
    band: 'Warranty',
    width: 16,
    tip: 'Own brand, or supplied by another company.',
    list: OWNERSHIP,
  },
  {
    header: 'Warranty provided by',
    band: 'Warranty',
    width: 24,
    tip: 'Who honours the warranty.',
    list: WARRANTY_BY,
  },
  {
    header: 'Standard warranty (months)',
    band: 'Warranty',
    width: 14,
    tip: 'Normal warranty period in months.',
  },
  {
    header: 'Supplier / distributor company',
    band: 'Supplier / distributor',
    width: 30,
    tip: 'Company we buy this brand from.',
  },
  {
    header: 'Supplier contact person',
    band: 'Supplier / distributor',
    width: 24,
    tip: 'Person who can help with a warranty case.',
  },
  {
    header: 'Supplier contact phone',
    band: 'Supplier / distributor',
    width: 20,
    tip: 'Include the country code.',
  },
  {
    header: 'Supplier contact email',
    band: 'Supplier / distributor',
    width: 30,
    tip: 'Email for warranty and complaint follow up.',
  },
  {
    header: 'Brand service center name',
    band: 'Brand service center',
    width: 28,
    tip: 'Authorised service center for the UAE.',
  },
  {
    header: 'Service / call center phone',
    band: 'Brand service center',
    width: 22,
    tip: 'Number customers or we call to register a complaint.',
  },
  {
    header: 'WhatsApp number',
    band: 'Brand service center',
    width: 20,
    tip: 'If the brand accepts complaints on WhatsApp.',
  },
  {
    header: 'Service center email',
    band: 'Brand service center',
    width: 30,
    tip: 'Email to send complaints to.',
  },
  {
    header: 'Service center address / location',
    band: 'Brand service center',
    width: 34,
    tip: 'Where to take the item, if it must be taken in.',
  },
  {
    header: 'Complaint registration link (portal)',
    band: 'Complaint registration',
    width: 34,
    tip: 'Web page where the complaint is registered, if the brand has one.',
  },
  {
    header: 'How to register a complaint',
    band: 'Complaint registration',
    width: 24,
    tip: 'Main way the brand takes complaints.',
    list: CHANNELS,
  },
  {
    header: 'Documents needed',
    band: 'Complaint registration',
    width: 28,
    tip: 'For example invoice copy, serial number, photo of the fault.',
  },
  {
    header: 'Normal response time (days)',
    band: 'Complaint registration',
    width: 14,
    tip: 'How long the brand usually takes to respond.',
  },
  {
    header: 'Escalation contact',
    band: 'Complaint registration',
    width: 28,
    tip: 'Name and number to call when a case is delayed.',
  },
  {
    header: 'Filled by (sales person)',
    band: 'Sales sign off',
    width: 24,
    tip: 'Name of the person who gave these details.',
  },
  { header: 'Date', band: 'Sales sign off', width: 13, tip: 'Date the details were confirmed.' },
  {
    header: 'Remarks',
    band: 'Sales sign off',
    width: 36,
    tip: 'Anything else the service team should know.',
  },
];
/** Needed before the service team can follow up a case. */
const KEY_HEADERS = [
  'Warranty provided by',
  'Supplier / distributor company',
  'Supplier contact phone',
  'Service / call center phone',
  'Service center email',
  'How to register a complaint',
];

function letter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const fill = (argb: string) => ({
  type: 'pattern' as const,
  pattern: 'solid' as const,
  fgColor: { argb },
});
const thin = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } };

export async function buildBrandSupplierTemplate(
  brands: BrandCatalogueRow[],
  products: BrandProductRow[],
  generatedOn: Date = new Date(),
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Jacky's Service Portal";
  workbook.created = generatedOn;
  const dateText = generatedOn.toLocaleDateString('en-GB', { timeZone: 'Asia/Dubai' });

  // ---- Instructions ----
  const info = workbook.addWorksheet('Read me', { views: [{ showGridLines: false }] });
  info.columns = [{ width: 4 }, { width: 38 }, { width: 100 }];
  info.mergeCells('B1:C1');
  info.getCell('B1').value = 'Brand warranty & service contact details';
  info.getCell('B1').font = { size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  info.getCell('B1').fill = fill(NAVY);
  info.getRow(1).height = 36;
  const lines: [string, string][] = [
    [
      'Why we need this',
      "For brands that carry the manufacturer's or supplier's own warranty, the service team cannot follow up customer complaints without the brand's contact and complaint registration details. Please fill in one row per brand.",
    ],
    [
      'Who fills it',
      'Sales team, brand by brand. Ask the supplier or distributor if you are not sure.',
    ],
    [
      'What is already filled',
      `${brands.length} brands in the MDA and SDA categories, taken from the portal's Stock Master on ${dateText}. Do not change the grey columns (Brand, Category, Product groups, Items). If a brand is missing, add it in the empty rows at the bottom.`,
    ],
    [
      'How to fill',
      'Use the white cells on the "Brand details" sheet. Several columns have a drop-down list. Write phone numbers with the country code (for example +971 4 123 4567). Leave a cell empty if it does not apply.',
    ],
    [
      'Minimum we need',
      `At least: ${KEY_HEADERS.join(', ')}. The Status column turns to Complete when these are filled.`,
    ],
    [
      'Own brands',
      'Venus and Thomson are marked as own brands. Philips is own brand for air conditioners only; for every other Philips product, please fill in the details like any other supplier brand.',
    ],
    [
      'When you are done',
      'Save the file and send it back to the service team. Please do not change the sheet names or the header rows.',
    ],
  ];
  lines.forEach(([k, v], i) => {
    const row = 3 + i;
    info.getCell(`B${row}`).value = k;
    info.getCell(`B${row}`).font = { bold: true, color: { argb: NAVY } };
    info.getCell(`B${row}`).alignment = { vertical: 'top' };
    info.getCell(`C${row}`).value = v;
    info.getCell(`C${row}`).alignment = { wrapText: true, vertical: 'top' };
    info.getRow(row).height = Math.max(32, Math.ceil(v.length / 95) * 17 + 6);
  });
  info.getCell('B11').value = 'Columns';
  info.getCell('B11').font = { bold: true, color: { argb: NAVY } };
  COLUMNS.forEach((c, i) => {
    const row = 12 + i;
    info.getCell(`B${row}`).value = c.header;
    info.getCell(`B${row}`).font = { bold: true };
    info.getCell(`C${row}`).value = c.tip;
  });

  info.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  // ---- Brand details ----
  const sheet = workbook.addWorksheet('Brand details');
  sheet.columns = COLUMNS.map((c) => ({ width: c.width }));
  const lastCol = letter(COLUMNS.length);
  sheet.mergeCells(`A1:${lastCol}1`);
  const title = sheet.getCell('A1');
  title.value = `Brand details for service follow up   |   Jacky's   |   ${dateText}`;
  title.font = { size: 15, bold: true, color: { argb: 'FFFFFFFF' } };
  title.fill = fill(NAVY);
  title.alignment = { vertical: 'middle', indent: 1 };
  sheet.getRow(1).height = 30;

  // Band row (row 2): merged group labels.
  let start = 0;
  const palette: Record<string, string> = {
    'From the portal (do not change)': 'FF64748B',
    Warranty: 'FF2F6F8F',
    'Supplier / distributor': 'FF3D7A5A',
    'Brand service center': 'FF8A6D1E',
    'Complaint registration': 'FF7A4A8A',
    'Sales sign off': 'FF475569',
  };
  while (start < COLUMNS.length) {
    let end = start;
    while (end + 1 < COLUMNS.length && COLUMNS[end + 1]!.band === COLUMNS[start]!.band) end += 1;
    if (end > start) sheet.mergeCells(`${letter(start)}2:${letter(end)}2`);
    const cell = sheet.getCell(`${letter(start)}2`);
    cell.value = COLUMNS[start]!.band;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = fill(palette[COLUMNS[start]!.band] ?? NAVY);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    for (let c = start; c <= end; c += 1)
      sheet.getCell(`${letter(c)}2`).fill = fill(palette[COLUMNS[start]!.band] ?? NAVY);
    start = end + 1;
  }
  sheet.getRow(2).height = 20;
  const headerRow = sheet.getRow(3);
  COLUMNS.forEach((c, i) => (headerRow.getCell(i + 1).value = c.header));
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = fill(NAVY);
  headerRow.alignment = { vertical: 'middle', wrapText: true };
  headerRow.height = 42;
  const statusCol = COLUMNS.length + 1;
  const statusCell = headerRow.getCell(statusCol);
  statusCell.value = 'Status';
  sheet.getColumn(statusCol).width = 15;
  statusCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  statusCell.fill = fill(NAVY);
  statusCell.alignment = { vertical: 'middle' };

  const spare = 30;
  const dataStart = 4;
  const dataEnd = dataStart + brands.length - 1 + spare;
  const keyIdx = KEY_HEADERS.map((h) => COLUMNS.findIndex((c) => c.header === h));
  const own = (b: BrandCatalogueRow) =>
    OWN_BRANDS.has(b.brand) ? 'Own brand' : b.brand === 'PHILIPS' ? '' : 'Supplier brand';
  for (let r = dataStart; r <= dataEnd; r += 1) {
    const b = brands[r - dataStart];
    const row = sheet.getRow(r);
    if (b) {
      row.getCell(1).value = b.brand;
      row.getCell(2).value = b.mainGroups.join(' + ');
      row.getCell(3).value = b.groups.join(', ');
      row.getCell(4).value = b.itemCount;
      const ownership = own(b);
      if (ownership) row.getCell(5).value = ownership;
      if (b.brand === 'PHILIPS')
        row.getCell(COLUMNS.length).value =
          'Own brand for air conditioners only; other Philips products: please fill in as a supplier brand.';
    }
    COLUMNS.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.border = { bottom: thin, right: thin };
      cell.alignment = { vertical: 'top', wrapText: true, horizontal: i === 3 ? 'right' : 'left' };
      if (i < 4) cell.fill = fill(GREY);
      else if (r % 2 === 1) cell.fill = fill('FFFBFCFE');
      if (c.list) {
        cell.dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`"${c.list.join(',')}"`],
          showErrorMessage: false,
        };
      }
    });
    const filled = keyIdx.map((i) => `(LEN(${letter(i)}${r})>0)`).join('+');
    const st = row.getCell(statusCol);
    st.value = {
      formula: `IF(A${r}="","",IF(${filled}=0,"Not started",IF(${filled}>=${keyIdx.length},"Complete","Partly filled")))`,
    };
    st.border = { bottom: thin };
    st.font = { bold: true };
  }
  const statusRange = `${letter(statusCol - 1)}${dataStart}:${letter(statusCol - 1)}${dataEnd}`;
  sheet.addConditionalFormatting({
    ref: statusRange,
    rules: [
      {
        type: 'cellIs',
        operator: 'equal',
        formulae: ['"Complete"'],
        priority: 1,
        style: {
          font: { color: { argb: 'FF166534' } },
          fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFDCFCE7' } },
        },
      },
      {
        type: 'cellIs',
        operator: 'equal',
        formulae: ['"Partly filled"'],
        priority: 2,
        style: {
          font: { color: { argb: 'FF92400E' } },
          fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFEF3C7' } },
        },
      },
      {
        type: 'cellIs',
        operator: 'equal',
        formulae: ['"Not started"'],
        priority: 3,
        style: {
          font: { color: { argb: 'FF991B1B' } },
          fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFEE2E2' } },
        },
      },
    ],
  });
  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 3 }];
  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: statusCol } };
  sheet.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: '1:3',
  };
  void YELLOW;

  // ---- Products by brand (reference) ----
  const ref = workbook.addWorksheet('Products by brand');
  ref.columns = [
    { header: 'Brand', width: 24 },
    { header: 'Category', width: 11 },
    { header: 'Product group', width: 30 },
    { header: 'Sub group', width: 30 },
    { header: 'Items', width: 9 },
  ];
  products.forEach((p) =>
    ref.addRow([p.brand, p.mainGroup, p.groupName ?? '', p.subGroup ?? '', p.itemCount]),
  );
  const h = ref.getRow(1);
  h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  h.fill = fill(NAVY);
  ref.views = [{ state: 'frozen', ySplit: 1 }];
  ref.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 5 } };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
