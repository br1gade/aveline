import { calculateInvitationExpiry, hasInvitationExpired } from './lifetime';

describe('Captured invitation lifetime', () => {
  const startsAt = new Date('2026-10-25T12:00:00Z'); const endsAt = new Date('2026-10-26T01:00:00Z');
  it('adds ninety elapsed days after event end', () => {
    expect(calculateInvitationExpiry({ startsAt, endsAt }, 90)).toEqual(new Date('2027-01-24T01:00:00Z'));
  });
  it('uses event start when no end is recorded', () => {
    expect(calculateInvitationExpiry({ startsAt, endsAt: null }, 90)).toEqual(new Date('2027-01-23T12:00:00Z'));
  });
  it('keeps indefinite entitlements indefinite', () => {
    expect(calculateInvitationExpiry({ startsAt, endsAt }, null)).toBeNull();
  });
  it.each([-1, 0, 1])('closes access at the exact deadline (offset %i ms)', (offset) => {
    expect(hasInvitationExpired({ expiresAt: startsAt }, new Date(startsAt.getTime() + offset))).toBe(offset >= 0);
  });

});
