import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLocation } from 'react-router';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest';

import { displayDate } from '@/features/invitation-renderer';
import { createI18n } from '@/lib/i18n';
import { formatMinor } from '@/lib/money';
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

const server = setupServer();
const reads = { get: 0, confirm: 0, listing: 0 };

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

function reserved(payment: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
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
        ...overrides,
      }),
    );
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', ORIGIN);
  vi.stubEnv('VITE_PUBLIC_ORIGIN', 'https://aveline.test');
  reads.get = 0;
  reads.confirm = 0;
  reads.listing = 0;
  server.use(
    http.get(`${API}/public/events/:slug`, () => {
      reads.listing += 1;
      return HttpResponse.json({});
    }),
  );
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
    holdOrder({ accessToken: TOKEN });
    serveRead(() => HttpResponse.json({ ...orderWire(), accessToken: TOKEN }));
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
    holdOrder({ accessToken: TOKEN });
    const wire = orderWire() as { tickets: Array<Record<string, unknown>> };
    serveRead(() =>
      HttpResponse.json({
        ...wire,
        accessToken: TOKEN,
        tickets: wire.tickets.map((ticket) => ({ ...ticket, status })),
      }),
    );
    renderAt('/tickets');
    const tickets = await screen.findByRole('region', { name: 'Tickets' });
    expect(within(tickets).queryByRole('img')).not.toBeInTheDocument();
  });

  it('says where each ticket sits: a numbered seat, or a zone by its name (PD-186)', async () => {
    holdOrder({ accessToken: TOKEN });
    const wire = orderWire() as { attendees: Array<Record<string, unknown>> };
    const [davit, anna] = wire.attendees;
    serveRead(() =>
      HttpResponse.json({
        ...wire,
        accessToken: TOKEN,
        attendees: [
          { ...davit, selection: { sectionName: 'Floor', row: null, seat: null } },
          { ...anna, selection: { sectionName: 'Balcony', row: 'A', seat: '3' } },
        ],
      }),
    );
    renderAt('/tickets');
    const tickets = await screen.findByRole('region', { name: 'Tickets' });
    expect(within(tickets).getByText('Balcony · Row A, seat 3')).toBeVisible();
    expect(within(tickets).getByText('Floor')).toBeVisible();
  });

  it('shows each person with their ticket, code and state, and the event', async () => {
    holdOrder({ accessToken: TOKEN });
    serveRead(() => HttpResponse.json({ ...orderWire(), accessToken: TOKEN }));
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

describe('what the order says for itself (FR-62)', () => {
  const EVENT = orderWire().event as Record<string, unknown>;
  const EVENT_LINE = /Autumn Jazz Night · Saturday, 2 October 2027, 19:00 · Yerevan time/;

  function serveOrder(overrides: Record<string, unknown> = {}) {
    serveRead(() => HttpResponse.json(orderWire({ accessToken: TOKEN, ...overrides })));
  }

  async function renderHeld() {
    holdOrder({ accessToken: TOKEN });
    renderAt('/tickets');
    return screen.findByRole('heading', { level: 1 });
  }

  it('names the event, the ticket types and the buyer from an emailed link in a fresh tab, reading no listing', async () => {
    serveOrder();
    renderAt(`/tickets/${TOKEN}`);
    expect(await screen.findByText(EVENT_LINE)).toBeVisible();
    expect(screen.getByText('Ordered by Ani Grigoryan')).toBeVisible();
    const tickets = screen.getByRole('region', { name: 'Tickets' });
    expect(within(tickets).getAllByText('General')).toHaveLength(2);
    expect(reads.listing).toBe(0);
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it('says the same from the answer to confirm, on the bank’s return', async () => {
    holdOrder({ accessToken: TOKEN });
    serveConfirm(() => HttpResponse.json(orderWire({ accessToken: TOKEN })));
    renderAt('/tickets/return');
    expect(await screen.findByText(EVENT_LINE)).toBeVisible();
    expect(screen.getByText('Ordered by Ani Grigoryan')).toBeVisible();
    expect(reads.listing).toBe(0);
  });

  it.each(['RESERVED', 'CANCELLED', 'EXPIRED', 'REFUNDED'])(
    'names the event on an order %s',
    async (status) => {
      serveOrder({ status, tickets: [] });
      await renderHeld();
      expect(screen.getByText(EVENT_LINE)).toBeVisible();
    },
  );

  it('formats the time in the event’s own zone', async () => {
    serveOrder({ event: { ...EVENT, timezone: 'America/New_York' } });
    await renderHeld();
    expect(screen.getByText(/Saturday, 2 October 2027, 11:00/)).toBeVisible();
  });

  it('shows the order in its own language, whatever the page negotiated', async () => {
    serveOrder({ locale: 'hy', totalMinor: '15000' });
    const { t } = createI18n('hy');
    const heading = await renderHeld();
    expect(heading).toHaveTextContent(t('ticket-order:outcome.paid.heading'));
    expect(heading.closest('[lang]')).toHaveAttribute('lang', 'hy');
    expect(screen.getByText(t('ticket-order:buyer', { name: 'Ani Grigoryan' }))).toBeVisible();
    expect(document.body.textContent).toContain(formatMinor('15000', 'AMD', 'hy'));
    expect(document.body.textContent).toContain(
      displayDate('2027-10-02T15:00:00.000Z', { timeZone: 'Asia/Yerevan', locale: 'hy' }),
    );
  });

  it('stays in the order’s language when a later check fails', async () => {
    serveOrder({ locale: 'hy', status: 'RESERVED', tickets: [] });
    serveConfirm(() => refusal(500));
    const { t } = createI18n('hy');
    holdOrder({ accessToken: TOKEN });
    const { user } = renderAt('/tickets');
    await user.click(await screen.findByRole('button', { name: t('ticket-order:waiting.check') }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('ticket-order:failed.body'));
    expect(alert.closest('[lang]')).toHaveAttribute('lang', 'hy');
  });

  it('names each ticket by its own type', async () => {
    const wire = orderWire() as { attendees: Array<Record<string, unknown>> };
    const [davit, anna] = wire.attendees;
    serveOrder({
      items: [
        { ticketTypeId: 'general', name: 'General', quantity: 1, unitPriceMinor: '0' },
        { ticketTypeId: 'vip', name: 'VIP', quantity: 1, unitPriceMinor: '0' },
      ],
      attendees: [davit, { ...anna, ticketTypeId: 'vip' }],
    });
    await renderHeld();
    const [first, second] = within(screen.getByRole('region', { name: 'Tickets' })).getAllByRole(
      'listitem',
    );
    expect(within(first as HTMLElement).getByText('VIP')).toBeVisible();
    expect(within(second as HTMLElement).getByText('General')).toBeVisible();
  });

  it('keeps the negotiated language for a locale it doesn’t have', async () => {
    serveOrder({ locale: 'de' });
    const heading = await renderHeld();
    expect(heading).toHaveTextContent('Your tickets');
    expect(heading.closest('[lang]')).toBeNull();
  });

  it('says “Ticket” when a ticket type has no name', async () => {
    serveOrder({
      items: [{ ticketTypeId: 'general', name: null, quantity: 2, unitPriceMinor: '0' }],
    });
    await renderHeld();
    const tickets = screen.getByRole('region', { name: 'Tickets' });
    expect(within(tickets).getAllByText('Ticket')).toHaveLength(2);
  });

  it('leaves out an event or a buyer it wasn’t given', async () => {
    serveOrder({ event: undefined, buyerName: '' });
    const heading = await renderHeld();
    expect(heading).toHaveTextContent('Your tickets');
    expect(screen.queryByText(/Autumn Jazz Night/)).toBeNull();
    expect(screen.queryByText(/Ordered by/)).toBeNull();
  });

  it('offers no way back when the event has no public listing', async () => {
    holdOrder({ accessToken: TOKEN });
    serveConfirm(
      reserved({ status: 'FAILED', redirectUrl: null }, { event: { ...EVENT, slug: null } }),
    );
    renderAt('/tickets/return');
    await screen.findByRole('heading', { name: 'The payment didn’t go through' });
    expect(screen.queryByRole('link', { name: 'Choose tickets again' })).toBeNull();
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
    holdOrder({ accessToken: TOKEN });
    serveConfirm(reserved({ status: 'FAILED', redirectUrl: null }));
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

  it('offers no new payment when the bank and our record disagree, and says whom to contact', async () => {
    vi.stubEnv('VITE_SUPPORT_TELEGRAM', 'aveline_help');
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    holdOrder({ accessToken: TOKEN });
    serveConfirm(() => refusal(409, 'Cannot move a payment from EXPIRED to PAID'));
    renderAt('/tickets/return');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Reference: r-409');
    expect(alert).toHaveTextContent('Please don’t pay again');
    expect(within(alert).getByRole('link', { name: '@aveline_help' })).toHaveAttribute(
      'href',
      'https://t.me/aveline_help',
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
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
