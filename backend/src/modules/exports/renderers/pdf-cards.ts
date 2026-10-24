import { CsvRow } from '../csv';
import { PdfReport } from './pdf-report';
import { wrapText } from './pdf-text';

const WIDTH = 90 * 72 / 25.4;
const HEIGHT = 70 * 72 / 25.4;

/** Six 90 x 70 mm flat cards on A4, with cut guides outside their text. */
export function drawPlaceCards(report: PdfReport, rows: CsvRow[]): void {
  if (!rows.length) { report.table(['Name'], []); return; }
  rows.forEach((row, index) => {
    if (index > 0 && index % 6 === 0) report.addPage();
    const x = 36 + (index % 2) * (WIDTH + 12);
    const y = Math.max(110, report.contentStart) + Math.floor((index % 6) / 2) * (HEIGHT + 12);
    drawCard(report, row, { x, y });
  });
}

function drawCard(report: PdfReport, row: CsvRow, origin: { x: number; y: number }): void {
  const document = report.document;
  const name = String(row.Name ?? '');
  const context = [row.Table, row.Venue === 'Unspecified' ? report.label('Unspecified') : row.Venue].filter((value) => value !== null && value !== undefined && value !== '').join('\n');
  const layout = fitCard(document, name, context);
  document.save().strokeColor('#9aa79f').lineWidth(0.4).dash(2, { space: 3 }).rect(origin.x, origin.y, WIDTH, HEIGHT).stroke().undash().restore();
  const nameHeight = layout.names.length * layout.nameSize * 1.2;
  const contextHeight = layout.context.length * layout.contextSize * 1.3;
  let y = origin.y + (HEIGHT - nameHeight - contextHeight - 12) / 2;
  document.font('Bold').fontSize(layout.nameSize).fillColor('#25352c');
  for (const line of layout.names) { drawCentered(report, line, origin.x, y); y += layout.nameSize * 1.2; }
  y += 12;
  document.font('Body').fontSize(layout.contextSize).fillColor('#4e5e54');
  for (const line of layout.context) { drawCentered(report, line, origin.x, y); y += layout.contextSize * 1.3; }
}

function drawCentered(report: PdfReport, line: string, x: number, y: number): void {
  report.text(line, x + (WIDTH - report.document.widthOfString(line)) / 2, y);
}

function fitCard(document: PDFKit.PDFDocument, name: string, context: string) {
  for (const contextSize of [9, 8]) {
    document.font('Body').fontSize(contextSize);
    const details = context ? wrapText(document, context, WIDTH - 24) : [];
    for (const nameSize of [20, 18, 16, 14, 12]) {
      document.font('Bold').fontSize(nameSize);
      const names = wrapText(document, name, WIDTH - 24);
      if (names.length * nameSize * 1.2 + details.length * contextSize * 1.3 + 12 <= HEIGHT - 24) return { names, context: details, nameSize, contextSize };
    }
  }
  throw new Error('Place-card text exceeds its print boundary');
}
