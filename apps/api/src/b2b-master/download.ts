import ExcelJS from 'exceljs';
import type { B2bMasterRow } from '../../../../packages/db/src/b2b-master.js';

/** The customer file's columns, in order. The header text is what the upload
 *  reads, so a downloaded file can be edited and uploaded again. */
export const B2B_FILE_COLUMNS = [
  'Cust Code',
  'Customer',
  'Salesman',
  'Sales Channel',
  'Last Sales Order No',
  'Last Invoice Date',
] as const;

export async function buildB2bMasterWorkbook(rows: B2bMasterRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('B2B Customers');
  sheet.columns = B2B_FILE_COLUMNS.map((header) => ({
    header,
    key: header,
    width: header === 'Customer' ? 46 : 22,
  }));
  for (const row of rows) {
    sheet.addRow({
      'Cust Code': row.custCode,
      Customer: row.customerName,
      Salesman: row.salesman,
      'Sales Channel': row.salesChannel,
      'Last Sales Order No': row.lastSalesOrderNumber,
      'Last Invoice Date': row.lastInvoiceDate,
    });
  }
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10233F' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: 'F1' };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
