import ExcelJS from 'exceljs';
import type { StockItemMasterRow, StockRow } from '../../../../packages/db/src/stock-master.js';

/** The ERP "Current Stock Valuation" columns, in file order. The header text is
 *  what the upload reads, so a rebuilt file can be uploaded again as it is. */
export const STOCK_FILE_COLUMNS: { header: string; key: keyof StockRow; width: number }[] = [
  { header: 'Location', key: 'location', width: 10 },
  { header: 'LocnDesc', key: 'locnDesc', width: 24 },
  { header: 'ItemCode', key: 'itemCode', width: 18 },
  { header: 'ItemDesc', key: 'itemDesc', width: 46 },
  { header: 'Grade', key: 'grade', width: 8 },
  { header: 'Stock', key: 'stock', width: 10 },
  { header: 'WAC', key: 'wac', width: 12 },
  { header: 'Value', key: 'value', width: 14 },
  { header: 'Transit', key: 'transit', width: 10 },
  { header: 'Reserved', key: 'reserved', width: 10 },
  { header: 'MainGroup', key: 'mainGroup', width: 12 },
  { header: 'Group', key: 'groupName', width: 24 },
  { header: 'SubGroup', key: 'subGroup', width: 24 },
  { header: 'Brand', key: 'brand', width: 18 },
  { header: 'TYPE', key: 'itemType', width: 10 },
  { header: 'LastGRN', key: 'lastGrn', width: 10 },
  { header: 'LastGRNDate', key: 'lastGrnDate', width: 13 },
  { header: 'LandedCost', key: 'landedCost', width: 12 },
];

function styleHeader(sheet: ExcelJS.Worksheet): void {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10233F' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

async function toBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** One channel's location rows, rebuilt from what the portal stored. */
export async function buildStockChannelWorkbook(rows: StockRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Current Stock Valuation');
  sheet.columns = STOCK_FILE_COLUMNS.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width,
  }));
  for (const row of rows) sheet.addRow(row);
  styleHeader(sheet);
  return toBuffer(workbook);
}

export const ITEM_MASTER_COLUMNS = [
  'ItemCode',
  'ItemDesc',
  'Grade',
  'MainGroup',
  'Group',
  'SubGroup',
  'Brand',
  'TYPE',
  'Last channel',
  'JDI',
  'JMS',
  'TGE',
  'First seen',
  'Updated',
] as const;

function channelState(item: StockItemMasterRow, channel: string): string {
  const found = item.channels.find((entry) => entry.channel === channel);
  if (!found) return '';
  return found.seen ? 'In latest file' : 'Not in latest file';
}

/** The unique item list the portal searches (one row per item code). */
export async function buildStockItemMasterWorkbook(items: StockItemMasterRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Stock item master');
  sheet.columns = ITEM_MASTER_COLUMNS.map((header) => ({
    header,
    key: header,
    width: header === 'ItemDesc' ? 46 : 18,
  }));
  for (const item of items) {
    sheet.addRow({
      ItemCode: item.itemCode,
      ItemDesc: item.itemDesc,
      Grade: item.grade,
      MainGroup: item.mainGroup,
      Group: item.groupName,
      SubGroup: item.subGroup,
      Brand: item.brand,
      TYPE: item.itemType,
      'Last channel': item.lastChannel,
      JDI: channelState(item, 'JDI'),
      JMS: channelState(item, 'JMS'),
      TGE: channelState(item, 'TGE'),
      'First seen': new Date(item.firstSeenAt).toISOString().slice(0, 10),
      Updated: new Date(item.updatedAt).toISOString().slice(0, 10),
    });
  }
  styleHeader(sheet);
  return toBuffer(workbook);
}
