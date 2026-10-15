import PDFDocument from 'pdfkit';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CsvRow } from '../csv';
import type { RenderInput } from './export-document';
import { MAX_EXPORT_BYTES } from './export-document';
import { PdfReport } from './pdf-report';
import { drawPlaceCards } from './pdf-cards';

let fonts: Promise<Buffer[]> | undefined;
function loadFonts(): Promise<Buffer[]> {
  fonts ??= Promise.all(['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'].map((file) => readFile(resolve(__dirname, '../../../../assets/fonts', file))));
  return fonts;
}

export async function renderPdf(input: RenderInput): Promise<Buffer> {
  const [body, bold] = await loadFonts();
  const document = new PDFDocument({ autoFirstPage: false, size: 'A4', layout: input.kind !== 'PLACE_CARDS' && input.sheet.columns.length > 4 ? 'landscape' : 'portrait',
    margins: { top: 36, bottom: 36, left: 36, right: 36 }, info: { Title: input.title, Creator: 'Aveline', CreationDate: input.snapshotAt } });
  document.registerFont('Body', body).registerFont('Bold', bold);
  const result = collectPdf(document);
  try {
    const report = new PdfReport(document, input);
    report.addPage();
    drawReport(report, input);
    document.end();
  } catch (error) { document.destroy(error instanceof Error ? error : new Error('PDF rendering failed')); }
  return result;
}

function collectPdf(document: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolveBuffer, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    document.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > MAX_EXPORT_BYTES) { document.destroy(new Error('PDF byte limit exceeded')); return; }
      chunks.push(chunk);
    });
    document.on('error', reject);
    document.on('end', () => resolveBuffer(Buffer.concat(chunks)));
  });
}

function drawReport(report: PdfReport, input: RenderInput): void {
  if (input.kind === 'PLACE_CARDS') { drawPlaceCards(report, input.sheet.rows); return; }
  if (input.kind === 'SEATING_CHART') { drawSeating(report, input.sheet.rows); return; }
  if (['CATERING_SHEET', 'BAR_SHEET'].includes(input.kind) && input.sheet.columns.includes('Venue')) { drawVenueOperations(report, input); return; }
  const columns = orderedColumns(input);
  const bands = columnBands(columns);
  bands.forEach((band, index) => {
    if (index > 0) report.addPage();
    const rows = input.sheet.rows.map((row) => band.map((column) => String(row[column] ?? '')));
    const labels = band.filter((column) => /^Q\d+:/.test(column));
    const group = bands.length > 1 ? `Column group ${index + 1} of ${bands.length}` : '';
    const headings = band.map((column) => /^Q\d+:/.test(column) ? column.split(':')[0] : column);
    report.table(headings, rows, [group, ...labels].filter(Boolean).join('\n'));
  });
}

function orderedColumns(input: RenderInput): string[] {
  const identity = ['First name', 'Last name'].filter((column) => input.sheet.columns.includes(column));
  return [...identity, ...input.sheet.columns.filter((column) => !identity.includes(column))];
}

function columnBands(columns: string[]): string[][] {
  if (columns.length <= 6) return [columns];
  const bands: string[][] = [];
  for (let index = 2; index < columns.length; index += 4) bands.push([...columns.slice(0, 2), ...columns.slice(index, index + 4)]);
  return bands;
}

function drawSeating(report: PdfReport, rows: CsvRow[]): void {
  const groups = new Map<string, CsvRow[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.Venue, row.Arrangement, row.Table]);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  if (!groups.size) { report.table(['Venue', 'Table', 'Guest'], []); return; }
  for (const group of groups.values()) {
    const first = group[0];
    const label = `${String(first.Venue ?? 'Unspecified')} / ${String(first.Table ?? '')}\nCapacity ${String(first.Capacity ?? '')} - Seated ${String(first.Seated ?? 0)}`;
    report.table(['Guest'], group.map((row) => [String(row.Guest ?? '')]), label);
  }
}


function drawVenueOperations(report: PdfReport, input: RenderInput): void {
  const groups = new Map<string, CsvRow[]>();
  for (const row of input.sheet.rows) {
    const venue = String(row.Venue ?? 'Unspecified');
    const group = groups.get(venue) ?? [];
    group.push(row);
    groups.set(venue, group);
  }
  const columns = input.sheet.columns.filter((column) => column !== 'Venue');
  if (!groups.size) { report.table(columns, []); return; }
  for (const [venue, rows] of groups) report.table(columns, rows.map((row) => columns.map((column) => String(row[column] ?? ''))), venue);
}
