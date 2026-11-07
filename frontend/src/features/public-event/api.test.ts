import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createAppApi } from '@/api/client';

import { fetchPublicEvent, fetchPublicListing } from './api';
import { publicEventWire } from './test-data';

const ORIGIN = 'http://api.test';

const server = setupServer();
const api = createAppApi(ORIGIN, {});

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('fetchPublicEvent', () => {
  it('asks for a language only when the page names one', async () => {
    const asked: string[] = [];
    server.use(
      http.get(`${ORIGIN}/api/v1/public/events/jazz`, ({ request }) => {
        asked.push(new URL(request.url).search);
        return HttpResponse.json(publicEventWire());
      }),
    );
    await fetchPublicEvent(api, { slug: 'jazz' });
    await fetchPublicEvent(api, { slug: 'jazz', locale: 'hy' });
    expect(asked).toEqual(['', '?locale=hy']);
  });
});

describe('fetchPublicListing', () => {
  async function asked(query: Parameters<typeof fetchPublicListing>[1]) {
    let params = new URLSearchParams();
    server.use(
      http.get(`${ORIGIN}/api/v1/public/events`, ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json({ items: [], total: 0, limit: 20, offset: 0, hasMore: false });
      }),
    );
    await fetchPublicListing(api, query);
    return Object.fromEntries(params);
  }

  it('asks for the page, the language and the category', async () => {
    expect(await asked({ offset: 40, category: 'open air', locale: 'hy' })).toEqual({
      limit: '20',
      offset: '40',
      locale: 'hy',
      category: 'open air',
    });
  });

  it('asks for no category when none is chosen', async () => {
    expect(await asked({ offset: 0, locale: 'en' })).toEqual({
      limit: '20',
      offset: '0',
      locale: 'en',
    });
  });
});
