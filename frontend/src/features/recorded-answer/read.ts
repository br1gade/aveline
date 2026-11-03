import { REPLIES, type AnsweringGuest, type GuestAnswerWire, type Reply } from './types';

function replyOf(status: string | undefined): Reply | null {
  return REPLIES.find((reply) => reply === status) ?? null;
}

type Attendance = Pick<AnsweringGuest, 'mode' | 'revision' | 'venues'>;

/** How the event takes answers, as of this read; one event-wide answer before `eb77cd4`. */
function attendanceOf({ attendance }: GuestAnswerWire): Attendance {
  if (!attendance) return { mode: 'EVENT_WIDE', revision: 1, venues: [] };
  const venues = attendance.mode === 'PER_VENUE' ? attendance.venues : [];
  return {
    mode: attendance.mode,
    revision: attendance.revision,
    venues: venues.map((venue) => ({
      venueId: venue.venueId,
      venue: venue.venue,
      reply: replyOf(venue.status),
    })),
  };
}

type Words = Pick<
  AnsweringGuest,
  'dietary' | 'dietaryNotes' | 'drinkPreference' | 'songRequest' | 'message'
>;

const NO_WORDS: Words = {
  dietary: [],
  dietaryNotes: '',
  drinkPreference: '',
  songRequest: '',
  message: '',
};

/** The built-in answers; a guest who never answered has none. */
function wordsOf({ rsvp }: GuestAnswerWire): Words {
  if (!rsvp) return NO_WORDS;
  return {
    dietary: [...rsvp.dietary],
    dietaryNotes: rsvp.dietaryNotes ?? '',
    drinkPreference: rsvp.drinkPreference ?? '',
    songRequest: rsvp.songRequest ?? '',
    message: rsvp.message ?? '',
  };
}

/** The guest's answer so far, every field named; their token and contacts are never copied. */
export function readAnsweringGuest(wire: GuestAnswerWire): AnsweringGuest {
  return {
    id: wire.id,
    name: wire.name,
    isErased: wire.isAnonymized,
    ...attendanceOf(wire),
    reply: replyOf(wire.rsvp?.status ?? wire.rsvpStatus),
    ...wordsOf(wire),
    answers: Object.fromEntries(
      (wire.answers ?? []).map((answer) => [answer.questionId, answer.value]),
    ),
  };
}
