import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createAppApi } from '@/api/client';

import { fetchInvitation } from './api';

const ORIGIN = 'http://api.test';
/** Made at run time: no committed fixture holds a capability token. */
const TOKEN = `tok-${crypto.randomUUID()}`;

const server = setupServer();
const api = createAppApi(ORIGIN, {});

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('fetchInvitation', () => {
  // A personal page names private artwork by its id, never by an address holding the token (FR-115).
  it('asks for a language only when the page names one, and for artwork by id on a guest’s', async () => {
    const asked: string[] = [];
    const record = ({ request }: { request: Request }) => {
      asked.push(new URL(request.url).search);
      return HttpResponse.json({});
    };
    server.use(
      http.get(`${ORIGIN}/api/v1/invitations/wedding`, record),
      http.get(`${ORIGIN}/api/v1/invitations/wedding/g/${TOKEN}`, record),
    );
    await fetchInvitation(api, { slug: 'wedding' });
    await fetchInvitation(api, { slug: 'wedding', locale: 'hy' });
    await fetchInvitation(api, { slug: 'wedding', guestToken: TOKEN });
    await fetchInvitation(api, { slug: 'wedding', guestToken: TOKEN, locale: 'hy' });
    expect(asked).toEqual(['', '?locale=hy', '?artwork=asset-id', '?locale=hy&artwork=asset-id']);
  });
});
