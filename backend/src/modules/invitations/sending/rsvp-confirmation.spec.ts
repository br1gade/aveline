import { RsvpStatus } from '@prisma/client';
import { confirmationDedupeKey, confirmationTemplateFor } from './rsvp-confirmation';

describe('confirmationTemplateFor', () => {
  it.each([
    { status: RsvpStatus.ATTENDING, key: 'rsvp.confirmation.attending' },
    { status: RsvpStatus.DECLINED, key: 'rsvp.confirmation.declined' },
    { status: RsvpStatus.UNDECIDED, key: 'rsvp.confirmation.undecided' },
  ])('confirms $status with its own copy', ({ status, key }) => {
    expect(confirmationTemplateFor(status)).toBe(key);
  });

  // PENDING is the state before anyone has answered, so there is nothing to
  // confirm.
  it('confirms nothing for PENDING', () => {
    expect(confirmationTemplateFor(RsvpStatus.PENDING)).toBeNull();
  });

  it('has copy for every status a guest can actually choose', () => {
    const answerable = Object.values(RsvpStatus).filter((status) => status !== RsvpStatus.PENDING);

    for (const status of answerable) {
      expect(confirmationTemplateFor(status)).not.toBeNull();
    }
  });
});

describe('confirmationDedupeKey', () => {
  const at = (iso: string) => new Date(iso);
  const minute = at('2027-01-01T10:00:30.000Z');

  // A double-submitted form is one answer.
  it('sends nothing for the same answer as the last confirmation this minute', () => {
    expect(confirmationDedupeKey('h1', RsvpStatus.ATTENDING, minute, [RsvpStatus.ATTENDING])).toBeNull();
  });

  // Concurrent identical submissions read the same history, so they agree on one key.
  it('gives identical answers with the same history the same key', () => {
    expect(confirmationDedupeKey('h1', RsvpStatus.ATTENDING, at('2027-01-01T10:00:05.000Z'), [])).toBe(
      confirmationDedupeKey('h1', RsvpStatus.ATTENDING, at('2027-01-01T10:00:55.000Z'), []),
    );
  });

  // Changing your answer deserves its own acknowledgement.
  it('differs when the answer changes, even within the same minute', () => {
    expect(confirmationDedupeKey('h1', RsvpStatus.DECLINED, minute, [RsvpStatus.ATTENDING])).not.toBeNull();
  });

  // B60: attending, declined, attending again in one minute — the third reused
  // the first one's key and was dropped, so the last word the guest had was
  // "sorry you can't make it".
  it('confirms an answer changed back within the same minute', () => {
    const first = confirmationDedupeKey('h1', RsvpStatus.ATTENDING, minute, []);
    const back = confirmationDedupeKey('h1', RsvpStatus.ATTENDING, minute, [RsvpStatus.DECLINED, RsvpStatus.ATTENDING]);

    expect(back).not.toBeNull();
    expect(back).not.toBe(first);
  });

  it('differs for the same answer given again later', () => {
    expect(confirmationDedupeKey('h1', RsvpStatus.ATTENDING, at('2027-01-01T10:00:00.000Z'), [])).not.toBe(
      confirmationDedupeKey('h1', RsvpStatus.ATTENDING, at('2027-01-01T11:00:00.000Z'), []),
    );
  });
});
