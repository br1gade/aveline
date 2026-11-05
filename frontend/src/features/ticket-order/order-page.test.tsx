import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLocation } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createI18n } from '@/lib/i18n';
import { APP_PATHS, ROUTE_PATHS } from '@/route-paths';
import TicketLink from '@/routes/public/ticket-link';

import { OrderPage } from './components/order-page';
import { orderWire } from './test-data';
import { forgetOrder, heldOrder, holdOrder } from './token-store';

vi.mock('@/lib/poll', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  waitFor: () => Promise.resolve(),
}));

const ORIGIN = 'http://api.test';
const API = `${ORIGIN}/api/v1`;
/** Made at run time: no committed fixture holds a capability token. */
const TOKEN = `tok-${crypto.randomUUID()}`;

/** The public event this tab came from: only what the order page reads of it. */
const EVENT_WIRE = {
  slug: 'autumn-jazz-night',
  locale: 'en',
  headline: 'Autumn Jazz Night',
  startsAt: '2027-10-02T15:00:00.000Z',
  timezone: 'Asia/Yerevan',
  ticketTypes: [{ id: 'general', name: 'General', priceMinor: '0', currency: 'AMD' }],
  checkout: { acknowledgementsRequiredBeforeCheckIn: [] },
};

const server = setupServer();
const reads = { get: 0, confirm: 0 };

function refusal(status: number, message = 'No') {
  return HttpResponse.json(
    { statusCode: status, message, requestId: `r-${status}` },
    { status, headers: { 'x-request-id': `r-${status}` } },
  );
}

function serveRead(reply: () => Response) {
  server.use(
    http.get(`${API}/ticket-orders/:token`, ({ params }) => {
      reads.get += 1;
      return params.token === TOKEN ? reply() : refusal(404, 'Order not found');
    }),
  );
}

/** Each confirm answers the next of `replies`, then the last again. */
function serveConfirm(...replies: Array<() => Response>) {
  server.use(
    http.post(`${API}/ticket-orders/:token/confirm`, () => {
      const reply = replies[Math.min(reads.confirm, replies.length - 1)];
      reads.confirm += 1;
      return reply ? reply() : refusal(500);
    }),
  );
}

function reserved(payment: Record<string, unknown>) {
  const reservesUntil = new Date(Date.now() + 10 * 60_000 - 1_000).toISOString();
  return () =>
    HttpResponse.json(
      orderWire({
        status: 'RESERVED',
        totalMinor: '15000',
        reservesUntil,
        tickets: [],
        accessToken: TOKEN,
        payment,
      }),
    );
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', ORIGIN);
  vi.stubEnv('VITE_PUBLIC_ORIGIN', 'https://aveline.test');
  reads.get = 0;
  reads.confirm = 0;
  forgetOrder();
  sessionStorage.clear();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderAt(path: string) {
  const Stub = createRoutesStub([
    {
      path: APP_PATHS.ticketOrder,
      Component: () => (
        <>
          <OrderPage />
          <Where />
        </>
      ),
    },
    { path: ROUTE_PATHS.ticketPaymentReturn, Component: () => <OrderPage confirmFirst /> },
    { path: ROUTE_PATHS.ticket, Component: TicketLink },
    { path: ROUTE_PATHS.publicEvent, Component: () => <p>The event page</p> },
  ]);
  const view = render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={[path]} />
    </I18nextProvider>,
  );
  return { ...view, user: userEvent.setup() };
}

describe("the buyer's order (PD-81)", () => {
  it('asks for the emailed link when this tab holds no order', async () => {
    renderAt('/tickets');
    expect(
      await screen.findByRole('heading', { name: 'Open your order from its email' }),
    ).toBeInTheDocument();
    expect(reads.get).toBe(0);
  });

  it('draws a QR code for a ticket that can still be used, naming its holder and never its code', async () => {
    holdOrder({ accessToken: TOKEN, slug: 'autumn-jazz-night' });
    serveRead(() => HttpResponse.json({ ...orderWire(), accessToken: TOKEN }));
    server.use(http.get(`${API}/public/events/:slug`, () => HttpResponse.json(EVENT_WIRE)));
    renderAt('/tickets');
    const tickets = await screen.findByRole('region', { name: 'Tickets' });
    const items = within(tickets).getAllByRole('listitem');
    const drawing = within(items[0]!).getByRole('img', {
      name: 'QR code for Anna Sargsyan’s ticket',
    });
    expect(drawing.tagName.toLowerCase()).toBe('svg');
    expect(drawing.outerHTML).not.toContain('SAMPLE-CODE');
    expect(within(items[0]!).getByText(/brightness/)).toBeVisible();
    expect(within(items[0]!).getByText('SAMPLE-CODE-1')).toBeVisible();
    // Admitted already: nothing left to scan, and it still says so.
    expect(within(items[1]!).queryByRole('img')).not.toBeInTheDocument();
    expect(within(items[1]!).queryByText(/brightness/)).not.toBeInTheDocument();
    expect(within(items[1]!).getByText('Admitted')).toBeVisible();
  });

  it.each(['VOID', 'REFUNDED'])('draws none for a ticket that is %s', async (status) => {
    holdOrder({ accessToken: TOKEN, slug: 'autumn-jazz-night' });
    const wire = orderWire() as { tickets: Array<Record<string, unknown>> };
    serveRead(() =>
      HttpResponse.json({
        ...wire,
        accessToken: TOKEN,
        tickets: wire.tickets.map((ticket) => ({ ...ticket, status })),
      }),
    );
    server.use(http.get(`${API}/public/events/:slug`, () => HttpResponse.json(EVENT_WIRE)));
    renderAt('/tickets');
    const tickets = await screen.findByRole('region', { name: 'Tickets' });
    expect(within(tickets).queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows each person with their ticket, code and state, and the event this tab came from', async () => {
    holdOrder({ accessToken: TOKEN, slug: 'autumn-jazz-night' });
    serveRead(() => HttpResponse.json({ ...orderWire(), accessToken: TOKEN }));
    server.use(http.get(`${API}/public/events/:slug`, () => HttpResponse.json(EVENT_WIRE)));
    renderAt('/tickets');
    expect(
      await screen.findByRole('heading', { name: 'Your tickets', level: 1 }),
    ).toBeInTheDocument();
    const tickets = await screen.findByRole('region', { name: 'Tickets' });
    const items = within(tickets).getAllByRole('listitem');
    expect(within(items[0]!).getByText('Anna Sargsyan')).toBeInTheDocument();
    expect(within(items[0]!).getByText('SAMPLE-CODE-1')).toBeInTheDocument();
    expect(within(items[0]!).getByText('Valid')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Admitted')).toBeInTheDocument();
    expect(
      await screen.findByText(/Autumn Jazz Night · Saturday, 2 October 2027, 19:00 · Yerevan time/),
    ).toBeInTheDocument();
    expect(within(items[0]!).getByText('General')).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it('says so when the link opens no order', async () => {
    holdOrder({ accessToken: `tok-${crypto.randomUUID()}` });
    serveRead(() => refusal(500));
    renderAt('/tickets');
    expect(
      await screen.findByRole('heading', { name: 'This order can’t be found' }),
    ).toBeInTheDocument();
  });

  it('offers to try again, with a reference, when the order cannot be read', async () => {
    holdOrder({ accessToken: TOKEN });
    serveRead(() => refusal(500));
    renderAt('/tickets');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Reference: r-500');
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('takes the emailed link’s token out of the address, and opens the order from this tab', async () => {
    serveRead(() => HttpResponse.json({ ...orderWire(), accessToken: TOKEN }));
    renderAt(`/tickets/${TOKEN}`);
    expect(
      await screen.findByRole('heading', { name: 'Your tickets', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/tickets$/);
    expect(heldOrder()).toEqual({ accessToken: TOKEN });
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });
});

describe("the bank's return (PD-82)", () => {
  it('confirms first, asks again while the bank is silent, and shows the hold and the way to pay', async () => {
    holdOrder({ accessToken: TOKEN });
    serveConfirm(
      reserved({
        status: 'PENDING',
        redirectUrl: 'https://bank.test/pay?id=1',
        orderNumber: 'AVL-1',
      }),
    );
    renderAt('/tickets/return');
    expect(
      await screen.findByRole('heading', { name: 'Waiting for your bank' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(reads.confirm).toBe(4));
    expect(screen.getByText('Held for 10 more minutes')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the payment page' })).toHaveAttribute(
      'href',
      'https://bank.test/pay?id=1',
    );
    expect(document.body.innerHTML).not.toContain('AVL-1');
    expect(reads.get).toBe(0);
  });

  it('issues the tickets once the bank says the money moved', async () => {
    holdOrder({ accessToken: TOKEN });
    serveConfirm(
      reserved({ status: 'PENDING', redirectUrl: null }),
      reserved({ status: 'PENDING', redirectUrl: null }),
      reserved({ status: 'PENDING', redirectUrl: null }),
      reserved({ status: 'PENDING', redirectUrl: null }),
      () => HttpResponse.json({ ...orderWire(), accessToken: TOKEN }),
    );
    const { user } = renderAt('/tickets/return');
    await user.click(await screen.findByRole('button', { name: 'Check with the bank' }));
    expect(
      await screen.findByRole('heading', { name: 'Your tickets', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText('SAMPLE-CODE-1')).toBeInTheDocument();
  });

  it('says the payment did not go through, and offers to choose again from the event', async () => {
    holdOrder({ accessToken: TOKEN, slug: 'autumn-jazz-night' });
    serveConfirm(reserved({ status: 'FAILED', redirectUrl: null }));
    server.use(http.get(`${API}/public/events/:slug`, () => HttpResponse.json(EVENT_WIRE)));
    renderAt('/tickets/return');
    expect(
      await screen.findByRole('heading', { name: 'The payment didn’t go through' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choose tickets again' })).toHaveAttribute(
      'href',
      '/events/autumn-jazz-night',
    );
    expect(reads.confirm).toBe(1);
  });

  it('reads an order confirm has nothing to ask about, rather than failing', async () => {
    holdOrder({ accessToken: TOKEN });
    serveConfirm(() => refusal(400, 'Order is cancelled'));
    serveRead(() => HttpResponse.json(orderWire({ status: 'CANCELLED', accessToken: TOKEN })));
    renderAt('/tickets/return');
    expect(
      await screen.findByRole('heading', { name: 'This order was cancelled' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(reads.get).toBe(1);
  });

  it('offers no new payment when the bank and our record disagree', async () => {
    holdOrder({ accessToken: TOKEN, slug: 'autumn-jazz-night' });
    serveConfirm(() => refusal(409, 'Cannot move a payment from EXPIRED to PAID'));
    server.use(http.get(`${API}/public/events/:slug`, () => HttpResponse.json(EVENT_WIRE)));
    renderAt('/tickets/return');
    expect(await screen.findByRole('alert')).toHaveTextContent('Reference: r-409');
    expect(screen.queryByRole('link', { name: 'Choose tickets again' })).not.toBeInTheDocument();
    expect(reads.get).toBe(0);
  });

  it('explains a hold that ended, and what happens to money taken late', async () => {
    holdOrder({ accessToken: TOKEN });
    serveConfirm(() =>
      HttpResponse.json(orderWire({ status: 'EXPIRED', tickets: [], accessToken: TOKEN })),
    );
    renderAt('/tickets/return');
    expect(await screen.findByRole('heading', { name: 'Your hold has ended' })).toBeInTheDocument();
    expect(screen.getByText(/the money is returned in full/)).toBeInTheDocument();
  });
});
