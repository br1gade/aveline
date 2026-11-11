import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData, useLocation } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import { GrantedPermissions, type Granted } from '@/features/permissions';
import { createI18n } from '@/lib/i18n';
import { guardedRoutes, isLeavingAsked } from '@/ui/app-form/guarded-routes';

import { BookVendorPage } from './components/book-vendor-page';
import { BookingPage } from './components/booking-page';
import { EventVendorsPage } from './components/event-vendors-page';
import { VendorsPage } from './components/vendors-page';
import { listVendorChoices } from './api';
import {
  loadBooking,
  loadEventVendors,
  loadNewBooking,
  loadVendors,
  type BookingData,
  type EventVendorsData,
  type NewBookingData,
  type VendorsData,
} from './load';
import { bookingWire, EVENT, optionsWire, plantedToken, vendorWire, without } from './test-data';
import type { BookingWire, VendorWire } from './types';

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
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  vi.stubEnv('VITE_PUBLIC_ORIGIN', 'https://aveline.test');
  current.session = createBrowserSession({
    baseUrl: ORIGIN,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
});
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(() => server.close());

const refused = (status: number, code?: string) => () =>
  HttpResponse.json(
    { statusCode: status, message: 'refused', requestId: 'req-1', ...(code ? { code } : {}) },
    { status },
  );

interface Served {
  vendors?: () => Response;
  choices?: () => Response;
  bookings?: () => Response;
}

/** The event's choices, as the options read gives the vendors of `vendorList`. */
const choicesOf = (vendors: readonly VendorWire[]) =>
  optionsWire(
    vendors.map(({ id, name, category, isCurated }) => ({ id, name, category, isCurated })),
  );

/** What each write sent, in order, so a test can say what went and what didn't. */
function serve({ vendors, choices, bookings }: Served = {}) {
  const sent: Array<{ method: string; path: string; body: JsonBodyType }> = [];
  const record = async ({ request }: { request: Request }) => {
    const text = await request.text();
    sent.push({
      method: request.method,
      path: new URL(request.url).pathname,
      body: text ? (JSON.parse(text) as JsonBodyType) : null,
    });
  };
  server.use(
    http.get(`${API}/events/e1`, () => HttpResponse.json(EVENT)),
    http.get(`${API}/vendors`, vendors ?? (() => HttpResponse.json(vendorList()))),
    http.get(
      `${API}/events/e1/vendor-options`,
      choices ?? (() => HttpResponse.json(choicesOf(vendorList()))),
    ),
    http.patch(`${API}/vendors/:vendorId`, async (call) => {
      await record(call);
      return HttpResponse.json({ id: call.params.vendorId });
    }),
    http.delete(`${API}/vendors/:vendorId`, async (call) => {
      await record(call);
      return HttpResponse.json({ ok: true });
    }),
    http.get(`${API}/events/e1/vendors`, bookings ?? (() => HttpResponse.json([bookingWire()]))),
    http.post(`${API}/vendors`, async (call) => {
      await record(call);
      return HttpResponse.json({ id: 'v9' }, { status: 201 });
    }),
    http.post(`${API}/events/e1/vendors`, async (call) => {
      await record(call);
      return HttpResponse.json({ id: 'b2', briefToken: plantedToken() }, { status: 201 });
    }),
    http.patch(`${API}/events/e1/vendors/b1`, async (call) => {
      await record(call);
      return HttpResponse.json({ id: 'b1' });
    }),
    http.post(`${API}/events/e1/vendors/b1/rotate-brief`, async (call) => {
      await record(call);
      return HttpResponse.json({ id: 'b1', briefToken: plantedToken() }, { status: 201 });
    }),
    http.delete(`${API}/events/e1/vendors/b1`, async (call) => {
      await record(call);
      return HttpResponse.json({ ok: true });
    }),
  );
  return sent;
}

function vendorList(): VendorWire[] {
  return [
    vendorWire({
      id: 'v2',
      name: 'Garden Halls',
      category: 'VENUE',
      isCurated: true,
      email: null,
      phone: null,
      venueProfiles: [{ id: 'h1', name: 'Rose hall', city: 'Yerevan', capacity: 300 }],
    }),
    vendorWire(),
    vendorWire({ id: 'v3', name: 'Lens & Light', category: 'PHOTOGRAPHY' }),
  ];
}

function Vendors() {
  return <VendorsPage data={useLoaderData<VendorsData>()} />;
}
function EventVendors() {
  return <EventVendorsPage data={useLoaderData<EventVendorsData>()} />;
}
function NewBooking() {
  return <BookVendorPage data={useLoaderData<NewBookingData>()} />;
}
function Booking() {
  return (
    <>
      <BookingPage data={useLoaderData<BookingData>()} />
      <Where />
    </>
  );
}
/** The router's own address and history state, which a memory router keeps from `window`. */
function Where() {
  const location = useLocation();
  const state: unknown = location.state;
  const address = `${location.pathname}${location.search}`;
  return <p data-testid="where">{`${address} ${JSON.stringify(state ?? null)}`}</p>;
}

function isStored(secret: string): boolean {
  return [localStorage, sessionStorage].some((store) =>
    Array.from(
      { length: store.length },
      (_, index) => store.getItem(store.key(index) ?? '') ?? '',
    ).some((value) => value.includes(secret)),
  );
}

function renderAt(path: string, permissions: Granted = null) {
  const Stub = createRoutesStub(
    guardedRoutes([
      { path: '/app', Component: Where },
      { path: '/app/vendors', loader: () => loadVendors(session().api), Component: Vendors },
      {
        path: '/app/events/:eventId/vendors',
        loader: () => loadEventVendors(session().api, 'e1'),
        Component: EventVendors,
      },
      {
        path: '/app/events/:eventId/vendors/new',
        loader: () => loadNewBooking(session().api, 'e1'),
        Component: NewBooking,
      },
      {
        path: '/app/events/:eventId/vendors/:bookingId',
        loader: ({ params }) =>
          loadBooking(session().api, { eventId: 'e1', bookingId: params.bookingId ?? '' }),
        Component: Booking,
      },
    ]),
  );
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <GrantedPermissions permissions={permissions}>
        <Stub initialEntries={[path]} />
      </GrantedPermissions>
    </I18nextProvider>,
  );
  return userEvent.setup();
}

async function press(user: ReturnType<typeof userEvent.setup>, name: string | RegExp) {
  const button = await screen.findByRole('button', { name });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
}

describe('the organization’s vendors', () => {
  it('marks Aveline’s list apart from the organization’s own, with each one’s halls', async () => {
    serve();
    renderAt('/app/vendors');
    const garden = (await screen.findByText('Garden Halls')).closest('li');
    if (!garden) throw new Error('No row');
    expect(within(garden).getByText(/Aveline’s list/)).toBeInTheDocument();
    expect(within(garden).getByText('Rose hall: Yerevan · seats 300')).toBeInTheDocument();
    const own = screen.getByText('Tashir Catering').closest('li');
    if (!own) throw new Error('No row');
    expect(within(own).getByText(/Yours/)).toBeInTheDocument();
    expect(within(own).getByText('hello@tashir.example')).toBeInTheDocument();
    expect(within(own).getByRole('button', { name: 'Correct: Tashir Catering' })).toBeEnabled();
    expect(within(garden).queryByRole('button')).not.toBeInTheDocument();
  });

  it('corrects only what changed, clearing an emptied detail, then says so (FR-102)', async () => {
    const sent = serve({
      vendors: () => HttpResponse.json([vendorWire({ notes: 'Ask for Ani' })]),
    });
    const user = renderAt('/app/vendors');
    const own = (await screen.findByText('Tashir Catering')).closest('li');
    if (!own) throw new Error('No row');
    expect(within(own).getByText('Ask for Ani')).toBeInTheDocument();
    await user.click(within(own).getByRole('button', { name: 'Correct: Tashir Catering' }));
    const dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Phone'));
    await user.clear(within(dialog).getByLabelText('Notes'));
    await user.type(within(dialog).getByLabelText('Notes'), 'Ask for Aram');
    await user.click(within(dialog).getByRole('button', { name: 'Save the vendor' }));
    expect(await screen.findByText('Tashir Catering is corrected.')).toBeInTheDocument();
    expect(sent).toEqual([
      {
        method: 'PATCH',
        path: '/api/v1/vendors/v1',
        body: { phone: null, notes: 'Ask for Aram' },
      },
    ]);
  });

  it('asks before removing one, saying its bookings stay, then removes it (FR-102)', async () => {
    const sent = serve();
    const user = renderAt('/app/vendors');
    await user.click(await screen.findByRole('button', { name: 'Remove: Tashir Catering' }));
    const ask = await screen.findByRole('alertdialog');
    expect(ask).toHaveTextContent(
      'Bookings already made, and the briefs sent with them, are kept.',
    );
    expect(sent).toEqual([]);
    await user.click(within(ask).getByRole('button', { name: 'Remove' }));
    expect(
      await screen.findByText('Tashir Catering is removed from your vendors.'),
    ).toBeInTheDocument();
    expect(sent).toEqual([{ method: 'DELETE', path: '/api/v1/vendors/v1', body: null }]);
  });

  it('says a vendor already gone is no longer on the list when removing it', async () => {
    serve();
    server.use(http.delete(`${API}/vendors/:vendorId`, refused(404)));
    const user = renderAt('/app/vendors');
    await user.click(await screen.findByRole('button', { name: 'Remove: Tashir Catering' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }),
    );
    expect(
      await screen.findByText(/isn’t on your organization’s list or Aveline’s/),
    ).toBeInTheDocument();
  });

  it('offers adding, correcting and removing only to whom `vendor:write` is granted (FR-6)', async () => {
    serve();
    renderAt('/app/vendors', ['vendor:read']);
    expect(await screen.findByText('Tashir Catering')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Correct|Remove|Add the vendor/ }),
    ).not.toBeInTheDocument();
  });

  it('shows one kind from the address, and all again', async () => {
    serve();
    const user = renderAt('/app/vendors?category=PHOTOGRAPHY');
    expect(await screen.findByText('Lens & Light')).toBeInTheDocument();
    expect(screen.queryByText('Tashir Catering')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Photography' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await user.click(screen.getByRole('link', { name: 'All' }));
    expect(await screen.findByText('Tashir Catering')).toBeInTheDocument();
  });

  it('tells an account with no organization that vendors are an organization’s, and keeps the form', async () => {
    serve({ vendors: refused(403, 'FORBIDDEN') });
    renderAt('/app/vendors');
    expect(await screen.findByText(/your account isn’t a member of one/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add the vendor' })).toBeInTheDocument();
  });

  it('adds a vendor with only what was typed, then says so', async () => {
    const sent = serve();
    const user = renderAt('/app/vendors');
    await user.type(await screen.findByLabelText('Name'), '  Lens  ');
    await user.selectOptions(screen.getByLabelText('Kind of vendor'), 'PHOTOGRAPHY');
    expect(isLeavingAsked()).toBe(true);
    await press(user, 'Add the vendor');
    expect(await screen.findByText('Lens was added.')).toBeInTheDocument();
    expect(sent).toEqual([
      { method: 'POST', path: '/api/v1/vendors', body: { name: 'Lens', category: 'PHOTOGRAPHY' } },
    ]);
    expect(isLeavingAsked()).toBe(false);
  });

  it('words a role’s refusal to add, and marks a field the server refused', async () => {
    serve();
    server.use(http.post(`${API}/vendors`, refused(403)));
    const user = renderAt('/app/vendors');
    await user.type(await screen.findByLabelText('Name'), 'Lens');
    await user.selectOptions(screen.getByLabelText('Kind of vendor'), 'PHOTOGRAPHY');
    await press(user, 'Add the vendor');
    expect(
      await screen.findByText(
        /Your role can’t add vendors. The organization’s owner or a manager can./,
      ),
    ).toBeInTheDocument();

    server.use(
      http.post(`${API}/vendors`, () =>
        HttpResponse.json(
          {
            statusCode: 400,
            message: ['phone must be shorter than or equal to 40 characters'],
            details: [{ field: 'phone', code: 'TOO_LONG', userMessage: 'Too long' }],
          },
          { status: 400 },
        ),
      ),
    );
    await press(user, 'Add the vendor');
    expect(await screen.findByLabelText('Phone')).toHaveAccessibleDescription(
      expect.stringContaining('This was refused.'),
    );
  });
});

describe('an event’s vendors', () => {
  it('tells a fee not this role’s to see apart from no fee agreed', async () => {
    serve({
      bookings: () =>
        HttpResponse.json([
          without(bookingWire(), 'feeMinor', 'feeCurrency', 'briefToken'),
          bookingWire({
            id: 'b2',
            vendor: {
              id: 'v3',
              name: 'Lens & Light',
              category: 'PHOTOGRAPHY',
              email: null,
              phone: null,
            },
            feeMinor: null,
          }),
        ]),
    });
    renderAt('/app/events/e1/vendors');
    const hidden = (await screen.findByText('Tashir Catering')).closest('li');
    const none = screen.getByText('Lens & Light').closest('li');
    if (!hidden || !none) throw new Error('No rows');
    expect(within(hidden).getByText('Fee: not yours to see')).toBeInTheDocument();
    expect(
      within(hidden).getByText('Shares: Headcount, Catering, Running order'),
    ).toBeInTheDocument();
    expect(within(none).getByText('Fee: none agreed')).toBeInTheDocument();
  });

  it('marks a paused brief on the event’s list (FR-108)', async () => {
    serve({ bookings: () => HttpResponse.json([bookingWire({ isBriefEnabled: false })]) });
    renderAt('/app/events/e1/vendors');
    expect(await screen.findByText(/· Brief paused/)).toBeInTheDocument();
  });

  it('offers booking only to whom `vendor:write` is granted (FR-6)', async () => {
    serve();
    renderAt('/app/events/e1/vendors', ['vendor:read']);
    expect(await screen.findByText('Tashir Catering')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Book a vendor' })).not.toBeInTheDocument();
  });

  it('says vendors aren’t a designer’s, without hiding the way to book while unknown', async () => {
    serve({ bookings: refused(403) });
    renderAt('/app/events/e1/vendors');
    expect(
      await screen.findByText(/Vendors aren’t part of your role on this event/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Book a vendor' })).toBeInTheDocument();
  });
});

describe('booking a vendor', () => {
  it('ticks the usual set for the vendor chosen, sends what is ticked, and opens the booking', async () => {
    const booked = bookingWire({
      id: 'b2',
      vendor: { id: 'v3', name: 'Lens & Light', category: 'PHOTOGRAPHY', email: null, phone: null },
    });
    const sent = serve({ bookings: () => HttpResponse.json(sent.length ? [booked] : []) });
    const user = renderAt('/app/events/e1/vendors/new');
    await user.selectOptions(await screen.findByLabelText('Vendor'), 'v3');
    expect(screen.getByRole('checkbox', { name: 'Running order' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Households' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Guests’ contact details' })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Households' }));
    await user.click(screen.getByRole('checkbox', { name: 'Guests’ contact details' }));
    expect(
      screen.getByText(/the email address and phone number of every guest/),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Agreed fee'), '250000');
    expect(isLeavingAsked()).toBe(true);
    await press(user, 'Book the vendor');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Lens & Light' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Booked. Copy the brief link below/, { selector: '[role="status"]' }),
    ).toBeInTheDocument();
    expect(isLeavingAsked()).toBe(false);
    expect(sent).toEqual([
      {
        method: 'POST',
        path: '/api/v1/events/e1/vendors',
        body: {
          vendorId: 'v3',
          briefScopes: ['timeline', 'contacts'],
          feeMinor: '250000',
          feeCurrency: 'AMD',
        },
      },
    ]);
  });

  it('asks for a vendor before anything is sent', async () => {
    const sent = serve({ bookings: () => HttpResponse.json([]) });
    const user = renderAt('/app/events/e1/vendors/new');
    await press(user, 'Book the vendor');
    expect(await screen.findByLabelText('Vendor')).toHaveAccessibleDescription(
      expect.stringContaining('Choose one.'),
    );
    expect(sent).toEqual([]);
  });

  it('sends an empty set as empty, saying the vendor sees the event and venues only', async () => {
    const sent = serve({ bookings: () => HttpResponse.json([]) });
    const user = renderAt('/app/events/e1/vendors/new');
    await user.selectOptions(await screen.findByLabelText('Vendor'), 'v3');
    await user.click(screen.getByRole('checkbox', { name: 'Running order' }));
    await user.click(screen.getByRole('checkbox', { name: 'Households' }));
    expect(screen.getByText(/the brief shares the event and its venues only/)).toBeInTheDocument();
    await press(user, 'Book the vendor');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({ vendorId: 'v3', briefScopes: [] });
  });

  it('refuses decimals dram doesn’t have, and takes cents in dollars (FR-106)', async () => {
    const sent = serve({ bookings: () => HttpResponse.json([]) });
    const user = renderAt('/app/events/e1/vendors/new');
    await user.selectOptions(await screen.findByLabelText('Vendor'), 'v3');
    await user.type(screen.getByLabelText('Agreed fee'), '1500.50');
    await press(user, 'Book the vendor');
    expect(await screen.findByText(/no more decimals than the currency has/)).toBeInTheDocument();
    expect(sent).toEqual([]);
    await user.selectOptions(screen.getByLabelText('Currency'), 'USD');
    await press(user, 'Book the vendor');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toMatchObject({ feeMinor: '150050', feeCurrency: 'USD' });
  });

  it('won’t post a vendor booked already again, and books one whose booking ended', async () => {
    const sent = serve({
      bookings: () =>
        HttpResponse.json([
          bookingWire(),
          bookingWire({
            id: 'b3',
            vendor: {
              id: 'v3',
              name: 'Lens & Light',
              category: 'PHOTOGRAPHY',
              email: null,
              phone: null,
            },
            status: 'CANCELLED',
          }),
        ]),
    });
    const user = renderAt('/app/events/e1/vendors/new');
    expect(
      await screen.findByRole('option', { name: 'Tashir Catering (already booked)' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('option', { name: 'Lens & Light (booking ended, books again)' }),
    ).toBeEnabled();
    expect(screen.getByRole('option', { name: 'Garden Halls (Aveline’s list)' })).toBeEnabled();
    await user.selectOptions(screen.getByLabelText('Vendor'), 'v3');
    await press(user, 'Book the vendor');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({ vendorId: 'v3', briefScopes: ['timeline', 'households'] });
  });

  it('words a 404 as a vendor no longer on the list, and reads the list again without it', async () => {
    const refusedOnce = { isDone: false };
    serve({
      bookings: () => HttpResponse.json([]),
      choices: () =>
        HttpResponse.json(
          choicesOf(vendorList().filter((each) => !refusedOnce.isDone || each.id !== 'v3')),
        ),
    });
    server.use(
      http.post(`${API}/events/e1/vendors`, () => {
        refusedOnce.isDone = true;
        return refused(404)();
      }),
    );
    const user = renderAt('/app/events/e1/vendors/new');
    await user.selectOptions(await screen.findByLabelText('Vendor'), 'v3');
    await press(user, 'Book the vendor');
    expect(
      await screen.findByText(/isn’t on your organization’s list or Aveline’s/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /Lens & Light/ })).not.toBeInTheDocument(),
    );
  });

  it('lets someone on the event only book from the event’s own choices (FR-103)', async () => {
    serve({ vendors: refused(403, 'FORBIDDEN'), bookings: () => HttpResponse.json([]) });
    renderAt('/app/events/e1/vendors/new');
    expect(await screen.findByRole('option', { name: 'Lens & Light' })).toBeEnabled();
  });

  it('reads every page of the choices, a hundred at a time', async () => {
    const offsets: string[] = [];
    serve({
      bookings: () => HttpResponse.json([]),
      choices: () => HttpResponse.json({}),
    });
    server.use(
      http.get(`${API}/events/e1/vendor-options`, ({ request }) => {
        const offset = new URL(request.url).searchParams.get('offset') ?? '';
        offsets.push(`${new URL(request.url).searchParams.get('limit')}@${offset}`);
        const isFirst = offset === '0';
        return HttpResponse.json(
          optionsWire(
            [
              {
                id: isFirst ? 'v1' : 'v3',
                name: isFirst ? 'First' : 'Second',
                category: 'MUSIC',
                isCurated: false,
              },
            ],
            { offset: Number(offset), hasMore: isFirst },
          ),
        );
      }),
    );
    renderAt('/app/events/e1/vendors/new');
    expect(await screen.findByRole('option', { name: 'Second' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'First' })).toBeInTheDocument();
    expect(offsets).toEqual(['100@0', '100@100']);
  });

  it('words a role refused the event’s vendors, with nothing to choose', async () => {
    serve({ choices: refused(403, 'FORBIDDEN') });
    renderAt('/app/events/e1/vendors/new');
    expect(
      await screen.findByText(/Vendors aren’t part of your role on this event/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Vendor')).not.toBeInTheDocument();
  });
});

describe('a booking', () => {
  function serveOne(booking: BookingWire) {
    return serve({ bookings: () => HttpResponse.json([booking]) });
  }

  it('copies the brief link to the clipboard, and puts it nowhere else', async () => {
    const token = plantedToken();
    const logged = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'error'),
      vi.spyOn(console, 'warn'),
    ];
    serveOne(bookingWire({ briefToken: token }));
    const user = renderAt('/app/events/e1/vendors/b1');
    await press(user, 'Copy the brief link');
    expect(await screen.findByText(/The link was copied/)).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(`https://aveline.test/briefs/${token}`);
    expect(screen.getByTestId('where')).toHaveTextContent('/app/events/e1/vendors/b1 null');
    expect(document.body.innerHTML).not.toContain(token);
    expect(isStored(token)).toBe(false);
    for (const spy of logged) expect(JSON.stringify(spy.mock.calls)).not.toContain(token);
  });

  it('says so when the browser refuses the clipboard, and shows the link nowhere', async () => {
    const token = plantedToken();
    serveOne(bookingWire({ briefToken: token }));
    const user = renderAt('/app/events/e1/vendors/b1');
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await press(user, 'Copy the brief link');
    expect(await screen.findByText(/Your browser didn’t allow copying/)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(token);
  });

  it('says the link isn’t this role’s, and still offers a new one, whose refusal is worded', async () => {
    serveOne(without(bookingWire(), 'briefToken', 'feeMinor', 'feeCurrency'));
    server.use(http.post(`${API}/events/e1/vendors/b1/rotate-brief`, refused(403)));
    const user = renderAt('/app/events/e1/vendors/b1');
    expect(await screen.findByText(/The link isn’t yours to see/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy the brief link' })).not.toBeInTheDocument();
    expect(screen.getByText('Fee: not yours to see')).toBeInTheDocument();
    await press(user, 'Make a new link');
    await press(user, 'Make a new link');
    expect(await screen.findByText(/Your role can’t replace brief links/)).toBeInTheDocument();
  });

  it('asks before making a new link, and sends nothing on Cancel', async () => {
    const sent = serveOne(bookingWire());
    const user = renderAt('/app/events/e1/vendors/b1');
    await press(user, 'Make a new link');
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/stops working at once/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(sent).toEqual([]);
    await press(user, 'Make a new link');
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Make a new link',
      }),
    );
    expect(await screen.findByText(/A new link was made/)).toBeInTheDocument();
    expect(sent).toEqual([
      { method: 'POST', path: '/api/v1/events/e1/vendors/b1/rotate-brief', body: null },
    ]);
  });

  it('removes an emptied fee (FR-106)', async () => {
    const sent = serveOne(bookingWire());
    const user = renderAt('/app/events/e1/vendors/b1');
    await user.clear(await screen.findByLabelText('Agreed fee'));
    await press(user, 'Save the booking');
    expect(await screen.findByText('The booking was saved.')).toBeInTheDocument();
    expect(sent).toEqual([
      { method: 'PATCH', path: '/api/v1/events/e1/vendors/b1', body: { feeMinor: null } },
    ]);
  });

  it('pauses the brief, keeping the booking (FR-108)', async () => {
    const sent = serveOne(bookingWire());
    const user = renderAt('/app/events/e1/vendors/b1');
    expect(
      await screen.findByText(/can open their brief with the link you sent/),
    ).toBeInTheDocument();
    await press(user, 'Pause the brief');
    expect(
      await screen.findByText(/The brief is paused: its link opens nothing/),
    ).toBeInTheDocument();
    expect(sent).toEqual([
      { method: 'PATCH', path: '/api/v1/events/e1/vendors/b1', body: { isBriefEnabled: false } },
    ]);
  });

  it('says a paused brief opens nothing, and offers to open it again', async () => {
    const sent = serveOne(bookingWire({ isBriefEnabled: false }));
    const user = renderAt('/app/events/e1/vendors/b1');
    expect(await screen.findByText(/the link you sent opens nothing for now/)).toBeInTheDocument();
    await press(user, 'Let them see it again');
    expect(
      await screen.findByText('Tashir Catering can open their brief again.'),
    ).toBeInTheDocument();
    expect(sent[0]?.body).toEqual({ isBriefEnabled: true });
  });

  it('offers a reader no engaging an ended booking again (FR-6)', async () => {
    serveOne(bookingWire({ status: 'CANCELLED' }));
    renderAt('/app/events/e1/vendors/b1', ['vendor:read']);
    expect(await screen.findByText(/This booking was ended/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Engage again' })).not.toBeInTheDocument();
  });

  it('keeps a fee in a currency not on the usual list, offering it to choose (FR-106)', async () => {
    serveOne(bookingWire({ feeCurrency: 'JPY', feeMinor: '1500' }));
    renderAt('/app/events/e1/vendors/b1');
    const currency = await screen.findByLabelText('Currency');
    expect(currency).toHaveValue('JPY');
    expect(within(currency).getByRole('option', { name: /JPY/ })).toBeInTheDocument();
  });

  it('reads the event’s choices up to the furthest offset allowed, and no further', async () => {
    const offsets: number[] = [];
    server.use(
      http.get(`${API}/events/e1/vendor-options`, ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset'));
        offsets.push(offset);
        return HttpResponse.json(optionsWire([], { offset, hasMore: true }));
      }),
    );
    await listVendorChoices(session().api, 'e1');
    expect(offsets).toHaveLength(101);
    expect(offsets.at(-1)).toBe(10_000);
  });

  it('offers a reader no change to the booking (FR-6)', async () => {
    serveOne(bookingWire());
    renderAt('/app/events/e1/vendors/b1', ['vendor:read']);
    expect(
      await screen.findByText(/can open their brief with the link you sent/),
    ).toBeInTheDocument();
    for (const name of [
      'Pause the brief',
      'Save the booking',
      'End the booking',
      'Make a new link',
    ]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('sends only what changed', async () => {
    const sent = serveOne(bookingWire());
    const user = renderAt('/app/events/e1/vendors/b1');
    await user.selectOptions(await screen.findByLabelText('State'), 'CONFIRMED');
    expect(isLeavingAsked()).toBe(true);
    await press(user, 'Save the booking');
    expect(await screen.findByText('The booking was saved.')).toBeInTheDocument();
    expect(sent).toEqual([
      { method: 'PATCH', path: '/api/v1/events/e1/vendors/b1', body: { status: 'CONFIRMED' } },
    ]);
    expect(isLeavingAsked()).toBe(false);
  });

  it('says nothing changed, and sends nothing, when saved as it is', async () => {
    const sent = serveOne(bookingWire());
    const user = renderAt('/app/events/e1/vendors/b1');
    await press(user, 'Save the booking');
    expect(
      await screen.findByText('Nothing had changed, so nothing was sent.'),
    ).toBeInTheDocument();
    expect(sent).toEqual([]);
  });

  it('reloads behind the words when the booking is gone, then says it isn’t on the event', async () => {
    const sent = serve({ bookings: () => HttpResponse.json(sent.length ? [] : [bookingWire()]) });
    server.use(
      http.patch(`${API}/events/e1/vendors/b1`, ({ request }) => {
        sent.push({ method: 'PATCH', path: new URL(request.url).pathname, body: null });
        return refused(404)();
      }),
    );
    const user = renderAt('/app/events/e1/vendors/b1');
    await user.selectOptions(await screen.findByLabelText('State'), 'QUOTED');
    await press(user, 'Save the booking');
    expect(await screen.findByText(/This booking isn’t on the event/)).toBeInTheDocument();
  });

  it('words a role’s refusal to engage an ended booking again', async () => {
    serveOne(bookingWire({ status: 'CANCELLED' }));
    server.use(http.patch(`${API}/events/e1/vendors/b1`, refused(403)));
    const user = renderAt('/app/events/e1/vendors/b1');
    await press(user, 'Engage again');
    expect(await screen.findByText(/Your role can’t engage a vendor again/)).toBeInTheDocument();
  });

  it('marks the sections when the server refuses them', async () => {
    serveOne(bookingWire());
    server.use(
      http.patch(`${API}/events/e1/vendors/b1`, () =>
        HttpResponse.json(
          {
            statusCode: 400,
            message: ['each value in briefScopes must be one of the following values'],
            details: [{ field: 'briefScopes', code: 'INVALID', userMessage: 'Invalid' }],
          },
          { status: 400 },
        ),
      ),
    );
    const user = renderAt('/app/events/e1/vendors/b1');
    await user.click(await screen.findByRole('checkbox', { name: 'Bar' }));
    await press(user, 'Save the booking');
    expect(
      await screen.findByRole('group', { name: 'What their brief shares' }),
    ).toHaveAccessibleDescription(expect.stringContaining('This was refused.'));
  });

  it('words a role’s refusal to change it', async () => {
    serveOne(bookingWire());
    server.use(http.patch(`${API}/events/e1/vendors/b1`, refused(403)));
    const user = renderAt('/app/events/e1/vendors/b1');
    await user.selectOptions(await screen.findByLabelText('State'), 'QUOTED');
    await press(user, 'Save the booking');
    expect(await screen.findByText(/Your role can’t change bookings/)).toBeInTheDocument();
  });

  it('asks before ending it, then ends it', async () => {
    const sent = serveOne(bookingWire());
    const user = renderAt('/app/events/e1/vendors/b1');
    await press(user, 'End the booking');
    const dialog = await screen.findByRole('alertdialog', {
      name: 'End the booking with Tashir Catering?',
    });
    await user.click(within(dialog).getByRole('button', { name: 'End the booking' }));
    expect(await screen.findByText(/was ended. Their link no longer works/)).toBeInTheDocument();
    expect(sent).toEqual([{ method: 'DELETE', path: '/api/v1/events/e1/vendors/b1', body: null }]);
  });

  it('offers an ended booking no link to copy, and engages it again at once', async () => {
    const sent = serveOne(bookingWire({ status: 'CANCELLED' }));
    const user = renderAt('/app/events/e1/vendors/b1');
    expect(await screen.findByText(/so its link no longer works/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy the brief link' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('State')).not.toBeInTheDocument();
    await press(user, 'Engage again');
    expect(await screen.findByText(/is engaged again, with a new link/)).toBeInTheDocument();
    expect(sent).toEqual([
      { method: 'PATCH', path: '/api/v1/events/e1/vendors/b1', body: { status: 'ENQUIRED' } },
    ]);
  });

  it('says so when the booking isn’t on the event', async () => {
    serveOne(bookingWire({ id: 'other' }));
    renderAt('/app/events/e1/vendors/b1');
    expect(await screen.findByText(/This booking isn’t on the event/)).toBeInTheDocument();
  });
});
