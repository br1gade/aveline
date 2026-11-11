import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AuthenticatedRequest } from './actor';

/**
 * Counts a signed-in caller by account, everyone else by address.
 *
 * By address alone, everyone behind one connection — door staff on the
 * venue's Wi-Fi with their check-in tablets, a mobile carrier's shared NAT —
 * drew on a single allowance and got 429s. The auth guard runs first, so the
 * actor is known here.
 */
@Injectable()
export class AccountOrAddressThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(request: Record<string, unknown>): Promise<string> {
    const actor = (request as AuthenticatedRequest).actor;
    return actor ? Promise.resolve(`user:${actor.userId}`) : super.getTracker(request);
  }
}

/**
 * For reads that many people make through one tracker at once: a guest's own
 * invitation page, opened by a whole room on one Wi-Fi when guests look up
 * their table; the public pages our renderer reads for every visitor from one
 * address; and the door roster, read whole a page at a time by one account.
 * Each route has its own bucket, so this never widens a write's allowance.
 */
export const GUEST_PAGE_LIMITS = {
  short: { limit: 50, ttl: 1000 },
  medium: { limit: 3000, ttl: 60_000 },
};
