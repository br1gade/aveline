import { describe, expect, it } from 'vitest';

import { personalInvitation } from './test-data';

import { withCorrectedName } from './correction';

describe('a corrected name, shown without reading the page again', () => {
  const invitation = personalInvitation();
  const guest = invitation.guest;
  if (!guest) throw new Error('the fixture is a personal invitation');
  const corrected = { id: guest.id, firstName: 'Armen', lastName: null, name: 'Armen' };

  it('greets the guest by the new name and lists it among the household', () => {
    const fixed = withCorrectedName(invitation, corrected);
    expect(fixed.guest?.name).toBe('Armen');
    const own = fixed.guest?.household.members.find((member) => member.id === guest.id);
    expect(own?.name).toBe('Armen');
    const others = fixed.guest?.household.members.filter((member) => member.id !== guest.id);
    expect(others).toEqual(guest.household.members.filter((member) => member.id !== guest.id));
  });

  it('changes nothing for another guest’s answer', () => {
    expect(withCorrectedName(invitation, { ...corrected, id: 'someone-else' })).toBe(invitation);
  });
});
