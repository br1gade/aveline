import { describe, expect, it, vi } from 'vitest';

import { oneByOne } from './one-by-one';

describe('one request at a time', () => {
  it('sends each in order and says all were done', async () => {
    const run = vi.fn(() => Promise.resolve());
    await expect(oneByOne(['a', 'b'], run)).resolves.toEqual({
      done: ['a', 'b'],
      notDone: [],
      error: null,
    });
    expect(run.mock.calls).toEqual([['a'], ['b']]);
  });

  it('stops at the first refusal, sending nothing after it', async () => {
    const refusal = new Error('refused');
    const run = vi.fn((item: string) =>
      item === 'b' ? Promise.reject(refusal) : Promise.resolve(),
    );
    await expect(oneByOne(['a', 'b', 'c'], run)).resolves.toEqual({
      done: ['a'],
      notDone: ['b', 'c'],
      error: refusal,
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does nothing with nothing to send', async () => {
    const run = vi.fn();
    await expect(oneByOne([], run)).resolves.toEqual({ done: [], notDone: [], error: null });
    expect(run).not.toHaveBeenCalled();
  });
});
