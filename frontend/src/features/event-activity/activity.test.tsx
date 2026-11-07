import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import { createI18n } from '@/lib/i18n';

import { ActivityPage } from './components/activity-page';
import { loadActivity, type ActivityData } from './load';

const ORIGIN = 'http://api.test';
const API = `${ORIGIN}/api/v1`;
const server = setupServer();
let session: BrowserSession;

const EVENT = {
  id: 'e1',
  title: 'Anna & Davit',
  timezone: 'Asia/Yerevan',
  locales: ['en'],
  defaultLocale: 'en',
};
const entry = (over: Record<string, unknown> = {}) => ({
  action: 'events.guests.import.create',
  method: 'POST',
  route: '/events/:eventId/guests/import',
  userId: 'u1',
  email: 'host@example.am',
  organizationId: 'o1',
  eventId: 'e1',
  statusCode: 201,
  requestId: 'secret-request-id',
  at: '2026-10-05T21:02:11.000Z',
  ...over,
});

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  session = createBrowserSession({
    baseUrl: ORIGIN,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
  server.use(http.get(`${API}/events/e1`, () => HttpResponse.json(EVENT)));
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function answerTrail(reply: () => Response) {
  server.use(http.get(`${API}/events/e1/audit-trail`, reply));
}

async function open() {
  const Stub = createRoutesStub([
    {
      path: '/activity',
      HydrateFallback: () => null,
      loader: () => loadActivity(session.api, 'e1'),
      Component: () => <ActivityPage data={useLoaderData<ActivityData>()} />,
    },
    { path: '/app/events/e1', Component: () => <p>The event</p> },
  ]);
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={['/activity']} />
    </I18nextProvider>,
  );
  await screen.findByRole('heading', { level: 1, name: 'Activity' });
}

describe('an event’s activity (PD-158)', () => {
  it('says who, what and when, in the event’s own zone, newest first as read', async () => {
    answerTrail(() =>
      HttpResponse.json([
        entry(),
        entry({
          method: 'DELETE',
          route: '/events/:eventId/team/:userId',
          email: 'second@example.am',
          at: '2026-10-04T08:00:00.000Z',
        }),
      ]),
    );
    await open();
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('host@example.am');
    expect(rows[0]).toHaveTextContent('The guest list: something added or done');
    // 21:02 in UTC is already the next day in Yerevan.
    expect(rows[0]).toHaveTextContent('6 October 2026');
    expect(rows[0]).toHaveTextContent('01:02');
    expect(rows[1]).toHaveTextContent('The team: something removed');
    expect(rows[1]).toHaveTextContent('second@example.am');
  });

  it('keeps what the page doesn’t need off it', async () => {
    answerTrail(() => HttpResponse.json([entry()]));
    await open();
    expect(document.body).not.toHaveTextContent('secret-request-id');
    expect(document.body).not.toHaveTextContent('events.guests.import.create');
  });

  it('names no one whose address was erased, and blames no one else for it', async () => {
    answerTrail(() => HttpResponse.json([entry({ email: null })]));
    await open();
    expect(screen.getByText('Someone no longer named')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('link');
  });

  it('keeps the order it is given', async () => {
    answerTrail(() =>
      HttpResponse.json([
        entry({ email: 'older@example.am', at: '2026-10-01T08:00:00.000Z' }),
        entry({ email: 'newer@example.am', at: '2026-10-09T08:00:00.000Z' }),
      ]),
    );
    await open();
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('older@example.am');
    expect(rows[1]).toHaveTextContent('newer@example.am');
  });

  it('shows a part it has no word for as it came, marked English', async () => {
    answerTrail(() => HttpResponse.json([entry({ route: '/events/:eventId/brand-new' })]));
    await open();
    expect(screen.getByText('/events/:eventId/brand-new')).toHaveAttribute('lang', 'en');
  });

  it('doesn’t state nothing as a fact, as a failed read looks the same (FR-123)', async () => {
    answerTrail(() => HttpResponse.json([]));
    await open();
    expect(screen.getByText(/or the record can’t be read just now/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('says only the newest hundred are shown', async () => {
    answerTrail(() => HttpResponse.json([entry()]));
    await open();
    expect(screen.getByText('The newest 100 are shown.')).toBeInTheDocument();
  });

  it('words a role that may not see it, saying the rest stays open', async () => {
    answerTrail(() =>
      HttpResponse.json({ statusCode: 403, message: 'Forbidden' }, { status: 403 }),
    );
    await open();
    expect(screen.getByText(/The rest of the event stays open to you/)).toBeInTheDocument();
  });

  it('gives a reference when the read fails', async () => {
    answerTrail(() =>
      HttpResponse.json(
        { statusCode: 500, message: 'Boom', requestId: 'r-9' },
        { status: 500, headers: { 'x-request-id': 'r-9' } },
      ),
    );
    await open();
    expect(document.body).toHaveTextContent('r-9');
  });
});
