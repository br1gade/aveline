import { describe, expect, it, vi } from 'vitest';

import { pollUntil, waitFor } from './poll';

const noWait = () => Promise.resolve();
const isDone = (value: string) => value === 'done';

describe('reading again until something is done', () => {
  it('returns the first value that is done, after a wait each time', async () => {
    const read = vi
      .fn<() => Promise<string | undefined>>()
      .mockResolvedValueOnce('working')
      .mockResolvedValueOnce('done');
    const wait = vi.fn((_ms: number) => noWait());
    const signal = new AbortController().signal;
    await expect(pollUntil({ read, isDone, delays: [10, 20, 30], wait, signal })).resolves.toBe(
      'done',
    );
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([10, 20]);
  });

  it('treats a failed read as not done yet', async () => {
    const read = vi
      .fn<() => Promise<string | undefined>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('done');
    const signal = new AbortController().signal;
    await expect(pollUntil({ read, isDone, delays: [1, 1], wait: noWait, signal })).resolves.toBe(
      'done',
    );
  });

  it('gives up after its waits, and stops when the page stops waiting', async () => {
    const read = vi.fn(() => Promise.resolve('working'));
    const signal = new AbortController().signal;
    await expect(
      pollUntil({ read, isDone, delays: [1, 1, 1], wait: noWait, signal }),
    ).resolves.toBeUndefined();
    expect(read).toHaveBeenCalledTimes(3);
    const stopped = new AbortController();
    stopped.abort();
    await expect(
      pollUntil({ read, isDone, delays: [1], wait: noWait, signal: stopped.signal }),
    ).resolves.toBeUndefined();
  });

  it('ends a wait early, quietly, when stopped', async () => {
    vi.useFakeTimers();
    const stop = new AbortController();
    const waited = waitFor(60_000, stop.signal);
    stop.abort();
    await expect(waited).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
