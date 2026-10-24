import { GuestProjectionReader } from './guest-projection';

it('loads outstanding guest projections together and preserves identity boundaries', async () => {
  let finish!: (value: unknown) => void;
  const findFirst = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
  const query = jest.fn().mockResolvedValue([{ household: { name: 'Family', seatsAllotted: 1, guests: [{ id: 'b', attendanceResponses: [], seats: [] }] },
    event: { seatingPublishedAt: null }, payloadRevision: '1:family:2' }]);
  const reader = new GuestProjectionReader({ guest: { findFirst }, $queryRaw: query } as never);
  const first = reader.read('event', 'a');
  await new Promise(setImmediate);
  const second = reader.read('event', 'b');
  const erased = reader.read('event', 'erased');
  finish({ id: 'a' });
  expect(await Promise.all([first, second, erased])).toMatchObject([{ id: 'a' }, { id: 'b' }, null]);
  expect(query).toHaveBeenCalledTimes(1);
});
