import { describe, expect, it } from 'vitest';

import type { AttendanceView, Invitation } from '@/features/invitation-renderer';

import {
  effectiveVenues,
  summarize,
  venueAnswersFrom,
  venueAttendance,
  venueChoices,
  type VenueAnswers,
} from './attendance';
import { perVenueRecord, recordWith } from './test-data';

const VENUES = ['v-church', 'v-hall'];

describe('the summary of per-venue answers', () => {
  it.each<[VenueAnswers, string]>([
    [{ 'v-church': 'ATTENDING', 'v-hall': 'DECLINED' }, 'ATTENDING'],
    [{ 'v-church': 'ATTENDING', 'v-hall': '' }, 'ATTENDING'],
    [{ 'v-church': 'DECLINED', 'v-hall': '' }, ''],
    [{ 'v-church': 'DECLINED', 'v-hall': 'UNDECIDED' }, 'UNDECIDED'],
    [{ 'v-church': 'DECLINED', 'v-hall': 'DECLINED' }, 'DECLINED'],
    [{}, ''],
  ])('reads %j as %j, as the backend does', (answers, expected) => {
    expect(summarize(VENUES, answers)).toBe(expected);
  });

  it('is unanswered when there is no venue to answer', () => {
    expect(summarize([], {})).toBe('');
  });
});

describe('the venues to answer', () => {
  const invitation = (attendance?: AttendanceView) =>
    ({ guest: attendance ? { attendance } : null }) as unknown as Invitation;

  it('are none for one answer for the whole event', () => {
    expect(venueChoices(recordWith(), invitation())).toEqual([]);
  });

  it('keep the host’s order and prefer the page’s own language', () => {
    const record = perVenueRecord();
    const page: AttendanceView = {
      ...record.attendance,
      venues: [{ venueId: 'v-hall', venue: 'Դահլիճ', status: 'PENDING', respondedAt: null }],
    };
    expect(venueChoices(record, invitation(page))).toEqual([
      { venueId: 'v-church', label: 'Church' },
      { venueId: 'v-hall', label: 'Դահլիճ' },
    ]);
  });
});

describe('answers per venue', () => {
  it('start unanswered where the saved answer is pending', () => {
    const record = perVenueRecord({ 'v-church': 'ATTENDING' });
    expect(venueAnswersFrom(record.attendance)).toEqual({ 'v-church': 'ATTENDING', 'v-hall': '' });
  });

  it('follow the respondent where someone has no answer of their own', () => {
    expect(
      effectiveVenues(
        { 'v-church': 'DECLINED', 'v-hall': '' },
        { 'v-church': 'ATTENDING', 'v-hall': 'ATTENDING' },
        VENUES,
      ),
    ).toEqual({ 'v-church': 'DECLINED', 'v-hall': 'ATTENDING' });
  });

  it('are sent for the answered venues only', () => {
    expect(venueAttendance({ 'v-church': 'ATTENDING', 'v-hall': '' }, VENUES)).toEqual([
      { venueId: 'v-church', status: 'ATTENDING' },
    ]);
  });
});
