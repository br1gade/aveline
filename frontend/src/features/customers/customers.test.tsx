import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData, useLocation, useParams } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import { createI18n } from '@/lib/i18n';
import { APP_PATHS } from '@/route-paths';
import { LeaveGuard } from '@/ui/app-form';

import { isUnloadAsked } from '../../../test/unload';
import { customerChoices, findOrganizations, openForCustomer } from './api';
import { CustomerNewEvent } from './components/customer-new-event';
import { CustomersPage } from './components/customers-page';
import { StaffHome } from './components/staff-home';
import { loadCustomers, type CustomersData } from './load';

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
const ORGANIZATIONS = `${API}/concierge/organizations`;
const server = setupServer();
const petrosyan = {
  id: 'o1',
  name: 'Petrosyan Wedding',
  kind: 'HOST',
  createdAt: '2026-10-01T10:00:00Z',
  events: 2,
  owners: ['anna@example.am'],
  pendingOwnerInvites: ['new@example.am'],
};
const searches: Array<string | null> = [];
const bodies: unknown[] = [];

function refusal(status: number, message: string, code?: string) {
  return HttpResponse.json(
    { statusCode: status, message, code, requestId: 'r-1' },
    { status, headers: { 'x-request-id': 'r-1' } },
  );
}

function serve(list: () => Response = () => HttpResponse.json([petrosyan])) {
  server.use(
    http.get(ORGANIZATIONS, ({ request }) => {
      searches.push(new URL(request.url).searchParams.get('search'));
      return list();
    }),
  );
}

function answerOpen(...answers: Array<() => Response>) {
  let index = 0;
  server.use(
    http.post(ORGANIZATIONS, async ({ request }) => {
      bodies.push(await request.json());
      const answer = answers[Math.min(index, answers.length - 1)];
      index += 1;
      return answer ? answer() : HttpResponse.json({});
    }),
  );
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  searches.length = 0;
  bodies.length = 0;
  current.session = createBrowserSession({
    baseUrl: ORIGIN,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{`${pathname}${search}`}</p>;
}

async function open(address: string = APP_PATHS.staffCustomers) {
  const Stub = createRoutesStub([
    {
      path: APP_PATHS.staffCustomers,
      HydrateFallback: () => null,
      loader: ({ request }) => {
        if (!current.session) throw new Error('No session in this test');
        return loadCustomers(current.session.api, new URL(request.url).searchParams.get('q'));
      },
      Component: function Page() {
        return (
          <LeaveGuard>
            <CustomersPage data={useLoaderData<CustomersData>()} />
            <Where />
          </LeaveGuard>
        );
      },
    },
    {
      path: APP_PATHS.staffNewEvent,
      Component: function NewEvent() {
        const { organizationId = '' } = useParams();
        return (
          <LeaveGuard>
            <CustomerNewEvent organizationId={organizationId} />
            <Where />
          </LeaveGuard>
        );
      },
    },
    { path: '/app/events/:eventId', Component: Where },
  ]);
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={[address]} />
    </I18nextProvider>,
  );
  await screen.findByRole('heading', { level: 1, name: 'Customers' });
  return userEvent.setup();
}

async function fillIn(user: ReturnType<typeof userEvent.setup>, email = 'anna@example.am') {
  await user.type(screen.getByLabelText('Organization’s name'), 'Petrosyan Wedding');
  await user.type(screen.getByLabelText('Owner’s email address'), email);
  await user.click(screen.getByRole('button', { name: 'Open the account' }));
}

describe('finding a customer', () => {
  it('lists each with its owners, who is yet to accept, and its events', async () => {
    serve();
    await open();
    const row = screen.getByText('Petrosyan Wedding').closest('li');
    expect(row).toHaveTextContent('anna@example.am');
    expect(row).toHaveTextContent('new@example.am');
    expect(row).toHaveTextContent('2 events');
  });

  it('searches by the name in the address, and says only the newest are shown', async () => {
    serve();
    const user = await open();
    expect(searches).toEqual([null]);
    expect(screen.getByText(/newest 50/)).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'petro');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('?q=petro'));
    expect(searches).toContain('petro');
  });

  it('reads the search from the address', async () => {
    serve();
    await open(`${APP_PATHS.staffCustomers}?q=petro`);
    expect(searches).toEqual(['petro']);
    expect(screen.getByRole('searchbox')).toHaveValue('petro');
  });

  it('says when nothing is found', async () => {
    serve(() => HttpResponse.json([]));
    await open();
    expect(screen.getByText('No organizations found.')).toBeInTheDocument();
  });

  it('leads to setting up an event, naming the organization', async () => {
    serve();
    const user = await open();
    await user.click(screen.getByRole('link', { name: 'Set up an event: Petrosyan Wedding' }));
    expect(await screen.findByTestId('where')).toHaveTextContent(
      '/app/staff/customers/o1/new-event',
    );
  });

  it('tells a customer who opens the address that this is Aveline’s staff’s', async () => {
    serve(() => refusal(403, 'Forbidden resource'));
    await open();
    expect(screen.getByText(/for Aveline’s staff/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open the account' })).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('keeps the search and what was typed when the list can’t be read', async () => {
    let isDown = false;
    serve(() => (isDown ? refusal(400, 'search must be shorter') : HttpResponse.json([petrosyan])));
    const user = await open();
    await user.type(screen.getByLabelText('Owner’s email address'), 'anna@example.am');
    isDown = true;
    await user.type(screen.getByRole('searchbox'), 'petro');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('?q=petro'));
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    expect(screen.getByLabelText('Owner’s email address')).toHaveValue('anna@example.am');
  });

  it('stops a search at the backend’s limit', async () => {
    serve();
    await open();
    expect(screen.getByRole('searchbox')).toHaveAttribute('maxlength', '160');
  });
});

describe('what the API layer keeps', () => {
  const api = () => {
    if (!current.session) throw new Error('No session in this test');
    return current.session.api;
  };

  it('keeps nothing of a development link’s token', async () => {
    answerOpen(() =>
      HttpResponse.json({
        organization: { id: 'o2', name: 'A', kind: 'HOST', extra: 'x' },
        invite: { sent: true, devLink: 'https://app.test/accept-invite?token=SENTINEL' },
        isExisting: false,
      }),
    );
    await expect(
      openForCustomer(api(), { name: 'A b', kind: 'HOST', ownerEmail: 'a@x.am' }),
    ).resolves.toEqual({ organization: { id: 'o2', name: 'A' }, isExisting: false });
  });

  it('keeps what it shows of an organization and a choice', async () => {
    serve(() => HttpResponse.json([{ ...petrosyan, extra: 'x' }]));
    server.use(
      http.post(`${ORGANIZATIONS}/resolve-customer`, () =>
        HttpResponse.json({ items: [{ id: 'o3', name: 'B', kind: 'HOST', extra: 'x' }] }),
      ),
    );
    const { kind: _kind, createdAt: _createdAt, ...shown } = petrosyan;
    await expect(findOrganizations(api(), null)).resolves.toEqual([shown]);
    await expect(customerChoices(api(), 'a@x.am')).resolves.toEqual([{ id: 'o3', name: 'B' }]);
  });
});

describe('the staff’s home', () => {
  function renderHome(access: Parameters<typeof StaffHome>[0]['access']) {
    const Stub = createRoutesStub([
      { path: APP_PATHS.staff, Component: () => <StaffHome access={access} /> },
    ]);
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <Stub initialEntries={[APP_PATHS.staff]} />
      </I18nextProvider>,
    );
  }

  it('leads to each tool', async () => {
    renderHome({ kind: 'ready', value: [] });
    expect(await screen.findByRole('link', { name: 'Customers' })).toHaveAttribute(
      'href',
      APP_PATHS.staffCustomers,
    );
    expect(screen.getByRole('link', { name: 'Data requests' })).toHaveAttribute(
      'href',
      APP_PATHS.staffDataRequests,
    );
  });

  it('offers a customer nothing, and says whose it is', async () => {
    renderHome({ kind: 'refused' });
    expect(await screen.findByText(/for Aveline’s staff/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Customers' })).not.toBeInTheDocument();
  });
});

describe('an event for a customer', () => {
  const posted: string[] = [];

  function answerEvents() {
    posted.length = 0;
    server.use(
      http.post(`${ORGANIZATIONS}/:organizationId/events`, ({ params }) => {
        posted.push(`customer ${String(params.organizationId)}`);
        return HttpResponse.json({ id: 'e1' });
      }),
      http.post(`${API}/events`, () => {
        posted.push('own');
        return HttpResponse.json({ id: 'wrong' });
      }),
    );
  }

  it('names the organization, and goes in it', async () => {
    serve();
    answerEvents();
    const user = await open();
    await user.click(screen.getByRole('link', { name: 'Set up an event: Petrosyan Wedding' }));
    expect(await screen.findByText(/goes in Petrosyan Wedding/)).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Kind of event'), 'WEDDING');
    await user.type(screen.getByLabelText('Title'), 'The wedding of Anna and Davit');
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2027-06-12' } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '15:00' } });
    await user.click(screen.getByRole('button', { name: 'Create the event' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/app/events/e1'));
    expect(posted).toEqual(['customer o1']);
  });

  it('goes back to choosing when it can’t say whose it is, as from a link someone sent', async () => {
    serve();
    answerEvents();
    await open('/app/staff/customers/o9/new-event');
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/app\/staff\/customers$/);
    expect(posted).toEqual([]);
  });
});

describe('opening an account', () => {
  it('sends what was typed, keeping nothing of a development link', async () => {
    serve();
    answerOpen(() =>
      HttpResponse.json({
        organization: { id: 'o2', name: 'The Petrosyans' },
        invite: { sent: true, devLink: 'https://app.test/accept-invite?token=SENTINEL' },
        isExisting: false,
      }),
    );
    const user = await open();
    await fillIn(user);
    expect(await screen.findByText(/emailed an invitation/)).toBeVisible();
    expect(bodies).toEqual([
      { name: 'Petrosyan Wedding', kind: 'HOST', ownerEmail: 'anna@example.am' },
    ]);
    expect(screen.getByLabelText('Owner’s email address')).toHaveValue('');
    expect(screen.getByRole('link', { name: 'Set up an event: The Petrosyans' })).toHaveAttribute(
      'href',
      '/app/staff/customers/o2/new-event',
    );
  });

  it('says when the address is already on one, to be checked, and promises nothing', async () => {
    serve();
    answerOpen(() =>
      HttpResponse.json({
        organization: { id: 'o1', name: 'Petrosyan Wedding' },
        invite: null,
        isExisting: true,
      }),
    );
    const user = await open();
    await fillIn(user);
    expect(await screen.findByText(/already on Petrosyan Wedding/)).toBeVisible();
    expect(screen.getByText(/Check it’s the customer’s own/)).toBeVisible();
    expect(screen.queryByText(/nothing for them to accept/)).not.toBeInTheDocument();
    expect(screen.queryByText(/emailed an invitation/)).not.toBeInTheDocument();
  });

  it('offers the choices when they have several, and sends the one chosen', async () => {
    serve();
    answerOpen(
      () => refusal(409, 'Choose', 'ORGANIZATION_SELECTION_REQUIRED'),
      () =>
        HttpResponse.json({
          organization: { id: 'o3', name: 'Sargsyan Events' },
          invite: null,
          isExisting: true,
        }),
    );
    const asked: unknown[] = [];
    server.use(
      http.post(`${ORGANIZATIONS}/resolve-customer`, async ({ request }) => {
        asked.push(await request.json());
        return HttpResponse.json({
          items: [{ id: 'o3', name: 'Sargsyan Events', kind: 'PLANNER', createdAt: 'x' }],
          nextCursor: null,
        });
      }),
    );
    const user = await open();
    await fillIn(user);
    const choose = await screen.findByRole('button', { name: 'Use Sargsyan Events' });
    expect(asked).toEqual([{ ownerEmail: 'anna@example.am' }]);
    await user.click(choose);
    await screen.findByText(/already on Sargsyan Events/);
    expect(screen.queryByRole('button', { name: 'Use Sargsyan Events' })).not.toBeInTheDocument();
    expect(bodies[1]).toEqual({
      name: 'Petrosyan Wedding',
      kind: 'HOST',
      ownerEmail: 'anna@example.am',
      organizationId: 'o3',
    });
  });

  function answerChoices(answer: () => Response) {
    server.use(http.post(`${ORGANIZATIONS}/resolve-customer`, answer));
  }
  const several = () => refusal(409, 'Choose', 'ORGANIZATION_SELECTION_REQUIRED');
  const oneChoice = () =>
    HttpResponse.json({ items: [{ id: 'o3', name: 'Sargsyan Events' }], nextCursor: null });

  it('says what to do when nothing can be listed to choose from', async () => {
    serve();
    answerOpen(several);
    answerChoices(() => HttpResponse.json({ items: [], nextCursor: null }));
    const user = await open();
    await fillIn(user);
    expect(await screen.findByText(/can’t be listed here/)).toBeVisible();
  });

  it('gives a reference when the choices can’t be read', async () => {
    serve();
    answerOpen(several);
    answerChoices(() => refusal(500, 'Boom'));
    const user = await open();
    await fillIn(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('r-1');
  });

  it('takes the choices away once the address they were for has changed', async () => {
    serve();
    answerOpen(several);
    answerChoices(oneChoice);
    const user = await open();
    await fillIn(user);
    await screen.findByRole('button', { name: 'Use Sargsyan Events' });
    await user.type(screen.getByLabelText('Owner’s email address'), 'x');
    expect(screen.queryByRole('button', { name: 'Use Sargsyan Events' })).not.toBeInTheDocument();
  });

  it('says a chosen organization is no longer theirs, not that this isn’t staff’s', async () => {
    serve();
    answerOpen(several, () => refusal(403, 'x', 'ORGANIZATION_ACCESS_DENIED'));
    answerChoices(oneChoice);
    const user = await open();
    await fillIn(user);
    await user.click(await screen.findByRole('button', { name: 'Use Sargsyan Events' }));
    const said = await screen.findByRole('alert');
    expect(said).toHaveTextContent(/no longer/);
    expect(said).not.toHaveTextContent('Aveline’s staff');
  });

  it('reads the list again, and takes away the last answer when the next is refused', async () => {
    serve();
    answerOpen(
      () => HttpResponse.json({ organization: { id: 'o2', name: 'A' }, isExisting: false }),
      () => refusal(500, 'Boom'),
    );
    const user = await open();
    const before = searches.length;
    await fillIn(user);
    await screen.findByText(/emailed an invitation/);
    await waitFor(() => expect(searches.length).toBeGreaterThan(before));
    await fillIn(user);
    await screen.findByRole('alert');
    expect(screen.queryByText(/emailed an invitation/)).not.toBeInTheDocument();
  });

  it('puts the backend’s refusal of a name on its field', async () => {
    serve();
    answerOpen(() => refusal(400, 'name must be longer than or equal to 2 characters'));
    const user = await open();
    await fillIn(user);
    await waitFor(() =>
      expect(screen.getByLabelText('Organization’s name')).toHaveAttribute('aria-invalid'),
    );
  });

  it('sends who it is for', async () => {
    serve();
    answerOpen(() => refusal(500, 'Boom'));
    const user = await open();
    await user.selectOptions(screen.getByLabelText('Who it is for'), 'PLANNER');
    await fillIn(user);
    await screen.findByRole('alert');
    expect(bodies[0]).toMatchObject({ kind: 'PLANNER' });
  });

  it.each(['nope', `${'a'.repeat(190)}@example.am`])('sends nothing for “%s”', async (typed) => {
    serve();
    answerOpen();
    const user = await open();
    await user.type(screen.getByLabelText('Organization’s name'), 'Petrosyan');
    await user.click(screen.getByLabelText('Owner’s email address'));
    await user.paste(typed);
    await user.click(screen.getByRole('button', { name: 'Open the account' }));
    expect(await screen.findByText('Type a valid email address.')).toBeVisible();
    expect(bodies).toEqual([]);
  });

  it('leaves an address past ASCII for the backend to judge', async () => {
    serve();
    answerOpen(() =>
      HttpResponse.json({ organization: { id: 'o2', name: 'A' }, invite: {}, isExisting: false }),
    );
    const user = await open();
    await fillIn(user, 'анна@пример.рф');
    await screen.findByText(/emailed an invitation/);
    expect(bodies[0]).toMatchObject({ ownerEmail: 'анна@пример.рф' });
  });

  it('sends nothing for a name the form refuses', async () => {
    const typed = 'x';
    serve();
    answerOpen();
    const user = await open();
    await user.click(screen.getByLabelText('Organization’s name'));
    await user.paste(typed);
    await user.type(screen.getByLabelText('Owner’s email address'), 'anna@example.am');
    await user.click(screen.getByRole('button', { name: 'Open the account' }));
    expect(await screen.findByText('Use 2 to 160 characters.')).toBeVisible();
    expect(bodies).toEqual([]);
  });

  it('puts the backend’s refusal of an address on its field', async () => {
    serve();
    answerOpen(() => refusal(400, 'ownerEmail must be an email'));
    const user = await open();
    await fillIn(user);
    await waitFor(() =>
      expect(screen.getByLabelText('Owner’s email address')).toHaveAttribute('aria-invalid'),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('words a role that may not, keeping what was typed', async () => {
    serve();
    answerOpen(() => refusal(403, 'Forbidden resource'));
    const user = await open();
    await fillIn(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Aveline’s staff');
    expect(screen.getByLabelText('Owner’s email address')).toHaveValue('anna@example.am');
  });

  it('gives a reference with no answer', async () => {
    serve();
    answerOpen(() => refusal(500, 'Boom'));
    const user = await open();
    await fillIn(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('r-1');
  });

  it('asks before what is typed is lost', async () => {
    serve();
    const user = await open();
    expect(isUnloadAsked()).toBe(false);
    await user.type(screen.getByLabelText('Organization’s name'), 'Petrosyan');
    expect(isUnloadAsked()).toBe(true);
  });
});
