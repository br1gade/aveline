import { ERASED_NAME, ERASED_RSVP_FIELDS, anonymisedGuestFields } from './anonymisation';

describe('anonymisedGuestFields', () => {
  const NOW = new Date('2026-10-05T12:00:00.000Z');

  it('clears every identifying field', () => {
    const fields = anonymisedGuestFields('new-token', NOW);

    expect(fields.lastName).toBeNull();
    expect(fields.email).toBeNull();
    expect(fields.phone).toBeNull();
  });

  // A blank cell in a seating chart reads as a bug, and the row must stay
  // countable.
  it('leaves a placeholder name rather than an empty one', () => {
    expect(anonymisedGuestFields('new-token', NOW).firstName).toBe(ERASED_NAME);
  });

  /**
   * The old invitation link identifies them and would still open their RSVP,
   * so erasure has to replace it — otherwise the data is "deleted" while a
   * working link to it remains in a group chat.
   */
  it('replaces the invitation token', () => {
    expect(anonymisedGuestFields('new-token', NOW).token).toBe('new-token');
  });

  it('records when it happened, so the request can be evidenced', () => {
    expect(anonymisedGuestFields('new-token', NOW).anonymizedAt).toEqual(NOW);
  });

  /**
   * The counterpart rule: structural data is not erased. Nothing in the
   * returned fields touches the household, the seat or the response status,
   * because a headcount the caterer was already paid for must not change.
   */
  it('touches nothing structural', () => {
    expect(Object.keys(anonymisedGuestFields('new-token', NOW)).sort()).toEqual([
      'anonymizedAt',
      'email',
      'firstName',
      'lastName',
      'phone',
      'token',
    ]);
  });
});

describe('ERASED_RSVP_FIELDS', () => {
  // Free text the guest wrote themselves goes; the tags that feed the
  // catering sheet stay, because "vegan" against an anonymous row identifies
  // nobody.
  it('clears the free text and nothing else', () => {
    expect(ERASED_RSVP_FIELDS).toEqual({ message: null, dietaryNotes: null, songRequest: null });
  });
});
