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
const ADDRESS =
  'http://app.test/billing/return?orderId=secret&invoice=AV-2026-000001&organization=a';
const load = () =>
  clientLoader({ request: new Request(ADDRESS) } as unknown as Parameters<typeof clientLoader>[0]);

/** Whether a plan can be paid for now, and at which bank (FR-109). */
function payments(isPaymentAvailable: boolean) {
  server.use(
    http.get(`${API}/payment-options`, () =>
      HttpResponse.json({
        isPaymentAvailable,
        providers: isPaymentAvailable ? ['AMERIABANK'] : [],
      }),
    ),
  );
}

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
    expect(await redirectOf(load())).toBe(
      '/sign-in?next=%2Fbilling%2Freturn%3Finvoice%3DAV-2026-000001%26organization%3Da',
    );
  });

  it('confirms the exact returned invoice with an explicit organization', async () => {
    signedIn();
    memberOf('a');
    payments(true);
    const confirmed: string[] = [];
    const newest = { number: 'AV-2026-000001', status: 'ISSUED' };
    server.use(
      http.get(`${API}/invoices/page`, () =>
        HttpResponse.json({ items: [newest], nextCursor: null }),
      ),
      http.post(`${API}/invoices/:number/confirm`, ({ params, request }) => {
        expect(request.headers.get('x-aveline-organization-id')).toBe('a');
        confirmed.push(String(params.number));
        return HttpResponse.json({ ...newest, status: 'PAID' });
      }),
    );
    await expect(load()).resolves.toMatchObject({
      provider: 'AMERIABANK',
      read: { kind: 'confirmed', invoice: { status: 'PAID' } },
    });
    expect(confirmed).toEqual(['AV-2026-000001']);
  });

  it('says there is nothing to confirm when there is no invoice', async () => {
    signedIn();
    memberOf('a');
    payments(true);
    server.use(
      http.get(`${API}/invoices/page`, () => HttpResponse.json({ items: [], nextCursor: null })),
    );
    await expect(
      clientLoader({
        request: new Request('http://app.test/billing/return?orderId=secret'),
      } as unknown as Parameters<typeof clientLoader>[0]),
    ).resolves.toMatchObject({ read: { kind: 'nothing' } });
  });

  it('keeps a confirmed payment when the payment options can’t be read', async () => {
    signedIn();
    memberOf('a');
    server.use(
      http.get(`${API}/payment-options`, () => HttpResponse.json({}, { status: 503 })),
      http.get(`${API}/invoices/page`, () =>
        HttpResponse.json({ items: [{ number: 'AV-1', status: 'ISSUED' }], nextCursor: null }),
      ),
      http.post(`${API}/invoices/:number/confirm`, () =>
        HttpResponse.json({ number: 'AV-1', status: 'PAID' }),
      ),
    );
    const loaded = await load();
    expect(loaded).toMatchObject({ read: { kind: 'confirmed', invoice: { status: 'PAID' } } });
    expect(loaded.provider).toBeUndefined();
  });

  it('names no bank to pay again at while payments are off', async () => {
    signedIn();
    memberOf('a');
    payments(false);
    server.use(
      http.get(`${API}/invoices/page`, () => HttpResponse.json({ items: [], nextCursor: null })),
    );
    server.use(
      http.post(`${API}/invoices/:number/confirm`, () =>
        HttpResponse.json({ number: 'AV-2026-000001', status: 'PAID' }),
      ),
    );
    const loaded = await load();
    expect(loaded).toMatchObject({ read: { kind: 'confirmed' } });
    expect(loaded.provider).toBeUndefined();
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
    expect(shouldRevalidate(change('?lang=hy'))).toBe(true);
    expect(
      shouldRevalidate(
        change('?invoice=AV-2026-000002&organization=a', '?invoice=AV-2026-000001&organization=a'),
      ),
    ).toBe(true);
  });
});
