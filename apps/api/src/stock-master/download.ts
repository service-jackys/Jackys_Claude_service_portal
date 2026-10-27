import ExcelJS from 'exceljs';
import type { StockMasterRow } from '../../../../packages/db/src/stock-master.js';

/** The ERP Item Listing columns, in file order. The header text is what the
 *  upload reads, so a rebuilt file can be uploaded again as it is. */
export const STOCK_FILE_COLUMNS = [
  'Item Code',
  'Item Desc',
  'Maingrp Name',
  'Grp Name',
  'SUBGRPNAME',
  'BRANDNAME',
] as const;

/** The stock master rebuilt as an Item Listing workbook (one row per item code). */
export async function buildStockMasterWorkbook(rows: StockMasterRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Item Listing');
  sheet.columns = STOCK_FILE_COLUMNS.map((header) => ({
    header,
    key: header,
    width: header === 'Item Desc' ? 46 : 22,
  }));
  for (const row of rows) {
    sheet.addRow({
      'Item Code': row.itemCode,
      'Item Desc': row.itemDesc,
      'Maingrp Name': row.mainGroup,
      'Grp Name': row.groupName,
      SUBGRPNAME: row.subGroup,
      BRANDNAME: row.brand,
    });
  }
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10233F' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
