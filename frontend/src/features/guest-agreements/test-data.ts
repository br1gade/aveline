import type { ReplyRecord } from '@/features/guest-reply';
import type { Invitation } from '@/features/invitation-renderer';

/**
 * A personal page with one required statement, and the saved reply of a ticket holder coming
 * (docs/API.md §11), for the tests. Sample content (design AS-6); no token is committed.
 */
export const INVITATION: Invitation = {
  slug: 'autumn-jazz-night',
  isAcceptingResponses: true,
  template: 'classic',
  theme: {},
  allowedFonts: [],
  musicUrl: null,
  coverUrl: null,
  locale: 'en',
  availableLocales: ['en'],
  event: {
    type: 'CONCERT',
    title: 'Autumn Jazz Night',
    hosts: 'The Garden',
    startsAt: '2027-10-02T15:00:00.000Z',
    endsAt: null,
    timezone: 'Asia/Yerevan',
    sides: { a: null, b: null },
  },
  guest: null,
  blocks: [],
  rsvpQuestions: [
    {
      id: 'q-rules',
      type: 'SIGNATURE',
      required: true,
      prompt: 'I accept the house rules',
      options: [],
      statementVersionId: 'v2',
    },
  ],
};

const COMING = {
  mode: 'EVENT_WIDE',
  revision: 1,
  status: 'ATTENDING',
  needsReconfirmation: false,
  venues: [],
} as const;

export function recordComing(members: ReplyRecord['household']['members'] = []): ReplyRecord {
  return {
    guest: { id: 'g-anna', firstName: 'Anna', lastName: 'Sargsyan' },
    household: { name: 'Anna Sargsyan', seatsAllotted: 1 + members.length, members },
    attendance: { ...COMING, venues: [] },
    rsvp: { status: 'ATTENDING', answers: [] },
  };
}

export const DAVIT_COMING: ReplyRecord['household']['members'][number] = {
  id: 'g-davit',
  firstName: 'Davit',
  lastName: null,
  addedByGuest: false,
  status: 'ATTENDING',
  attendance: { ...COMING, venues: [] },
  dietary: [],
  dietaryNotes: null,
};

/** `GET …/acknowledgements`, with the records given. */
export function acknowledgementsWire(
  records: Array<{ subjectGuestId: string; statementVersionId?: string }> = [],
) {
  return {
    statements: [
      {
        questionId: 'q-rules',
        statementVersionId: 'v2',
        required: true,
        prompt: 'I accept the house rules',
        locale: 'en',
        statementLocale: 'en',
      },
    ],
    records: records.map((record, index) => ({
      id: `ack-${index}`,
      questionId: 'q-rules',
      statementVersionId: record.statementVersionId ?? 'v2',
      subjectGuestId: record.subjectGuestId,
      signerGuestId: 'g-anna',
      signerName: 'Anna Sargsyan',
      method: 'TYPED',
      createdAt: '2027-09-01T10:00:00.000Z',
    })),
    signatureUploads: [],
    nextCursor: null,
  };
}
