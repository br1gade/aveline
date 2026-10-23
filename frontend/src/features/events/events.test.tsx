import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createPublicApi } from '@/api/client';
import { createI18n } from '@/lib/i18n';

import { listEvents } from './api';
import { EventList } from './components/event-list';

const ORIGIN = 'http://api.test';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderList(events: Parameters<typeof EventList>[0]['events']) {
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <EventList events={events} />
    </I18nextProvider>,
  );
}

describe('EventList', () => {
  it('says where events will appear when there are none', () => {
    renderList([]);
    expect(screen.getByText('Your events will appear here.')).toBeInTheDocument();
  });

  it('dates each event in its own time zone, never the device’s', () => {
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
    const [yerevan, losAngeles] = screen.getAllByRole('listitem');
    expect(yerevan).toHaveTextContent('Anna & Davit');
    expect(yerevan).toHaveTextContent('15:00');
    expect(losAngeles).toHaveTextContent('04:00');
  });
});

describe('listEvents', () => {
  it('sends none of the query parameters the schema wrongly requires (FR-17)', async () => {
    let search: string | undefined;
    server.use(
      http.get(`${ORIGIN}/api/v1/events`, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json([]);
      }),
    );
    expect(await listEvents(createPublicApi(ORIGIN))).toEqual([]);
    expect(search).toBe('');
  });
});
