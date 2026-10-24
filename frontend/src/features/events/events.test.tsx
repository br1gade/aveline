import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createPublicApi } from '@/api/client';
import { isApiError } from '@/api/errors';
import { createI18n } from '@/lib/i18n';

import { listEvents } from './api';
import { EventList } from './components/event-list';
import { loadEventOverview } from './load';

const ORIGIN = 'http://api.test';
const API = `${ORIGIN}/api/v1`;
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderList(events: Parameters<typeof EventList>[0]['events']) {
  const Stub = createRoutesStub([{ path: '/app', Component: () => <EventList events={events} /> }]);
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={['/app']} />
    </I18nextProvider>,
  );
}

describe('EventList', () => {
  it('says where events will appear when there are none, and links to creating one', async () => {
    renderList([]);
    expect(await screen.findByText('Your events will appear here.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create your first event' })).toHaveAttribute(
      'href',
      '/app/events/new',
    );
  });

  it('links each event to its overview', async () => {
    renderList([
      {
        id: 'e1',
        title: 'Anna & Davit',
        startsAt: '2027-06-12T11:00:00Z',
        timezone: 'Asia/Yerevan',
      },
    ]);
    expect(await screen.findByRole('link', { name: 'Anna & Davit' })).toHaveAttribute(
      'href',
      '/app/events/e1',
    );
  });

  it('dates each event in its own time zone, never the device’s', async () => {
    renderList([
      {
        id: 'e1',
        title: 'Anna & Davit',
        startsAt: '2027-06-12T11:00:00Z',
        timezone: 'Asia/Yerevan',
      },
      {
        id: 'e2',
        title: 'Launch',
        startsAt: '2027-06-12T11:00:00Z',
        timezone: 'America/Los_Angeles',
      },
    ]);
    const [yerevan, losAngeles] = await screen.findAllByRole('listitem');
    expect(yerevan).toHaveTextContent('Anna & Davit');
    expect(yerevan).toHaveTextContent('15:00');
    expect(losAngeles).toHaveTextContent('04:00');
  });
});

describe('listEvents', () => {
  it('sends none of the query parameters the schema wrongly requires (FR-17)', async () => {
    let search: string | undefined;
    server.use(
      http.get(`${API}/events`, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json([]);
      }),
    );
    expect(await listEvents(createPublicApi(ORIGIN))).toEqual([]);
    expect(search).toBe('');
  });
});

describe('loadEventOverview', () => {
  const event = { id: 'e1', title: 'Anna & Davit' };
  const headcount = { invited: 4, households: 2, attending: 2, declined: 1, undecided: 0 };

  function answer(dashboard: () => Response, eventResponse = () => HttpResponse.json(event)) {
    server.use(
      http.get(`${API}/events/e1`, eventResponse),
      http.get(`${API}/events/e1/dashboard`, dashboard),
    );
  }

  it('reads the event and its headcount', async () => {
    answer(() => HttpResponse.json({ headcount, catering: {} }));
    expect(await loadEventOverview(createPublicApi(ORIGIN), 'e1')).toEqual({
      event,
      headcount: { kind: 'ready', headcount },
    });
  });

  it('keeps the event when its numbers are refused to this role', async () => {
    answer(() => HttpResponse.json({ statusCode: 403, message: 'no' }, { status: 403 }));
    expect(await loadEventOverview(createPublicApi(ORIGIN), 'e1')).toEqual({
      event,
      headcount: { kind: 'refused' },
    });
  });

  it('keeps the event when its numbers fail, with the reference', async () => {
    answer(() =>
      HttpResponse.json({ statusCode: 500, message: 'boom', requestId: 'req-9' }, { status: 500 }),
    );
    expect(await loadEventOverview(createPublicApi(ORIGIN), 'e1')).toEqual({
      event,
      headcount: { kind: 'failed', requestId: 'req-9' },
    });
  });

  it('fails when the event itself cannot be read', async () => {
    answer(
      () => HttpResponse.json({ statusCode: 403, message: 'no' }, { status: 403 }),
      () => HttpResponse.json({ statusCode: 403, message: 'no' }, { status: 403 }),
    );
    const failure: unknown = await loadEventOverview(createPublicApi(ORIGIN), 'e1').catch(
      (error: unknown) => error,
    );
    expect(isApiError(failure) && failure.status).toBe(403);
  });
});
