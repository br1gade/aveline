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

  // A double-submitted form is one answer.
  it('is the same for the same answer within a minute', () => {
    expect(
      confirmationDedupeKey('h1', RsvpStatus.ATTENDING, at('2027-01-01T10:00:05.000Z')),
    ).toBe(confirmationDedupeKey('h1', RsvpStatus.ATTENDING, at('2027-01-01T10:00:55.000Z')));
  });

  // Changing your answer deserves its own acknowledgement.
  it('differs when the answer changes, even within the same minute', () => {
    expect(
      confirmationDedupeKey('h1', RsvpStatus.ATTENDING, at('2027-01-01T10:00:05.000Z')),
    ).not.toBe(confirmationDedupeKey('h1', RsvpStatus.DECLINED, at('2027-01-01T10:00:20.000Z')));
  });

  it('differs for the same answer given again later', () => {
    expect(
      confirmationDedupeKey('h1', RsvpStatus.ATTENDING, at('2027-01-01T10:00:00.000Z')),
    ).not.toBe(confirmationDedupeKey('h1', RsvpStatus.ATTENDING, at('2027-01-01T11:00:00.000Z')));
  });

  it('differs between households', () => {
    const now = at('2027-01-01T10:00:00.000Z');

    expect(confirmationDedupeKey('h1', RsvpStatus.ATTENDING, now)).not.toBe(
      confirmationDedupeKey('h2', RsvpStatus.ATTENDING, now),
    );
  });
});
