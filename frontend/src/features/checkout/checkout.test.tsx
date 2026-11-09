import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { readBasket, type PublicEvent } from '@/features/public-event';
import { forgetOrder, heldOrder } from '@/features/ticket-order';
import { createI18n } from '@/lib/i18n';
import { APP_PATHS } from '@/route-paths';

import { CheckoutPage } from './components/checkout-page';
import { leaveForBank } from '@/lib/links/bank';
import { LeaveGuard } from '@/ui/app-form';
import { EVENT, PER_VENUE_RULES } from './test-data';
import { isUnloadAsked } from '../../../test/unload';

vi.mock('@/lib/links/bank', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  leaveForBank: vi.fn(),
}));

const ORIGIN = 'http://api.test';
const ORDERS = `${ORIGIN}/api/v1/public/events/:slug/orders`;
const PROMO = `${ORIGIN}/api/v1/public/events/:slug/promo-check`;
/** Made at run time: no committed fixture holds a capability token. */
const TOKEN = `tok-${crypto.randomUUID()}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const server = setupServer();
const posted: Array<Record<string, unknown>> = [];
const current = { event: EVENT, loads: 0 };

function refusal(status: number, message: string, extra: Record<string, unknown> = {}) {
  return HttpResponse.json(
    { statusCode: status, message, requestId: `r-${status}`, ...extra },
    { status, headers: { 'x-request-id': `r-${status}` } },
  );
}

/** Records each order, then answers with the next of `replies`, then the last again. */
function serveOrders(...replies: Array<() => Response>) {
  server.use(
    http.post(ORDERS, async ({ request }) => {
      posted.push((await request.json()) as Record<string, unknown>);
      const reply = replies[Math.min(posted.length - 1, replies.length - 1)];
      return reply ? reply() : refusal(500, 'No reply');
    }),
  );
}

const paid = () =>
  HttpResponse.json(
    { orderId: 'o1', accessToken: TOKEN, status: 'PAID', totalMinor: '0', tickets: [] },
    { status: 201 },
  );

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', ORIGIN);
  posted.length = 0;
  current.event = EVENT;
  current.loads = 0;
  forgetOrder();
  sessionStorage.clear();
  vi.mocked(leaveForBank).mockClear();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

interface Loaded {
  event: PublicEvent;
  tickets: string;
}

function renderCheckout(tickets = 'general.2') {
  const Stub = createRoutesStub([
    {
      path: APP_PATHS.checkout,
      loader: (): Loaded => {
        current.loads += 1;
        return { event: current.event, tickets };
      },
      Component: () => {
        const { event, tickets: param } = useLoaderData<Loaded>();
        return (
          <LeaveGuard>
            <CheckoutPage
              event={event}
              basket={readBasket(param, event.ticketTypes)}
              isSalesClosed={false}
              provider="FAKE"
            />
          </LeaveGuard>
        );
      },
    },
    { path: APP_PATHS.ticketOrder, Component: () => <p>The order page</p> },
  ]);
  const view = render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={['/events/autumn-jazz-night/checkout']} />
    </I18nextProvider>,
  );
  return { ...view, user: userEvent.setup() };
}

const ticket = (number: number, total = 2, type = 'General') =>
  screen.findByRole('region', { name: `Ticket ${number} of ${total} · ${type}` });

async function fillBuyer(user: ReturnType<typeof userEvent.setup>) {
  const buyer = await screen.findByRole('region', { name: 'Your details' });
  await user.type(within(buyer).getByLabelText('First name'), 'Ani');
  await user.type(within(buyer).getByLabelText('Email'), 'ani@example.com');
}

async function name(
  user: ReturnType<typeof userEvent.setup>,
  number: number,
  first: string,
  { total = 2, type = 'General' } = {},
) {
  const card = await ticket(number, total, type);
  await user.type(within(card).getByLabelText('First name'), first);
  return card;
}

const submit = () => screen.findByRole('button', { name: 'Get tickets' });

describe('checkout for an event answered once (PD-79)', () => {
  it('names one person per ticket, sends them apart from the buyer, and opens the order', async () => {
    serveOrders(paid);
    const { user } = renderCheckout();
    await fillBuyer(user);
    await user.click(within(await name(user, 1, 'Anna')).getByRole('radio', { name: 'Fish' }));
    await user.click(within(await name(user, 2, 'Davit')).getByRole('radio', { name: 'Beef' }));
    await user.click(await submit());
    expect(await screen.findByText('The order page')).toBeInTheDocument();
    expect(posted).toEqual([
      {
        items: [{ ticketTypeId: 'general', quantity: 2 }],
        buyerName: 'Ani',
        buyerEmail: 'ani@example.com',
        locale: 'en',
        attendanceRevision: 1,
        provider: 'FAKE',
        idempotencyKey: expect.stringMatching(UUID) as unknown,
        attendees: [
          {
            ticketTypeId: 'general',
            firstName: 'Anna',
            answers: [{ questionId: 'q-meal', value: 0 }],
          },
          {
            ticketTypeId: 'general',
            firstName: 'Davit',
            answers: [{ questionId: 'q-meal', value: 1 }],
          },
        ],
      },
    ]);
    expect(heldOrder()).toEqual({ accessToken: TOKEN });
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it('sends a numbered seat and a zone in the same order, in attendee order', async () => {
    const base = { layoutVersionId: 'layout-1', ticketTypeIds: ['general'], available: 1 };
    current.event = {
      ...EVENT,
      ticketInventory: {
        layoutVersionId: 'layout-1',
        sections: [
          { key: 'balcony', name: 'Balcony', mode: 'NUMBERED', ticketTypeIds: ['general'] },
          { key: 'floor', name: 'Floor', mode: 'UNNUMBERED', ticketTypeIds: ['general'] },
        ],
      },
    };
    server.use(
      http.get(`${ORIGIN}/api/v1/public/events/:slug/ticket-inventory/:key`, ({ params }) =>
        HttpResponse.json({
          ...base,
          seats: params.key === 'balcony' ? [{ id: 'seat-12', row: 'B', label: '12' }] : [],
        }),
      ),
    );
    serveOrders(paid);
    const { user } = renderCheckout();
    expect(await submit()).toBeDisabled();
    const choices = await screen.findAllByLabelText('Section or zone');
    await user.selectOptions(choices[0] as HTMLElement, 'balcony');
    await screen.findByRole('option', { name: 'Row B, seat 12' });
    await user.selectOptions(await screen.findByLabelText('Seat'), 'seat-12');
    await user.selectOptions(choices[1] as HTMLElement, 'floor');
    await fillBuyer(user);
    await user.click(within(await name(user, 1, 'Anna')).getByRole('radio', { name: 'Fish' }));
    await user.click(within(await name(user, 2, 'Davit')).getByRole('radio', { name: 'Beef' }));
    await user.click(await submit());
    expect(await screen.findByText('The order page')).toBeInTheDocument();
    expect(posted[0]).toMatchObject({
      layoutVersionId: 'layout-1',
      selections: [{ sectionKey: 'balcony', seatId: 'seat-12' }, { sectionKey: 'floor' }],
    });
  });

  describe('choosing a seat or zone (PD-185)', () => {
    function withInventory() {
      current.event = {
        ...EVENT,
        ticketInventory: {
          layoutVersionId: 'layout-1',
          sections: [
            { key: 'balcony', name: 'Balcony', mode: 'NUMBERED', ticketTypeIds: ['general'] },
          ],
        },
      };
      return {
        layoutVersionId: 'layout-1',
        ticketTypeIds: ['general'],
        available: 1,
        seats: [{ id: 'seat-12', row: 'B', label: '12' }],
      };
    }

    function serveStock() {
      const stock = withInventory();
      server.use(
        http.get(`${ORIGIN}/api/v1/public/events/:slug/ticket-inventory/:key`, () =>
          HttpResponse.json(stock),
        ),
      );
    }

    async function chooseSeatAndFill(user: Parameters<typeof fillBuyer>[0]) {
      await user.selectOptions(
        await screen.findByRole('combobox', { name: 'Section or zone' }),
        'balcony',
      );
      await user.selectOptions(await screen.findByRole('combobox', { name: 'Seat' }), 'seat-12');
      await fillBuyer(user);
      await user.click(
        within(await name(user, 1, 'Anna', { total: 1 })).getByRole('radio', { name: 'Fish' }),
      );
    }

    it('names each choice by its label alone, as a screen reader says it', async () => {
      serveStock();
      const { user } = renderCheckout('general.1');
      const section = await screen.findByRole('combobox', { name: 'Section or zone' });
      await user.selectOptions(section, 'balcony');
      expect(await screen.findByRole('combobox', { name: 'Seat' })).toBeInTheDocument();
    });

    it('offers to read availability again when it couldn’t be read', async () => {
      const stock = withInventory();
      let reads = 0;
      server.use(
        http.get(`${ORIGIN}/api/v1/public/events/:slug/ticket-inventory/:key`, () => {
          reads += 1;
          return reads === 1 ? refusal(500, 'down') : HttpResponse.json(stock);
        }),
      );
      const { user } = renderCheckout('general.1');
      await user.selectOptions(
        await screen.findByRole('combobox', { name: 'Section or zone' }),
        'balcony',
      );
      await user.click(await screen.findByRole('button', { name: 'Retry availability' }));
      expect(await screen.findByRole('combobox', { name: 'Seat' })).toBeInTheDocument();
      expect(reads).toBe(2);
    });

    it('asks for the seats again when one was taken meanwhile', async () => {
      serveStock();
      serveOrders(() =>
        refusal(409, 'That place is no longer available', { code: 'TICKET_SELECTION_UNAVAILABLE' }),
      );
      const { user } = renderCheckout('general.1');
      await chooseSeatAndFill(user);
      await user.click(await submit());
      expect(await screen.findByText(/A selection is unavailable/)).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Section or zone' })).toHaveValue('');
      expect(await submit()).toBeDisabled();
    });

    it('reads the event again, and clears the seats, when its layout changed', async () => {
      serveStock();
      serveOrders(() => refusal(409, 'Layout changed', { code: 'TICKET_LAYOUT_CHANGED' }));
      const { user } = renderCheckout('general.1');
      await chooseSeatAndFill(user);
      const before = current.loads;
      await user.click(await submit());
      expect(await screen.findByText(/The layout changed/)).toBeInTheDocument();
      await waitFor(() => expect(current.loads).toBe(before + 1));
      expect(screen.getByRole('combobox', { name: 'Section or zone' })).toHaveValue('');
    });

    it('keeps the seats when the order passes the limit per buyer', async () => {
      serveStock();
      serveOrders(() => refusal(409, 'Too many', { code: 'TICKET_BUYER_LIMIT_REACHED' }));
      const { user } = renderCheckout('general.1');
      await chooseSeatAndFill(user);
      await user.click(await submit());
      expect(await screen.findByText(/exceeds the event’s ticket limit per buyer/)).toBeVisible();
      expect(screen.getByRole('combobox', { name: 'Section or zone' })).toHaveValue('balcony');
    });
  });

  it('checks the form before sending anything', async () => {
    serveOrders(paid);
    const { user } = renderCheckout('general.1');
    await user.click(await submit());
    const buyer = await screen.findByRole('region', { name: 'Your details' });
    expect(within(buyer).getAllByText('Fill this in.')).toHaveLength(2);
    // The first name, and the meal the hosts require of everyone coming.
    expect(within(await ticket(1, 1)).getAllByText('Fill this in.')).toHaveLength(2);
    expect(posted).toEqual([]);
  });

  it('copies the buyer onto one ticket only when asked, and only one', async () => {
    const { user } = renderCheckout();
    await fillBuyer(user);
    const first = await ticket(1);
    await user.click(within(first).getByRole('checkbox', { name: 'This ticket is for me' }));
    expect(within(first).getByLabelText('First name')).toHaveValue('Ani');
    expect(within(first).getByLabelText(/^Email/)).toHaveValue('ani@example.com');
    const second = await ticket(2);
    expect(within(second).getByLabelText('First name')).toHaveValue('');
    expect(within(second).getByRole('checkbox', { name: 'This ticket is for me' })).toBeDisabled();
  });
});

describe('checkout per venue (PD-79)', () => {
  beforeEach(() => {
    current.event = { ...EVENT, checkout: PER_VENUE_RULES };
  });

  it("asks each person's own venues, and the required questions only of someone coming", async () => {
    serveOrders(paid);
    const { user } = renderCheckout('general.1');
    await fillBuyer(user);
    const card = await name(user, 1, 'Anna', { total: 1 });
    expect(within(card).queryByRole('group', { name: /Your meal/ })).not.toBeInTheDocument();
    await user.click(await submit());
    expect(await within(card).findByText('Answer at least one place.')).toBeInTheDocument();
    const church = within(card).getByRole('group', { name: 'Anna · Saint Gregory Church' });
    await user.click(within(church).getByRole('radio', { name: 'Coming' }));
    await user.click(within(card).getByRole('radio', { name: 'Fish' }));
    await user.type(within(card).getByLabelText(/^Drink/), 'Tea');
    await user.click(await submit());
    await screen.findByText('The order page');
    expect(posted[0]).toMatchObject({
      attendanceRevision: 3,
      attendees: [
        {
          ticketTypeId: 'general',
          firstName: 'Anna',
          venueAttendance: [{ venueId: 'v-church', status: 'ATTENDING' }],
          drinkPreference: 'Tea',
          answers: [{ questionId: 'q-meal', value: 0 }],
        },
      ],
    });
    expect(posted[0]?.attendees).not.toContainEqual(
      expect.objectContaining({ status: expect.anything() as unknown }),
    );
  });

  it('tells of the agreements each person is asked for before the door', async () => {
    renderCheckout('general.1');
    const ahead = await screen.findByRole('region', { name: 'Before the door' });
    expect(within(ahead).getByText('I accept the house rules')).toBeInTheDocument();
  });

  it('asks again where each person comes when the hosts changed how guests answer', async () => {
    serveOrders(() =>
      refusal(
        409,
        'attendanceRevision: attendance policy changed; reload the invitation and reconfirm',
        {
          code: 'ATTENDANCE_CHANGED',
        },
      ),
    );
    const { user } = renderCheckout('general.1');
    await fillBuyer(user);
    const card = await name(user, 1, 'Anna', { total: 1 });
    const before = within(card).getByRole('group', { name: 'Anna · Saint Gregory Church' });
    await user.click(within(before).getByRole('radio', { name: 'Not coming' }));
    current.event = { ...EVENT, checkout: { ...PER_VENUE_RULES, attendanceRevision: 4 } };
    await user.click(await submit());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The hosts changed how guests answer',
    );
    await waitFor(() => expect(current.loads).toBe(2));
    const church = within(await ticket(1, 1)).getByRole('group', {
      name: 'Anna · Saint Gregory Church',
    });
    await waitFor(() =>
      expect(within(church).getByRole('radio', { name: 'Not coming' })).not.toBeChecked(),
    );
    expect(within(await ticket(1, 1)).getByLabelText('First name')).toHaveValue('Anna');
  });
});

describe('refusals and retries (PD-80)', () => {
  async function fillOne(user: ReturnType<typeof userEvent.setup>) {
    await fillBuyer(user);
    await user.click(
      within(await name(user, 1, 'Anna', { total: 1 })).getByRole('radio', { name: 'Fish' }),
    );
  }

  it('sends the same key again after no answer, and a new one once the order changed', async () => {
    serveOrders(
      () => refusal(502, 'Bad Gateway'),
      () => refusal(502, 'Bad Gateway'),
      paid,
    );
    const { user } = renderCheckout('general.1');
    await fillOne(user);
    await user.click(await submit());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Press again: your order won’t be placed twice.',
    );
    await user.click(await submit());
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]?.idempotencyKey).toBe(posted[0]?.idempotencyKey);
    await user.type(within(await ticket(1, 1)).getByLabelText('First name'), 'h');
    await user.click(await submit());
    await screen.findByText('The order page');
    expect(posted[2]?.idempotencyKey).not.toBe(posted[0]?.idempotencyKey);
  });

  it('sends the same key after a reload, for the same order, and keeps no names in this tab (PD-152)', async () => {
    serveOrders(() => refusal(502, 'Bad Gateway'), paid);
    const first = renderCheckout('general.1');
    await fillOne(first.user);
    await first.user.click(await submit());
    await screen.findByRole('alert');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('Anna');
    first.unmount();
    const { user } = renderCheckout('general.1');
    await fillOne(user);
    await user.click(await submit());
    await screen.findByText('The order page');
    expect(posted[1]?.idempotencyKey).toBe(posted[0]?.idempotencyKey);
  });

  it('reads the event again when fewer tickets remain, keeping the people typed', async () => {
    serveOrders(() => refusal(409, 'Only 1 ticket(s) remain; 2 were requested'));
    const { user } = renderCheckout();
    await fillBuyer(user);
    await user.click(within(await name(user, 1, 'Anna')).getByRole('radio', { name: 'Fish' }));
    await user.click(within(await name(user, 2, 'Davit')).getByRole('radio', { name: 'Beef' }));
    current.event = { ...EVENT, ticketTypes: [{ ...EVENT.ticketTypes[0]!, available: 1 }] };
    await user.click(await submit());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'There are fewer tickets left than you chose.',
    );
    expect(await ticket(1, 1)).toBeInTheDocument();
    expect(within(await ticket(1, 1)).getByLabelText('First name')).toHaveValue('Anna');
  });

  it('keeps everything typed when paid tickets cannot be bought during the pilot', async () => {
    serveOrders(() => refusal(403, 'Payments are disabled for the free pilot'));
    const { user } = renderCheckout('general.1');
    await fillOne(user);
    await user.click(await submit());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Aveline is running as a free pilot',
    );
    expect(within(await ticket(1, 1)).getByLabelText('First name')).toHaveValue('Anna');
  });

  it('marks a refused field on the person it belongs to', async () => {
    serveOrders(() =>
      refusal(400, 'attendees.0.email must be an email', {
        details: [{ field: 'attendees.0.email', code: 'VALIDATION_FAILED', userMessage: 'x' }],
      }),
    );
    const { user } = renderCheckout('general.1');
    await fillOne(user);
    await user.click(await submit());
    expect(
      await within(await ticket(1, 1)).findByText('Check this: it was refused.'),
    ).toBeInTheDocument();
  });

  it('shows a sentence it does not know as it came, marked English, with its reference', async () => {
    serveOrders(() => refusal(400, 'attendees.locale: use one of the event languages'));
    const { user } = renderCheckout('general.1');
    await fillOne(user);
    await user.click(await submit());
    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByText('attendees.locale: use one of the event languages'),
    ).toHaveAttribute('lang', 'en');
    expect(alert).toHaveTextContent('Reference: r-400');
  });
});

describe('paying and promo codes (PD-82)', () => {
  it('leaves for the bank’s page with the order held by this tab', async () => {
    serveOrders(() =>
      HttpResponse.json(
        {
          accessToken: TOKEN,
          status: 'RESERVED',
          totalMinor: '15000',
          payment: { orderNumber: 'AVL-1', redirectUrl: 'https://bank.test/pay?id=1' },
        },
        { status: 201 },
      ),
    );
    const { user } = renderCheckout('table.1');
    await fillBuyer(user);
    const card = await name(user, 1, 'Anna', { total: 1, type: 'Table' });
    await user.click(within(card).getByRole('radio', { name: 'Fish' }));
    expect(screen.getAllByText(/15,000/).length).toBeGreaterThan(0);
    await user.click(await screen.findByRole('button', { name: 'Continue to payment' }));
    await waitFor(() => expect(leaveForBank).toHaveBeenCalledWith('https://bank.test/pay?id=1'));
    expect(heldOrder()).toEqual({ accessToken: TOKEN });
    // The browser's "Leave site?" would stand between the buyer and the bank.
    await waitFor(() => expect(isUnloadAsked()).toBe(false));
  });

  it('asks before names typed are lost, and not before anything is', async () => {
    const { user } = renderCheckout('table.1');
    await screen.findByRole('region', { name: 'Your details' });
    expect(isUnloadAsked()).toBe(false);
    await fillBuyer(user);
    expect(isUnloadAsked()).toBe(true);
  });

  it('keeps asking after a refusal, as the names typed are still there to lose', async () => {
    serveOrders(() =>
      HttpResponse.json({ statusCode: 500, message: 'Boom', requestId: 'r-1' }, { status: 500 }),
    );
    const { user } = renderCheckout('table.1');
    await fillBuyer(user);
    const card = await name(user, 1, 'Anna', { total: 1, type: 'Table' });
    await user.click(within(card).getByRole('radio', { name: 'Fish' }));
    await user.click(await screen.findByRole('button', { name: 'Continue to payment' }));
    await screen.findByRole('alert');
    expect(isUnloadAsked()).toBe(true);
    expect(within(card).getByRole('radio', { name: 'Fish' })).toBeChecked();
  });

  it('applies a promo code the server accepts, and sends it with the order', async () => {
    server.use(
      http.post(PROMO, () =>
        HttpResponse.json({
          code: 'AUTUMN',
          isApplicable: true,
          subtotalMinor: '15000',
          discountMinor: '15000',
          totalMinor: '0',
          currency: 'AMD',
        }),
      ),
    );
    serveOrders(paid);
    const { user } = renderCheckout('table.1');
    await fillBuyer(user);
    const card = await name(user, 1, 'Anna', { total: 1, type: 'Table' });
    await user.click(within(card).getByRole('radio', { name: 'Fish' }));
    await user.type(screen.getByLabelText(/^Code/), 'autumn');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('status')).toHaveTextContent('AUTUMN is applied');
    await user.click(await submit());
    await screen.findByText('The order page');
    expect(posted[0]?.promoCode).toBe('AUTUMN');
  });

  it('says a refusal of the check itself, rather than asking to try again', async () => {
    server.use(http.post(PROMO, () => refusal(400, 'Ticket sales closed when this event started')));
    const { user } = renderCheckout('table.1');
    await user.type(await screen.findByLabelText(/^Code/), 'autumn');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Ticket sales closed when this event started');
    expect(alert).not.toHaveTextContent('Try again');
  });

  it('drops a promo quote once the basket changes, since it priced the old one', async () => {
    server.use(
      http.post(PROMO, () =>
        HttpResponse.json({
          code: 'AUTUMN',
          isApplicable: true,
          subtotalMinor: '30000',
          discountMinor: '5000',
          totalMinor: '25000',
          currency: 'AMD',
        }),
      ),
    );
    serveOrders(() => refusal(409, 'Only 1 ticket(s) remain; 2 were requested'));
    const { user } = renderCheckout('table.2');
    await fillBuyer(user);
    await user.click(
      within(await name(user, 1, 'Anna', { type: 'Table' })).getByRole('radio', { name: 'Fish' }),
    );
    await user.click(
      within(await name(user, 2, 'Davit', { type: 'Table' })).getByRole('radio', { name: 'Beef' }),
    );
    await user.type(screen.getByLabelText(/^Code/), 'autumn');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText(/AUTUMN is applied/);
    current.event = { ...EVENT, ticketTypes: [{ ...EVENT.ticketTypes[1]!, available: 1 }] };
    await user.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await screen.findByRole('alert');
    await waitFor(() => expect(screen.queryByText(/AUTUMN is applied/)).not.toBeInTheDocument());
    expect(await ticket(1, 1, 'Table')).toBeInTheDocument();
  });

  it('words a code the server refuses, and its minimum order with the amount', async () => {
    server.use(
      http.post(PROMO, () =>
        HttpResponse.json({
          code: 'BIG',
          isApplicable: false,
          reason: 'This code needs an order of at least 20000',
          subtotalMinor: '15000',
          discountMinor: '0',
          totalMinor: '15000',
          currency: 'AMD',
        }),
      ),
    );
    const { user } = renderCheckout('table.1');
    await user.type(await screen.findByLabelText(/^Code/), 'big');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This code needs an order of at least',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('20,000');
  });
});
