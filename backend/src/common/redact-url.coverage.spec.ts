import { redactUrl } from './redact-url';

/**
 * The door scanner's route lives under the event. Its ticket code is a
 * credential (root CLAUDE.md §3), and must be redacted on the current route,
 * not only on the legacy un-scoped one.
 */
describe('redactUrl on event-scoped ticket routes (coverage)', () => {
  it.each([
    ['/api/v1/events/clz123/tickets/ABCDEF123/admit', '/api/v1/events/clz123/tickets/[token]/admit'],
    ['/api/v1/events/clz123/tickets/ABCDEF123/attendee', '/api/v1/events/clz123/tickets/[token]/attendee'],
    ['/api/v1/events/clz123/tickets/ABCDEF123/link-guest', '/api/v1/events/clz123/tickets/[token]/link-guest'],
    ['/api/v1/events/clz123/tickets/ABCDEF123/admit?locale=hy', '/api/v1/events/clz123/tickets/[token]/admit?locale=hy'],
  ])('removes the ticket code from %s', (url, expected) => {
    expect(redactUrl(url)).toBe(expected);
  });
});
