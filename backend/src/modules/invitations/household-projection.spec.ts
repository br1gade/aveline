import { GuestProjectionReader } from './guest-projection';

it('returns a snapshot stamp and UTC dates with each batched household projection', async () => {
  const timestamp = '2026-10-24T12:34:56';
  const person = { id: 'a', rsvp: { status: 'ATTENDING', respondedAt: timestamp }, attendanceResponses: [{ respondedAt: timestamp }], seats: [] };
  const query = jest.fn().mockResolvedValue([{ payloadRevision: '3:family:7', household: { name: 'Family', guests: [person] },
    event: { seatingPublishedAt: timestamp } }]);
  const reader = new GuestProjectionReader({ $queryRaw: query } as never);
  const [first, second] = await Promise.all([reader.read('event', 'a'), reader.read('event', 'a')]);
  expect(first?.payloadRevision).toBe('3:family:7'); expect(second?.payloadRevision).toBe('3:family:7');
  expect(first?.rsvp?.respondedAt).toEqual(new Date(`${timestamp}Z`));
  expect(first?.attendanceResponses[0].respondedAt).toEqual(new Date(`${timestamp}Z`));
  expect(first?.event.seatingPublishedAt).toEqual(new Date(`${timestamp}Z`));
  expect(query).toHaveBeenCalledTimes(1);
});

it('fetches each household once for a batch and derives each requested person without another relation traversal', async () => {
  const first = { id: 'a', firstName: 'First', rsvp: { status: 'ATTENDING', respondedAt: null }, attendanceResponses: [], seats: [] };
  const second = { id: 'b', firstName: 'Second', rsvp: { status: 'DECLINED', respondedAt: null }, attendanceResponses: [], seats: [] };
  const query = jest.fn().mockResolvedValue([{ household: { name: 'Family', seatsAllotted: 2, guests: [first, second] },
    event: { attendanceRevision: 1, seatingPublishedAt: null }, payloadRevision: '1:family:2' }]);
  const reader = new GuestProjectionReader({ $queryRaw: query } as never);
  const [a, b] = await Promise.all([reader.read('event', 'a'), reader.read('event', 'b')]);
  expect(a).toMatchObject({ ...first, household: { name: 'Family', guests: [first, second] } });
  expect(b).toMatchObject({ ...second, household: { name: 'Family', guests: [first, second] } });
  expect(query).toHaveBeenCalledTimes(1);
});
