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

import { RunningOrderPage } from './components/running-order-page';
import { loadRunningOrder, type RunningOrderData } from './load';
import type { TimelineEntryWire } from './types';

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
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const EVENT = {
  id: 'e1',
  title: 'The wedding of Anna and Davit',
  type: 'WEDDING',
  hostsLabel: 'Anna & Davit',
  startsAt: '2027-06-12T11:00:00.000Z',
  endsAt: null,
  timezone: 'Asia/Yerevan',
  locales: ['hy', 'en'],
  defaultLocale: 'en',
  sideALabel: null,
  sideBLabel: null,
  invitation: null,
  venues: [
    { id: 'church', role: 'CEREMONY', name: 'Saint Gayane' },
    { id: 'hall', role: 'RECEPTION', name: 'The hall' },
  ],
};

function entries(): TimelineEntryWire[] {
  return [
    {
      id: 't1',
      label: { hy: 'Պսակադրություն', en: 'Ceremony' },
      occursAt: '2027-06-12T11:00:00.000Z',
      sortOrder: 0,
      isInternal: false,
      venue: { id: 'church', name: 'Saint Gayane' },
    },
    {
      id: 't2',
      label: { en: 'Dinner' },
      occursAt: '2027-06-12T15:00:00.000Z',
      sortOrder: 0,
      isInternal: false,
      venue: { id: 'hall', name: 'The hall' },
    },
    {
      id: 't3',
      label: { en: 'Caterer arrives' },
      // 23:30 UTC is the next day in Yerevan.
      occursAt: '2027-06-12T20:30:00.000Z',
      sortOrder: 0,
      isInternal: true,
      venue: { id: 'hall', name: 'The hall' },
    },
  ];
}

function serve(read: () => Response = () => HttpResponse.json(entries())) {
  const reads = { list: 0 };
  server.use(
    http.get(`${API}/events/e1`, () => HttpResponse.json(EVENT)),
    http.get(`${API}/events/e1/timeline`, () => {
      reads.list += 1;
      return read();
    }),
  );
  return reads;
}

const refused =
  (status: number, message = 'refused') =>
  () =>
    HttpResponse.json({ statusCode: status, message, requestId: 'req-1' }, { status });

function Page() {
  return <RunningOrderPage data={useLoaderData<RunningOrderData>()} />;
}

function renderPage(language: 'en' | 'hy' = 'en') {
  const Stub = createRoutesStub(
    guardedRoutes([
      {
        path: '/app/events/:eventId/running-order',
        loader: ({ params }) => loadRunningOrder(session().api, params.eventId ?? ''),
        Component: Page,
      },
    ]),
  );
  render(
    <I18nextProvider i18n={createI18n(language)}>
      <Stub initialEntries={['/app/events/e1/running-order']} />
    </I18nextProvider>,
  );
  return userEvent.setup();
}

async function submit(dialog: HTMLElement, name: string) {
  const button = within(dialog).getByRole('button', { name });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

describe('the running order, as shown', () => {
  it('lists entries by day in the event’s zone, with venue and the team mark', async () => {
    serve();
    renderPage();
    expect(await screen.findByText('Ceremony')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Saturday, 12 June 2027' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sunday, 13 June 2027' })).toBeInTheDocument();
    expect(screen.getByText('15:00')).toBeInTheDocument();
    expect(screen.getByText('00:30')).toBeInTheDocument();
    expect(screen.getByText('At Saint Gayane')).toBeInTheDocument();
    expect(screen.getByText(/For the team only/)).toBeInTheDocument();
    expect(screen.getByText(/Asia\/Yerevan/)).toBeInTheDocument();
  });

  it('marks a name shown in another language than the page’s', async () => {
    serve(() => HttpResponse.json([{ ...entries()[0], label: { hy: 'Պսակադրություն' } }]));
    renderPage();
    expect(await screen.findByText('Պսակադրություն')).toHaveAttribute('lang', 'hy');
  });

  it('says when there is nothing yet', async () => {
    serve(() => HttpResponse.json([]));
    renderPage();
    expect(await screen.findByText('Nothing in the running order yet.')).toBeInTheDocument();
  });

  it('gives a failed read’s reference, and offers no adding without the list', async () => {
    serve(refused(500));
    renderPage();
    expect(await screen.findByText(/req-1/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add an entry' })).not.toBeInTheDocument();
  });
});

describe('adding an entry', () => {
  it('sends the time as UTC in the event’s zone, last at its minute, then says so', async () => {
    const reads = serve();
    const received: unknown[] = [];
    server.use(
      http.post(`${API}/events/e1/timeline`, async ({ request }) => {
        received.push(await request.json());
        return HttpResponse.json({ id: 't9' }, { status: 201 });
      }),
    );
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Add an entry' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('English'), 'Vows');
    await user.type(within(dialog).getByLabelText('Time'), '15:00');
    await user.selectOptions(within(dialog).getByLabelText('Where'), 'church');
    expect(isLeavingAsked()).toBe(true);
    await user.click(await submit(dialog, 'Add'));
    const status = await screen.findByText('“Vows” is in the running order.');
    await waitFor(() => expect(status).toHaveFocus());
    expect(received).toEqual([
      {
        label: { en: 'Vows' },
        occursAt: '2027-06-12T11:00:00.000Z',
        venueId: 'church',
        isInternal: false,
        sortOrder: 1,
      },
    ]);
    expect(reads.list).toBe(2);
  });

  it('refuses no name in any language before sending', async () => {
    serve();
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Add an entry' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Time'), '15:00');
    await user.click(await submit(dialog, 'Add'));
    expect(
      await within(dialog).findByText('Give it a name in one language at least.'),
    ).toBeInTheDocument();
  });

  it('can’t be dismissed while it sends, and Cancel returns the focus to the button', async () => {
    serve();
    let release = () => undefined as void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(`${API}/events/e1/timeline`, async () => {
        await held;
        return refused(403)();
      }),
    );
    const user = renderPage();
    const opener = await screen.findByRole('button', { name: 'Add an entry' });
    await user.click(opener);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('English'), 'Vows');
    await user.type(within(dialog).getByLabelText('Time'), '15:00');
    await user.click(await submit(dialog, 'Add'));
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled(),
    );
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    release();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Your role on this event can’t change the running order.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(opener).toHaveFocus());
  });
});

describe('correcting an entry', () => {
  it('sends only what changed', async () => {
    serve();
    const received: unknown[] = [];
    server.use(
      http.patch(`${API}/events/e1/timeline/t1`, async ({ request }) => {
        received.push(await request.json());
        return HttpResponse.json({ id: 't1' });
      }),
    );
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Edit: Ceremony' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Time')).toHaveValue('15:00');
    const english = within(dialog).getByLabelText('English');
    await user.clear(english);
    await user.type(english, 'The ceremony');
    await user.click(await submit(dialog, 'Save'));
    expect(await screen.findByText('“The ceremony” is saved.')).toBeInTheDocument();
    expect(received).toEqual([{ label: { en: 'The ceremony' } }]);
  });

  it('closes without a request when nothing changed', async () => {
    serve();
    const patches: unknown[] = [];
    server.use(
      http.patch(`${API}/events/e1/timeline/t1`, () => {
        patches.push('patch');
        return HttpResponse.json({ id: 't1' });
      }),
    );
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Edit: Ceremony' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(await submit(dialog, 'Save'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(patches).toEqual([]);
  });

  it('warns before taking a venue away from guests, and words the backend’s refusal', async () => {
    serve();
    server.use(
      http.patch(
        `${API}/events/e1/timeline/t2`,
        refused(
          409,
          'venue: attendance, checkout choices or seats exist; keep the venue guest-facing to preserve history',
        ),
      ),
    );
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Edit: Dinner' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText(/Guests would no longer see/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('checkbox', { name: 'For the team only' }));
    expect(within(dialog).getByText(/Guests would no longer see The hall/)).toBeInTheDocument();
    await user.click(await submit(dialog, 'Save'));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('must stay shown to them');
  });
});

describe('removing an entry', () => {
  it('asks first, then removes', async () => {
    const reads = serve();
    const removed: string[] = [];
    server.use(
      http.delete(`${API}/events/e1/timeline/t1`, () => {
        removed.push('t1');
        return HttpResponse.json({ ok: true });
      }),
    );
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Remove: Ceremony' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(removed).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('“Ceremony” is out of the running order.')).toBeInTheDocument();
    expect(removed).toEqual(['t1']);
    expect(reads.list).toBe(2);
  });

  it('warns that removing a venue’s last guest entry hides the venue', async () => {
    serve();
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Remove: Dinner' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Guests would no longer see The hall/)).toBeInTheDocument();
  });

  it('reloads when it was already gone', async () => {
    const reads = serve();
    server.use(
      http.delete(
        `${API}/events/e1/timeline/t1`,
        refused(404, 'No such timeline entry on this event'),
      ),
    );
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Remove: Ceremony' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'no longer in the running order',
    );
    await waitFor(() => expect(reads.list).toBe(2));
  });
});

describe('in Armenian', () => {
  it('words each entry’s buttons', async () => {
    serve();
    renderPage('hy');
    expect(await screen.findByRole('button', { name: 'Հեռացնել՝ Ceremony' })).toBeInTheDocument();
  });
});
