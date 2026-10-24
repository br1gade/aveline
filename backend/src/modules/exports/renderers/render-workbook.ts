import writeExcelFile, { Cell, CellObject, Sheet as WorkbookSheet } from 'write-excel-file/node';
import { CsvRow } from '../csv';
import { Sheet } from '../export-sheets';
import type { RenderInput } from './export-document';
import { exportText, exportTitle, exportValue } from './export-copy';

export function renderWorkbook(input: RenderInput): Promise<Buffer> {
  return writeExcelFile(workbookSheets(input), { fontFamily: 'DejaVu Sans', fontSize: 10 }).toBuffer();
}

function workbookSheets(input: RenderInput): WorkbookSheet<never>[] {
  if (input.kind !== 'CATERING_SHEET') return [makeSheet(input, input.sheet, exportTitle(input.locale, input.kind))];
  const isNote = (row: CsvRow) => row.Requirement === 'Dietary note';
  return [
    makeSheet(input, { columns: ['Venue', 'Requirement', 'Guests'], rows: input.sheet.rows.filter((row) => !isNote(row)) }, 'Requirements'),
    makeSheet(input, { columns: ['Venue', 'Guest and household', 'Note'], rows: input.sheet.rows.filter(isNote).map((row) => ({ Venue: row.Venue, 'Guest and household': row.Guests, Note: row.Note })) }, 'Dietary notes'),
  ];
}

function makeSheet(input: RenderInput, sheet: Sheet, name: string): WorkbookSheet<never> {
  const widths = sheet.columns.map(columnWidth);
  const copy = (text: string) => exportText(input.locale, text);
  const heading = sheet.columns.map((column): CellObject => ({ value: copy(column), type: String, fontWeight: 'bold', textColor: '#FFFFFF',
    backgroundColor: '#34483b', align: 'center', alignVertical: 'center', wrap: true, height: Math.min(409, Math.max(32, Math.ceil(copy(column).length / widths[sheet.columns.indexOf(column)]) * 15 + 8)) }));
  return { sheet: copy(name), showGridLines: false, stickyRowsCount: 8, stickyColumnsCount: Math.min(3, sheet.columns.length),
    columns: widths.map((width) => ({ width })), data: [[], [{ value: exportTitle(input.locale, input.kind), type: String, fontSize: 16, fontWeight: 'bold', height: 24 }],
      [textCell(input.title)], [textCell(copy('Generated (UTC)')), { value: input.snapshotAt, type: Date, format: 'yyyy-mm-dd hh:mm:ss "UTC"' }],
      [textCell(copy('Event timezone')), textCell(input.timezone)],
      [textCell(copy(input.includesContacts ? 'Includes contact details' : 'Contact columns omitted'))], [], heading,
      ...sheet.rows.map((row) => sheet.columns.map((column, index) => dataCell(column, exportValue(input.locale, column, row[column]), widths[index]))),
    ] };
}

function textCell(value: string): CellObject { return { value, type: String, alignVertical: 'center' }; }

function dataCell(column: string, value: CsvRow[string], width: number): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return { value: column === 'Share %' ? value / 100 : value, type: Number,
    format: column === 'Share %' ? '0.0%' : '#,##0', align: 'right', alignVertical: 'center', height: 22 };
  if (['Arrived', 'Used at'].includes(column) && /^\d{4}-\d\d-\d\dT/.test(value)) {
    return { value: new Date(value), type: Date, format: 'yyyy-mm-dd hh:mm:ss "UTC"', height: 22, alignVertical: 'center' };
  }
  const lines = value.split('\n').reduce((count, line) => count + Math.max(1, Math.ceil(line.length / width)), 0);
  return { ...textCell(value), wrap: true, height: Math.min(409, Math.max(22, lines * 15 + 8)) };
}

function columnWidth(column: string): number {
  if (/Note|note|^Q\d/.test(column)) return 55;
  if (/Email|email|Name|name|Household|Guest|Track/.test(column)) return 32;
  if (['Arrived', 'Used at', 'Arrangement'].includes(column)) return 29;
  return 22;
}
