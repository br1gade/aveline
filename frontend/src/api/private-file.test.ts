import { describe, expect, it, vi } from 'vitest';

import { ApiError } from './errors';
import { readPrivateFile } from './private-file';

const refused = (status: number) => new ApiError({ status, messages: [] });
const picture = new Blob(['webp'], { type: 'image/webp' });

describe('a private file read through the API', () => {
  it('waits and tries again after a 429, as docs/API.md §11 asks', async () => {
    const load = vi
      .fn<() => Promise<Blob>>()
      .mockRejectedValueOnce(refused(429))
      .mockResolvedValueOnce(picture);
    const wait = vi.fn((_ms: number) => Promise.resolve());
    await expect(readPrivateFile(load, { wait })).resolves.toBe(picture);
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([2000]);
  });

  it('gives up after two waits and throws the last 429', async () => {
    const load = vi.fn(() => Promise.reject(refused(429)));
    const wait = vi.fn((_ms: number) => Promise.resolve());
    await expect(readPrivateFile(load, { wait })).rejects.toMatchObject({ status: 429 });
    expect(load).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([2000, 4000]);
  });

  it.each([403, 404, 500])('never tries a %i again', async (status) => {
    const load = vi.fn(() => Promise.reject(refused(status)));
    await expect(readPrivateFile(load, { wait: () => Promise.resolve() })).rejects.toMatchObject({
      status,
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('stops trying once the picture is no longer wanted', async () => {
    const stop = new AbortController();
    const load = vi.fn(() => Promise.reject(refused(429)));
    const wait = vi.fn((_ms: number) => {
      stop.abort();
      return Promise.resolve();
    });
    await expect(readPrivateFile(load, { wait, signal: stop.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(load).toHaveBeenCalledTimes(1);
  });
});
