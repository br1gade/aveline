import { describe, expect, it } from 'vitest';

import {
  applySecurityHeaders,
  capabilityPageHeaders,
  contentSecurityPolicy,
  createNonce,
  publicInvitationHeaders,
} from './headers';

describe('security headers', () => {
  it('builds a strict nonce-based policy', () => {
    const policy = contentSecurityPolicy({
      nonce: 'abc',
      isProduction: true,
      mediaOrigin: 'https://media.example/bucket/x.jpg',
    });
    expect(policy).toContain("script-src 'self' 'nonce-abc'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("img-src 'self' data: blob: https://media.example");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it('sets the policy only in production, and the basics always', () => {
    const dev = new Headers();
    applySecurityHeaders(dev, { nonce: 'n', isProduction: false });
    expect(dev.get('Content-Security-Policy')).toBeNull();
    expect(dev.get('X-Content-Type-Options')).toBe('nosniff');

    const prod = new Headers();
    applySecurityHeaders(prod, { nonce: 'n', isProduction: true });
    expect(prod.get('Content-Security-Policy')).toContain("'nonce-n'");
  });

  it('makes a fresh nonce each time', () => {
    expect(createNonce()).not.toBe(createNonce());
    expect(createNonce()).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });

  it('keeps capability pages out of referrers, caches and indexes', () => {
    expect(capabilityPageHeaders()).toEqual({
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    });
  });

  it('lets the generic link be kept briefly by the browser, never by a shared cache', () => {
    expect(publicInvitationHeaders()).toEqual({
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'private, max-age=60',
      'X-Robots-Tag': 'noindex, nofollow',
    });
  });
});
