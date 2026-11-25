import type { AccessReview } from './types';

/** Every field named, so who resolved what, and anything added later, go no further. */
export function readReview({
  id,
  organizationId,
  organization,
  reason,
  openedAt,
  revision,
}: AccessReview): AccessReview {
  const { name, kind } = organization;
  return { id, organizationId, organization: { name, kind }, reason, openedAt, revision };
}

export const KNOWN_REASONS = ['LAST_OWNER_CLOSURE', 'INACTIVE_OWNER_RECOVERY'] as const;
