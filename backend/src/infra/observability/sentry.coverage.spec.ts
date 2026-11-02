import type { ErrorEvent } from '@sentry/nestjs';
import { scrubEvent } from './sentry';

/** An error on the door scanner must not ship its ticket code off-host. */
describe('Sentry scrubbing of the event-scoped door route (coverage)', () => {
  it.each([
    { url: 'https://api.test/api/v1/events/e1/tickets/DOORCODE123/admit', leaked: 'DOORCODE123' },
    { url: 'https://api.test/api/v1/events/e1/tickets/DOORCODE456/link-guest', leaked: 'DOORCODE456' },
  ])('redacts the ticket code in $url', ({ url, leaked }) => {
    const scrubbed = scrubEvent({ request: { url } } as unknown as ErrorEvent);

    expect(scrubbed?.request?.url).not.toContain(leaked);
    expect(scrubbed?.request?.url).toBe(url.replace(leaked, '[token]'));
  });
});
