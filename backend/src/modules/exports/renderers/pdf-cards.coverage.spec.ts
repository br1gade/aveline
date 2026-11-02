import PDFDocument from 'pdfkit';
import { CsvRow } from '../csv';
import { renderExport, RenderInput } from './render-export';

const MM = 72 / 25.4;
const A4 = { width: 595.28, height: 841.89 };

const placeCards = (rows: CsvRow[]): RenderInput => ({ title: 'Wedding', snapshotAt: new Date('2026-10-15T12:00:00Z'), timezone: 'Asia/Yerevan',
  locale: 'en', attendanceRevision: 1, dataRevision: '1', includesContacts: false, kind: 'PLACE_CARDS', format: 'PDF',
  sheet: { columns: ['Name', 'Venue', 'Arrangement', 'Table'], rows } });
const guests = (count: number): CsvRow[] => Array.from({ length: count }, (_, index) => card(`Guest ${index + 1}`));
const pageCount = (buffer: Buffer) => buffer.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;
const card = (Name: string): CsvRow => ({ Name, Venue: 'Hall', Arrangement: 'a1', Table: 'Table 1' });
type Sized = PDFKit.PDFDocument & { _fontSize: number };

/** Records every printed string with the font size it was printed at. */
function recordPrinting(): { text: string; size: number }[] {
  const printed: { text: string; size: number }[] = [];
  const original = PDFDocument.prototype.text as (this: Sized, ...args: unknown[]) => Sized;
  jest.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (this: Sized, ...args: unknown[]) {
    printed.push({ text: String(args[0]), size: this._fontSize });
    return original.apply(this, args);
  });
  return printed;
}

describe('Place-card PDF layout', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([[1, 1], [6, 1], [7, 2], [12, 2], [13, 3]])('lays %i cards on %i A4 page(s), six per page', async (cards, pages) => {
    expect(pageCount((await renderExport(placeCards(guests(cards)))).buffer)).toBe(pages);
  });

  it('cuts each card at 90 x 70 mm, inside the A4 sheet, without overlapping on a page', async () => {
    const rect = jest.spyOn(PDFDocument.prototype, 'rect');
    await renderExport(placeCards(guests(6)));
    const calls = rect.mock.calls as unknown as [number, number, number, number][];
    const cards = calls.filter(([, , width]) => Math.abs(width - 90 * MM) < 0.01);
    expect(cards).toHaveLength(6);
    for (const [x, y, width, height] of cards) {
      expect(height).toBeCloseTo(70 * MM, 2);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + width).toBeLessThanOrEqual(A4.width);
      expect(y + height).toBeLessThanOrEqual(A4.height);
    }
    const overlaps = cards.flatMap(([ax, ay, aw, ah], index) => cards.slice(index + 1)
      .filter(([bx, by, bw, bh]) => ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah));
    expect(overlaps).toEqual([]);
  });

  it('prints a short name at the full 20 pt card size', async () => {
    const printed = recordPrinting();
    await renderExport(placeCards([card('Ani')]));
    expect(printed.filter((line) => line.text === 'Ani')).toEqual([{ text: 'Ani', size: 20 }]);
  });

  it('wraps and shrinks a long but printable name, printing every word', async () => {
    const words = ['Anahit', 'Hovhannisyan', 'Ter-Petrosyan', 'Grigoryan', 'Mkrtchyan', 'Khachatryan', 'Avetisyan', 'Sargsyan'];
    const printed = recordPrinting();
    await renderExport(placeCards([card(words.join(' '))]));
    const nameLines = printed.filter((line) => words.some((word) => line.text.includes(word)));
    expect(nameLines.length).toBeGreaterThan(1);
    expect(nameLines.map((line) => line.text).join(' ')).toBe(words.join(' '));
    expect(Math.max(...nameLines.map((line) => line.size))).toBeLessThan(20);
  });

  it('fails instead of clipping a name that cannot fit inside the print boundary', async () => {
    await expect(renderExport(placeCards([card('W'.repeat(400))])))
      .rejects.toThrow('print boundary');
  });
});
