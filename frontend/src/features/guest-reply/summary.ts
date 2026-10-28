import type { ReplySummary } from '@/features/invitation-renderer';

import { fullName } from './form-model';
import type { ReplyRecord } from './types';

/**
 * How many people are coming: the respondent, the members answered as attending, and plus-ones
 * not yet answered for, who follow the respondent (docs/API.md §4). In PER_VENUE nobody follows,
 * and someone coming to any venue is coming.
 */
export function attendingCount(record: ReplyRecord): number {
  const isRespondentAttending = record.rsvp.status === 'ATTENDING';
  const isFollowing = isRespondentAttending && record.attendance.mode === 'EVENT_WIDE';
  const members = record.household.members.filter(
    (member) =>
      member.status === 'ATTENDING' ||
      (isFollowing && member.addedByGuest && member.status === 'PENDING'),
  );
  return (isRespondentAttending ? 1 : 0) + members.length;
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
