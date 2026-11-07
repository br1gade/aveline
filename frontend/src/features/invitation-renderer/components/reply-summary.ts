import type { ReplyStatus } from '@/ui';

import type { Invitation } from '../types';

/** The reply section's heading: the Reply buttons move focus here (spec §4.3, §11). */
export const REPLY_SECTION_ID = 'reply';
export const REPLY_HEADING_ID = 'reply-heading';

/** What the page shows of a guest's reply: on the card, in the reply bar and on the cover. */
export interface ReplySummary {
  status: ReplyStatus;
  /** Everyone attending, the respondent included, when the household's answers are known. */
  attendingCount?: number | undefined;
  respondedAt?: string | null | undefined;
  /** Everyone in the household, the respondent first, as last saved: includes added guests. */
  householdNames?: readonly string[] | undefined;
}

/** From the invitation alone: the respondent's own answer, without the household's. */
export function replyFromInvitation(invitation: Invitation): ReplySummary | null {
  const rsvp = invitation.guest?.rsvp;
  if (!rsvp || rsvp.status === 'PENDING') {
    return null;
  }
  return { status: rsvp.status, respondedAt: rsvp.respondedAt };
}
