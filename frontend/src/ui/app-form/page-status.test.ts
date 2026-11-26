import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePageStatus } from './page-status';

const router = vi.hoisted(() => ({
  matches: [] as object[],
  state: 'idle',
  revalidate: vi.fn<() => Promise<void>>(),
}));
vi.mock('react-router', () => ({
  useMatches: () => router.matches,
  useRevalidator: () => ({ revalidate: router.revalidate, state: router.state }),
}));

beforeEach(() => {
  router.matches = [{ data: 'unchanged' }];
  router.state = 'idle';
  router.revalidate.mockReset().mockResolvedValue(undefined);
});

describe('waiting for refreshed page data', () => {
  it('keeps retry busy until route data commits, even when the loader value is unchanged', async () => {
    const { result, rerender } = renderHook(() => usePageStatus('unchanged'));
    let didFinish = false;
    const pending = result.current.page.reloadAndWait().then(() => {
      didFinish = true;
    });
    await act(() => Promise.resolve());
    expect(didFinish).toBe(false);
    router.matches = [{ data: 'unchanged' }];
    rerender();
    await pending;
    expect(didFinish).toBe(true);
  });

  it('keeps overlapping waits pending through a loading-only update', async () => {
    const { result, rerender } = renderHook(() => usePageStatus('unchanged'));
    let didFinish = false;
    const pending = Promise.all([
      result.current.page.reloadAndWait(),
      result.current.page.reloadAndWait(),
    ]).then(() => {
      didFinish = true;
    });
    await act(() => Promise.resolve());
    router.state = 'loading';
    router.matches = [{ data: 'unchanged' }];
    rerender();
    expect(didFinish).toBe(false);
    router.state = 'idle';
    rerender();
    await pending;
    expect(didFinish).toBe(true);
  });

  it('releases a pending commit wait when the page unmounts', async () => {
    const { result, unmount } = renderHook(() => usePageStatus('unchanged'));
    const pending = result.current.page.reloadAndWait();
    unmount();
    await expect(pending).resolves.toBeUndefined();
  });

  it('propagates revalidation failure without waiting for a commit', async () => {
    router.revalidate.mockRejectedValueOnce(new Error('read failed'));
    const { result } = renderHook(() => usePageStatus('unchanged'));
    await expect(result.current.page.reloadAndWait()).rejects.toThrow('read failed');
  });
});
