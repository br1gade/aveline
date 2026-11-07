import type { ReplySummary } from '@/features/invitation-renderer';

import { fullName } from './form-model';
import type { Signee } from './signatures';
import type { HouseholdMemberRecord, ReplyRecord } from './types';

/**
 * How many people are coming: the respondent, the members answered as attending, and plus-ones
 * not yet answered for, who follow the respondent (docs/API.md §4). In PER_VENUE nobody follows,
 * and someone coming to any venue is coming.
 */
function comingMembers(record: ReplyRecord): HouseholdMemberRecord[] {
  const isFollowing = record.rsvp.status === 'ATTENDING' && record.attendance.mode === 'EVENT_WIDE';
  return record.household.members.filter(
    (member) =>
      member.status === 'ATTENDING' ||
      (isFollowing && member.addedByGuest && member.status === 'PENDING'),
  );
}

export function attendingCount(record: ReplyRecord): number {
  return (record.rsvp.status === 'ATTENDING' ? 1 : 0) + comingMembers(record).length;
}

/**
 * Everyone coming by the saved reply, the respondent first: whom an agreement before the door
 * must cover (docs/API.md §11). A ticket holder's reply says they are coming.
 */
export function comingPeople(record: ReplyRecord): Signee[] {
  const self =
    record.rsvp.status === 'ATTENDING'
      ? [{ key: record.guest.id, guestId: record.guest.id, name: fullName(record.guest) }]
      : [];
  const members = comingMembers(record).map((member) => ({
    key: member.id,
    guestId: member.id,
    name: fullName(member),
  }));
  return [...self, ...members];
}

/** The reply as the card, the bar and the cover show it; `null` before the first answer. */
export function replySummaryFrom(record: ReplyRecord): ReplySummary | null {
  const { status, respondedAt } = record.rsvp;
  if (status === 'PENDING') return null;
  return {
    status,
    attendingCount: attendingCount(record),
    respondedAt: respondedAt ?? null,
    householdNames: [fullName(record.guest), ...record.household.members.map(fullName)],
  };
}
