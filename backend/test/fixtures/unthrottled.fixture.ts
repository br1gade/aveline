import { ThrottlerStorage } from '@nestjs/throttler';

/**
 * A throttle store that never counts. For journeys that drive long request
 * chains from one address and are not about rate limits: on a fast runner the
 * per-address limit (10 a second) would answer 429 for a request by its
 * position in the chain. rate-limiting.e2e-spec.ts and the limit specs own
 * the throttle; single-feature e2e files keep the real one.
 */
export const UNTHROTTLED: ThrottlerStorage = {
  increment: () => Promise.resolve({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};
