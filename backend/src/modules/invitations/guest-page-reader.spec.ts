import { GuestPageReader } from './guest-page-reader';

describe('Live invitation checks', () => {
  it('batches waiting capabilities without reusing an earlier authorization snapshot', async () => {
    let finish!: (value: unknown[]) => void;
    const query = jest.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce([{ requestIndex: 0, guestId: 'second' }, { requestIndex: 1, guestId: null }])
      .mockResolvedValueOnce([{ guestId: null }]);
    const reader = new GuestPageReader({ $queryRaw: query } as never);
    const first = reader.read('event', 'first-token');
    await new Promise(setImmediate);
    const second = reader.read('event', 'second-token');
    const revoked = reader.read('event', 'revoked-token');
    await new Promise(setImmediate);
    expect(query).toHaveBeenCalledTimes(2);
    finish([{ guestId: 'first' }]);
    expect(await Promise.all([first, second, revoked])).toEqual([[{ guestId: 'first' }], [{ guestId: 'second' }], [{ guestId: null }]]);
    expect(query).toHaveBeenCalledTimes(2);
    expect(await reader.read('event', 'first-token')).toEqual([{ guestId: null }]);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('clears failed work so the next live read can recover', async () => {
    const query = jest.fn().mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValueOnce([]);
    const reader = new GuestPageReader({ $queryRaw: query } as never);
    await expect(reader.read('event')).rejects.toThrow('database unavailable');
    await expect(reader.read('event')).resolves.toEqual([]);
  });
});
