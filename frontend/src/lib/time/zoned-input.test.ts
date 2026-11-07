import { afterEach, describe, expect, it } from 'vitest';

import { instantFromWallTime, timeZoneOptions, wallTimeOf } from './zoned-input';

const at = (date: string, time: string, timeZone: string) =>
  instantFromWallTime({ date, time }, timeZone);
const instant = (iso: string) => ({ kind: 'instant', iso });

describe('instantFromWallTime in Asia/Yerevan', () => {
  it('turns a time typed in Yerevan into UTC', () => {
    expect(at('2027-06-12', '15:00', 'Asia/Yerevan')).toEqual(instant('2027-06-12T11:00:00.000Z'));
  });

  it('uses the same offset all year: Yerevan has not changed its clocks since 2012', () => {
    expect(at('2027-01-15', '12:00', 'Asia/Yerevan')).toEqual(instant('2027-01-15T08:00:00.000Z'));
    expect(at('2027-07-15', '12:00', 'Asia/Yerevan')).toEqual(instant('2027-07-15T08:00:00.000Z'));
  });

  it('treats the nights Europe changes its clocks as ordinary ones', () => {
    expect(at('2027-03-28', '02:30', 'Asia/Yerevan')).toEqual(instant('2027-03-27T22:30:00.000Z'));
    expect(at('2027-10-31', '01:30', 'Asia/Yerevan')).toEqual(instant('2027-10-30T21:30:00.000Z'));
  });

  it('moves to the previous UTC day for a time early in the morning', () => {
    expect(at('2027-01-01', '02:00', 'Asia/Yerevan')).toEqual(instant('2026-12-31T22:00:00.000Z'));
    expect(at('2027-06-12', '00:00', 'Asia/Yerevan')).toEqual(instant('2027-06-11T20:00:00.000Z'));
  });
});

describe('instantFromWallTime when the clocks go forward', () => {
  it.each([
    ['Europe/London', '2027-03-28', '01:30'],
    ['America/Los_Angeles', '2027-03-14', '02:30'],
    ['Australia/Sydney', '2027-10-03', '02:30'],
  ])('says %s skips %s %s', (timeZone, date, time) => {
    expect(at(date, time, timeZone)).toEqual({ kind: 'skipped' });
  });

  it('converts the minutes on either side of the gap', () => {
    expect(at('2027-03-28', '00:59', 'Europe/London')).toEqual(instant('2027-03-28T00:59:00.000Z'));
    expect(at('2027-03-28', '02:00', 'Europe/London')).toEqual(instant('2027-03-28T01:00:00.000Z'));
    expect(at('2027-03-14', '01:59', 'America/Los_Angeles')).toEqual(
      instant('2027-03-14T09:59:00.000Z'),
    );
    expect(at('2027-03-14', '03:00', 'America/Los_Angeles')).toEqual(
      instant('2027-03-14T10:00:00.000Z'),
    );
  });
});

describe('instantFromWallTime when the clocks go back', () => {
  it('takes the earlier of a time that happens twice', () => {
    // 01:30 comes first in summer time (UTC+1), then again in winter time (UTC+0).
    expect(at('2027-10-31', '01:30', 'Europe/London')).toEqual(instant('2027-10-31T00:30:00.000Z'));
    expect(at('2027-11-07', '01:30', 'America/Los_Angeles')).toEqual(
      instant('2027-11-07T08:30:00.000Z'),
    );
  });
});

describe('instantFromWallTime in zones off the hour', () => {
  it('keeps half-hour and three-quarter-hour offsets', () => {
    expect(at('2027-06-12', '15:00', 'Asia/Kolkata')).toEqual(instant('2027-06-12T09:30:00.000Z'));
    expect(at('2027-06-12', '15:00', 'Asia/Kathmandu')).toEqual(
      instant('2027-06-12T09:15:00.000Z'),
    );
  });
});

describe('instantFromWallTime with input that is not a date and time', () => {
  it.each([
    ['2027-02-30', '15:00'],
    ['2027-13-01', '15:00'],
    ['2027-06-12', '24:00'],
    ['2027-06-12', '15:60'],
    ['', '15:00'],
    ['2027-06-12', ''],
    ['12/06/2027', '15:00'],
    ['2027-06-12', '3 pm'],
    // The API takes four-digit years only (docs/API.md §1, "Dates").
    ['0999-06-12', '15:00'],
    ['10000-06-12', '15:00'],
  ])('refuses %j %j', (date, time) => {
    expect(at(date, time, 'Asia/Yerevan')).toEqual({ kind: 'invalid' });
  });

  it('refuses a zone Intl does not know', () => {
    expect(at('2027-06-12', '15:00', 'Mars/Olympus_Mons')).toEqual({ kind: 'invalid' });
  });
});

describe('wallTimeOf', () => {
  it('reads an instant as the date and time in the event’s zone', () => {
    expect(wallTimeOf('2027-06-12T11:00:00.000Z', 'Asia/Yerevan')).toEqual({
      date: '2027-06-12',
      time: '15:00',
    });
    expect(wallTimeOf('2027-06-12T11:00:00.000Z', 'America/Los_Angeles')).toEqual({
      date: '2027-06-12',
      time: '04:00',
    });
    expect(wallTimeOf('2026-12-31T22:00:00Z', 'Asia/Yerevan')).toEqual({
      date: '2027-01-01',
      time: '02:00',
    });
  });

  it('round-trips with instantFromWallTime', () => {
    const zones = ['Asia/Yerevan', 'Europe/London', 'America/Los_Angeles', 'Asia/Kathmandu'];
    const instants = [
      '2027-01-15T08:00:00.000Z',
      '2027-06-12T11:45:00.000Z',
      '2027-12-31T23:59:00.000Z',
    ];
    for (const timeZone of zones) {
      for (const iso of instants) {
        expect(instantFromWallTime(wallTimeOf(iso, timeZone), timeZone)).toEqual(instant(iso));
      }
    }
  });

  it('cannot round-trip the second of a repeated time, which reads back as the first', () => {
    // 01:30Z on 31 October 2027 is the second 01:30 in London.
    const wall = wallTimeOf('2027-10-31T01:30:00.000Z', 'Europe/London');
    expect(wall).toEqual({ date: '2027-10-31', time: '01:30' });
    expect(instantFromWallTime(wall, 'Europe/London')).toEqual(instant('2027-10-31T00:30:00.000Z'));
  });
});

describe('the device’s own zone', () => {
  const original = process.env.TZ;
  afterEach(() => {
    process.env.TZ = original;
  });

  it('never changes the result', () => {
    for (const deviceZone of ['Pacific/Kiritimati', 'America/Los_Angeles', 'UTC']) {
      process.env.TZ = deviceZone;
      expect(at('2027-06-12', '15:00', 'Asia/Yerevan')).toEqual(
        instant('2027-06-12T11:00:00.000Z'),
      );
      expect(wallTimeOf('2027-06-12T11:00:00.000Z', 'Asia/Yerevan').time).toBe('15:00');
    }
  });
});

describe('timeZoneOptions', () => {
  it('lists the zones this runtime knows, Yerevan among them', () => {
    expect(timeZoneOptions()).toContain('Asia/Yerevan');
  });

  it('keeps the event’s own zone when the list lacks it, once', () => {
    const options = timeZoneOptions('UTC');
    expect(options).toContain('UTC');
    expect(options.filter((zone) => zone === 'UTC')).toHaveLength(1);
    expect(timeZoneOptions('Asia/Yerevan').filter((zone) => zone === 'Asia/Yerevan')).toHaveLength(
      1,
    );
  });
});
