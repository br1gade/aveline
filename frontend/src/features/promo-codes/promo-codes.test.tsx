import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import { createI18n } from '@/lib/i18n';
import { guardedRoutes, isLeavingAsked } from '@/ui/app-form/guarded-routes';

import { PromoCodesPage } from './components/promo-codes-page';
import { loadPromoCodes, type PromoCodesData } from './load';
import type { PromoCodeWire } from './types';

const current = vi.hoisted(() => ({ session: undefined as BrowserSession | undefined }));
vi.mock('@/api/session', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  browserSession: () => {
    if (!current.session) throw new Error('No session in this test');
    return current.session;
  },
}));

function session(): BrowserSession {
  if (!current.session) throw new Error('No session in this test');
  return current.session;
}

const ORIGIN = 'http://api.test';
const API = `${ORIGIN}/api/v1`;
const NOW = Date.parse('2027-05-01T12:00:00.000Z');
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  current.session = createBrowserSession({
    baseUrl: ORIGIN,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
});
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

function codes(): PromoCodeWire[] {
  return [
    {
      id: 'p1',
      code: 'FRIENDS',
      kind: 'PERCENT',
      value: '100',
      eventId: 'e1',
      event: { id: 'e1', title: 'Gala' },
      maxRedemptions: 10,
      redemptions: 4,
      remaining: 6,
      minOrderMinor: null,
      validFrom: null,
      validUntil: '2027-06-01T20:00:00.000Z',
      isActive: true,
    },
    {
      id: 'p2',
      code: 'SPRING',
      kind: 'FIXED',
      value: '5000',
      eventId: null,
      event: null,
      maxRedemptions: null,
      redemptions: 1,
      remaining: null,
      minOrderMinor: '20000',
      validFrom: null,
      validUntil: null,
      isActive: false,
    },
  ];
}

function serve(read: () => Response = () => HttpResponse.json(codes())) {
  const reads = { codes: 0 };
  server.use(
    http.get(`${API}/promo-codes`, () => {
      reads.codes += 1;
      return read();
    }),
    http.get(`${API}/events`, ({ request }) =>
      HttpResponse.json(
        new URL(request.url).searchParams.get('archived') === 'true'
          ? [
              {
                id: 'e9',
                organizationId: 'o1',
                title: 'Last year',
                startsAt: '2026-06-01T15:00:00.000Z',
                timezone: 'Asia/Tokyo',
              },
            ]
          : [
              {
                id: 'e1',
                organizationId: 'o1',
                title: 'Gala',
                startsAt: '2027-06-01T15:00:00.000Z',
                timezone: 'Europe/Paris',
              },
              {
                id: 'x1',
                organizationId: 'other',
                title: 'A friend’s wedding',
                startsAt: '2027-07-01T15:00:00.000Z',
                timezone: 'Asia/Yerevan',
              },
            ],
      ),
    ),
    http.get(`${API}/me/organizations`, () =>
      HttpResponse.json({
        items: [
          {
            organizationId: 'o1',
            name: 'Petrosyan Events',
            kind: 'AGENCY',
            role: 'OWNER',
            joinedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        nextCursor: null,
      }),
    ),
  );
  return reads;
}

const refused =
  (status: number, message = 'refused', code?: string) =>
  () =>
    HttpResponse.json(
      { statusCode: status, message, requestId: 'req-1', ...(code ? { code } : {}) },
      { status },
    );

function Page() {
  return <PromoCodesPage data={useLoaderData<PromoCodesData>()} />;
}

function renderPage() {
  const Stub = createRoutesStub(
    guardedRoutes([
      { path: '/app/promo-codes', loader: () => loadPromoCodes(session().api), Component: Page },
    ]),
  );
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={['/app/promo-codes']} />
    </I18nextProvider>,
  );
  return userEvent.setup();
}

async function submit(user: ReturnType<typeof userEvent.setup>) {
  const button = await screen.findByRole('button', { name: 'Make the code' });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
}

describe('the codes, as shown', () => {
  it('says what each gives, where, how often, until when in its zone, and its state', async () => {
    serve();
    renderPage();
    expect(await screen.findByText('FRIENDS')).toBeInTheDocument();
    expect(screen.getByText('100% off')).toBeInTheDocument();
    expect(screen.getByText('For Gala')).toBeInTheDocument();
    expect(screen.getByText('Used 4 times of 10 · 6 left')).toBeInTheDocument();
    // 20:00 UTC is 22:00 in Paris, the event's zone.
    expect(screen.getByText(/Until .*1 June 2027, 22:00 \(Europe\/Paris\)/)).toBeInTheDocument();
    expect(screen.getByText('Can be used now')).toBeInTheDocument();
    expect(screen.getByText(/5,000 off/)).toBeInTheDocument();
    expect(screen.getByText('For every event')).toBeInTheDocument();
    expect(screen.getByText(/On orders of .*20,000 or more/)).toBeInTheDocument();
    expect(screen.getByText('Stopped')).toBeInTheDocument();
  });

  it('offers only the organization’s own events, and shows a code on an archived one in its zone', async () => {
    serve(() =>
      HttpResponse.json([
        { ...codes()[0], eventId: 'e9', event: { id: 'e9', title: 'Last year' } },
      ]),
    );
    renderPage();
    // 20:00 UTC is 05:00 the next day in Tokyo, the archived event's zone.
    expect(
      await screen.findByText(/Until .*2 June 2027, 05:00 \(Asia\/Tokyo\)/),
    ).toBeInTheDocument();
    const choices = within(screen.getByLabelText('For which event'))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(choices).toEqual(['Every event', 'Gala']);
  });

  it('says when the events couldn’t be read, offering every event alone', async () => {
    serve();
    server.use(http.get(`${API}/events`, refused(500)));
    renderPage();
    expect(await screen.findByText(/Your events couldn’t be read/)).toBeInTheDocument();
    const choices = within(screen.getByLabelText('For which event'))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(choices).toEqual(['Every event']);
  });

  it('says what the pilot lets through', async () => {
    serve();
    renderPage();
    expect(
      await screen.findByText(/takes a code only when it makes the order free/),
    ).toBeInTheDocument();
  });

  it('tells anyone but the owner who can see them, and keeps the form', async () => {
    serve(refused(403, 'This account may not billing:read', 'FORBIDDEN'));
    renderPage();
    expect(
      await screen.findByText(/Only the organization’s owner can see or change promo codes/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('The code')).toBeInTheDocument();
  });
});

describe('making a code', () => {
  it('asks before the page is left with what was typed, and not once it is saved', async () => {
    serve();
    server.use(
      http.post(`${API}/promo-codes`, () => HttpResponse.json({ id: 'p9' }, { status: 201 })),
    );
    const user = renderPage();
    await user.type(await screen.findByLabelText('The code'), 'comp-guests');
    await user.type(screen.getByLabelText('Percentage off, 1 to 100'), '100');
    await waitFor(() => expect(isLeavingAsked()).toBe(true));
    await submit(user);
    await screen.findByText('COMP-GUESTS is made.');
    expect(isLeavingAsked()).toBe(false);
  });

  it('sends the code with only what was given, times in the event’s zone', async () => {
    const reads = serve();
    const received: unknown[] = [];
    server.use(
      http.post(`${API}/promo-codes`, async ({ request }) => {
        received.push(await request.json());
        return HttpResponse.json({ id: 'p9' }, { status: 201 });
      }),
    );
    const user = renderPage();
    await user.type(await screen.findByLabelText('The code'), 'comp-guests');
    await user.type(screen.getByLabelText('Percentage off, 1 to 100'), '100');
    await user.selectOptions(screen.getByLabelText('For which event'), 'e1');
    await user.type(screen.getByLabelText('How many times it can be used (optional)'), '20');
    const ends = screen.getAllByLabelText('Date');
    fireEvent.change(ends[1] as HTMLElement, { target: { value: '2027-06-01' } });
    fireEvent.change(screen.getAllByLabelText('Time')[1] as HTMLElement, {
      target: { value: '22:00' },
    });
    await submit(user);
    const status = await screen.findByText('COMP-GUESTS is made.');
    await waitFor(() => expect(status).toHaveFocus());
    expect(received).toEqual([
      {
        code: 'comp-guests',
        kind: 'PERCENT',
        value: '100',
        eventId: 'e1',
        maxRedemptions: 20,
        validUntil: '2027-06-01T20:00:00.000Z',
      },
    ]);
    expect(reads.codes).toBe(2);
  });

  it('sends an amount in AMD', async () => {
    serve();
    const received: unknown[] = [];
    server.use(
      http.post(`${API}/promo-codes`, async ({ request }) => {
        received.push(await request.json());
        return HttpResponse.json({ id: 'p9' }, { status: 201 });
      }),
    );
    const user = renderPage();
    await user.type(await screen.findByLabelText('The code'), 'SPRING2');
    await user.click(screen.getByRole('radio', { name: 'An amount off, in AMD' }));
    await user.type(screen.getByLabelText('Amount off, in AMD'), '5000');
    await submit(user);
    await screen.findByText('SPRING2 is made.');
    expect(received).toEqual([{ code: 'SPRING2', kind: 'FIXED', value: '5000' }]);
  });

  it('puts a code already taken on its field', async () => {
    serve();
    server.use(
      http.post(`${API}/promo-codes`, refused(409, 'You already have a code called FRIENDS')),
    );
    const user = renderPage();
    await user.type(await screen.findByLabelText('The code'), 'friends');
    await user.type(screen.getByLabelText('Percentage off, 1 to 100'), '10');
    await submit(user);
    expect(await screen.findByLabelText('The code')).toHaveAccessibleDescription(
      expect.stringContaining('You already have a code called that.'),
    );
  });

  it('words a 403', async () => {
    serve();
    server.use(
      http.post(
        `${API}/promo-codes`,
        refused(403, 'This account may not billing:write', 'FORBIDDEN'),
      ),
    );
    const user = renderPage();
    await user.type(await screen.findByLabelText('The code'), 'friends');
    await user.type(screen.getByLabelText('Percentage off, 1 to 100'), '10');
    await submit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the organization’s owner');
  });
});

describe('a code already made', () => {
  it('stops after asking', async () => {
    serve();
    const stopped: string[] = [];
    server.use(
      http.delete(`${API}/promo-codes/p1`, () => {
        stopped.push('p1');
        return HttpResponse.json({ id: 'p1' });
      }),
    );
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Stop FRIENDS' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(stopped).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Stop' }));
    expect(await screen.findByText('FRIENDS is stopped.')).toBeInTheDocument();
    expect(stopped).toEqual(['p1']);
  });

  it('is used again at once', async () => {
    serve();
    const received: unknown[] = [];
    server.use(
      http.patch(`${API}/promo-codes/p2`, async ({ request }) => {
        received.push(await request.json());
        return HttpResponse.json({ id: 'p2' });
      }),
    );
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Use again: SPRING' }));
    expect(await screen.findByText('SPRING can be used again.')).toBeInTheDocument();
    expect(received).toEqual([{ isActive: true }]);
  });

  it('words a refused “use again”', async () => {
    serve();
    server.use(
      http.patch(
        `${API}/promo-codes/p2`,
        refused(403, 'This account may not billing:write', 'FORBIDDEN'),
      ),
    );
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Use again: SPRING' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the organization’s owner');
  });

  it('corrects the limit only, refusing one below what was used', async () => {
    serve();
    const received: unknown[] = [];
    server.use(
      http.patch(`${API}/promo-codes/p1`, async ({ request }) => {
        received.push(await request.json());
        return HttpResponse.json({ id: 'p1' });
      }),
    );
    const user = renderPage();
    const opener = await screen.findByRole('button', { name: 'Change the limit or end: FRIENDS' });
    await user.click(opener);
    const dialog = await screen.findByRole('dialog');
    const limit = within(dialog).getByLabelText('How many times it can be used (optional)');
    await user.clear(limit);
    await user.type(limit, '3');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      await within(dialog).findByText('It has been used more times than that already.'),
    ).toBeInTheDocument();
    await user.clear(limit);
    await user.type(limit, '30');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('FRIENDS is saved.')).toBeInTheDocument();
    expect(received).toEqual([{ maxRedemptions: 30 }]);
  });

  it('returns the focus to the button when the correction is cancelled', async () => {
    serve();
    const user = renderPage();
    const opener = await screen.findByRole('button', { name: 'Change the limit or end: FRIENDS' });
    await user.click(opener);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
