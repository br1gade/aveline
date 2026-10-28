import type { RenderInput } from './export-document';
import { exportText, exportTitle } from './export-copy';
import { wrapText } from './pdf-text';

const MARGIN = 36;
const LINE = 12;

/** Explicit page geometry prevents implicit PDFKit page breaks inside a cell. */
export class PdfReport {
  private y = 104;
  private pages = 0;
  private contentTop = 108;
  private readonly started = Date.now();
  constructor(readonly document: PDFKit.PDFDocument, private readonly input: RenderInput) {}
  get contentStart() { return this.contentTop; }
  get width() { return this.document.page.width - MARGIN * 2; }
  label(value: string) { return exportText(this.input.locale, value); }
  private get bottom() { return this.document.page.height - 40; }

  addPage(): void {
    if (this.pages >= 500 || Date.now() - this.started > 45_000) throw new Error('PDF page or render-time limit exceeded');
    this.document.addPage();
    this.pages += 1;
    this.document.font('Bold').fontSize(16).fillColor('#27342f');
    this.text(exportTitle(this.input.locale, this.input.kind), MARGIN, 30);
    this.document.font('Body').fontSize(10);
    const titleLines = wrapText(this.document, this.input.title.replace(/\s+/gu, ' '), this.width);
    titleLines.forEach((line, index) => this.text(line, MARGIN, 53 + index * 12));
    const metadataY = 57 + titleLines.length * 12;
    this.document.fontSize(8).fillColor('#535f59');
    const at = new Intl.DateTimeFormat(this.input.locale, { dateStyle: 'medium', timeStyle: 'medium', timeZone: this.input.timezone }).format(this.input.snapshotAt);
    this.text(`${this.label('Generated')} ${at} (${this.input.timezone})`, MARGIN, metadataY);
    this.text(this.label(this.input.includesContacts ? 'Includes contact details' : 'Contact columns omitted'), MARGIN, metadataY + 14);
    this.contentTop = metadataY + 37;
    this.document.strokeColor('#cbd3ce').lineWidth(0.5).moveTo(MARGIN, this.contentTop - 11).lineTo(MARGIN + this.width, this.contentTop - 11).stroke();
    this.document.fontSize(8);
    this.text(`${this.label('Page')} ${this.pages}`, MARGIN, this.document.page.height - 25);
    this.document.font('Body').fontSize(9).fillColor('#202823');
    this.y = this.contentTop;
  }

  text(value: string, x: number, y: number): void { this.document.text(value, x, y, { lineBreak: false }); }

  table(columns: string[], rows: string[][], label = ''): void {
    const widths = columns.map(() => this.width / columns.length);
    const header = () => this.drawHeader(columns.map((column) => this.label(column)), widths, label);
    header();
    if (!rows.length) this.drawRow([[this.label('No records')]], [this.width], false);
    for (const row of rows) this.paginateRow(row, widths, header);
    this.y += 16;
  }

  private drawHeader(columns: string[], widths: number[], label: string): void {
    this.document.font('Bold').fontSize(9);
    const cells = columns.map((column, index) => wrapText(this.document, column, widths[index] - 12));
    const labels = label ? wrapText(this.document, label, this.width) : [];
    const needed = (Math.max(...cells.map((cell) => cell.length)) + labels.length) * LINE + 20;
    if (needed > this.bottom - this.contentTop) throw new Error('PDF heading exceeds a page');
    if (this.y + needed + LINE > this.bottom) this.addPage();
    this.document.font('Bold').fontSize(9).fillColor('#27342f');
    for (const line of labels) { this.text(line, MARGIN, this.y); this.y += LINE; }
    this.drawRow(cells, widths, true);
    this.document.font('Body').fontSize(9);
  }

  private paginateRow(values: string[], widths: number[], header: () => void): void {
    this.document.font('Body').fontSize(9);
    const cells = values.map((value, index) => wrapText(this.document, value, widths[index] - 12));
    let offset = 0;
    const total = Math.max(...cells.map((cell) => cell.length));
    while (offset < total) {
      if (this.y + LINE + 8 > this.bottom) { this.addPage(); header(); }
      const count = Math.min(total - offset, Math.floor((this.bottom - this.y - 8) / LINE));
      this.drawRow(rowFragment(cells, offset, count), widths, false);
      offset += count;
    }
  }

  private drawRow(cells: string[][], widths: number[], isHeader: boolean): void {
    const height = Math.max(1, ...cells.map((cell) => cell.length)) * LINE + 8;
    if (isHeader) this.document.rect(MARGIN, this.y, this.width, height).fill('#e9eeea');
    this.document.fillColor('#202823');
    let x = MARGIN;
    cells.forEach((lines, index) => {
      this.drawCell(lines, x + 6, this.y + 4);
      x += widths[index];
    });
    this.y += height;
    this.document.strokeColor('#dce2dd').lineWidth(0.35).moveTo(MARGIN, this.y).lineTo(MARGIN + this.width, this.y).stroke();
  }

  private drawCell(lines: string[], x: number, y: number): void {
    lines.forEach((line, index) => this.text(line, x, y + index * LINE));
  }
}


function rowFragment(cells: string[][], offset: number, count: number): string[][] {
  return cells.map((cell, index) => index < 2 && offset >= cell.length ? cell.slice(0, count) : cell.slice(offset, offset + count));
}
