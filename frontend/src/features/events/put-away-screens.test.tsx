import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import { createI18n } from '@/lib/i18n';

import { listEvents } from './api';
import { ArchivedEvents } from './components/archived-events';
import { ArrivalStatus } from './components/event-list';
import { EventOverview } from './components/event-overview';
import { loadEventOverview, type EventOverviewData } from './load';
import type { EventStatus, EventSummary } from './types';

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
  current.session = createBrowserSession({
    baseUrl: ORIGIN,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
});
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

interface Served {
  status: EventStatus;
  statusBeforeArchive: EventStatus | null;
}

function serve(initial: Partial<Served> = {}) {
  const state: Served = { status: 'DRAFT', statusBeforeArchive: null, ...initial };
  const reads = { event: 0 };
  server.use(
    http.get(`${API}/events/e1`, () => {
      reads.event += 1;
      return HttpResponse.json({
        id: 'e1',
        title: 'Anna & Davit',
        type: 'WEDDING',
        hostsLabel: 'Anna & Davit',
        startsAt: '2027-06-12T11:00:00.000Z',
        endsAt: null,
        timezone: 'Asia/Yerevan',
        locales: ['en'],
        defaultLocale: 'en',
        sideALabel: null,
        sideBLabel: null,
        invitation: { slug: 'anna-davit', status: 'DRAFT' },
        ...state,
      });
    }),
    http.get(`${API}/events/e1/dashboard`, () =>
      HttpResponse.json({ statusCode: 403, message: 'no' }, { status: 403 }),
    ),
  );
  return { state, reads };
}

const refused =
  (status: number, message = 'refused') =>
  () =>
    HttpResponse.json({ statusCode: status, message, requestId: 'req-1' }, { status });

function Overview() {
  return <EventOverview data={useLoaderData<EventOverviewData>()} />;
}

function renderOverview() {
  const Stub = createRoutesStub([
    {
      path: '/app/events/:eventId',
      loader: ({ params }) => loadEventOverview(session().api, params.eventId ?? ''),
      Component: Overview,
    },
    { path: '/app', Component: () => <ArrivalStatus /> },
  ]);
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={['/app/events/e1']} />
    </I18nextProvider>,
  );
  return userEvent.setup();
}

describe('archiving', () => {
  it('asks first, saying nothing is deleted, then archives and says so', async () => {
    const { state, reads } = serve({ status: 'PUBLISHED' });
    const pressed: string[] = [];
    server.use(
      http.post(`${API}/events/e1/archive`, () => {
        pressed.push('archive');
        state.statusBeforeArchive = state.status;
        state.status = 'ARCHIVED';
        return HttpResponse.json({ id: 'e1' });
      }),
    );
    const user = renderOverview();
    await user.click(await screen.findByRole('button', { name: 'Archive this event…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Nothing is deleted.');
    expect(pressed).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));
    const status = await screen.findByText('The event is archived.');
    await waitFor(() => expect(status).toHaveFocus());
    expect(pressed).toEqual(['archive']);
    expect(reads.event).toBe(2);
    expect(screen.getByText(/guests can read its invitation but not reply/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bring it back' })).toBeInTheDocument();
  });

  it('words a 403 in the dialog, which stays open', async () => {
    serve();
    server.use(http.post(`${API}/events/e1/archive`, refused(403)));
    const user = renderOverview();
    await user.click(await screen.findByRole('button', { name: 'Archive this event…' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Only the event’s owner, or the organization’s, can archive or delete it.',
    );
  });
});

describe('bringing an event back', () => {
  it('goes at once and says the invitation stays closed', async () => {
    const { state } = serve({ status: 'ARCHIVED', statusBeforeArchive: 'PUBLISHED' });
    server.use(
      http.post(`${API}/events/e1/unarchive`, () => {
        state.status = 'PUBLISHED';
        state.statusBeforeArchive = null;
        return HttpResponse.json({ id: 'e1' });
      }),
    );
    const user = renderOverview();
    await user.click(await screen.findByRole('button', { name: 'Bring it back' }));
    expect(
      await screen.findByText(/Its invitation stays closed until you reopen it/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive this event…' })).toBeInTheDocument();
  });

  it('reloads when it was no longer archived', async () => {
    const { reads } = serve({ status: 'ARCHIVED', statusBeforeArchive: 'DRAFT' });
    server.use(http.post(`${API}/events/e1/unarchive`, refused(400, 'This event is not archived')));
    const user = renderOverview();
    await user.click(await screen.findByRole('button', { name: 'Bring it back' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer archived');
    await waitFor(() => expect(reads.event).toBe(2));
  });
});

describe('deleting', () => {
  it('is never one tap away: Cancel has the focus, and Delete waits for the box', async () => {
    serve();
    const deleted: string[] = [];
    server.use(
      http.delete(`${API}/events/e1`, () => {
        deleted.push('e1');
        return HttpResponse.json({ deleted: 'e1' });
      }),
    );
    const user = renderOverview();
    const opener = await screen.findByRole('button', { name: 'Delete this event…' });
    await user.click(opener);
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    const confirm = within(dialog).getByRole('button', { name: 'Delete for good' });
    expect(confirm).toBeDisabled();
    await user.keyboard('{Enter}');
    expect(deleted).toEqual([]);
    await waitFor(() => expect(opener).toHaveFocus());
    await user.click(opener);
    const again = await screen.findByRole('alertdialog');
    await user.click(within(again).getByRole('checkbox', { name: /deleted for good/ }));
    await user.click(within(again).getByRole('button', { name: 'Delete for good' }));
    const replaced = vi.spyOn(window.history, 'replaceState');
    const status = await screen.findByText('“Anna & Davit” is deleted.');
    await waitFor(() => expect(status).toHaveFocus());
    expect(deleted).toEqual(['e1']);
    // Taken out of the history entry, so a reload or Back doesn't say it again.
    expect(replaced).toHaveBeenCalledWith(expect.objectContaining({ usr: null }), '');
  });

  it('isn’t offered for an event that was published, and says why', async () => {
    serve({ status: 'ARCHIVED', statusBeforeArchive: 'PUBLISHED' });
    renderOverview();
    expect(await screen.findByText(/it can be archived, not deleted/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete this event…' })).not.toBeInTheDocument();
  });

  it('words money that moved, and reloads', async () => {
    const { reads } = serve();
    server.use(
      http.delete(
        `${API}/events/e1`,
        refused(
          409,
          'Money has moved through this event, and those records are kept; archive it instead',
        ),
      ),
    );
    const user = renderOverview();
    await user.click(await screen.findByRole('button', { name: 'Delete this event…' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('checkbox', { name: /deleted for good/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Delete for good' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('archive it instead');
    await waitFor(() => expect(reads.event).toBe(2));
  });
});

describe('the archived list', () => {
  it('asks the API for archived events only', async () => {
    const urls: string[] = [];
    server.use(
      http.get(`${API}/events`, ({ request }) => {
        urls.push(new URL(request.url).search);
        return HttpResponse.json([]);
      }),
    );
    await listEvents(session().api, { isArchiveWanted: true });
    await listEvents(session().api);
    expect(urls).toEqual(['?archived=true', '']);
  });

  function renderArchived(events: EventSummary[]) {
    const Stub = createRoutesStub([
      { path: '/a', Component: () => <ArchivedEvents events={events} /> },
    ]);
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <Stub initialEntries={['/a']} />
      </I18nextProvider>,
    );
  }

  it('links each to its overview', async () => {
    renderArchived([
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

  it('says when there are none, without offering to create one', async () => {
    renderArchived([]);
    expect(await screen.findByText('No event is archived.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create your first event' })).not.toBeInTheDocument();
  });
});
