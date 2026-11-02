import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import { createI18n } from '@/lib/i18n';
import { APP_PATHS } from '@/route-paths';

import { OrdersPage } from './components/orders-page';
import { loadOrders, type OrdersData } from './load';
import { LEGACY_TICKET, orderDetailWire, orderRowWire } from './test-data';

const current = vi.hoisted(() => ({ session: undefined as BrowserSession | undefined }));
vi.mock('@/api/session', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  browserSession: () => {
    if (!current.session) throw new Error('No session in this test');
    return current.session;
  },
}));

const ORIGIN = 'http://api.test';
const API = `${ORIGIN}/api/v1`;
/** Made at run time: whatever an answer carries beyond its fields must go nowhere. */
const TOKEN = `tok-${crypto.randomUUID()}`;

const EVENT = {
  id: 'e1',
  title: 'Autumn Jazz Night',
  type: 'CONCERT',
  hostsLabel: 'The Garden',
  startsAt: '2027-10-02T15:00:00.000Z',
  endsAt: null,
  timezone: 'Asia/Yerevan',
  locales: ['en'],
  defaultLocale: 'en',
  visibility: 'PUBLIC',
  invitation: null,
  venues: [],
};
const TYPES = [
  {
    id: 'general',
    name: { en: 'General' },
    description: {},
    priceMinor: '15000',
    currency: 'AMD',
    quantityTotal: 200,
    sold: 3,
    held: 0,
    available: 197,
    minPerOrder: 1,
    maxPerOrder: 10,
    salesStartAt: null,
    salesEndAt: null,
    isActive: true,
  },
];

function guestWire(id: string, name: string, extra: Record<string, unknown> = {}) {
  const [firstName, lastName = null] = name.split(' ');
  return {
    id,
    firstName,
    lastName,
    name,
    locale: null,
    attribution: null,
    isPrimary: true,
    addedByGuest: false,
    isAnonymized: false,
    rsvpStatus: 'ATTENDING',
    table: null,
    isCheckedIn: false,
    email: null,
    phone: null,
    token: TOKEN,
    ...extra,
  };
}
const HOUSEHOLDS = [
  {
    id: 'h1',
    name: 'Anna Sargsyan',
    seatsAllotted: 1,
    seatsNamed: 1,
    guests: [guestWire('g-anna', 'Anna Sargsyan')],
  },
  {
    id: 'h2',
    name: 'Petrosyan family',
    seatsAllotted: 2,
    seatsNamed: 2,
    guests: [
      guestWire('g-lusine', 'Lusine Petrosyan'),
      guestWire('g-old', 'Removed', { isAnonymized: true }),
    ],
  },
];

const server = setupServer();
const sent: Array<{ method: string; path: string; query: string; body: unknown }> = [];

function refusal(status: number, message: string) {
  return HttpResponse.json(
    { statusCode: status, message, requestId: `r-${status}` },
    { status, headers: { 'x-request-id': `r-${status}` } },
  );
}

function record(reply: () => Response) {
  return async ({ request }: { request: Request }) => {
    const text = request.method === 'GET' ? '' : await request.text();
    const url = new URL(request.url);
    sent.push({
      method: request.method,
      path: url.pathname,
      query: url.search,
      body: text ? (JSON.parse(text) as unknown) : null,
    });
    return reply();
  };
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  sent.length = 0;
  current.session = createBrowserSession({
    baseUrl: ORIGIN,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
  server.use(
    http.get(`${API}/events/e1`, () => HttpResponse.json(EVENT)),
    http.get(`${API}/events/e1/ticket-types`, () => HttpResponse.json(TYPES)),
    http.get(
      `${API}/events/e1/ticket-orders`,
      record(() =>
        HttpResponse.json([
          orderRowWire({ accessToken: TOKEN }),
          orderRowWire({ orderId: 'o2', buyerName: 'Karen', totalMinor: '0', tickets: 1 }),
        ]),
      ),
    ),
    http.get(`${API}/events/e1/ticket-orders/o1`, () =>
      HttpResponse.json(
        orderDetailWire({ tickets: [...(orderDetailWire().tickets as unknown[]), LEGACY_TICKET] }),
      ),
    ),
    http.get(`${API}/events/e1/guests`, () => HttpResponse.json(HOUSEHOLDS)),
  );
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderAt(path: string) {
  const Stub = createRoutesStub([
    {
      path: APP_PATHS.orders,
      loader: ({ params, request }) => {
        if (!current.session) throw new Error('No session');
        return loadOrders(
          current.session.api,
          params.eventId ?? '',
          new URL(request.url).searchParams,
        );
      },
      Component: () => <OrdersPage data={useLoaderData<OrdersData>()} />,
    },
    { path: APP_PATHS.event, Component: () => <p>Event page</p> },
    { path: APP_PATHS.ticketSales, Component: () => <p>Sales page</p> },
  ]);
  const view = render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={[path]} />
    </I18nextProvider>,
  );
  return { ...view, user: userEvent.setup() };
}

describe('the orders page (PD-87)', () => {
  it('lists orders newest first, the tab in the address', async () => {
    const { user } = renderAt('/app/events/e1/orders');
    expect(await screen.findByRole('heading', { name: 'Ani Grigoryan' })).toBeInTheDocument();
    expect(screen.getByText('Paid · 2 tickets · AMD 30,000')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Refunded' }));
    await waitFor(() => expect(sent.at(-1)?.query).toBe('?status=REFUNDED'));
    expect(screen.getByRole('link', { name: 'Refunded' })).toHaveAttribute('aria-current', 'page');
  });

  it('says the buyers’ addresses are hidden from a role without contact access', async () => {
    server.use(
      http.get(`${API}/events/e1/ticket-orders`, () =>
        HttpResponse.json([orderRowWire({ buyerEmail: undefined })]),
      ),
    );
    renderAt('/app/events/e1/orders');
    expect(
      await screen.findByText('Buyers’ email addresses aren’t shown to your role.'),
    ).toBeInTheDocument();
  });

  it('opens an order in place: each person, their ticket, its code and the guest it is linked to', async () => {
    renderAt('/app/events/e1/orders?order=o1');
    const anna = await screen.findByText('Anna Sargsyan', { selector: 'p' });
    const item = anna.closest('li');
    expect(item).not.toBeNull();
    expect(within(item!).getByText('General · Coming')).toBeInTheDocument();
    expect(within(item!).getByText('Valid · code SAMPLE-1')).toBeInTheDocument();
    expect(within(item!).getByText('On the guest list: Anna Sargsyan')).toBeInTheDocument();
    expect(screen.getByText('Bought by Ani Grigoryan, nobody named')).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it('lists a ticket whose person the roster read does not hold, rather than dropping it', async () => {
    server.use(
      http.get(`${API}/events/e1/ticket-orders/o1`, () =>
        HttpResponse.json(
          orderDetailWire({
            tickets: [{ ...LEGACY_TICKET, attendeeId: 'a-unknown', guestId: 'g-anna' }],
          }),
        ),
      ),
    );
    renderAt('/app/events/e1/orders?order=o1');
    expect(await screen.findByText('Bought by Ani Grigoryan, nobody named')).toBeInTheDocument();
    expect(screen.getByText('Valid · code SAMPLE-9')).toBeInTheDocument();
  });
});

describe('cancelling (PD-88)', () => {
  it('asks first, says what happens, and reports the refund', async () => {
    server.use(
      http.post(
        `${API}/events/e1/ticket-orders/o1/cancel`,
        record(() =>
          HttpResponse.json({
            orderId: 'o1',
            status: 'REFUNDED',
            refundedMinor: '30000',
            currency: 'AMD',
            tickets: [],
          }),
        ),
      ),
    );
    const { user } = renderAt('/app/events/e1/orders?order=o1');
    await user.click(await screen.findByRole('button', { name: 'Cancel and refund' }));
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Cancel and refund Ani Grigoryan’s order?',
    });
    expect(within(dialog).getByText('voids its 2 tickets')).toBeInTheDocument();
    expect(within(dialog).getByText('returns AMD 30,000 to the buyer’s card')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel and refund' }));
    // The status line is always there, empty until the reloaded page is on screen.
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Ani Grigoryan’s order is cancelled and AMD 30,000 refunded.',
      ),
    );
  });

  it('words a refusal for someone already let in', async () => {
    server.use(
      http.post(`${API}/events/e1/ticket-orders/o1/cancel`, () =>
        refusal(
          409,
          '1 ticket(s) on this order were already admitted at the door, so it cannot be cancelled',
        ),
      ),
    );
    const { user } = renderAt('/app/events/e1/orders?order=o1');
    await user.click(await screen.findByRole('button', { name: 'Cancel and refund' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel and refund' }));
    expect(await within(dialog).findByText(/was already let in/)).toBeInTheDocument();
  });
});

describe('reconciling (PD-89)', () => {
  it('links a ticket to an invited guest, expecting the guest it has now', async () => {
    server.use(
      http.post(
        `${API}/events/e1/tickets/t1/link-guest`,
        record(() => HttpResponse.json({ ticketId: 't1', guestId: 'g-lusine' })),
      ),
    );
    const { user } = renderAt('/app/events/e1/orders?order=o1');
    await user.click(await screen.findByRole('button', { name: 'Link to a guest: Anna Sargsyan' }));
    const dialog = await screen.findByRole('dialog');
    const options = within(dialog)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual(['Choose…', 'Lusine Petrosyan (Petrosyan family)']);
    await user.selectOptions(within(dialog).getByLabelText('Guest'), 'g-lusine');
    await user.click(within(dialog).getByRole('button', { name: 'Link' }));
    await waitFor(() =>
      expect(sent.filter((each) => each.method === 'POST')).toEqual([
        {
          method: 'POST',
          path: '/api/v1/events/e1/tickets/t1/link-guest',
          query: '',
          body: { guestId: 'g-lusine', expectedGuestId: 'g-anna', keepExistingAnswers: true },
        },
      ]),
    );
  });

  it('words a link the backend refuses', async () => {
    server.use(
      http.post(`${API}/events/e1/tickets/t9/link-guest`, () =>
        refusal(409, 'Guest already has a ticket'),
      ),
    );
    const { user } = renderAt('/app/events/e1/orders?order=o1');
    await user.click(await screen.findByRole('button', { name: 'Link to a guest: Ani Grigoryan' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Guest'), 'g-lusine');
    await user.click(within(dialog).getByRole('button', { name: 'Link' }));
    expect(
      await within(dialog).findByText('That guest already holds a ticket.'),
    ).toBeInTheDocument();
  });

  it('asks for the announcement to be published before registering who holds a legacy ticket', async () => {
    server.use(
      http.get(`${API}/events/e1/listing`, () =>
        HttpResponse.json({ slug: 'autumn-jazz-night', headline: { en: 'x' }, publishedAt: null }),
      ),
    );
    const { user } = renderAt('/app/events/e1/orders?order=o1');
    await user.click(
      await screen.findByRole('button', { name: 'Register who holds it: Ani Grigoryan' }),
    );
    expect(await screen.findByText(/Publish the announcement first/)).toBeInTheDocument();
  });

  it('registers who holds a legacy ticket with checkout’s own fields and rules', async () => {
    server.use(
      http.get(`${API}/events/e1/listing`, () =>
        HttpResponse.json({
          slug: 'autumn-jazz-night',
          headline: { en: 'x' },
          publishedAt: '2026-10-20T10:00:00.000Z',
        }),
      ),
      http.get(`${API}/public/events/autumn-jazz-night`, () =>
        HttpResponse.json({
          slug: 'autumn-jazz-night',
          locale: 'en',
          availableLocales: ['en'],
          startsAt: '2027-10-02T15:00:00.000Z',
          timezone: 'Asia/Yerevan',
          venues: [],
          ticketTypes: [],
          checkout: {
            attendanceMode: 'EVENT_WIDE',
            attendanceRevision: 2,
            venues: [],
            rsvpFields: {
              dietary: { isEnabled: false, options: null },
              drinkPreference: { isEnabled: false, options: null },
            },
            acknowledgementsRequiredBeforeCheckIn: [],
            questions: [],
          },
          metadata: { canonicalPath: '/events/autumn-jazz-night', robots: 'noindex,nofollow' },
        }),
      ),
      http.post(
        `${API}/events/e1/tickets/t9/attendee`,
        record(() =>
          HttpResponse.json({ ticketId: 't9', attendeeId: 'a9', guestId: 'g9' }, { status: 201 }),
        ),
      ),
    );
    const { user } = renderAt('/app/events/e1/orders?order=o1');
    await user.click(
      await screen.findByRole('button', { name: 'Register who holds it: Ani Grigoryan' }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.type(await within(dialog).findByLabelText('First name'), 'Ani');
    await user.click(within(dialog).getByRole('button', { name: 'Register' }));
    await waitFor(() =>
      expect(sent.filter((each) => each.method === 'POST')).toEqual([
        {
          method: 'POST',
          path: '/api/v1/events/e1/tickets/t9/attendee',
          query: '',
          body: { attendee: { ticketTypeId: 'general', firstName: 'Ani' }, attendanceRevision: 2 },
        },
      ]),
    );
  });
});
