import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createAppApi } from '@/api/client';

import { fetchPublicEvent } from './api';
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
