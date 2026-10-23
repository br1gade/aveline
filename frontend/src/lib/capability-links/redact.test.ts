import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  carriesCapability,
  CREDENTIAL_SEGMENTS,
  HARMLESS_QUERY_KEYS,
  isCapabilityPath,
  PERSONAL_SEGMENTS,
  redactText,
  redactUrl,
} from './redact';

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
    ['/api/v1/payments/AVL-1/confirm', '/api/v1/payments/[order]/confirm'],
    ['/api/v1/organization/invites/ani%40x.am', '/api/v1/organization/invites/[email]'],
    ['/api/v1/events/e1/team/invites/a@b.am', '/api/v1/events/e1/team/invites/[email]'],
  ])('removes the credential or personal data from %s', (url, expected) => {
    expect(redactUrl(url)).toBe(expected);
  });

  it.each([
    '/api/v1/ticket-orders/release-expired',
    '/api/v1/payments/reconcile',
    '/api/v1/invites/accept',
    '/api/v1/event-invites/accept',
  ])('keeps %s, which names nobody', (url) => {
    expect(redactUrl(url)).toBe(url);
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

  it('removes a token carried in a query, as the reset and invitation pages take it', () => {
    expect(redactText('at http://app/reset-password?token=abc123&lang=hy failed')).toBe(
      'at http://app/reset-password?token=[redacted]&lang=hy failed',
    );
    expect(redactText('/accept-invite?lang=en&token=abc123')).toBe(
      '/accept-invite?lang=en&token=[redacted]',
    );
  });
});

describe('isCapabilityPath', () => {
  it.each([
    ['/invitations/anna-davit/g/abc123', true],
    ['/invitations/anna-davit/g/abc123.data', true],
    ['/tickets/xyz', true],
    ['/invitations/anna-davit', false],
    ['/payments/AVL-1', false],
    ['/', false],
  ])('%s is %s', (path, expected) => {
    expect(isCapabilityPath(path)).toBe(expected);
  });
});

describe('carriesCapability', () => {
  it.each([
    ['http://app/invitations/anna-davit/g/abc123', true],
    ['http://app/reset-password?token=abc123', true],
    ['http://app/accept-event-invite?lang=hy&token=abc123', true],
    ['http://app/reset-password', false],
    ['http://app/sign-in?lang=hy', false],
  ])('%s is %s', (url, expected) => {
    expect(carriesCapability(new URL(url))).toBe(expected);
  });
});

// Read only: the frontend checks that it still redacts everything the backend does.
describe('parity with backend/src/common/redact-url.ts', () => {
  const backend = readFileSync(
    join(import.meta.dirname, '..', '..', '..', '..', 'backend', 'src', 'common', 'redact-url.ts'),
    'utf8',
  );
  const ours = [...CREDENTIAL_SEGMENTS, ...PERSONAL_SEGMENTS].map(
    ([pattern, replacement]) => `${pattern.source} -> ${replacement}`,
  );

  it('has every path pattern the backend has', () => {
    const theirs = [...backend.matchAll(/^\s*\[\/(.+)\/g, '([^']+)'\],/gm)].map(
      ([, source, replacement]) => `${source ?? ''} -> ${replacement ?? ''}`,
    );
    expect(theirs.length).toBeGreaterThan(0);
    expect(ours).toEqual(expect.arrayContaining(theirs));
  });

  it('treats the same query keys as harmless', () => {
    const list = /HARMLESS_QUERY_KEYS = new Set\(\[([^\]]*)\]\)/.exec(backend)?.[1] ?? '';
    const theirs = [...list.matchAll(/'([^']+)'/g)].map(([, key]) => key);
    expect(theirs.length).toBeGreaterThan(0);
    expect([...HARMLESS_QUERY_KEYS].sort()).toEqual(theirs.sort());
  });
});
