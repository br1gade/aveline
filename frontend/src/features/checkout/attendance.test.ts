import { describe, expect, it } from 'vitest';

import { attendanceBody, hasVenueAnswer, isComing } from './attendance';
import { blankPerson } from './roster';
import { EVENT_WIDE_RULES as WIDE, PER_VENUE_RULES as PER_VENUE } from './test-data';

function withVenues(venues: Record<string, '' | 'ATTENDING' | 'DECLINED' | 'UNDECIDED'>) {
  return { ...blankPerson('general'), venues };
}

describe('attendance for an event answered once', () => {
  it('sends neither a status nor venue answers: a ticket holder is coming', () => {
    const person = withVenues({ 'v-garden': 'DECLINED' });
    expect(attendanceBody(WIDE, person)).toEqual({});
    expect(isComing(WIDE, person)).toBe(true);
    expect(hasVenueAnswer(WIDE, person)).toBe(true);
  });
});

describe('attendance answered per venue', () => {
  it('sends only the venues answered, in the venues’ order, and never a status', () => {
    const person = withVenues({ 'v-hall': 'ATTENDING', 'v-church': '' });
    expect(attendanceBody(PER_VENUE, person)).toEqual({
      venueAttendance: [{ venueId: 'v-hall', status: 'ATTENDING' }],
    });
  });

  it('leaves out a venue checkout does not offer', () => {
    const person = withVenues({ 'v-salon': 'ATTENDING', 'v-church': 'DECLINED' });
    expect(attendanceBody(PER_VENUE, person)).toEqual({
      venueAttendance: [{ venueId: 'v-church', status: 'DECLINED' }],
    });
  });

  it.each([
    [{}, false],
    [{ 'v-church': '' as const }, false],
    [{ 'v-church': 'UNDECIDED' as const }, true],
  ])('needs at least one venue answered: %o → %s', (venues, isAnswered) => {
    expect(hasVenueAnswer(PER_VENUE, withVenues(venues))).toBe(isAnswered);
  });

  it.each([
    [{ 'v-church': 'ATTENDING' as const, 'v-hall': 'DECLINED' as const }, true],
    [{ 'v-church': 'DECLINED' as const, 'v-hall': 'UNDECIDED' as const }, false],
    [{ 'v-church': 'DECLINED' as const }, false],
    [{}, false],
  ])('is coming when coming to any venue, as the backend sums it up: %o → %s', (venues, coming) => {
    expect(isComing(PER_VENUE, withVenues(venues))).toBe(coming);
  });
});
