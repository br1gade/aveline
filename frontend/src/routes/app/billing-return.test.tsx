import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import { forgetSettledOrganization } from '@/features/account';

import { clientLoader, shouldRevalidate } from './billing-return';

const current = vi.hoisted(() => ({ session: undefined as BrowserSession | undefined }));
vi.mock('@/api/session', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  browserSession: () => current.session,
}));

const ORIGIN = 'http://api.test';
const API = `${ORIGIN}/api/v1`;
const server = setupServer();
const ADDRESS = 'http://app.test/billing/return?orderId=secret&lang=hy';
const load = () =>
  clientLoader({
    request: new Request(ADDRESS),
    serverLoader: () => Promise.resolve({ provider: 'FAKE' }),
  } as unknown as Parameters<typeof clientLoader>[0]);

async function redirectOf(run: Promise<unknown>): Promise<string | null> {
  const thrown = await run.then(
    () => null,
    (error: unknown) => error,
  );
  return thrown instanceof Response ? thrown.headers.get('Location') : null;
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  forgetSettledOrganization();
  current.session = createBrowserSession({
    baseUrl: ORIGIN,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function signedIn() {
  vi.spyOn(current.session as BrowserSession, 'ensureSignedIn').mockResolvedValue(true);
}

function memberOf(...names: string[]) {
  server.use(
    http.get(`${API}/me/organizations`, () =>
      HttpResponse.json({
        items: names.map((name) => ({ organizationId: name, name, role: 'OWNER' })),
        nextCursor: null,
      }),
    ),
  );
}

describe('coming back from the bank', () => {
  it('sends someone signed out to sign in, without the bank’s query', async () => {
    vi.spyOn(current.session as BrowserSession, 'ensureSignedIn').mockResolvedValue(false);
    expect(await redirectOf(load())).toBe('/sign-in?next=%2Fbilling%2Freturn');
  });

  it('sends someone yet to choose an organization to do so, without the query', async () => {
    signedIn();
    memberOf('a', 'b');
    expect(await redirectOf(load())).toBe('/app/organizations?next=%2Fbilling%2Freturn');
  });

  it('confirms the newest invoice and carries the bank to pay again at', async () => {
    signedIn();
    memberOf('a');
    const confirmed: string[] = [];
    const newest = { number: 'AV-2026-000001', status: 'ISSUED' };
    server.use(
      http.get(`${API}/invoices`, () => HttpResponse.json([newest])),
      http.post(`${API}/invoices/:number/confirm`, ({ params }) => {
        confirmed.push(String(params.number));
        return HttpResponse.json({ ...newest, status: 'PAID' });
      }),
    );
    await expect(load()).resolves.toMatchObject({
      provider: 'FAKE',
      read: { kind: 'confirmed', invoice: { status: 'PAID' } },
    });
    expect(confirmed).toEqual(['AV-2026-000001']);
  });

  it('says there is nothing to confirm when there is no invoice', async () => {
    signedIn();
    memberOf('a');
    server.use(http.get(`${API}/invoices`, () => HttpResponse.json([])));
    await expect(load()).resolves.toMatchObject({ read: { kind: 'nothing' } });
  });
});

describe('taking the query out of the address', () => {
  const change = (nextSearch: string, currentSearch = '?orderId=x') =>
    ({
      currentUrl: new URL(`http://app.test/billing/return${currentSearch}`),
      nextUrl: new URL(`http://app.test/billing/return${nextSearch}`),
      defaultShouldRevalidate: true,
    }) as Parameters<typeof shouldRevalidate>[0];

  it('confirms no second time', () => {
    expect(shouldRevalidate(change(''))).toBe(false);
    expect(shouldRevalidate(change('?lang=hy'))).toBe(false);
  });
});
