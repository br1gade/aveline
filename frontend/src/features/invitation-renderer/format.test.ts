import { describe, expect, it } from 'vitest';

import { capitalise, dayKey, displayDate, intlZoneName, zoneLabelKey } from './format';

const STARTS = '2027-06-12T12:00:00.000Z'; // 16:00 in Yerevan

describe('displayDate', () => {
  it.each([
    ['en', 'Saturday, 12 June 2027'],
    ['ru', 'Суббота, 12 июня 2027 г.'],
  ])('starts the %s date line with a capital', (locale, expected) => {
    expect(displayDate(STARTS, { timeZone: 'Asia/Yerevan', locale })).toBe(expected);
  });

  it('capitalises an Armenian weekday', () => {
    expect(displayDate(STARTS, { timeZone: 'Asia/Yerevan', locale: 'hy' })).toBe(
      'Շաբաթ, 12 հունիսի 2027 թ.',
    );
  });
});

describe('capitalise', () => {
  it('leaves an empty string alone', () => {
    expect(capitalise('', 'en')).toBe('');
  });
});

describe('dayKey', () => {
  it('groups by the calendar day in the event zone, not UTC', () => {
    // 22:30 UTC on 12 June is already 13 June in Yerevan (UTC+4).
    expect(dayKey('2027-06-12T22:30:00.000Z', 'Asia/Yerevan')).toBe('2027-06-13');
    expect(dayKey('2027-06-12T22:30:00.000Z', 'UTC')).toBe('2027-06-12');
  });
});

describe('zone labels', () => {
  it('has a translated label for Yerevan', () => {
    expect(zoneLabelKey('Asia/Yerevan')).toBe('timeZone.yerevan');
  });

  it('falls back to Intl for other zones', () => {
    expect(zoneLabelKey('Europe/Paris')).toBeUndefined();
    expect(intlZoneName(STARTS, { timeZone: 'Europe/Paris', locale: 'en' })).toBe(
      'Central European Time',
    );
  });

  it('never treats an inherited property as a zone', () => {
    expect(zoneLabelKey('toString')).toBeUndefined();
  });
});
