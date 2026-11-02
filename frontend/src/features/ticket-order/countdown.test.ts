import { describe, expect, it } from 'vitest';

import { clockOffset, holdAnnouncement, holdMinutesLeft } from './countdown';

const RECEIVED = Date.parse('2026-10-31T12:00:00.000Z');

describe("the server's clock", () => {
  it('is read from the Date header, to the second', () => {
    expect(clockOffset('Sat, 31 Oct 2026 12:02:00 GMT', RECEIVED)).toBe(120_000);
    expect(clockOffset('Sat, 31 Oct 2026 11:59:30 GMT', RECEIVED)).toBe(-30_000);
  });

  it.each([null, '', 'yesterday'])('is the device’s own when the header is %j', (header) => {
    expect(clockOffset(header, RECEIVED)).toBe(0);
  });
});

describe('the time left on the hold', () => {
  const until = '2026-10-31T12:15:00.000Z';

  it.each([
    ['2026-10-31T12:00:00.000Z', 0, 15],
    ['2026-10-31T12:10:30.000Z', 0, 5],
    ['2026-10-31T12:14:59.000Z', 0, 1],
    ['2026-10-31T12:15:00.000Z', 0, 0],
    ['2026-10-31T12:20:00.000Z', 0, 0],
    ['2026-10-31T12:00:00.000Z', 120_000, 13],
    ['2026-10-31T12:14:00.000Z', -60_000, 2],
  ])('at %s with the server %i ms ahead, %i minutes are left', (now, offset, minutes) => {
    expect(holdMinutesLeft(until, Date.parse(now), offset)).toBe(minutes);
  });

  it('is over for a deadline it cannot read', () => {
    expect(holdMinutesLeft('', RECEIVED, 0)).toBe(0);
  });
});

describe('what is announced, once each', () => {
  it.each([
    [null, 15, null],
    [null, 4, null],
    [6, 5, 'five'],
    [5, 5, null],
    [5, 4, null],
    [2, 1, 'one'],
    [6, 1, 'one'],
    [1, 0, 'over'],
    [0, 0, null],
  ])('from %s to %i minutes: %s', (before, now, announcement) => {
    expect(holdAnnouncement(before, now)).toBe(announcement);
  });
});
