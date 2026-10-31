import PDFDocument from 'pdfkit';
import { CsvRow } from '../csv';
import { renderExport, RenderInput } from './render-export';

const MM = 72 / 25.4;
const A4 = { width: 595.28, height: 841.89 };

const placeCards = (rows: CsvRow[]): RenderInput => ({ title: 'Wedding', snapshotAt: new Date('2026-10-15T12:00:00Z'), timezone: 'Asia/Yerevan',
  locale: 'en', attendanceRevision: 1, dataRevision: '1', includesContacts: false, kind: 'PLACE_CARDS', format: 'PDF',
  sheet: { columns: ['Name', 'Venue', 'Arrangement', 'Table'], rows } });
const guests = (count: number): CsvRow[] => Array.from({ length: count }, (_, index) => ({ Name: `Guest ${index + 1}`, Venue: 'Hall', Arrangement: 'a1', Table: 'Table 1' }));
const pageCount = (buffer: Buffer) => buffer.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;

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
    const origins = new Set(cards.map(([x, y]) => `${x.toFixed(1)}:${y.toFixed(1)}`));
    expect(origins.size).toBe(6);
  });

  it('shrinks a long but printable name to fit its card', async () => {
    const file = await renderExport(placeCards([{ Name: 'Anahit Hovhannisyan-Ter-Petrosyan Grigoryan', Venue: 'Hall', Arrangement: 'a1', Table: 'Table 1' }]));
    expect(file.buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('fails instead of clipping a name that cannot fit inside the print boundary', async () => {
    await expect(renderExport(placeCards([{ Name: 'W'.repeat(400), Venue: 'Hall', Arrangement: 'a1', Table: 'Table 1' }])))
      .rejects.toThrow('print boundary');
  });
});
