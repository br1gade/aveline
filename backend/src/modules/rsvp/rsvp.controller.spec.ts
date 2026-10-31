import { RsvpController } from './rsvp.controller';
import { GUEST_PAGE_LIMITS } from '../../infra/auth/throttler.guard';

const limitOf = (handler: object, name: string): unknown =>
  Reflect.getMetadata(`THROTTLER:LIMIT${name}`, handler);

describe('RsvpController rate limits', () => {
  // The guest page's server renderer reads the response for every guest it
  // serves, all from one address, so the read shares the guest-page allowance.
  it.each(Object.entries(GUEST_PAGE_LIMITS))('reads at the guest-page %s limit', (name, { limit }) => {
    expect(limitOf(RsvpController.prototype.get, name)).toBe(limit);
  });

  it('keeps the default mutation limits on submit', () => {
    // Read beside the read's, so a renamed metadata key fails here too.
    expect(limitOf(RsvpController.prototype.get, 'short')).toBeDefined();
    expect(limitOf(RsvpController.prototype.submit, 'short')).toBeUndefined();
  });
});
