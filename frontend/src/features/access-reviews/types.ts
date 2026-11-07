/** Interim until FR-1: the schema declares no answers. */
export interface AccessReview {
  id: string;
  organizationId: string;
  /** `LAST_OWNER_CLOSURE` or `INACTIVE_OWNER_RECOVERY`; another is shown as it came. */
  reason: string;
  openedAt: string;
  /** The review's own, which resolving it must name. */
  revision: number;
}

export interface ReviewsPage {
  items: AccessReview[];
  nextCursor: string | null;
}

export type ReviewDecision = 'HANDOVER' | 'CLOSE' | 'DECLINE';
