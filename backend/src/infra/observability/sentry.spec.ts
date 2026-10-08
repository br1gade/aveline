import type { ErrorEvent } from '@sentry/nestjs';
import { initialiseSentry, scrubEvent } from './sentry';

/**
 * Error reports leave the building, so what they carry matters more than
 * whether they arrive. These pin the two things that must never go: a
 * credential, and a guest's personal data.
 */
describe('Sentry', () => {
  describe('initialiseSentry', () => {
    it('stays off without a DSN, so development needs no flag', () => {
      expect(initialiseSentry({})).toBe(false);
    });
  });

  describe('scrubEvent', () => {
    const eventWith = (request: Record<string, unknown>) =>
      scrubEvent({ request } as unknown as ErrorEvent);

    it.each(['authorization', 'cookie', 'x-api-key'])('removes the %s header', (header) => {
      const scrubbed = eventWith({ headers: { [header]: 'secret-value', 'user-agent': 'curl' } });
      expect(scrubbed?.request?.headers?.[header]).toBeUndefined();
    });

    it('keeps harmless headers, which are what make a report useful', () => {
      const scrubbed = eventWith({ headers: { 'user-agent': 'curl', authorization: 'Bearer x' } });
      expect(scrubbed?.request?.headers?.['user-agent']).toBe('curl');
    });

    // A capability token in a URL grants access to that guest's invitation.
    it.each([
      {
        url: 'https://api.test/api/v1/invitations/anna-davit/g/ask4bkcjufxy',
        leaked: 'ask4bkcjufxy',
      },
      {
        url: 'https://api.test/api/v1/ticket-orders/2e022606ee7226ee',
        leaked: '2e022606ee7226ee',
      },
      { url: 'https://api.test/api/v1/devices/fcm-token-abc123', leaked: 'fcm-token-abc123' },
      { url: 'https://api.test/api/v1/briefs/brief-token-xyz', leaked: 'brief-token-xyz' },
      { url: 'https://api.test/api/v1/tickets/DOORCODE123/admit', leaked: 'DOORCODE123' },
    ])('redacts the capability token in $url', ({ url, leaked }) => {
      const scrubbed = eventWith({ url });
      expect(scrubbed?.request?.url).not.toContain(leaked);
      expect(scrubbed?.request?.url).toContain('[token]');
    });

    it('drops the query string, which can carry a searched name', () => {
      const event = { request: { url: 'https://api.test/x', query_string: 'q=Armen' } } as ErrorEvent;
      expect(scrubEvent(event)?.request?.query_string).toBeUndefined();
    });

    it('leaves a URL with no token alone', () => {
      const url = 'https://api.test/api/v1/events/abc/dashboard';
      expect(eventWith({ url })?.request?.url).toBe(url);
    });

    // Bodies here carry guest names, emails, dietary notes and passwords.
    it('drops the request body entirely', () => {
      const scrubbed = eventWith({
        data: { password: 'hunter2', buyerEmail: 'ani@example.com', dietaryNotes: 'coeliac' },
      });
      expect(scrubbed?.request?.data).toBeUndefined();
    });

    it('survives an event with no request at all', () => {
      expect(scrubEvent({} as ErrorEvent)).toEqual({});
    });
  });
});
