// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createVisitorApi, visitorAddress } from './visitor.server';

const page = (forwardedFor?: string) =>
  new Request('https://aveline.am/invitations/anna', {
    headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
  });

/**
 * The API limits each address. Its reads for a rendered page come from this server, so unless the
 * server says whose page it is, every visitor shares one allowance and one busy room, or one
 * abuser, puts every guest page into 429s (docs/GOING_LIVE.md 13c).
 */
describe('visitorAddress', () => {
  it.each([
    ['the address the proxy recorded', '203.0.113.7', '203.0.113.7'],
    ['an IPv6 address', '2001:db8::1', '2001:db8::1'],
    [
      'the proxy’s entry, never one the visitor sent before it',
      '198.51.100.9, 203.0.113.7',
      '203.0.113.7',
    ],
    ['surrounding spaces trimmed', ' 203.0.113.7 ', '203.0.113.7'],
    [
      'the longest address there is',
      'ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255',
      'ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255',
    ],
  ])('takes %s', (_case, header, expected) => {
    expect(visitorAddress(page(header))).toBe(expected);
  });

  it.each([
    ['no proxy in front (local development)', undefined],
    ['an empty entry', '203.0.113.7, '],
    ['something that is not an address', 'unknown'],
    ['hex that is not an address', 'cafe'],
    ['an address with a port', '203.0.113.7:443'],
    ['an address too long to be one', '1'.repeat(46)],
  ])('gives none for %s', (_case, header) => {
    expect(visitorAddress(page(header))).toBeUndefined();
  });
});

describe('createVisitorApi', () => {
  const fetchMock = vi.fn((_request: Request) => Promise.resolve(Response.json([])));

  beforeEach(() => {
    vi.stubEnv('API_INTERNAL_URL', 'http://api.internal');
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockClear();
  });

  const sentHeader = async (incoming: Request) => {
    await createVisitorApi(incoming).GET('/api/v1/plans');
    const sent = fetchMock.mock.calls[0]?.[0];
    return { url: sent?.url, forwardedFor: sent?.headers.get('x-forwarded-for') };
  };

  it('reads the API at its internal address and says whose page it is', async () => {
    await expect(sentHeader(page('198.51.100.9, 203.0.113.7'))).resolves.toEqual({
      url: 'http://api.internal/api/v1/plans',
      forwardedFor: '203.0.113.7',
    });
  });

  it('sends no address when it knows none', async () => {
    await expect(sentHeader(page())).resolves.toMatchObject({ forwardedFor: null });
  });
});
