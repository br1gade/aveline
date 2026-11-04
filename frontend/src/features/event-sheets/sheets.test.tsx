import { render, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import { createI18n } from '@/lib/i18n';

import { SheetsPage } from './components/sheets-page';
import { loadSheets, type SheetsData } from './load';

const ORIGIN = 'http://api.test';
const API = `${ORIGIN}/api/v1`;
const server = setupServer();
let session: BrowserSession;

const event = {
  id: 'e1',
  title: 'Anna & Davit',
  attendanceMode: 'PER_VENUE',
  timezone: 'Asia/Yerevan',
};
const dashboard = {
  headcount: {
    invited: 10,
    venues: [
      { venueId: 'v1', venue: 'Church' },
      { venueId: 'v2', venue: 'Hall' },
    ],
  },
  catering: {
    covers: 40,
    requirements: [{ requirement: 'Vegan', key: 'vegan', count: 3 }],
    notes: [
      { guest: 'Ani Petrosyan', household: 'Petrosyan family', note: 'No nuts' },
      { guest: 'Empty Note', household: 'X', note: null },
    ],
  },
  bar: {
    totalResponses: 20,
    preferences: [{ drink: 'Wine', key: 'wine', guests: 15, share: 75 }],
  },
  playlist: { uniqueTracks: 1, tracks: [{ track: 'Sirun Yar', requests: 3 }] },
  engagement: {
    totalViews: 120,
    byLocale: [
      { locale: 'hy', views: 100 },
      { locale: 'xx', views: 20 },
    ],
  },
  generatedAt: '2026-11-04T10:00:00Z',
};

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  session = createBrowserSession({
    baseUrl: ORIGIN,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
  server.use(http.get(`${API}/events/e1`, () => HttpResponse.json(event)));
});
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

function Loaded() {
  return <SheetsPage data={useLoaderData<SheetsData>()} />;
}

async function open(path = '/sheets') {
  const Stub = createRoutesStub([
    {
      path: '/sheets',
      Component: Loaded,
      HydrateFallback: () => null,
      loader: ({ request }: LoaderFunctionArgs) =>
        loadSheets(session.api, 'e1', new URL(request.url).searchParams.get('venue')),
    },
  ]);
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={[path]} />
    </I18nextProvider>,
  );
  await screen.findByRole('heading', { name: 'What guests’ answers add up to' });
}

describe('the event’s sheets', () => {
  it('shows all four from one read of the dashboard', async () => {
    let reads = 0;
    server.use(
      http.get(`${API}/events/e1/dashboard`, () => {
        reads += 1;
        return HttpResponse.json(dashboard);
      }),
    );
    await open();
    expect(reads).toBe(1);
    const catering = screen.getByRole('region', { name: 'Catering' });
    expect(within(catering).getByText('40 covers')).toBeInTheDocument();
    expect(within(catering).getByText('Vegan')).toBeInTheDocument();
    expect(within(catering).getByText('No nuts')).toBeInTheDocument();
    expect(within(catering).queryByText('Empty Note')).not.toBeInTheDocument();
    const bar = screen.getByRole('region', { name: 'Bar' });
    expect(within(bar).getByText('15 · 75%')).toBeInTheDocument();
    const playlist = screen.getByRole('region', { name: 'Playlist' });
    expect(within(playlist).getByText('Sirun Yar')).toBeInTheDocument();
    expect(within(playlist).getByText('3 requests')).toBeInTheDocument();
    const views = screen.getByRole('region', { name: 'Invitation views' });
    expect(within(views).getByText('120 views')).toBeInTheDocument();
    expect(within(views).getByText('xx')).toBeInTheDocument();
  });

  it('reads one venue’s catering and bar when one is chosen, saying the rest is event-wide', async () => {
    const asked: (string | null)[] = [];
    server.use(
      http.get(`${API}/events/e1/dashboard`, () => HttpResponse.json(dashboard)),
      http.get(`${API}/events/e1/catering-sheet`, ({ request }) => {
        asked.push(new URL(request.url).searchParams.get('venueId'));
        return HttpResponse.json({ ...dashboard.catering, covers: 7 });
      }),
      http.get(`${API}/events/e1/bar-sheet`, ({ request }) => {
        asked.push(new URL(request.url).searchParams.get('venueId'));
        return HttpResponse.json(dashboard.bar);
      }),
    );
    await open('/sheets?venue=v2');
    expect(asked).toEqual(['v2', 'v2']);
    const catering = screen.getByRole('region', { name: 'Catering' });
    expect(within(catering).getByText('7 covers')).toBeInTheDocument();
    expect(within(catering).getByText('At Hall')).toBeInTheDocument();
    const playlist = screen.getByRole('region', { name: 'Playlist' });
    expect(within(playlist).getByText(/whole event/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Hall' })).toHaveAttribute('aria-current', 'page');
  });

  it('ignores a venue in the address that isn’t a choice', async () => {
    server.use(http.get(`${API}/events/e1/dashboard`, () => HttpResponse.json(dashboard)));
    await open('/sheets?venue=old');
    expect(screen.getByRole('link', { name: 'Whole event' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('offers no venue choice with only one venue to choose', async () => {
    const oneVenue = {
      ...dashboard,
      headcount: { ...dashboard.headcount, venues: [dashboard.headcount.venues[0]] },
    };
    server.use(http.get(`${API}/events/e1/dashboard`, () => HttpResponse.json(oneVenue)));
    await open('/sheets?venue=v1');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('offers no venue choice when guests answer once for the event', async () => {
    server.use(
      http.get(`${API}/events/e1`, () =>
        HttpResponse.json({ ...event, attendanceMode: 'EVENT_WIDE' }),
      ),
      http.get(`${API}/events/e1/dashboard`, () => HttpResponse.json(dashboard)),
    );
    await open('/sheets?venue=v2');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Catering' })).getByText('40 covers'),
    ).toBeInTheDocument();
  });

  it('words each sheet with nothing in it, and doesn’t state zero views as a fact', async () => {
    server.use(
      http.get(`${API}/events/e1/dashboard`, () =>
        HttpResponse.json({
          headcount: {},
          catering: { covers: 0, requirements: [], notes: [] },
          bar: { totalResponses: 0, preferences: [] },
          playlist: { uniqueTracks: 0, tracks: [] },
          engagement: { totalViews: 0, byLocale: [] },
        }),
      ),
    );
    await open();
    expect(screen.getByText('0 covers')).toBeInTheDocument();
    expect(screen.getByText(/Nobody coming has named a requirement/)).toBeInTheDocument();
    expect(screen.getByText(/Nobody coming has named a drink/)).toBeInTheDocument();
    expect(screen.getByText(/Nobody coming has asked for a song/)).toBeInTheDocument();
    expect(screen.getByText(/No views recorded/)).toBeInTheDocument();
    expect(screen.getByText(/No views recorded/)).toHaveTextContent('may not be running');
  });

  it('tells a role without the numbers so', async () => {
    server.use(
      http.get(`${API}/events/e1/dashboard`, () =>
        HttpResponse.json({ statusCode: 403, message: 'Forbidden' }, { status: 403 }),
      ),
    );
    await open();
    expect(screen.getByText(/aren’t available to your role/)).toBeInTheDocument();
  });

  it.each([
    [500, /Something went wrong/],
    [429, /Too many/],
  ])('words a %i with the event still shown', async (status, words) => {
    server.use(
      http.get(`${API}/events/e1/dashboard`, () =>
        HttpResponse.json({ statusCode: status, message: 'x', requestId: 'req-9' }, { status }),
      ),
    );
    await open();
    expect(screen.getByText(words)).toBeInTheDocument();
    expect(screen.getByText('Anna & Davit')).toBeInTheDocument();
  });

  it('words one venue’s sheet refused while the rest stands', async () => {
    server.use(
      http.get(`${API}/events/e1/dashboard`, () => HttpResponse.json(dashboard)),
      http.get(`${API}/events/e1/catering-sheet`, () =>
        HttpResponse.json({ statusCode: 500, message: 'x', requestId: 'req-8' }, { status: 500 }),
      ),
      http.get(`${API}/events/e1/bar-sheet`, () => HttpResponse.json(dashboard.bar)),
    );
    await open('/sheets?venue=v1');
    expect(
      within(screen.getByRole('region', { name: 'Catering' })).getByText(/req-8/),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Bar' })).getByText('Wine'),
    ).toBeInTheDocument();
  });
});
