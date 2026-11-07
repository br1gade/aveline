import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import { createI18n } from '@/lib/i18n';
import { guardedRoutes, isLeavingAsked } from '@/ui/app-form/guarded-routes';
import { APP_PATHS } from '@/route-paths';

import { AnnouncementForm } from './components/announcement-form';
import { TicketSalesPage } from './components/sales-page';
import { TicketTypePage } from './components/ticket-type-form';
import {
  loadAnnouncement,
  loadTicketSales,
  loadTicketType,
  type AnnouncementData,
  type TicketSalesData,
  type TicketTypeData,
} from './load';

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

const EVENT = {
  id: 'e1',
  title: 'Autumn Jazz Night',
  type: 'CONCERT',
  hostsLabel: 'The Garden',
  startsAt: '2027-10-02T15:00:00.000Z',
  endsAt: null,
  timezone: 'Asia/Yerevan',
  locales: ['hy', 'en'],
  defaultLocale: 'en',
  visibility: 'PUBLIC',
  invitation: null,
};

const TYPE = {
  id: 'general',
  name: { en: 'General', hy: 'Ընդհանուր' },
  description: {},
  priceMinor: '15000',
  currency: 'AMD',
  quantityTotal: 200,
  sold: 12,
  held: 2,
  available: 186,
  minPerOrder: 1,
  maxPerOrder: 10,
  salesStartAt: null,
  salesEndAt: '2027-10-01T20:00:00.000Z',
  isActive: true,
  sortOrder: 0,
};
const UNSOLD = {
  ...TYPE,
  id: 'vip',
  name: { en: 'VIP' },
  sold: 0,
  held: 0,
  available: 20,
  quantityTotal: 20,
  salesEndAt: null,
};

const LISTING = {
  id: 'l1',
  eventId: 'e1',
  slug: 'autumn-jazz-night',
  headline: { en: 'Autumn Jazz Night' },
  summary: {},
  body: {},
  ogTitle: {},
  ogDescription: {},
  categories: ['concert'],
  isIndexable: false,
  heroAssetId: null,
  ogImageId: null,
  publishedAt: '2026-10-20T10:00:00.000Z',
};

const server = setupServer();
const sent: Array<{ method: string; path: string; body: unknown }> = [];

function refusal(status: number, message: string | string[]) {
  return HttpResponse.json(
    { statusCode: status, message, requestId: `r-${status}` },
    { status, headers: { 'x-request-id': `r-${status}` } },
  );
}

function record(reply: () => Response) {
  return async ({ request }: { request: Request }) => {
    const text = await request.text();
    sent.push({
      method: request.method,
      path: new URL(request.url).pathname,
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
    http.get(`${API}/events/e1/ticket-types`, () => HttpResponse.json([TYPE, UNSOLD])),
    http.get(`${API}/events/e1/listing`, () => HttpResponse.json(LISTING)),
    http.get(`${API}/events/e1/media`, () => HttpResponse.json([])),
  );
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function api() {
  if (!current.session) throw new Error('No session');
  return current.session.api;
}

function renderAt(path: string) {
  const Stub = createRoutesStub(
    guardedRoutes([
      {
        path: APP_PATHS.ticketSales,
        loader: ({ params }) => loadTicketSales(api(), params.eventId ?? ''),
        Component: () => <TicketSalesPage data={useLoaderData<TicketSalesData>()} />,
      },
      {
        path: APP_PATHS.newTicketType,
        loader: ({ params }) => loadTicketType(api(), params.eventId ?? '', null),
        Component: () => <TicketTypePage data={useLoaderData<TicketTypeData>()} />,
      },
      {
        path: APP_PATHS.editTicketType,
        loader: ({ params }) => loadTicketType(api(), params.eventId ?? '', params.typeId ?? null),
        Component: () => <TicketTypePage data={useLoaderData<TicketTypeData>()} />,
      },
      {
        path: APP_PATHS.announcement,
        loader: ({ params }) => loadAnnouncement(api(), params.eventId ?? ''),
        Component: () => <AnnouncementForm data={useLoaderData<AnnouncementData>()} />,
      },
      { path: APP_PATHS.event, Component: () => <p>Event page</p> },
      { path: APP_PATHS.orders, Component: () => <p>Orders page</p> },
    ]),
  );
  const view = render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={[path]} />
    </I18nextProvider>,
  );
  return { ...view, user: userEvent.setup() };
}

describe('the ticket sales page (PD-84)', () => {
  it('shows who can find the event, the announcement and each type with its counts and window', async () => {
    renderAt('/app/events/e1/tickets');
    const visibility = await screen.findByRole('region', { name: 'Who can find this event' });
    expect(within(visibility).getByRole('radio', { name: 'Public · now' })).toBeChecked();
    const announcement = screen.getByRole('region', { name: 'The announcement' });
    expect(within(announcement).getByText(/^Public since/)).toBeInTheDocument();
    expect(
      within(announcement).getByRole('link', { name: /Open \/events\/autumn-jazz-night/ }),
    ).toHaveAttribute('href', '/events/autumn-jazz-night');
    const types = screen.getByRole('region', { name: 'Tickets for sale' });
    expect(
      within(types).getByText('Sold: 12 · held now: 2 · left: 186 of 200'),
    ).toBeInTheDocument();
    expect(
      within(types).getByText('On sale until Saturday, 2 October 2027, 00:00'),
    ).toBeInTheDocument();
    expect(
      within(types).queryByRole('button', { name: 'Remove: General' }),
    ).not.toBeInTheDocument();
    expect(within(types).getByRole('button', { name: 'Remove: VIP' })).toBeInTheDocument();
  });

  it('asks before making the event private, since that takes the announcement down', async () => {
    server.use(
      http.patch(
        `${API}/events/e1/settings`,
        record(() => HttpResponse.json({ id: 'e1', visibility: 'PRIVATE' })),
      ),
    );
    const { user } = renderAt('/app/events/e1/tickets');
    await user.click(await screen.findByRole('radio', { name: /^Private/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Make the event private?' });
    expect(sent).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Make it private' }));
    await waitFor(() =>
      expect(sent).toEqual([
        { method: 'PATCH', path: '/api/v1/events/e1/settings', body: { visibility: 'PRIVATE' } },
      ]),
    );
  });

  it('lists every reason publishing was refused, each with its fix', async () => {
    server.use(
      http.get(`${API}/events/e1/listing`, () =>
        HttpResponse.json({ ...LISTING, publishedAt: null }),
      ),
      http.post(`${API}/events/e1/listing/publish`, () =>
        refusal(400, [
          'This event is private. Set its visibility to PUBLIC or UNLISTED first, deliberately',
          'headline: give the listing a headline in at least one language',
          'Something new',
        ]),
      ),
    );
    const { user } = renderAt('/app/events/e1/tickets');
    await user.click(await screen.findByRole('button', { name: 'Publish' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/The event is private/)).toBeInTheDocument();
    expect(within(alert).getByRole('link', { name: 'Who can find this event' })).toHaveAttribute(
      'href',
      '#who-can-find-it',
    );
    expect(within(alert).getByRole('link', { name: 'Edit the announcement' })).toBeInTheDocument();
    expect(within(alert).getByText('Something new')).toHaveAttribute('lang', 'en');
  });

  it('stops selling a type, and offers only that once a removal is refused for its history', async () => {
    server.use(
      http.patch(
        `${API}/events/e1/ticket-types/general`,
        record(() => HttpResponse.json({ ...TYPE, isActive: false })),
      ),
      http.delete(`${API}/events/e1/ticket-types/vip`, () =>
        refusal(
          409,
          'This type has checkout history or someone started buying it; deactivate it instead',
        ),
      ),
    );
    const { user } = renderAt('/app/events/e1/tickets');
    await user.click(await screen.findByRole('button', { name: 'Stop selling: General' }));
    await waitFor(() =>
      expect(sent.at(-1)).toEqual({
        method: 'PATCH',
        path: '/api/v1/events/e1/ticket-types/general',
        body: { isActive: false },
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Remove: VIP' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(await within(dialog).findByText(/so it can only stop being sold/)).toBeInTheDocument();
  });
});

describe('a ticket type’s form (PD-85)', () => {
  it('asks before the page is left with what was typed, not before', async () => {
    const { user } = renderAt('/app/events/e1/tickets/types/new');
    const names = await screen.findByRole('group', { name: 'Name' });
    expect(isLeavingAsked()).toBe(false);
    await user.type(within(names).getByLabelText('English · default language'), 'Table seat');
    await waitFor(() => expect(isLeavingAsked()).toBe(true));
  });

  it('adds a type with its names, price, limits and window in the event’s zone', async () => {
    server.use(
      http.post(
        `${API}/events/e1/ticket-types`,
        record(() => HttpResponse.json(UNSOLD, { status: 201 })),
      ),
    );
    const { user } = renderAt('/app/events/e1/tickets/types/new');
    const names = await screen.findByRole('group', { name: 'Name' });
    await user.type(within(names).getByLabelText('English · default language'), 'Table seat');
    await user.type(screen.getByLabelText('Price (AMD)'), '15000');
    await user.type(screen.getByLabelText('How many tickets'), '40');
    const close = screen.getByRole('group', { name: 'Sales close' });
    await user.type(within(close).getByLabelText('Date'), '2027-10-02');
    await user.type(within(close).getByLabelText('Time'), '00:00');
    await user.click(screen.getByRole('button', { name: 'Add the ticket type' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({
      name: { en: 'Table seat' },
      priceMinor: '15000',
      quantityTotal: 40,
      minPerOrder: 1,
      maxPerOrder: 10,
      salesEndAt: '2027-10-01T20:00:00.000Z',
    });
  });

  it('keeps the words of a language the event no longer publishes, and says so', async () => {
    server.use(
      http.get(`${API}/events/e1/ticket-types`, () =>
        HttpResponse.json([{ ...TYPE, name: { ...TYPE.name, ru: 'Общий' } }, UNSOLD]),
      ),
      http.patch(
        `${API}/events/e1/ticket-types/general`,
        record(() => HttpResponse.json(TYPE)),
      ),
    );
    const { user } = renderAt('/app/events/e1/tickets/types/general');
    const names = await screen.findByRole('group', { name: 'Name' });
    const english = within(names).getByLabelText('English · default language');
    expect(within(names).getByLabelText('Русский · no longer published')).toHaveValue('Общий');
    await user.clear(english);
    await user.type(english, 'Standard');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(sent[0]?.body).toEqual({
        name: { en: 'Standard', hy: 'Ընդհանուր', ru: 'Общий' },
      }),
    );
  });

  it('sends only what changed, and says a set window can be moved, not removed', async () => {
    server.use(
      http.patch(
        `${API}/events/e1/ticket-types/general`,
        record(() => HttpResponse.json(TYPE)),
      ),
    );
    const { user } = renderAt('/app/events/e1/tickets/types/general');
    const quantity = await screen.findByLabelText('How many tickets');
    expect(screen.getByText('12 sold and 2 held now: not fewer than 14.')).toBeInTheDocument();
    await user.clear(quantity);
    await user.type(quantity, '13');
    const close = screen.getByRole('group', { name: 'Sales close' });
    await user.clear(within(close).getByLabelText('Date'));
    await user.clear(within(close).getByLabelText('Time'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Not fewer than are already sold or held.')).toBeInTheDocument();
    expect(screen.getByText('Once set, this can be moved but not removed.')).toBeInTheDocument();
    await user.clear(quantity);
    await user.type(quantity, '250');
    await user.type(within(close).getByLabelText('Date'), '2027-10-02');
    await user.type(within(close).getByLabelText('Time'), '00:00');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(sent).toEqual([
        {
          method: 'PATCH',
          path: '/api/v1/events/e1/ticket-types/general',
          body: { quantityTotal: 250 },
        },
      ]),
    );
  });
});

describe('the announcement (PD-86)', () => {
  it('asks before the page is left with what was typed, not before', async () => {
    const { user } = renderAt('/app/events/e1/tickets/announcement');
    const armenian = await screen.findByRole('group', { name: 'Հայերեն' });
    expect(isLeavingAsked()).toBe(false);
    await user.type(within(armenian).getByLabelText('Headline'), 'Աշնանային ջազ');
    await waitFor(() => expect(isLeavingAsked()).toBe(true));
  });

  it('keeps the words of a language the event no longer publishes, and says so', async () => {
    server.use(
      http.get(`${API}/events/e1/listing`, () =>
        HttpResponse.json({ ...LISTING, summary: { ru: 'Вечер джаза' } }),
      ),
      http.put(
        `${API}/events/e1/listing`,
        record(() => HttpResponse.json(LISTING)),
      ),
    );
    const { user } = renderAt('/app/events/e1/tickets/announcement');
    const armenian = await screen.findByRole('group', { name: 'Հայերեն' });
    const russian = screen.getByRole('group', { name: 'Русский · no longer published' });
    expect(within(russian).getByLabelText('Summary')).toHaveValue('Вечер джаза');
    await user.type(within(armenian).getByLabelText('Summary'), 'Աշուն');
    await user.click(screen.getByRole('button', { name: 'Save the announcement' }));
    await waitFor(() =>
      expect(sent[0]?.body).toEqual({ summary: { hy: 'Աշուն', ru: 'Вечер джаза' } }),
    );
  });

  it('saves what changed, and puts a taken address on its field', async () => {
    let attempt = 0;
    server.use(
      http.put(
        `${API}/events/e1/listing`,
        record(() => {
          attempt += 1;
          return attempt === 1
            ? refusal(409, 'The address "jazz" is already taken')
            : HttpResponse.json(LISTING);
        }),
      ),
    );
    const { user } = renderAt('/app/events/e1/tickets/announcement');
    const armenian = await screen.findByRole('group', { name: 'Հայերեն' });
    await user.type(within(armenian).getByLabelText('Headline'), 'Աշնանային ջազ');
    await user.clear(screen.getByLabelText('Address'));
    await user.type(screen.getByLabelText('Address'), 'jazz');
    await user.click(screen.getByRole('button', { name: 'Save the announcement' }));
    expect(await screen.findByText('Another event already uses this address.')).toBeInTheDocument();
    expect(sent[0]?.body).toEqual({
      headline: { en: 'Autumn Jazz Night', hy: 'Աշնանային ջազ' },
      slug: 'jazz',
    });
  });
});
