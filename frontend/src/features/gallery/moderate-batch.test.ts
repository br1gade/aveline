import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/errors';

import { approveOneByOne } from './moderate-batch';
import type { GalleryPhoto } from './types';

const photo = (id: string) => ({ id }) as GalleryPhoto;

function refused(status: number) {
  return new ApiError({ status, messages: ['No'], requestId: 'r-1' });
}

function approvingExcept(failures: Readonly<Record<string, number>>) {
  return vi.fn((id: string) => {
    const status = failures[id];
    return status === undefined ? Promise.resolve(photo(id)) : Promise.reject(refused(status));
  });
}

describe('approving several photos, one request each', () => {
  it('approves each in the order chosen, one at a time', async () => {
    let running = 0;
    let most = 0;
    const order: string[] = [];
    const outcome = await approveOneByOne(['a', 'b', 'c'], async (id) => {
      running += 1;
      most = Math.max(most, running);
      order.push(id);
      await Promise.resolve();
      running -= 1;
      return photo(id);
    });
    expect(order).toEqual(['a', 'b', 'c']);
    expect(most).toBe(1);
    expect(outcome.approved.map(({ id }) => id)).toEqual(['a', 'b', 'c']);
    expect(outcome.rest).toEqual([]);
    expect(outcome.stop).toBeNull();
  });

  it.each([404, 409])('goes on past a photo gone or changed meanwhile (%i)', async (status) => {
    const outcome = await approveOneByOne(['a', 'b', 'c'], approvingExcept({ b: status }));
    expect(outcome.approved.map(({ id }) => id)).toEqual(['a', 'c']);
    expect(outcome.gone).toEqual(['b']);
    expect(outcome.stop).toBeNull();
    expect(outcome.rest).toEqual([]);
  });

  it.each([429, 403, 500, 0])(
    'stops at what would refuse the next too (%i), keeping the rest chosen',
    async (status) => {
      const approve = approvingExcept({ b: status });
      const outcome = await approveOneByOne(['a', 'b', 'c'], approve);
      expect(outcome.approved.map(({ id }) => id)).toEqual(['a']);
      expect(outcome.rest).toEqual(['b', 'c']);
      expect(outcome.stop).toBeInstanceOf(ApiError);
      expect(approve).toHaveBeenCalledTimes(2);
    },
  );

  it('says how far it has come', async () => {
    const onProgress = vi.fn();
    await approveOneByOne(['a', 'b'], approvingExcept({}), onProgress);
    expect(onProgress.mock.calls).toEqual([[1], [2]]);
  });

  it('asks nothing of nothing chosen', async () => {
    const approve = approvingExcept({});
    const outcome = await approveOneByOne([], approve);
    expect(approve).not.toHaveBeenCalled();
    expect(outcome).toEqual({ approved: [], gone: [], rest: [], stop: null });
  });

  it('throws on what is not the API’s', async () => {
    await expect(approveOneByOne(['a'], () => Promise.reject(new Error('bug')))).rejects.toThrow(
      'bug',
    );
  });
});
