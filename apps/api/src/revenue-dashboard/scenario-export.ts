import ExcelJS from 'exceljs';
import type { ScenarioResult, ScenarioSettings } from './scenario-run.js';

// "Export comparison" workbook of the Scenario test tab (modification #304).
const NAVY = 'FF10233F';
const BAND = 'FFF3F6FB';
const MONEY = '#,##0.00;[Red]-#,##0.00';
const FONT = 'Arial';

function header(row: ExcelJS.Row) {
  row.height = 26;
  row.eachCell((cell) => {
    cell.font = { name: FONT, bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
}

function table(
  sheet: ExcelJS.Worksheet,
  columns: { h: string; w: number; money?: boolean }[],
  rows: unknown[][],
) {
  sheet.columns = columns.map((c) => ({ width: c.w }));
  header(sheet.addRow(columns.map((c) => c.h)));
  for (const r of rows) {
    const row = sheet.addRow(r);
    row.eachCell((cell, i) => {
      cell.font = { name: FONT, size: 10 };
      if (columns[i - 1]?.money) cell.numFmt = MONEY;
    });
  }
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  if (rows.length) sheet.autoFilter = { from: 'A1', to: { row: 1, column: columns.length } };
}

export async function buildScenarioWorkbook(
  fileName: string,
  settings: ScenarioSettings,
  result: ScenarioResult,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Jacky's Service Portal";
  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ width: 44 }, { width: 18 }, { width: 18 }, { width: 18 }];
  const title = sum.addRow([
    'Scenario test: new fridge pricing logic (TEST ONLY, nothing is changed)',
  ]);
  title.font = { name: FONT, bold: true, size: 13, color: { argb: NAVY } };
  sum.addRow([`Workbook: ${fileName}`]).font = { name: FONT, size: 10 };
  sum.addRow([]);
  header(sum.addRow(['', 'Current logic (live)', 'New logic (scenario)', 'Difference']));
  for (const [label, a, b] of [['Total revenue', result.current, result.scenario]] as const) {
    const r = sum.addRow([label, a, b, Math.round((b - a) * 100) / 100]);
    r.eachCell((c, i) => {
      c.font = { name: FONT, bold: true, size: 10 };
      if (i > 1) c.numFmt = MONEY;
    });
  }
  sum.addRow([]);
  const f = settings.fridge;
  const lines: [string, string | number][] = [
    ['Fridge 400 L and under: base rate (2 to 10 units)', f.smallBase],
    ['Fridge 400 L and under: second tier (over 10 units)', f.smallOver10],
    ['Fridge 400 L and under: minimum', f.smallMinimum],
    ['Over 10 units', f.optionB ? 'Option B: only the units above 10' : 'Option A: all units'],
    ['13A plug amount per plug', f.plugAmount],
    ['Fridge lines / units priced', `${result.fridges.lines} / ${result.fridges.units}`],
    [
      'Fridge lines on the 400 L default (litres not found)',
      `${result.fridges.defaultLines} lines / ${result.fridges.defaultUnits} units`,
    ],
    ['Plug lines counted', 'None yet: the ERP line wording is still to come'],
  ];
  header(sum.addRow(['Scenario settings', 'Value']));
  for (const [k, v] of lines) {
    const r = sum.addRow([k, v]);
    r.eachCell((c) => (c.font = { name: FONT, size: 10 }));
  }

  const money = (h: string, w = 16) => ({ h, w, money: true });
  const cmp = (rows: ScenarioResult['byCategory']) =>
    rows.map((x) => [x.label, x.jobs, x.units, x.current, x.scenario, x.change]);
  const cmpCols = (first: string) => [
    { h: first, w: 40 },
    { h: 'Jobs', w: 10 },
    { h: 'Units', w: 10 },
    money('Current'),
    money('New'),
    money('Difference'),
  ];
  table(wb.addWorksheet('By category'), cmpCols('Category'), cmp(result.byCategory));
  table(wb.addWorksheet('By job type'), cmpCols('Job type'), cmp(result.byJobType));
  table(wb.addWorksheet('By salesperson'), cmpCols('Salesperson'), cmp(result.bySalesperson));
  table(
    wb.addWorksheet('Changed invoices'),
    [
      { h: 'Invoice', w: 16 },
      { h: 'Date', w: 12 },
      { h: 'Salesperson', w: 22 },
      { h: 'Customer', w: 28 },
      { h: 'Job type', w: 10 },
      { h: 'Category', w: 28 },
      { h: 'Units', w: 8 },
      { h: 'Litres', w: 9 },
      { h: 'Litres from', w: 14 },
      { h: 'Default litres', w: 10 },
      { h: 'Rule applied', w: 60 },
      money('Current'),
      money('New'),
      money('Difference'),
    ],
    result.invoices.map((i) => [
      i.invoice,
      i.date,
      i.salesPerson,
      i.customer,
      i.jobType,
      i.category,
      i.units,
      i.litres,
      i.litresSource,
      i.defaultLitres ? 'Yes' : '',
      i.rule,
      i.current,
      i.scenario,
      i.change,
    ]),
  );
  const review = wb.addWorksheet('Default litres');
  table(
    review,
    [
      { h: 'Invoice', w: 16 },
      { h: 'Customer', w: 28 },
      { h: 'Job type', w: 10 },
      { h: 'Units', w: 8 },
      { h: 'Litres used', w: 11 },
      { h: 'Litres from', w: 14 },
      { h: 'Rule applied', w: 60 },
    ],
    result.invoices
      .filter((i) => i.defaultLitres)
      .map((i) => [i.invoice, i.customer, i.jobType, i.units, i.litres, i.litresSource, i.rule]),
  );
  sum.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
