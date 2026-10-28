import type { AttendanceView, Invitation } from '@/features/invitation-renderer';

import type { MemberValues, ReplyFormValues } from './form-model';
import type { ReplyRecord, ReplyStatus } from './types';

/**
 * Answering per venue (docs/API.md §4, "Attendance modes"; design PD-50). In PER_VENUE each person
 * answers each guest-facing venue, and their overall answer is a summary of those. In EVENT_WIDE
 * there are no venues to answer and nothing here applies.
 */

/** Each venue's answer as the form holds it: '' while it is unanswered. */
export type VenueAnswers = Record<string, ReplyStatus | ''>;

export interface VenueChoice {
  venueId: string;
  label: string;
}

/**
 * The venues to answer, in the host's order; none in EVENT_WIDE. The reply read names them
 * untranslated (FR-40), so the personal page's names, in the page's language, come first.
 */
export function venueChoices(record: ReplyRecord, invitation: Invitation): VenueChoice[] {
  if (record.attendance.mode !== 'PER_VENUE') return [];
  const translated = new Map(
    (invitation.guest?.attendance?.venues ?? []).map((venue) => [venue.venueId, venue.venue]),
  );
  return record.attendance.venues.map(({ venueId, venue }) => ({
    venueId,
    label: translated.get(venueId) ?? venue,
  }));
}

/** Mirrors the backend's `summarizeAttendance`: coming to any venue is coming. */
export function summarize(venueIds: readonly string[], answers: VenueAnswers): ReplyStatus | '' {
  const statuses = venueIds.map((venueId) => answers[venueId] ?? '');
  if (statuses.includes('ATTENDING')) return 'ATTENDING';
  if (statuses.length === 0 || statuses.includes('')) return '';
  return statuses.includes('UNDECIDED') ? 'UNDECIDED' : 'DECLINED';
}

/** A saved attendance as the form starts it: a pending venue is unanswered. */
export function venueAnswersFrom(view: AttendanceView): VenueAnswers {
  return Object.fromEntries(
    view.venues.map(({ venueId, status }) => [venueId, status === 'PENDING' ? '' : status]),
  );
}

/**
 * Someone else's answer at each venue: their own where given, otherwise the respondent's, as the
 * form shows it ("same as me", PD-28). The server does not follow in PER_VENUE, so this is sent.
 */
export function effectiveVenues(
  own: VenueAnswers,
  respondent: VenueAnswers,
  venueIds: readonly string[],
): VenueAnswers {
  return Object.fromEntries(
    venueIds.map((venueId) => [venueId, own[venueId] || respondent[venueId] || '']),
  );
}

/**
 * The respondent's answer: chosen in EVENT_WIDE, the summary of their venues in PER_VENUE (coming
 * to any venue is coming). `venueIds` is empty in EVENT_WIDE.
 */
export function respondentStatus(
  values: Pick<ReplyFormValues, 'status' | 'venues'>,
  venueIds: readonly string[],
): ReplyStatus | '' {
  return venueIds.length > 0 ? summarize(venueIds, values.venues) : values.status;
}

/** A household member's answer, following the respondent's where they have none of their own. */
export function memberStatus(
  member: Pick<MemberValues, 'status' | 'venues'>,
  respondent: Pick<ReplyFormValues, 'status' | 'venues'>,
  venueIds: readonly string[],
): ReplyStatus | '' {
  if (venueIds.length === 0) return member.status || respondent.status;
  return summarize(venueIds, effectiveVenues(member.venues, respondent.venues, venueIds));
}

/** The answered venues, as the API takes them. */
export function venueAttendance(
  answers: VenueAnswers,
  venueIds: readonly string[],
): Array<{ venueId: string; status: ReplyStatus }> {
  return venueIds.flatMap((venueId) => {
    const status = answers[venueId];
    return status ? [{ venueId, status }] : [];
  });
}
