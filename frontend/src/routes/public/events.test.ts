import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { Route } from './+types/events';
import { loader } from './events';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** What the route's loader asks of the API, and answers, for an address and its headers. */
async function load(address: string, headers: Record<string, string> = {}) {
  let asked = new URLSearchParams();
  server.use(
    http.get('http://localhost:3000/api/v1/public/events', ({ request }) => {
      asked = new URL(request.url).searchParams;
      return HttpResponse.json({ items: [], total: 0, limit: 20, offset: 0, hasMore: false });
    }),
  );
  const request = new Request(`http://localhost:5173${address}`, { headers });
  const answer = await loader({ request } as unknown as Route.LoaderArgs);
  return { asked, answer, headers: new Headers(answer.init?.headers) };
}

describe('the listing’s route', () => {
  it('asks the API in the language the page negotiated, with the address’s page and category', async () => {
    const { asked, answer } = await load('/events?offset=20&category=jazz', {
      'accept-language': 'ru',
    });
    expect(Object.fromEntries(asked)).toEqual({
      limit: '20',
      offset: '20',
      category: 'jazz',
      locale: 'ru',
    });
    expect(answer.data).toMatchObject({ language: 'ru', query: { offset: 20, category: 'jazz' } });
  });

  it('remembers a language chosen with ?lang=', async () => {
    const { asked, headers } = await load('/events?lang=fr');
    expect(asked.get('locale')).toBe('fr');
    expect(headers.get('Set-Cookie')).toContain('aveline-lang=fr');
  });

  it('asks a browser’s cache to tell the languages apart, as the address doesn’t', async () => {
    const { headers } = await load('/events');
    expect(headers.get('Vary')).toBe('Cookie, Accept-Language');
    expect(headers.get('Cache-Control')).toBe('private, max-age=60');
  });
});
