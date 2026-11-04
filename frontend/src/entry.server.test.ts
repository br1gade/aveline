// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { plantedToken } from '../test/tokens';

import handleRequest, { handleDataRequest } from './entry.server';

type DataArgs = Parameters<typeof handleDataRequest>[1];

/** A client navigation's loader request, as React Router makes it, and the headers it leaves. */
function dataHeaders(path: string): Headers {
  const response = handleDataRequest(new Response(null), {
    request: new Request(`http://app.test${path}`),
  } as DataArgs);
  if (!(response instanceof Response)) throw new Error('Expected a response');
  return response.headers;
}

describe('the pages a capability opens, on every response', () => {
  const token = plantedToken();

  it.each([
    `/briefs/${token}.data`,
    '/briefs.data',
    '/briefs.data?lang=hy',
    `/tickets/${token}.data`,
    '/tickets.data',
  ])('keeps %s out of referrers, caches and indexes', (path) => {
    const headers = dataHeaders(path);
    expect(headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(headers.get('Cache-Control')).toBe('private, no-store');
    expect(headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });

  it('leaves an ordinary page’s caching to the page', () => {
    expect(dataHeaders('/events.data').get('Cache-Control')).toBeNull();
  });

  it.each([`/briefs/${token}`, '/briefs', '/tickets'])(
    'keeps a full load of %s out of referrers, caches and indexes',
    async (path) => {
      const headers = new Headers();
      const context = { staticHandlerContext: { loaderData: {} } };
      await handleRequest(
        new Request(`http://app.test${path}`, { method: 'HEAD' }),
        200,
        headers,
        context as unknown as Parameters<typeof handleRequest>[3],
        undefined as unknown as Parameters<typeof handleRequest>[4],
      );
      expect(headers.get('Referrer-Policy')).toBe('no-referrer');
      expect(headers.get('Cache-Control')).toBe('private, no-store');
      expect(headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    },
  );
});
