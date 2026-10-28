import type {
  AttendanceView,
  BuiltInField,
  RsvpFieldConfig,
  RsvpQuestion,
  RsvpStatus,
} from '@/features/invitation-renderer';

import type { PayloadContext } from './payload';
import type { ReplyRecord } from './types';

/** One answer for the whole event, as every event starts. */
export function eventWide(status: RsvpStatus = 'PENDING', revision = 1): AttendanceView {
  return { mode: 'EVENT_WIDE', revision, status, needsReconfirmation: false, venues: [] };
}

/** Two guest-facing venues, answered as given; the rest pending. */
export function perVenue(
  answers: Partial<Record<'v-church' | 'v-hall', RsvpStatus>> = {},
  revision = 2,
): AttendanceView {
  const venues = (['v-church', 'v-hall'] as const).map((venueId) => ({
    venueId,
    venue: venueId === 'v-church' ? 'Church' : 'Hall',
    status: answers[venueId] ?? 'PENDING',
    respondedAt: null,
  }));
  const isPending = venues.some((venue) => venue.status === 'PENDING');
  return {
    mode: 'PER_VENUE',
    revision,
    status: isPending ? 'PENDING' : 'ATTENDING',
    needsReconfirmation: revision > 1 && isPending,
    venues,
  };
}

/** Fictional test data for the reply's logic. No real token appears (frontend/CLAUDE.md §10). */
export const QUESTIONS: RsvpQuestion[] = [
  {
    id: 'q-main',
    type: 'SINGLE_CHOICE',
    required: true,
    prompt: 'Main course',
    options: ['Beef', 'Fish'],
  },
  {
    id: 'q-multi',
    type: 'MULTI_CHOICE',
    required: false,
    prompt: 'Activities',
    options: ['Dance', 'Toast'],
  },
  { id: 'q-bus', type: 'BOOLEAN', required: false, prompt: 'Shuttle?', options: [] },
  { id: 'q-note', type: 'TEXT', required: false, prompt: 'Note', options: [] },
  { id: 'q-sign', type: 'SIGNATURE', required: true, prompt: 'Sign', options: [] },
];

export function recordWith(rsvp: Partial<ReplyRecord['rsvp']> = {}): ReplyRecord {
  return {
    guest: { id: 'g1', firstName: 'Armen', lastName: 'Petrosyan' },
    household: {
      name: 'Petrosyan family',
      seatsAllotted: 3,
      members: [
        {
          id: 'g2',
          firstName: 'Lusine',
          lastName: 'Petrosyan',
          addedByGuest: false,
          status: 'PENDING',
          attendance: eventWide(),
          dietary: [],
          dietaryNotes: null,
        },
      ],
    },
    attendance: eventWide(rsvp.status ?? 'PENDING'),
    rsvp: { status: 'PENDING', answers: [], ...rsvp },
  };
}

/**
 * The same household after the host switched to answering per venue (revision 2): everyone is
 * pending again until they answer, and Lusine's plus-one, Davit, follows nobody.
 */
export function perVenueRecord(
  respondent: Parameters<typeof perVenue>[0] = {},
  member: Parameters<typeof perVenue>[0] = {},
): ReplyRecord {
  const base = recordWith();
  const lusine = base.household.members[0];
  if (!lusine) throw new Error('The household has a member');
  return {
    ...base,
    household: {
      ...base.household,
      members: [
        { ...lusine, attendance: perVenue(member), status: perVenue(member).status },
        {
          id: 'g3',
          firstName: 'Davit',
          lastName: null,
          addedByGuest: true,
          status: 'PENDING',
          attendance: perVenue(),
          dietary: [],
          dietaryNotes: null,
        },
      ],
    },
    attendance: perVenue(respondent),
    rsvp: { status: perVenue(respondent).status, answers: [] },
  };
}

/** Every built-in question asked, as free text, unless a test says otherwise. */
export function contextWith(
  fields: Partial<Record<BuiltInField, RsvpFieldConfig>> = {},
  locale?: string,
  attendance: PayloadContext['attendance'] = { revision: 1, venueIds: [] },
): PayloadContext {
  return {
    questions: QUESTIONS,
    field: (name) => fields[name] ?? { isEnabled: true, options: null },
    locale,
    attendance,
  };
}
