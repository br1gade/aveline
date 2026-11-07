import { describe, expect, it, vi } from 'vitest';

import { followSnapshots, POLL_DELAYS } from './follow';
import { snapshot } from './test-data';
import type { Snapshot } from './types';

const queued = (id: string) =>
  snapshot({ id, status: 'QUEUED', attempts: 0, isDownloadable: false });
const running = (id: string) =>
  snapshot({ id, status: 'RUNNING', attempts: 1, isDownloadable: false });
const ready = (id: string) => snapshot({ id });

/** Each call answers the next value of a script, then the last one again. */
function script<T>(...answers: T[]): () => Promise<T> {
  let index = 0;
  return () => Promise.resolve(answers[Math.min(index++, answers.length - 1)] as T);
}

function options(overrides: Partial<Parameters<typeof followSnapshots>[0]> = {}) {
  return {
    ids: ['a'],
    readOne: vi.fn((_id: string) => Promise.resolve(ready('a'))),
    readAll: vi.fn(() => Promise.resolve<Snapshot[]>([])),
    onRead: vi.fn((_read: Snapshot[]) => undefined),
    wait: vi.fn((_ms: number, _signal: AbortSignal) => Promise.resolve()),
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('following exports until they end', () => {
  it('reads one export by itself until it ends, and says each read', async () => {
    const readOne = vi.fn(script(queued('a'), running('a'), ready('a')));
    const onRead = vi.fn((_read: Snapshot[]) => undefined);
    const follow = options({ readOne, onRead });
    await expect(followSnapshots(follow)).resolves.toBe(true);
    expect(readOne).toHaveBeenCalledTimes(3);
    expect(follow.readAll).not.toHaveBeenCalled();
    expect(onRead.mock.calls.map(([read]) => read[0]?.status)).toEqual([
      'QUEUED',
      'RUNNING',
      'COMPLETED',
    ]);
  });

  it('reads the history once a tick while several are going, then the last one by itself', async () => {
    const readAll = vi.fn(
      script([running('a'), running('b'), ready('c')], [ready('a'), running('b'), ready('c')]),
    );
    const readOne = vi.fn(script(ready('b')));
    const follow = options({ ids: ['a', 'b'], readAll, readOne });
    await expect(followSnapshots(follow)).resolves.toBe(true);
    expect(readAll).toHaveBeenCalledTimes(2);
    expect(readOne).toHaveBeenCalledTimes(1);
    expect(readOne).toHaveBeenCalledWith('b');
  });

  it('stops following one the history no longer lists', async () => {
    const readAll = vi.fn(script([running('a')]));
    const readOne = vi.fn(script(ready('a')));
    const follow = options({ ids: ['a', 'gone'], readAll, readOne });
    await expect(followSnapshots(follow)).resolves.toBe(true);
    expect(readOne).toHaveBeenCalledWith('a');
  });

  it('reads nothing when nothing is going', async () => {
    const follow = options({ ids: [] });
    await expect(followSnapshots(follow)).resolves.toBe(true);
    expect(follow.readOne).not.toHaveBeenCalled();
    expect(follow.wait).not.toHaveBeenCalled();
  });

  it('keeps going past a failed read, and gives up when the waits run out', async () => {
    const readOne = vi.fn((_id: string) => Promise.reject(new Error('offline')));
    const follow = options({ readOne, delays: [1, 2] });
    await expect(followSnapshots(follow)).resolves.toBe(false);
    expect(readOne).toHaveBeenCalledTimes(2);
  });

  it('stops quietly once the page leaves', async () => {
    const stop = new AbortController();
    const wait = vi.fn((_ms: number, _signal: AbortSignal) => {
      stop.abort();
      return Promise.resolve();
    });
    const follow = options({ wait, signal: stop.signal });
    await expect(followSnapshots(follow)).resolves.toBe(false);
    expect(follow.readOne).not.toHaveBeenCalled();
  });

  it('reads soon at first, then every five seconds, for about three minutes', () => {
    expect(POLL_DELAYS.slice(0, 4)).toEqual([1000, 2000, 3000, 5000]);
    const total = POLL_DELAYS.reduce((sum, ms) => sum + ms, 0);
    expect(total).toBeGreaterThanOrEqual(170_000);
    expect(total).toBeLessThanOrEqual(190_000);
  });
});
