import type { Invitation } from '@/features/invitation-renderer';

import type { CorrectedName } from './types';

/**
 * The page as it is, with the guest's corrected name wherever it shows: the greeting and their
 * place among the household. Applied from the correction's answer, so the page is not read again
 * and nothing typed in the reply form is lost. Another guest's answer changes nothing.
 */
export function withCorrectedName(invitation: Invitation, corrected: CorrectedName): Invitation {
  const { guest } = invitation;
  if (!guest || guest.id !== corrected.id) return invitation;
  const members = guest.household.members.map((member) =>
    member.id === corrected.id ? { ...member, name: corrected.name } : member,
  );
  return {
    ...invitation,
    guest: { ...guest, name: corrected.name, household: { ...guest.household, members } },
  };
}
