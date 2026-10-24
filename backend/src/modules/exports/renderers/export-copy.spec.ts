import { strFromU8, unzipSync } from 'fflate';
import { renderExport, RenderInput } from './render-export';

describe('Snapshot document language', () => {
  it.each([
    ['en', 'First name', 'Guest list'], ['ru', 'Имя', 'Список гостей'],
    ['fr', 'Prénom', 'Liste des invités'], ['hy', 'Անուն', 'Հյուրերի ցանկ'],
  ])('localizes CSV and workbook headings in %s while preserving literal guest values', async (locale, heading, title) => {
    const input: RenderInput = { locale, kind: 'GUEST_LIST', format: 'CSV', title: 'ATTENDING', snapshotAt: new Date(), timezone: 'UTC',
      attendanceRevision: 1, dataRevision: '1', includesContacts: false,
      sheet: { columns: ['First name', 'RSVP', 'Q1: question'], rows: [{ 'First name': 'ATTENDING', RSVP: 'ATTENDING', 'Q1: question': '=1+1' }] } };
    const csv = (await renderExport(input)).buffer.toString();
    expect(csv.split('\r\n')[0]).toContain(heading);
    expect(csv).toContain('ATTENDING');
    expect(csv).toContain('Q1: question');
    const workbook = await renderExport({ ...input, format: 'XLSX' });
    const xml = Object.values(unzipSync(workbook.buffer)).map((value) => strFromU8(value)).join('');
    expect(xml).toContain(heading);
    expect(xml).toContain(title);
    expect(xml).toContain('ATTENDING');
    expect(xml).not.toMatch(/<f[ >]/);
    expect(input.sheet.columns[0]).toBe('First name');
  });
});
