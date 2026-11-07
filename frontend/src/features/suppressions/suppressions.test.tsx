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

import { SuppressionsPage } from './components/suppressions-page';
import { loadSuppressions, type SuppressionsData } from './load';
import type { SuppressionWire } from './types';

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

function list(): SuppressionWire[] {
  return [
    {
      id: 's1',
      channel: 'EMAIL',
      address: 'ani@example.am',
      reason: 'UNSUBSCRIBED',
      scope: 'ORGANIZATION',
      createdAt: '2026-10-01T22:30:00.000Z',
    },
    {
      id: 's2',
      channel: 'EMAIL',
      address: 'gone@example.am',
      reason: 'HARD_BOUNCE',
      scope: 'GLOBAL',
      createdAt: '2026-09-01T10:00:00.000Z',
    },
    {
      id: 's3',
      channel: 'EMAIL',
      address: '[erased]',
      reason: 'ERASED',
      scope: 'ORGANIZATION',
      createdAt: '2026-08-01T10:00:00.000Z',
    },
  ];
}

function serve(read: () => Response = () => HttpResponse.json(list())) {
  const reads = { list: 0 };
  server.use(
    http.get(`${API}/suppressions`, () => {
      reads.list += 1;
      return read();
    }),
  );
  return reads;
}

const refused =
  (status: number, message = 'refused', code?: string) =>
  () =>
    HttpResponse.json(
      { statusCode: status, message, requestId: 'req-1', ...(code ? { code } : {}) },
      { status },
    );

function Page() {
  return <SuppressionsPage data={useLoaderData<SuppressionsData>()} />;
}

function renderPage() {
  const Stub = createRoutesStub(
    guardedRoutes([
      { path: '/app/suppressions', loader: () => loadSuppressions(session().api), Component: Page },
    ]),
  );
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={['/app/suppressions']} />
    </I18nextProvider>,
  );
  return userEvent.setup();
}

async function submit(user: ReturnType<typeof userEvent.setup>) {
  const button = await screen.findByRole('button', { name: 'Add to the list' });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
}

describe('the list', () => {
  it('shows each entry with its reason, the day in Yerevan, and lifts only what may be', async () => {
    serve();
    renderPage();
    expect(await screen.findByText('ani@example.am')).toBeInTheDocument();
    // 22:30 UTC on 1 October is already 2 October in Yerevan.
    expect(screen.getByText('Email · unsubscribed · added 2 October 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow again: ani@example.am' })).toBeInTheDocument();
    expect(
      screen.getByText(/after a bounce or a complaint, so it can’t be lifted here/),
    ).toBeInTheDocument();
    expect(screen.getByText('An address no longer kept')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Allow again/ })).toHaveLength(1);
  });

  it('says the list may stop at 500', async () => {
    serve(() =>
      HttpResponse.json(
        Array.from({ length: 500 }, (_, index) => ({ ...list()[0], id: `s${index}` })),
      ),
    );
    renderPage();
    expect(await screen.findByText(/Only the newest 500 are shown/)).toBeInTheDocument();
  });

  it('tells someone on an event only that the list is the organization’s, and keeps the form', async () => {
    serve(refused(403, 'organizationId: access is unavailable', 'ORGANIZATION_ACCESS_DENIED'));
    renderPage();
    expect(await screen.findByText(/your account is on an event only/)).toBeInTheDocument();
    expect(screen.getByLabelText('Their address')).toBeInTheDocument();
  });

  it('tells a member or viewer who can see it', async () => {
    serve(refused(403, 'This account may not guest:contact:read', 'FORBIDDEN'));
    renderPage();
    expect(
      await screen.findByText(
        'Only the organization’s owner or a manager can see or change this list.',
      ),
    ).toBeInTheDocument();
  });
});

describe('adding someone', () => {
  it('asks before the page is left with what was typed, and not once it is saved', async () => {
    serve();
    server.use(
      http.post(`${API}/suppressions`, () => HttpResponse.json({ id: 's9' }, { status: 201 })),
    );
    const user = renderPage();
    await user.type(await screen.findByLabelText('Their address'), 'davit@example.am');
    await waitFor(() => expect(isLeavingAsked()).toBe(true));
    await submit(user);
    await screen.findByText('davit@example.am is on the list.');
    expect(isLeavingAsked()).toBe(false);
  });

  it('sends the channel and the address, no reason, then says so', async () => {
    const reads = serve();
    const received: unknown[] = [];
    server.use(
      http.post(`${API}/suppressions`, async ({ request }) => {
        received.push(await request.json());
        return HttpResponse.json({ id: 's9' }, { status: 201 });
      }),
    );
    const user = renderPage();
    await user.type(await screen.findByLabelText('Their address'), 'davit@example.am');
    await submit(user);
    const status = await screen.findByText('davit@example.am is on the list.');
    await waitFor(() => expect(status).toHaveFocus());
    expect(received).toEqual([{ channel: 'EMAIL', address: 'davit@example.am' }]);
    expect(reads.list).toBe(2);
  });

  it('doesn’t post an address already listed, and says it is there', async () => {
    serve();
    const received: unknown[] = [];
    server.use(
      http.post(`${API}/suppressions`, async ({ request }) => {
        received.push(await request.json());
        return HttpResponse.json({ id: 's9' }, { status: 201 });
      }),
    );
    const user = renderPage();
    await user.type(await screen.findByLabelText('Their address'), 'ANI@example.am');
    await submit(user);
    expect(await screen.findByText(/is already on the list for this/)).toBeInTheDocument();
    expect(received).toEqual([]);
  });

  it('asks for a phone as the guest list has it, and refuses one that isn’t', async () => {
    serve();
    const user = renderPage();
    await user.click(await screen.findByRole('radio', { name: 'Phone, by WhatsApp' }));
    expect(screen.getByText(/exactly as it is on the guest list/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Their address'), 'call me');
    await submit(user);
    expect(await screen.findByText('That doesn’t look like a phone number.')).toBeInTheDocument();
  });

  it('puts an address the server refuses on its field', async () => {
    serve();
    server.use(
      http.post(
        `${API}/suppressions`,
        refused(400, 'address must be shorter than or equal to 200 characters'),
      ),
    );
    const user = renderPage();
    await user.type(await screen.findByLabelText('Their address'), 'davit@example.am');
    await submit(user);
    await waitFor(() =>
      expect(screen.getByLabelText('Their address')).toHaveAccessibleDescription(
        expect.stringContaining('That address wasn’t accepted.'),
      ),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('words a 403', async () => {
    serve();
    server.use(
      http.post(
        `${API}/suppressions`,
        refused(403, 'This account may not guest:write', 'FORBIDDEN'),
      ),
    );
    const user = renderPage();
    await user.type(await screen.findByLabelText('Their address'), 'davit@example.am');
    await submit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only the organization’s owner or a manager',
    );
  });
});

describe('allowing someone again', () => {
  it('asks first, then lifts', async () => {
    const reads = serve();
    const lifted: string[] = [];
    server.use(
      http.delete(`${API}/suppressions/s1`, () => {
        lifted.push('s1');
        return HttpResponse.json({ ok: true });
      }),
    );
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Allow again: ani@example.am' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(lifted).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Allow again' }));
    expect(await screen.findByText('ani@example.am can be contacted again.')).toBeInTheDocument();
    expect(lifted).toEqual(['s1']);
    expect(reads.list).toBe(2);
  });

  it('words a refusal and reloads', async () => {
    const reads = serve();
    server.use(
      http.delete(
        `${API}/suppressions/s1`,
        refused(
          409,
          'This person asked for their data to be erased; they cannot be contacted again',
        ),
      ),
    );
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Allow again: ani@example.am' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Allow again' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'asked for their data to be erased',
    );
    await waitFor(() => expect(reads.list).toBe(2));
  });

  it('returns the focus to the button when cancelled', async () => {
    serve();
    const user = renderPage();
    const opener = await screen.findByRole('button', { name: 'Allow again: ani@example.am' });
    await user.click(opener);
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
