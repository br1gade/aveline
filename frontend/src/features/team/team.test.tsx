import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import { createI18n } from '@/lib/i18n';

import { TeamPage } from './components/team-page';
import { loadTeamPage, type TeamPageData } from './load';
import type { TeamWire } from './types';

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

function team(): TeamWire {
  return {
    members: [
      {
        userId: 'u1',
        name: 'Anna',
        email: 'anna@example.am',
        role: 'OWNER',
        since: '2027-01-01T20:30:00.000Z',
      },
      {
        userId: 'u2',
        name: 'Davit',
        email: 'davit@example.am',
        role: 'COORDINATOR',
        since: '2027-01-02T10:00:00.000Z',
      },
    ],
    invites: [
      { email: 'door+1@example.am', role: 'COORDINATOR', expiresAt: '2027-02-01T10:00:00.000Z' },
    ],
  };
}

function serve(read: () => Response = () => HttpResponse.json(team())) {
  const reads = { team: 0 };
  server.use(
    http.get(`${API}/events/e1`, () =>
      HttpResponse.json({
        id: 'e1',
        title: 'The wedding of Anna and Davit',
        type: 'WEDDING',
        hostsLabel: 'Anna & Davit',
        startsAt: '2027-06-12T11:00:00.000Z',
        endsAt: null,
        timezone: 'Asia/Yerevan',
        locales: ['en'],
        defaultLocale: 'en',
        sideALabel: null,
        sideBLabel: null,
        invitation: null,
      }),
    ),
    http.get(`${API}/events/e1/team`, () => {
      reads.team += 1;
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
  return <TeamPage data={useLoaderData<TeamPageData>()} />;
}

function renderPage(language: 'en' | 'hy' = 'en') {
  const Stub = createRoutesStub([
    {
      path: '/app/events/:eventId/team',
      loader: ({ params }) => loadTeamPage(session().api, params.eventId ?? ''),
      Component: Page,
    },
  ]);
  render(
    <I18nextProvider i18n={createI18n(language)}>
      <Stub initialEntries={['/app/events/e1/team']} />
    </I18nextProvider>,
  );
  return userEvent.setup();
}

const sendButton = async () => {
  const button = await screen.findByRole('button', { name: 'Send the invitation' });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
};

describe('the team, as shown', () => {
  it('lists members and open invitations, times in the event’s zone', async () => {
    serve();
    renderPage();
    expect(await screen.findByText('Anna')).toBeInTheDocument();
    expect(screen.getByText('anna@example.am')).toBeInTheDocument();
    // 20:30 UTC is past midnight in Yerevan, whatever this machine's zone.
    expect(screen.getByText(/Owner · since 2 January 2027, 00:30/)).toBeInTheDocument();
    expect(screen.getByText('door+1@example.am')).toBeInTheDocument();
    expect(screen.getByText(/Coordinator · link works until 1 February 2027/)).toBeInTheDocument();
  });

  it('says so when nothing is there', async () => {
    serve(() => HttpResponse.json({ members: [], invites: [] }));
    renderPage();
    expect(await screen.findByText('Nobody is on this team yet.')).toBeInTheDocument();
    expect(screen.getByText(/No invitations are open/)).toBeInTheDocument();
  });

  it('tells a role refused the list who can see it, and still offers the invite (FR-6)', async () => {
    serve(refused(403));
    server.use(http.post(`${API}/events/e1/team/invites`, refused(403)));
    const user = renderPage();
    expect(
      await screen.findByText(/Only the event’s owner or the organization’s owner can see/),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Their email address'), 'door@example.am');
    await user.click(await sendButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only the event’s owner or the organization’s owner can manage the team.',
    );
  });

  it('says a failed read failed, with its reference', async () => {
    serve(refused(500));
    renderPage();
    expect(await screen.findByText(/req-1/)).toBeInTheDocument();
    expect(screen.getByLabelText('Their email address')).toBeInTheDocument();
  });
});

describe('inviting', () => {
  it('invites door staff as coordinators by default, says what that gives them, and never shows the development link', async () => {
    const token = crypto.randomUUID();
    const reads = serve();
    const received: unknown[] = [];
    server.use(
      http.post(`${API}/events/e1/team/invites`, async ({ request }) => {
        received.push(await request.json());
        return HttpResponse.json(
          {
            sent: true,
            email: 'door@example.am',
            role: 'COORDINATOR',
            devLink: `http://localhost:5173/accept-event-invite?token=${token}`,
          },
          { status: 201 },
        );
      }),
    );
    const user = renderPage();
    expect(await screen.findByText(/Door staff are invited as coordinators/)).toHaveTextContent(
      'contact details',
    );
    expect(screen.getByRole('radio', { name: 'Coordinator' })).toBeChecked();
    await user.type(screen.getByLabelText('Their email address'), 'door@example.am');
    await user.click(await sendButton());
    const status = await screen.findByText('The invitation is on its way to door@example.am.');
    await waitFor(() => expect(status).toHaveFocus());
    expect(received).toEqual([{ email: 'door@example.am', role: 'COORDINATOR' }]);
    expect(reads.team).toBe(2);
    expect(screen.getByLabelText('Their email address')).toHaveValue('');
    expect(document.body.innerHTML).not.toContain(token);
  });

  it('sends the role chosen', async () => {
    serve();
    const received: unknown[] = [];
    server.use(
      http.post(`${API}/events/e1/team/invites`, async ({ request }) => {
        received.push(await request.json());
        return HttpResponse.json(
          { sent: true, email: 'a@example.am', role: 'VIEWER' },
          { status: 201 },
        );
      }),
    );
    const user = renderPage();
    await user.type(await screen.findByLabelText('Their email address'), 'a@example.am');
    await user.click(screen.getByRole('radio', { name: 'Viewer' }));
    await user.click(await sendButton());
    await screen.findByText(/on its way to a@example.am/);
    expect(received).toEqual([{ email: 'a@example.am', role: 'VIEWER' }]);
  });

  it.each([
    ['', 'Enter their email address.'],
    ['nonsense', 'That doesn’t look like an email address.'],
  ])('refuses “%s” before sending', async (email, words) => {
    serve();
    const user = renderPage();
    const field = await screen.findByLabelText('Their email address');
    if (email) await user.type(field, email);
    await user.click(await sendButton());
    expect(await screen.findByText(words)).toBeInTheDocument();
  });

  it.each([
    [
      'someone on the team',
      refused(400, "That person is already on this event's team"),
      'already on this event’s team',
      2,
    ],
    ['a 403', refused(403), 'can manage the team', 1],
    ['no answer', () => HttpResponse.error(), 'No answer came.', 1],
    ['a 429', refused(429), 'Too many tries.', 1],
    ['a sentence it doesn’t know', refused(400, 'Something new'), 'Something new', 1],
  ])('words %s', async (_case, response, words, teamReads) => {
    const reads = serve();
    server.use(http.post(`${API}/events/e1/team/invites`, response));
    const user = renderPage();
    await user.type(await screen.findByLabelText('Their email address'), 'door@example.am');
    await user.click(await sendButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(words);
    await waitFor(() => expect(reads.team).toBe(teamReads));
    // What was typed stays, to fix or press again.
    expect(screen.getByLabelText('Their email address')).toHaveValue('door@example.am');
  });

  it('marks an address the server refuses on its field', async () => {
    serve();
    server.use(http.post(`${API}/events/e1/team/invites`, refused(400, 'email must be an email')));
    const user = renderPage();
    await user.type(await screen.findByLabelText('Their email address'), 'door@example.am');
    await user.click(await sendButton());
    expect(await screen.findByText('That doesn’t look like an email address.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('an open invitation', () => {
  it('sends again with the same role, saying the earlier link stops working', async () => {
    serve();
    const received: unknown[] = [];
    server.use(
      http.post(`${API}/events/e1/team/invites`, async ({ request }) => {
        received.push(await request.json());
        return HttpResponse.json(
          { sent: true, email: 'door+1@example.am', role: 'COORDINATOR' },
          { status: 201 },
        );
      }),
    );
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Send again: door+1@example.am' }));
    expect(await screen.findByText(/The earlier one no longer works/)).toBeInTheDocument();
    expect(received).toEqual([{ email: 'door+1@example.am', role: 'COORDINATOR' }]);
  });

  it('withdraws after asking, with the address encoded in the path', async () => {
    const reads = serve();
    const urls: string[] = [];
    server.use(
      http.delete(`${API}/events/e1/team/invites/:email`, ({ request, params }) => {
        urls.push(new URL(request.url).pathname, String(params.email));
        return HttpResponse.json({ ok: true });
      }),
    );
    const user = renderPage();
    await user.click(
      await screen.findByRole('button', { name: 'Withdraw the invitation: door+1@example.am' }),
    );
    const dialog = await screen.findByRole('alertdialog');
    expect(urls).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    expect(
      await screen.findByText('The invitation to door+1@example.am is withdrawn.'),
    ).toBeInTheDocument();
    expect(urls[1]).toBe('door+1@example.am');
    expect(urls[0]).not.toContain('door+1@');
    expect(reads.team).toBe(2);
  });

  it('reloads when it was already gone', async () => {
    const reads = serve();
    server.use(
      http.delete(
        `${API}/events/e1/team/invites/:email`,
        refused(404, 'No pending invitation for that address'),
      ),
    );
    const user = renderPage();
    await user.click(
      await screen.findByRole('button', { name: 'Withdraw the invitation: door+1@example.am' }),
    );
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('no longer open');
    await waitFor(() => expect(reads.team).toBe(2));
  });
});

describe('changing a role', () => {
  async function openChange(user: ReturnType<typeof userEvent.setup>, name = 'Davit') {
    await user.click(await screen.findByRole('button', { name: `Change role: ${name}` }));
    return screen.findByRole('dialog');
  }

  it('sends the new role, marks the current, and refuses no change', async () => {
    const reads = serve();
    const received: unknown[] = [];
    server.use(
      http.patch(`${API}/events/e1/team/u2`, async ({ request }) => {
        received.push(await request.json());
        return HttpResponse.json({ userId: 'u2', role: 'VIEWER' });
      }),
    );
    const user = renderPage();
    const dialog = await openChange(user);
    expect(within(dialog).getByRole('radio', { name: /Coordinator · now/ })).toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'Change role' })).toBeDisabled();
    await user.click(within(dialog).getByRole('radio', { name: 'Viewer' }));
    await user.click(within(dialog).getByRole('button', { name: 'Change role' }));
    expect(await screen.findByText('Davit is now: Viewer.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(received).toEqual([{ role: 'VIEWER' }]);
    expect(reads.team).toBe(2);
  });

  it.each([
    [
      'An event needs an owner; make someone else an owner first',
      'Make someone else an owner first.',
    ],
    [
      'An event needs an active owner; make someone else an owner first',
      'Make someone else an owner first.',
    ],
    ['Only an active event member may become owner', 'Only someone whose account is active'],
  ])('words “%s”', async (message, words) => {
    serve();
    server.use(http.patch(`${API}/events/e1/team/u1`, refused(400, message)));
    const user = renderPage();
    const dialog = await openChange(user, 'Anna');
    await user.click(within(dialog).getByRole('radio', { name: 'Viewer' }));
    await user.click(within(dialog).getByRole('button', { name: 'Change role' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(words);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('words a 403', async () => {
    serve();
    server.use(http.patch(`${API}/events/e1/team/u2`, refused(403)));
    const user = renderPage();
    const dialog = await openChange(user);
    await user.click(within(dialog).getByRole('radio', { name: 'Viewer' }));
    await user.click(within(dialog).getByRole('button', { name: 'Change role' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('can manage the team');
  });
});

describe('removing someone', () => {
  it('asks first, says they’re locked out at once, then removes', async () => {
    const reads = serve();
    const removed: string[] = [];
    server.use(
      http.delete(`${API}/events/e1/team/u2`, () => {
        removed.push('u2');
        return HttpResponse.json({ removed: 'u2' });
      }),
    );
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Remove Davit' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('locked out of this event at once');
    expect(removed).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Davit is off the team.')).toBeInTheDocument();
    expect(removed).toEqual(['u2']);
    expect(reads.team).toBe(2);
  });

  it('refuses to remove the last owner, in words', async () => {
    serve();
    server.use(
      http.delete(
        `${API}/events/e1/team/u1`,
        refused(400, 'An event needs an owner; make someone else an owner first'),
      ),
    );
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Remove Anna' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('An event needs an owner.');
  });

  it('reloads when they were already gone', async () => {
    const reads = serve();
    server.use(
      http.delete(
        `${API}/events/e1/team/u2`,
        refused(404, "That person is not on this event's team"),
      ),
    );
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Remove Davit' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('no longer on this team');
    await waitFor(() => expect(reads.team).toBe(2));
  });

  it('is worded in Armenian too', async () => {
    serve();
    renderPage('hy');
    expect(await screen.findByRole('button', { name: 'Հեռացնել՝ Davit' })).toBeInTheDocument();
  });
});

describe('a refusal, as shown', () => {
  it('takes the focus, and marks a sentence it doesn’t know as English', async () => {
    serve();
    server.use(http.post(`${API}/events/e1/team/invites`, refused(400, 'Something new')));
    const user = renderPage();
    await user.type(await screen.findByLabelText('Their email address'), 'door@example.am');
    await user.click(await sendButton());
    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(alert).toHaveFocus());
    expect(within(alert).getByText('Something new')).toHaveAttribute('lang', 'en');
  });
});

describe('sending an invitation again', () => {
  const button = () => screen.findByRole('button', { name: 'Send again: door+1@example.am' });

  it('keeps its refusal on the page when the reload removes the row', async () => {
    let isGone = false;
    const reads = serve(() => {
      const wire = team();
      return HttpResponse.json(isGone ? { ...wire, invites: [] } : wire);
    });
    server.use(
      http.post(`${API}/events/e1/team/invites`, () => {
        isGone = true;
        return refused(400, "That person is already on this event's team")();
      }),
    );
    const user = renderPage();
    await user.click(await button());
    await waitFor(() => expect(reads.team).toBe(2));
    await waitFor(() => expect(screen.queryByText('door+1@example.am')).not.toBeInTheDocument());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('already on this event’s team');
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it.each([
    ['a 403', refused(403), 'can manage the team', 1],
    ['no answer', () => HttpResponse.error(), 'No answer came.', 1],
  ])('words %s, without reloading', async (_case, response, words, teamReads) => {
    const reads = serve();
    server.use(http.post(`${API}/events/e1/team/invites`, response));
    const user = renderPage();
    await user.click(await button());
    expect(await screen.findByRole('alert')).toHaveTextContent(words);
    expect(reads.team).toBe(teamReads);
  });

  it('can’t be pressed twice: each press would replace the link', async () => {
    serve();
    let release = () => undefined as void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(`${API}/events/e1/team/invites`, async () => {
        await held;
        return HttpResponse.json(
          { sent: true, email: 'door+1@example.am', role: 'COORDINATOR' },
          { status: 201 },
        );
      }),
    );
    const user = renderPage();
    const again = await button();
    await user.click(again);
    await waitFor(() => expect(again).toBeDisabled());
    release();
    await screen.findByText(/The earlier one no longer works/);
  });
});

describe('a role this page doesn’t know', () => {
  const withUnknownRole = () => {
    const wire = team();
    return HttpResponse.json({
      members: [{ ...wire.members[1], role: 'BOUNCER' }],
      invites: [{ ...wire.invites[0], role: 'BOUNCER' }],
    });
  };

  it('is said to be unknown, on a member and on an invitation', async () => {
    serve(withUnknownRole);
    renderPage();
    expect(await screen.findByText(/A role this page doesn’t know · since/)).toBeInTheDocument();
    expect(
      screen.getByText(/A role this page doesn’t know · link works until/),
    ).toBeInTheDocument();
  });

  it('can’t be sent again: that would reissue it as another role', async () => {
    serve(withUnknownRole);
    renderPage();
    expect(
      await screen.findByRole('button', { name: 'Send again: door+1@example.am' }),
    ).toBeDisabled();
  });

  it('starts the dialog with nothing chosen, and sends only what is chosen', async () => {
    serve(withUnknownRole);
    const received: unknown[] = [];
    server.use(
      http.patch(`${API}/events/e1/team/u2`, async ({ request }) => {
        received.push(await request.json());
        return HttpResponse.json({ userId: 'u2', role: 'DESIGNER' });
      }),
    );
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Change role: Davit' }));
    const dialog = await screen.findByRole('dialog');
    for (const radio of within(dialog).getAllByRole('radio')) expect(radio).not.toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'Change role' })).toBeDisabled();
    await user.click(within(dialog).getByRole('radio', { name: 'Designer' }));
    await user.click(within(dialog).getByRole('button', { name: 'Change role' }));
    await screen.findByText('Davit is now: Designer.');
    expect(received).toEqual([{ role: 'DESIGNER' }]);
  });
});

describe('a dialog’s focus and its request', () => {
  it('moves the focus to the status line, not the opener still on the page, after a change', async () => {
    serve();
    server.use(
      http.patch(`${API}/events/e1/team/u2`, () =>
        HttpResponse.json({ userId: 'u2', role: 'VIEWER' }),
      ),
    );
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Change role: Davit' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Viewer' }));
    await user.click(within(dialog).getByRole('button', { name: 'Change role' }));
    const status = await screen.findByText('Davit is now: Viewer.');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Radix moves the focus on the tick after it closes: past that, nothing can steal it.
    await act(() => new Promise((resolve) => setTimeout(resolve)));
    expect(status).toHaveFocus();
  });

  it('can’t be confirmed twice while its request runs', async () => {
    serve();
    let release = () => undefined as void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const presses: string[] = [];
    server.use(
      http.delete(`${API}/events/e1/team/u2`, async () => {
        presses.push('remove');
        await held;
        return HttpResponse.json({ removed: 'u2' });
      }),
    );
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Remove Davit' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(await within(dialog).findByRole('button', { name: 'Saving…' })).toBeDisabled();
    release();
    await screen.findByText('Davit is off the team.');
    expect(presses).toEqual(['remove']);
  });

  it.each([
    ['a role refused', refused(403), 1],
    ['no answer', () => HttpResponse.error(), 1],
    [
      'the last owner',
      refused(400, 'An event needs an owner; make someone else an owner first'),
      2,
    ],
  ])('after %s, reloads only if the team may have changed', async (_case, response, teamReads) => {
    const reads = serve();
    server.use(http.delete(`${API}/events/e1/team/u2`, response));
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Remove Davit' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await within(dialog).findByRole('alert');
    await waitFor(() => expect(reads.team).toBe(teamReads));
    expect(reads.team).toBe(teamReads);
  });

  it('returns the focus to the button that opened it when cancelled', async () => {
    serve();
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Remove Davit' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Davit' })).toHaveFocus());
  });

  it('moves the focus to the status line once the action went through', async () => {
    serve();
    server.use(http.delete(`${API}/events/e1/team/u2`, () => HttpResponse.json({ removed: 'u2' })));
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Remove Davit' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    const status = await screen.findByText('Davit is off the team.');
    await waitFor(() => expect(status).toHaveFocus());
  });

  it('can’t be dismissed while its request runs, so a refusal is never lost', async () => {
    serve();
    let release = () => undefined as void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.delete(`${API}/events/e1/team/u1`, async () => {
        await held;
        return refused(400, 'An event needs an owner; make someone else an owner first')();
      }),
    );
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Remove Anna' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled(),
    );
    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    release();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('An event needs an owner.');
  });
});
