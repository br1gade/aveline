import { describe, expect, it } from 'vitest';

import { buildCalendarFile } from './calendar';

const NOW = new Date('2027-03-01T09:30:00.000Z');
const venue = (name: string, address: string) => ({
  id: null,
  role: 'RECEPTION',
  name,
  address,
  mapUrl: 'https://maps.example/x',
  arriveAt: null,
});
const BASE = {
  slug: 'anna-davit',
  title: 'Anna & Davit',
  startsAt: '2027-06-12T11:00:00.000Z',
  endsAt: '2027-06-12T21:30:00.000Z',
  venues: [venue('Hall', 'Abovyan 1, Yerevan')],
};
const lines = (file: string) => file.split('\r\n');

describe('buildCalendarFile (C-32)', () => {
  it('writes one event in UTC, from the event’s own times', () => {
    const file = buildCalendarFile(BASE, NOW);
    expect(lines(file)).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Aveline//Invitation//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:anna-davit@aveline',
      'DTSTAMP:20270301T093000Z',
      'DTSTART:20270612T110000Z',
      'DTEND:20270612T213000Z',
      'SUMMARY:Anna & Davit',
      'LOCATION:Hall\\, Abovyan 1\\, Yerevan',
      'DESCRIPTION:Hall\\, Abovyan 1\\, Yerevan',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ]);
  });

  it('leaves the end out when the event names none', () => {
    const file = buildCalendarFile({ ...BASE, endsAt: null }, NOW);
    expect(file).not.toContain('DTEND');
  });

  it('lists every venue in the description, and the first as the place', () => {
    const file = buildCalendarFile(
      { ...BASE, venues: [venue('Church', 'Mashtots 2'), venue('Hall', 'Abovyan 1')] },
      NOW,
    );
    expect(file).toContain('LOCATION:Church\\, Mashtots 2\r\n');
    expect(file).toContain('DESCRIPTION:Church\\, Mashtots 2\\nHall\\, Abovyan 1\r\n');
  });

  it('writes no place with no venue', () => {
    const file = buildCalendarFile({ ...BASE, venues: [] }, NOW);
    expect(file).not.toContain('LOCATION');
    expect(file).not.toContain('DESCRIPTION');
  });

  it('escapes what the format reserves', () => {
    const file = buildCalendarFile({ ...BASE, title: 'A; B, C\\D\nE' }, NOW);
    expect(file).toContain('SUMMARY:A\\; B\\, C\\\\D\\nE\r\n');
  });

  it.each([
    ['Armenian, two bytes a letter', 'Աննա և Դավիթ '.repeat(8)],
    ['ASCII, where one byte decides', 'A'.repeat(200)],
  ])('folds long lines at 75 bytes, never inside a letter: %s', (_what, title) => {
    const file = buildCalendarFile({ ...BASE, title }, NOW);
    const summary = lines(file).slice(lines(file).findIndex((line) => line.startsWith('SUMMARY:')));
    const folded = summary.slice(
      0,
      summary.findIndex((line) => line.startsWith('LOCATION:')),
    );
    expect(folded.length).toBeGreaterThan(1);
    for (const line of folded) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(folded.slice(1).every((line) => line.startsWith(' '))).toBe(true);
    const unfolded = folded.map((line, index) => (index === 0 ? line : line.slice(1))).join('');
    expect(unfolded).toBe(`SUMMARY:${title}`);
  });

  it('carries no link, so nothing that opens the invitation reaches a calendar', () => {
    const file = buildCalendarFile(BASE, NOW);
    expect(file).not.toMatch(/https?:|URL:|maps\.example/);
  });
});
