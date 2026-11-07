// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UNSAFE_ErrorResponseImpl as ErrorResponseImpl } from 'react-router';

import { plantedToken } from '../test/tokens';

import handleRequest, { handleDataRequest, handleError } from './entry.server';

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
    '/billing/return.data',
    '/billing/return/',
    '/BILLING/return?orderId=AVL-1',
    '/Briefs',
    `/TICKETS/${token}`,
    '/billing/return.data?orderId=AVL-1',
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

describe("the server's error log", () => {
  afterEach(() => vi.restoreAllMocks());

  const token = plantedToken();
  const args = (signal: AbortSignal) =>
    ({ request: new Request('http://app.test/', { signal }) }) as Parameters<typeof handleError>[1];

  it('redacts a capability path an error quotes, where the default would print it whole', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    handleError(
      new Error(`failed on /invitations/a/g/${token}`),
      args(new AbortController().signal),
    );
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0]?.[0])).toContain('/invitations/a/g/[token]');
    expect(String(log.mock.calls[0]?.[0])).not.toContain(token);
  });

  it('reads a route error’s own error, not "[object Object]"', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    handleError(
      new ErrorResponseImpl(405, 'Method Not Allowed', new Error(`bad /tickets/${token}`)),
      args(new AbortController().signal),
    );
    const said = String(log.mock.calls[0]?.[0]);
    expect(said).toContain('/tickets/[token]');
    expect(said).not.toContain('[object Object]');
  });

  it('says nothing of a request the browser gave up on', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    handleError(new Error('gone'), args(AbortSignal.abort()));
    expect(log).not.toHaveBeenCalled();
  });
});

describe('framing (design PD-153)', () => {
  async function documentHeaders(path: string): Promise<Headers> {
    const headers = new Headers();
    const context = { staticHandlerContext: { loaderData: {} } };
    await handleRequest(
      new Request(`http://app.test${path}`, { method: 'HEAD' }),
      200,
      headers,
      context as unknown as Parameters<typeof handleRequest>[3],
      undefined as unknown as Parameters<typeof handleRequest>[4],
    );
    return headers;
  }

  it.each(['/app/events/e1/design/draft-preview', '/APP/events/e1/design/draft-preview/'])(
    'lets the designer’s draft preview, %s, be framed by the app itself',
    async (path) => {
      expect((await documentHeaders(path)).get('X-Frame-Options')).toBe('SAMEORIGIN');
    },
  );

  it.each(['/app/events/e1/design/preview', '/app/events/e1/design', '/events', '/'])(
    'lets nobody frame %s',
    async (path) => {
      expect((await documentHeaders(path)).get('X-Frame-Options')).toBe('DENY');
    },
  );
});

describe('the camera, by the page first loaded (Permissions-Policy)', () => {
  const token = plantedToken();
  const cameraOf = async (path: string) => {
    const headers = new Headers();
    const context = { staticHandlerContext: { loaderData: {} } };
    await handleRequest(
      new Request(`http://app.test${path}`, { method: 'HEAD' }),
      200,
      headers,
      context as unknown as Parameters<typeof handleRequest>[3],
      undefined as unknown as Parameters<typeof handleRequest>[4],
    );
    return /camera=\([^)]*\)/.exec(headers.get('Permissions-Policy') ?? '')?.[0];
  };

  it.each([`/invitations/autumn/g/${token}`, `/briefs/${token}`, '/tickets', '/Tickets/'])(
    'closes it on %s, which shows what a capability opened',
    async (path) => {
      expect(await cameraOf(path)).toBe('camera=()');
    },
  );

  // The policy is the document's: a page that goes on into the app keeps it open for the door.
  it.each(['/app/events/e1/door', '/', '/sign-in', '/billing/return', '/BILLING/return/'])(
    'leaves it to this origin on %s',
    async (path) => {
      expect(await cameraOf(path)).toBe('camera=(self)');
    },
  );
});
