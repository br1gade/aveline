import { describe, expect, it } from 'vitest';

import { isCapabilityPath, redactText, redactUrl } from './redact';

describe('redactUrl', () => {
  it.each([
    ['/invitations/anna-davit/g/abc123', '/invitations/anna-davit/g/[token]'],
    [
      '/api/v1/invitations/anna-davit/g/abc123/rsvp',
      '/api/v1/invitations/anna-davit/g/[token]/rsvp',
    ],
    ['/tickets/t0k3n', '/tickets/[token]'],
    ['/briefs/xyz', '/briefs/[token]'],
    ['/api/v1/devices/d1/heartbeat', '/api/v1/devices/[token]/heartbeat'],
    ['/api/v1/ticket-orders/o1/confirm', '/api/v1/ticket-orders/[token]/confirm'],
  ])('removes the credential from %s', (url, expected) => {
    expect(redactUrl(url)).toBe(expected);
  });

  it('keeps the one ticket-order route that is not a credential', () => {
    expect(redactUrl('/api/v1/ticket-orders/release-expired')).toBe(
      '/api/v1/ticket-orders/release-expired',
    );
  });

  it('leaves the generic invitation alone', () => {
    expect(redactUrl('/invitations/anna-davit')).toBe('/invitations/anna-davit');
  });

  it('keeps harmless query values and redacts the rest', () => {
    expect(redactUrl('/invitations/a/g/t?locale=hy&q=Armen&token=abc')).toBe(
      '/invitations/a/g/[token]?locale=hy&q=[redacted]&token=[redacted]',
    );
  });
});

describe('redactText', () => {
  it('removes a guest token quoted inside an error message, and leaves other text alone', () => {
    expect(
      redactText('Error: failed GET http://api/invitations/anna-davit/g/abc123?x=1 (is it up?)'),
    ).toBe('Error: failed GET http://api/invitations/anna-davit/g/[token]?x=1 (is it up?)');
  });
});

describe('isCapabilityPath', () => {
  it.each([
    ['/invitations/anna-davit/g/abc123', true],
    ['/invitations/anna-davit/g/abc123.data', true],
    ['/tickets/xyz', true],
    ['/invitations/anna-davit', false],
    ['/', false],
  ])('%s is %s', (path, expected) => {
    expect(isCapabilityPath(path)).toBe(expected);
  });
});
