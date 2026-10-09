import { redactQueryObject, redactUrl } from './redact-url';

describe('redactUrl', () => {
  it.each([
    ['/api/v1/invitations/anna-davit/g/k7m2abcd9xyz', '/api/v1/invitations/anna-davit/g/[token]'],
    ['/api/v1/invitations/anna-davit/g/k7m2abcd9xyz/rsvp', '/api/v1/invitations/anna-davit/g/[token]/rsvp'],
    ['/api/v1/ticket-orders/8d20e99a77/confirm', '/api/v1/ticket-orders/[token]/confirm'],
    ['/api/v1/ticket-orders/8d20e99a77', '/api/v1/ticket-orders/[token]'],
    ['/api/v1/tickets/ABCDEF123/admit', '/api/v1/tickets/[token]/admit'],
    ['/api/v1/briefs/brief-token-1', '/api/v1/briefs/[token]'],
    ['/api/v1/devices/push-token', '/api/v1/devices/[token]'],
  ])('removes the credential from %s', (url, expected) => {
    expect(redactUrl(url)).toBe(expected);
  });

  it.each([
    '/api/v1/invitations/anna-davit',
    '/api/v1/ticket-orders/release-expired',
    '/api/v1/events/clz123/ticket-orders',
    '/api/v1/events/clz123/guests/clz456',
  ])('leaves %s alone — no credential in it', (url) => {
    expect(redactUrl(url)).toBe(url);
  });

  it('keeps harmless query values and drops the rest', () => {
    expect(redactUrl('/api/v1/concierge/organizations?search=Armen%20Petrosyan&locale=hy')).toBe(
      '/api/v1/concierge/organizations?search=[redacted]&locale=hy',
    );
    expect(redactUrl('/api/v1/payments/return?orderId=123&token=abc')).toBe(
      '/api/v1/payments/return?orderId=[redacted]&token=[redacted]',
    );
  });
});

describe('redactQueryObject', () => {
  it('applies the same rule to a parsed query', () => {
    expect(redactQueryObject({ q: 'Armen', limit: '20' })).toEqual({ q: '[redacted]', limit: '20' });
  });
});
