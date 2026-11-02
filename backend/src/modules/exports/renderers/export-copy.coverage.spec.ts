import PDFDocument from 'pdfkit';
import { exportValue, translateSheet } from './export-copy';
import { renderExport, RenderInput } from './render-export';

describe('Snapshot value translation', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['ru', 'Придёт'], ['fr', 'Présent'], ['hy', 'Մասնակցելու է'], ['en', 'ATTENDING'],
  ])('translates the RSVP status in %s', (locale, label) => {
    expect(exportValue(locale, 'RSVP', 'ATTENDING')).toBe(label);
  });

  it.each([
    ['Status', 'VALID', 'Действителен'],
    ['Side', 'SIDE_A', 'Сторона A'],
    ['Requirement', 'Total covers', 'Всего порций'],
    ['Requirement', 'Dietary note', 'Примечание по питанию'],
    ['Drink', 'No responses', 'Нет ответов'],
    ['Venue', 'Unspecified', 'Не указано'],
  ])('translates the standard %s value %s into Russian', (column, value, label) => {
    expect(exportValue('ru', column, value)).toBe(label);
  });

  it.each([
    ['First name', 'ATTENDING'], ['Requirement', 'vegan'], ['Drink', 'VALID'], ['Venue', 'Fixture Hall'], ['Q1: Status', 'SIDE_A'],
  ])('keeps host-authored %s value %s literal', (column, value) => {
    expect(exportValue('ru', column, value)).toBe(value);
  });

  it('keeps numbers and blanks untouched', () => {
    expect(exportValue('ru', 'RSVP', 3)).toBe(3);
    expect(exportValue('ru', 'RSVP', null)).toBeNull();
  });

  it('translates headings and standard values together while leaving literal cells', () => {
    const sheet = translateSheet({ columns: ['First name', 'RSVP', 'Side'], rows: [{ 'First name': 'ATTENDING', RSVP: 'DECLINED', Side: 'SIDE_B' }] }, 'fr');
    expect(sheet).toEqual({ columns: ['Prénom', 'Réponse', 'Côté'], rows: [{ Prénom: 'ATTENDING', Réponse: 'Absent', Côté: 'Côté B' }] });
  });

  const guestList = (format: RenderInput['format']): RenderInput => ({ title: 'Wedding', snapshotAt: new Date('2026-10-15T12:00:00Z'),
    timezone: 'Asia/Yerevan', locale: 'ru', attendanceRevision: 1, dataRevision: '1', includesContacts: false, kind: 'GUEST_LIST', format,
    sheet: { columns: ['First name', 'RSVP'], rows: [{ 'First name': 'ATTENDING', RSVP: 'ATTENDING' }] } });

  it('writes the translated RSVP into the RSVP column of a Russian CSV, not the literal name', async () => {
    const [header, row] = (await renderExport(guestList('CSV'))).buffer.toString().replace(/^\uFEFF/u, '').split('\r\n');
    expect(header).toBe('"Имя","Ответ"');
    expect(row).toBe('"ATTENDING","Придёт"');
  });

  it('prints the Russian title, headings and RSVP label in a PDF', async () => {
    const text = jest.spyOn(PDFDocument.prototype, 'text');
    await renderExport(guestList('PDF'));
    const printed = text.mock.calls.map(([value]) => String(value));
    expect(printed).toEqual(expect.arrayContaining(['Список гостей', 'Имя', 'Ответ', 'Придёт', 'ATTENDING']));
    expect(printed).not.toContain('Guest list');
  });
});
