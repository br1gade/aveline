import { describe, expect, it } from 'vitest';

import { formatEventDate, formatEventDay, formatEventTime, timeLeftUntil } from './time';

const yerevan = (locale: string) => ({ timeZone: 'Asia/Yerevan', locale });

describe('event time', () => {
  it('formats in the event zone, not the device zone', () => {
    // 12:00 UTC is 16:00 in Yerevan (UTC+4), whatever the machine running the test.
    expect(formatEventTime('2027-06-12T12:00:00Z', yerevan('en'))).toBe('16:00');
  });

  it('writes English dates day, month, year', () => {
    expect(formatEventDate('2027-06-12T12:00:00Z', yerevan('en'))).toBe('Saturday, 12 June 2027');
    expect(formatEventDay('2027-06-12T12:00:00Z', yerevan('en'))).toBe('12 June 2027');
  });

  it('moves the date across midnight when the zone does', () => {
    expect(formatEventDay('2027-06-12T21:30:00Z', yerevan('en'))).toBe('13 June 2027');
  });

  it('follows daylight saving in zones that have it', () => {
    expect(
      formatEventTime('2027-07-01T12:00:00Z', { timeZone: 'Europe/London', locale: 'en' }),
    ).toBe('13:00');
    expect(
      formatEventTime('2027-01-01T12:00:00Z', { timeZone: 'Europe/London', locale: 'en' }),
    ).toBe('12:00');
  });

  it('formats Russian and Armenian with their own month names', () => {
    expect(formatEventDay('2027-06-12T12:00:00Z', yerevan('ru'))).toContain('июня');
    expect(formatEventDay('2027-06-12T12:00:00Z', yerevan('hy'))).toContain('հունիսի');
  });

  it('composes Armenian dates in the design’s form, not Intl’s', () => {
    expect(formatEventDate('2027-06-12T12:00:00Z', yerevan('hy'))).toBe(
      'շաբաթ, 12 հունիսի 2027 թ.',
    );
    expect(formatEventDay('2027-01-03T21:30:00Z', yerevan('hy'))).toBe('4 հունվարի 2027 թ.');
  });

  it('takes the Armenian day in the event zone, not UTC', () => {
    // 21:30 UTC on 31 December is already 1 January in Yerevan.
    expect(formatEventDate('2026-12-31T21:30:00Z', yerevan('hy'))).toBe(
      'ուրբաթ, 1 հունվարի 2027 թ.',
    );
  });

  it('writes midnight as 00:00', () => {
    expect(formatEventTime('2027-06-11T20:00:00Z', yerevan('en'))).toBe('00:00');
  });

  it('uses a 24-hour clock in every language', () => {
    for (const locale of ['en', 'ru', 'hy']) {
      expect(formatEventTime('2027-06-12T14:30:00Z', yerevan(locale))).toBe('18:30');
    }
  });
});

describe('timeLeftUntil', () => {
  const now = new Date('2027-06-01T10:00:00Z');

  it('counts whole days, hours and minutes', () => {
    expect(timeLeftUntil('2027-06-12T12:15:30Z', now)).toEqual({ days: 11, hours: 2, minutes: 15 });
  });

  it('is zero in the last minute', () => {
    expect(timeLeftUntil('2027-06-01T10:00:30Z', now)).toEqual({ days: 0, hours: 0, minutes: 0 });
  });

  it('is null once the start has passed', () => {
    expect(timeLeftUntil('2027-06-01T09:59:00Z', now)).toBeNull();
  });
});
