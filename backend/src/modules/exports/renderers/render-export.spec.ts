import { ExportFormat, ExportKind } from '@prisma/client';
import { strFromU8, unzipSync } from 'fflate';
import { renderExport, RenderInput } from './render-export';

const context = { title: 'Աննա & Иван - Événement', snapshotAt: new Date('2026-10-15T12:34:56Z'), timezone: 'Asia/Yerevan', locale: 'hy',
  attendanceRevision: 2, dataRevision: '1:2:', includesContacts: false };
const input = (format: ExportFormat, kind: ExportKind = 'GUEST_LIST'): RenderInput => ({ ...context, format, kind,
  sheet: { columns: ['Name', 'Guests', 'Note'], rows: [{ Name: 'Անահիտ Иван Émilie', Guests: 0, Note: '=HYPERLINK("https://invalid.test","click")' }] } });

function xmlFiles(buffer: Buffer) {
  return Object.entries(unzipSync(buffer)).filter(([name]) => name.endsWith('.xml')).map(([name, value]) => ({ name, xml: strFromU8(value) }));
}

describe('Operational file rendering', () => {
  it.each(Object.values(ExportKind))('renders a PDF for %s with embedded fonts', async (kind) => {
    const file = await renderExport(input('PDF', kind));
    expect(file.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(file.mimeType).toBe('application/pdf');
    expect(file.extension).toBe('pdf');
    expect(file.buffer.toString('latin1')).toContain('/FontFile2');
  });
  it('paginates a long guest list without losing the file boundary', async () => {
    const payload = input('PDF');
    payload.sheet.rows = Array.from({ length: 400 }, (_, index) => ({ Name: `Հայերեն ${index}`, Guests: index, Note: 'Allergy note '.repeat(8) }));
    const file = await renderExport(payload);
    const text = file.buffer.toString('latin1');
    expect(text.match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(1);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });
  it('writes literal Unicode, formula-like text, URLs, numbers and blanks without executable cells', async () => {
    const payload = input('XLSX');
    payload.sheet.rows.push({ Name: '@SUM(1,2)', Guests: 12, Note: 'https://example.test' }, { Name: '+12345', Guests: null, Note: '<&>' });
    const file = await renderExport(payload);
    expect(file.extension).toBe('xlsx');
    expect(file.mimeType).toContain('spreadsheetml');
    const documents = xmlFiles(file.buffer);
    const worksheets = documents.filter(({ name }) => name.startsWith('xl/worksheets/'));
    const combined = documents.map(({ xml }) => xml).join('\n');
    expect(combined).toContain('Անահիտ Иван Émilie');
    expect(combined).toContain('=HYPERLINK');
    expect(combined).not.toMatch(/<f[ >]|<hyperlink[ >]|externalLink/);
    expect(worksheets[0].xml).toMatch(/<v>0<\/v>/);
    expect(worksheets[0].xml).toMatch(/<v>12<\/v>/);
    expect(worksheets[0].xml).toContain('state="frozen"');
  });
  it('keeps actual attendance timestamps typed and percentages in Excel units', async () => {
    const payload = input('XLSX', 'BAR_SHEET');
    payload.sheet = { columns: ['Arrived', 'Share %', 'Code'], rows: [{ Arrived: '2026-10-15T12:34:56.000Z', 'Share %': 25, Code: '00123' }] };
    const combined = xmlFiles((await renderExport(payload)).buffer).map(({ xml }) => xml).join('\n');
    expect(combined).toContain('<v>0.25</v>');
    expect(combined).toContain('00123');
    expect(combined).toContain('UTC');
    expect(combined).not.toContain('2026-10-15T12:34:56.000Z');
  });
  it.each([0, 257])('refuses an invalid column count %i before rendering', async (count) => {
    const payload = input('PDF');
    payload.sheet.columns = Array.from({ length: count }, (_, index) => `Column ${index}`);
    await expect(renderExport(payload)).rejects.toThrow('column');
  });
  it('rejects oversized cell text instead of silently truncating a saved document', async () => {
    const payload = input('XLSX');
    payload.sheet.rows[0].Note = 'x'.repeat(32768);
    await expect(renderExport(payload)).rejects.toThrow('cell');
  });
});
