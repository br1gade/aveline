import { MAX_PAGE_SIZE, resolvePaging, toPage } from './pagination.dto';

/**
 * Paging is the one contract every list endpoint shares, so its edges are
 * worth pinning: a caller must not be able to ask for the whole table, and
 * `hasMore` must not lie, because a client loops on it.
 */
describe('pagination', () => {
  describe('resolvePaging', () => {
    it('applies the default when nothing is asked for', () => {
      expect(resolvePaging({})).toEqual({ take: 20, skip: 0 });
    });

    it.each([
      { limit: 1, expected: 1 },
      { limit: 50, expected: 50 },
      { limit: MAX_PAGE_SIZE, expected: MAX_PAGE_SIZE },
      { limit: 10_000, expected: MAX_PAGE_SIZE },
      { limit: 0, expected: 1 },
      { limit: -5, expected: 1 },
    ])('clamps a limit of $limit to $expected', ({ limit, expected }) => {
      expect(resolvePaging({ limit }).take).toBe(expected);
    });

    it('never produces a negative offset', () => {
      expect(resolvePaging({ offset: -10 }).skip).toBe(0);
    });
  });

  describe('toPage', () => {
    it.each([
      { items: 20, total: 100, skip: 0, hasMore: true, label: 'a first page of many' },
      { items: 20, total: 40, skip: 20, hasMore: false, label: 'the exact last page' },
      { items: 5, total: 25, skip: 20, hasMore: false, label: 'a short last page' },
      { items: 0, total: 0, skip: 0, hasMore: false, label: 'an empty result' },
    ])('reports hasMore=$hasMore for $label', ({ items, total, skip, hasMore }) => {
      const page = toPage(Array.from({ length: items }, (_, i) => i), total, { take: 20, skip });
      expect(page.hasMore).toBe(hasMore);
      expect(page.total).toBe(total);
    });
  });
});
