import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/errors';

import { useMoreByCursor, type CursorPage } from './use-more';

const page = (items: number[], nextCursor: string | null): CursorPage<number> => ({
  items,
  nextCursor,
});

describe('useMoreByCursor', () => {
  it('reads on by the cursor the last page gave, and stops when the list is exhausted', async () => {
    const first = page([1, 2], 'c1');
    const read = vi.fn((cursor: string) =>
      Promise.resolve(cursor === 'c1' ? page([3, 4], 'c2') : page([5], null)),
    );
    const { result } = renderHook(() => useMoreByCursor(first, read));
    act(() => result.current.more());
    await waitFor(() => expect(result.current.items).toEqual([1, 2, 3, 4]));
    act(() => result.current.more());
    await waitFor(() => expect(result.current.items).toEqual([1, 2, 3, 4, 5]));
    expect(result.current.hasMore).toBe(false);
    expect(read.mock.calls.map(([cursor]) => cursor)).toEqual(['c1', 'c2']);
  });

  it('starts over from a new first page, as after the route reads itself again', async () => {
    const read = vi.fn(() => Promise.resolve(page([3], null)));
    const { result, rerender } = renderHook(({ first }) => useMoreByCursor(first, read), {
      initialProps: { first: page([1], 'c1') },
    });
    act(() => result.current.more());
    await waitFor(() => expect(result.current.items).toEqual([1, 3]));
    rerender({ first: page([9], 'c9') });
    expect(result.current.items).toEqual([9]);
    expect(result.current.hasMore).toBe(true);
  });

  it('keeps a refusal for the page to word, and the pages already read', async () => {
    const first = page([1], 'c1');
    const refused = new ApiError({ status: 429, messages: ['Too many requests'] });
    const read = vi.fn(() => Promise.reject(refused));
    const { result } = renderHook(() => useMoreByCursor(first, read));
    act(() => result.current.more());
    await waitFor(() => expect(result.current.error).toBe(refused));
    expect(result.current.items).toEqual([1]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.hasMore).toBe(true);
  });
});
