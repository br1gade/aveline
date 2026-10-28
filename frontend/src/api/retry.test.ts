import { describe, expect, it, vi } from 'vitest';

import { ApiError } from './errors';
import { retryOnConflict } from './retry';

const conflict = () =>
  new ApiError({ status: 409, messages: ['Invitation changed while loading'] });

describe('retryOnConflict', () => {
  it('tries again after a 409 and returns what the next attempt read', async () => {
    const load = vi.fn<() => Promise<string>>().mockRejectedValueOnce(conflict());
    load.mockResolvedValueOnce('page');
    await expect(retryOnConflict(load)).resolves.toBe('page');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('gives up after its attempts and throws the last conflict', async () => {
    const load = vi.fn(() => Promise.reject(conflict()));
    await expect(retryOnConflict(load, 3)).rejects.toMatchObject({ status: 409 });
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('never retries anything else', async () => {
    const missing = new ApiError({ status: 404, messages: [] });
    const load = vi.fn(() => Promise.reject(missing));
    await expect(retryOnConflict(load)).rejects.toBe(missing);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
