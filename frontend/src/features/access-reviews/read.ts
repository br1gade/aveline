import type { AccessReview } from './types';

/** Every field named, so who resolved what, and anything added later, go no further. */
export function readReview({
  id,
  organizationId,
  reason,
  openedAt,
  revision,
}: AccessReview): AccessReview {
  return { id, organizationId, reason, openedAt, revision };
}

export const KNOWN_REASONS = ['LAST_OWNER_CLOSURE', 'INACTIVE_OWNER_RECOVERY'] as const;
