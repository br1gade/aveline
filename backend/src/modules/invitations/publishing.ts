import { BlockType, InvitationStatus } from '@prisma/client';

/**
 * What must be true before an invitation goes live.
 *
 * Three checks, decided with the product owner, each catching a mistake that
 * makes a published invitation useless rather than merely imperfect — and
 * once one is sent to four hundred people it cannot be unsent:
 *
 *   - **No enabled RSVP block** — guests receive a page they cannot answer.
 *   - **No venue with an address** — guests know when, but not where.
 *   - **An event that has already started** — the invitation arrives late.
 *
 * Every blocker is reported at once, so a host fixes the page in one pass
 * rather than discovering the next problem on each attempt to publish.
 *
 * Pure, because "is this ready" is a product rule that should be readable in
 * one place and testable without a database.
 */
export interface PublishCandidate {
  status: InvitationStatus;
  startsAt: Date;
  blocks: { type: BlockType; enabled: boolean }[];
  venues: { address: string }[];
}

export function publishBlockers(candidate: PublishCandidate, now: Date): string[] {
  const blockers: string[] = [];

  const hasRsvp = candidate.blocks.some((block) => block.type === BlockType.RSVP && block.enabled);
  if (!hasRsvp) {
    blockers.push('Turn on the RSVP block, or guests will have no way to answer');
  }

  const hasVenue = candidate.venues.some((venue) => venue.address.trim().length > 0);
  if (!hasVenue) {
    blockers.push('Add a venue with an address, so guests know where to go');
  }

  if (candidate.startsAt.getTime() <= now.getTime()) {
    blockers.push('This event has already started; an invitation now would arrive late');
  }

  return blockers;
}

/**
 * Which moves between states are allowed.
 *
 * A table rather than branching, so the whole lifecycle is visible at once:
 *
 *   DRAFT ──publish──▶ PUBLISHED ──close──▶ CLOSED
 *                          ▲                  │
 *                          └─────reopen───────┘
 *
 * There is no way back to DRAFT. A published invitation has had links sent,
 * and returning it to draft would turn every one of those links into a 404 in
 * a guest's chat history. Closing is the reversible way to stop responses.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<InvitationStatus, readonly InvitationStatus[]>> = {
  [InvitationStatus.DRAFT]: [InvitationStatus.PUBLISHED],
  [InvitationStatus.PUBLISHED]: [InvitationStatus.CLOSED],
  [InvitationStatus.CLOSED]: [InvitationStatus.PUBLISHED],
};

export function canTransition(from: InvitationStatus, to: InvitationStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Whether guests can still read the page.
 *
 * Closing stops new responses; it does not hide the venue, the time or the
 * dress code from the people who are coming. Only a draft is invisible.
 */
export function isReadableByGuests(status: InvitationStatus): boolean {
  return status !== InvitationStatus.DRAFT;
}
