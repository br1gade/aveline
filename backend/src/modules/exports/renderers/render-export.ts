import { ExportFormat } from '@prisma/client';
import { Sheet } from '../export-sheets';
import { toCsv } from '../csv';
import { renderPdf } from './render-pdf';
import { renderWorkbook } from './render-workbook';
import { translateSheet } from './export-copy';

import { RenderInput, RenderedFile, EXPORT_TYPES, MAX_EXPORT_BYTES } from './export-document';
export type { RenderInput } from './export-document';

export async function renderExport(input: RenderInput): Promise<RenderedFile> {
  assertRenderBounds(input.sheet);
  const renderers: Record<ExportFormat, () => Buffer | Promise<Buffer>> = {
    CSV: () => { const sheet = translateSheet(input.sheet, input.locale); return Buffer.from(toCsv(sheet.columns, sheet.rows), 'utf8'); },
    PDF: () => renderPdf(input), XLSX: () => renderWorkbook(input),
  };
  const buffer = await renderers[input.format]();
  if (buffer.length > MAX_EXPORT_BYTES) throw new Error('Export byte limit exceeded');
  return { buffer, ...EXPORT_TYPES[input.format] };
}

function assertRenderBounds(sheet: Sheet): void {
  if (!sheet.columns.length || sheet.columns.length > 256) throw new Error('Export column limit exceeded');
  if (sheet.rows.length > 20_000) throw new Error('Export row limit exceeded');
  let characters = sheet.columns.join('').length;
  for (const row of sheet.rows) {
    for (const column of sheet.columns) {
      const text = String(row[column] ?? '');
      if (text.length > 32767) throw new Error('Export cell limit exceeded');
      characters += text.length;
    }
  }
  if (characters > 2_000_000) throw new Error('Export text limit exceeded');
}
