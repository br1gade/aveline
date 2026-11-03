import { describe, expect, it, vi } from 'vitest';

import { ApiError } from './errors';
import { readEveryPage } from './every-page';

const MAX_PAGES = 11;

interface Page {
  items: { id: string }[];
  nextCursor: string | null;
}

const page = (ids: string[], nextCursor: string | null): Page => ({
  items: ids.map((id) => ({ id })),
  nextCursor,
});

describe('reading a whole list by its cursor', () => {
  it('follows the cursor to the end', async () => {
    const read = vi
      .fn<(after?: string) => Promise<Page>>()
      .mockResolvedValueOnce(page(['a', 'b'], 'b'))
      .mockResolvedValueOnce(page(['c'], null));
    await expect(readEveryPage(read, MAX_PAGES)).resolves.toEqual({
      items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      isComplete: true,
    });
    expect(read.mock.calls).toEqual([[undefined], ['b']]);
  });

  it('ends on an empty page, which a full last page is followed by', async () => {
    const read = vi
      .fn<(after?: string) => Promise<Page>>()
      .mockResolvedValueOnce(page(['a'], 'a'))
      .mockResolvedValueOnce(page([], null));
    await expect(readEveryPage(read, MAX_PAGES)).resolves.toMatchObject({ isComplete: true });
  });

  it('starts again once when its cursor was removed meanwhile (404)', async () => {
    const gone = new ApiError({ status: 404, messages: ['Unknown gallery cursor'] });
    const read = vi
      .fn<(after?: string) => Promise<Page>>()
      .mockResolvedValueOnce(page(['a'], 'a'))
      .mockRejectedValueOnce(gone)
      .mockResolvedValueOnce(page(['b'], null));
    await expect(readEveryPage(read, MAX_PAGES)).resolves.toEqual({
      items: [{ id: 'b' }],
      isComplete: true,
    });
    expect(read.mock.calls).toEqual([[undefined], ['a'], [undefined]]);
  });

  it('throws a second 404, and any 404 on the first page', async () => {
    const gone = new ApiError({ status: 404, messages: [] });
    const twice = vi
      .fn<(after?: string) => Promise<Page>>()
      .mockResolvedValueOnce(page(['a'], 'a'))
      .mockRejectedValueOnce(gone)
      .mockResolvedValueOnce(page(['a'], 'a'))
      .mockRejectedValueOnce(gone);
    await expect(readEveryPage(twice, MAX_PAGES)).rejects.toBe(gone);
    const first = vi.fn(() => Promise.reject(gone));
    await expect(readEveryPage(first, MAX_PAGES)).rejects.toBe(gone);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('stops at its page limit and says the list is not whole', async () => {
    const read = vi.fn((after?: string) =>
      Promise.resolve(page([`${after ?? 0}x`], `${after ?? 0}x`)),
    );
    await expect(readEveryPage(read, 3)).resolves.toMatchObject({ isComplete: false });
    expect(read).toHaveBeenCalledTimes(3);
  });
});
