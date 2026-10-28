import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData, useLocation, useNavigate } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import type { EventDetail } from '@/features/events';
import { createI18n } from '@/lib/i18n';
import { revalidateUnlessQueryOnly } from '@/lib/routing';

import { GuestList } from './components/guest-list';
import { loadGuestList, type GuestListData } from './load';
import { guestWire, guestWithoutContact, householdWire } from './test-data';
import type { HouseholdWire } from './types';

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

/** Made afresh for each test, never written into a fixture (frontend/CLAUDE.md §10). */
let token = '';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  token = crypto.randomUUID();
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

const EVENT: EventDetail = {
  id: 'e1',
  title: 'The wedding of Anna and Davit',
  type: 'WEDDING',
  hostsLabel: 'Anna & Davit',
  startsAt: '2027-06-12T11:00:00.000Z',
  endsAt: null,
  timezone: 'Asia/Yerevan',
  locales: ['hy', 'en'],
  defaultLocale: 'hy',
  sideALabel: 'The bride’s family',
  sideBLabel: 'The groom’s family',
  invitation: { slug: 'anna-davit-3f8a1c20', status: 'PUBLISHED' },
};

function guestList(): HouseholdWire[] {
  return [
    householdWire({
      id: 'h2',
      name: 'Hakobyan',
      seatsAllotted: 2,
      guests: [
        guestWire({
          id: 'g3',
          firstName: 'Davit',
          lastName: 'Hakobyan',
          name: 'Davit Hakobyan',
          email: 'davit@example.am',
          phone: null,
          attribution: 'SIDE_B',
          rsvpStatus: 'DECLINED',
          table: null,
          isCheckedIn: true,
          token,
        }),
      ],
    }),
    householdWire({
      id: 'h1',
      name: 'Petrosyan family',
      seatsAllotted: 3,
      guests: [
        guestWire({ id: 'g1', token }),
        guestWire({
          id: 'g2',
          firstName: 'Ani',
          name: 'Ani Petrosyan',
          email: null,
          phone: null,
          isPrimary: false,
          rsvpStatus: 'PENDING',
          attribution: 'UNKNOWN',
          table: null,
          token,
        }),
      ],
    }),
  ];
}

/** `GET /invitations/:slug/delivery` as the backend sends it (docs/API.md §6). */
interface DeliveryWire {
  invited: number;
  notSent: number;
  unreachable: Array<{ householdId: string; householdName: string; reason: string }>;
  households: Array<Record<string, unknown> & { householdId: string; toAddress?: string }>;
}

/** The delivery report: the Petrosyans invited by email, the Hakobyans not yet. */
function deliveryReport(overrides: Partial<DeliveryWire> = {}): DeliveryWire {
  return {
    invited: 1,
    notSent: 1,
    unreachable: [],
    households: [
      {
        householdId: 'h1',
        household: 'Petrosyan family',
        guest: 'Armen Petrosyan',
        channel: 'EMAIL',
        toAddress: 'armen@example.am',
        status: 'SENT',
        attempts: 1,
        failureReason: null,
        sentAt: '2027-05-01T10:00:00.000Z',
        reminders: 0,
        lastRemindedAt: null,
        ...{ token },
      },
      {
        householdId: 'h2',
        household: 'Hakobyan',
        guest: 'Davit Hakobyan',
        channel: 'EMAIL',
        toAddress: 'davit@example.am',
        status: 'NOT_SENT',
        attempts: 0,
        failureReason: null,
        sentAt: null,
      },
    ],
    ...overrides,
  };
}

interface ServeOptions {
  event?: EventDetail;
  delivery?: DeliveryWire | (() => Response);
}

/** Serves the event, its guests and the delivery report, and counts each read of the list. */
function serve(
  households: HouseholdWire[] | (() => Response) = guestList(),
  { event = EVENT, delivery = deliveryReport() }: ServeOptions = {},
) {
  const reads = { guests: 0, delivery: 0 };
  server.use(
    http.get(`${API}/events/e1`, () => HttpResponse.json(event)),
    http.get(`${API}/events/e1/guests`, () => {
      reads.guests += 1;
      return typeof households === 'function' ? households() : HttpResponse.json(households);
    }),
    http.get(`${API}/invitations/anna-davit-3f8a1c20/delivery`, () => {
      reads.delivery += 1;
      return typeof delivery === 'function' ? delivery() : HttpResponse.json(delivery);
    }),
  );
  return reads;
}

/** Records each write's JSON body, and answers with `response`. */
function answer(method: 'post' | 'patch' | 'delete', path: string, response: () => Response) {
  const received: unknown[] = [];
  server.use(
    http[method](`${API}${path}`, async ({ request }) => {
      received.push(method === 'delete' ? 'deleted' : await request.json());
      return response();
    }),
  );
  return received;
}

const refusal =
  (status: number, message: string | string[] = 'refused') =>
  () =>
    HttpResponse.json({ statusCode: status, message, requestId: 'req-1' }, { status });

/** A write's own answer carries the guest's token, as the backend's does (FR-29). */
const savedGuest = () =>
  HttpResponse.json({ id: 'g9', householdId: 'h9', firstName: 'Lilit', token }, { status: 201 });

function Where() {
  return <p data-testid="where">{useLocation().search}</p>;
}

/** The browser's own Back, which the page cannot tell from any other change of address. */
function HistoryBack() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => void navigate(-1)}>
      Go back
    </button>
  );
}

function GuestsPage() {
  return (
    <>
      <GuestList data={useLoaderData<GuestListData>()} />
      <Where />
      <HistoryBack />
    </>
  );
}

function renderList(path: string | string[] = '/app/events/e1/guests') {
  const Stub = createRoutesStub([
    {
      path: '/app/events/:eventId/guests',
      loader: ({ params }) => loadGuestList(session().api, params.eventId ?? ''),
      shouldRevalidate: revalidateUnlessQueryOnly,
      Component: GuestsPage,
    },
    { path: '/app/events/:eventId/guests/import', Component: () => <p>Import page</p> },
    { path: '/app/events/:eventId/invitation', Component: () => <p>Invitation page</p> },
    { path: '/app/events/:eventId', Component: () => <p>Event page</p> },
  ]);
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={typeof path === 'string' ? [path] : path} />
    </I18nextProvider>,
  );
  return userEvent.setup();
}

const household = (name: string) => screen.getByRole('region', { name });

async function openEdit(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: `Edit: ${name}` }));
  return screen.findByRole('dialog');
}

const save = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Save changes' }));

describe('GuestList: reading', () => {
  it('lists each household with its seats, and each guest’s answer, side and table', async () => {
    serve();
    renderList();
    expect(await screen.findByText('3 guests in 2 households')).toBeInTheDocument();
    const petrosyans = household('Petrosyan family');
    expect(petrosyans).toHaveTextContent('2 of 3 seats named');
    expect(petrosyans).toHaveTextContent('Armen Petrosyan');
    expect(petrosyans).toHaveTextContent('Coming');
    expect(petrosyans).toHaveTextContent('The bride’s family');
    expect(petrosyans).toHaveTextContent('Seated at Table 4');
    expect(petrosyans).toHaveTextContent('Receives the invitation');
    expect(petrosyans).toHaveTextContent('armen@example.am');
    expect(within(petrosyans).getByText('Not answered')).toBeInTheDocument();
    const hakobyans = household('Hakobyan');
    expect(hakobyans).toHaveTextContent('Not coming');
    expect(hakobyans).toHaveTextContent('The groom’s family');
    expect(hakobyans).toHaveTextContent('Checked in');
  });

  it('keeps the households in the order they came', async () => {
    serve();
    renderList();
    await screen.findByText('3 guests in 2 households');
    const names = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent);
    expect(names).toEqual(['Hakobyan', 'Petrosyan family']);
  });

  it('never puts a guest’s token on the page, nor in the console', async () => {
    const logged = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
    ];
    serve();
    answer('post', '/events/e1/guests', savedGuest);
    const user = renderList();
    await screen.findByText('3 guests in 2 households');
    expect(document.body.innerHTML).not.toContain(token);
    await openEdit(user, 'Armen Petrosyan');
    expect(document.body.innerHTML).not.toContain(token);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Add a guest' }));
    await user.type(await screen.findByLabelText('First name'), 'Lilit');
    await user.click(screen.getByRole('button', { name: 'Add the guest' }));
    expect(await screen.findByText('Lilit was added.')).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(token);
    expect(screen.getByTestId('where').textContent).not.toContain(token);
    for (const spy of logged) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(token);
    }
  });

  it('says when the list is empty', async () => {
    serve([]);
    renderList();
    expect(
      await screen.findByText('No guests yet. Import a spreadsheet, or add guests one at a time.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Import a spreadsheet' })).toHaveAttribute(
      'href',
      '/app/events/e1/guests/import',
    );
  });

  it('says when this role cannot read the guests, and still names the event', async () => {
    serve(refusal(403));
    renderList();
    expect(
      await screen.findByText('The guest list isn’t available to your role on this event.'),
    ).toBeInTheDocument();
    expect(screen.getByText(EVENT.title)).toBeInTheDocument();
  });
});

describe('GuestList: contact details this role cannot see', () => {
  const hidden = () => [householdWire({ id: 'h1', guests: [guestWithoutContact({ id: 'g1' })] })];

  /** The report as this role receives it: no address (docs/API.md §6). */
  const noAddresses = () => {
    const report = deliveryReport();
    report.households = report.households.map(({ toAddress: _hidden, ...row }) => row);
    return report;
  };

  it('says so once, and shows no email or phone', async () => {
    serve(hidden(), { delivery: noAddresses() });
    renderList();
    expect(
      await screen.findByText(
        'Email addresses and phone numbers aren’t shown to your role on this event.',
      ),
    ).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('armen@example.am');
  });

  it('edits without them, and never sends them', async () => {
    serve(hidden());
    const received = answer('patch', '/events/e1/guests/g1', () => HttpResponse.json({}));
    const user = renderList();
    const dialog = await openEdit(user, 'Armen Petrosyan');
    expect(within(dialog).queryByLabelText('Email')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Phone')).not.toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Last name'));
    await user.type(within(dialog).getByLabelText('Last name'), 'Petrosyants');
    await save(user);
    await waitFor(() => expect(received).toEqual([{ lastName: 'Petrosyants' }]));
  });
});

describe('GuestList: the search and the filter', () => {
  it('reads the filter from the address', async () => {
    serve();
    renderList('/app/events/e1/guests?answer=pending');
    expect(await screen.findByText('Showing 1 guest in 1 household')).toBeInTheDocument();
    expect(screen.getByLabelText('Answer')).toHaveValue('PENDING');
    expect(screen.queryByText('Armen Petrosyan')).not.toBeInTheDocument();
    expect(screen.getByText('Ani Petrosyan')).toBeInTheDocument();
  });

  it('writes the search into the address once typing stops, without reloading the list', async () => {
    const reads = serve();
    const user = renderList();
    await user.type(await screen.findByLabelText('Search by name'), 'davit');
    expect(await screen.findByText('Showing 1 guest in 1 household')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('?q=davit'));
    await user.selectOptions(screen.getByLabelText('Answer'), 'DECLINED');
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('?q=davit&answer=declined'),
    );
    expect(reads.guests).toBe(1);
  });

  it('follows the address when it changes by other means, such as Back', async () => {
    serve();
    const user = renderList(['/app/events/e1/guests?q=davit', '/app/events/e1/guests?q=ani']);
    expect(await screen.findByLabelText('Search by name')).toHaveValue('ani');
    await user.click(screen.getByRole('button', { name: 'Go back' }));
    await waitFor(() => expect(screen.getByLabelText('Search by name')).toHaveValue('davit'));
    expect(await screen.findByText('Showing 1 guest in 1 household')).toBeInTheDocument();
    expect(screen.getByText('Davit Hakobyan')).toBeInTheDocument();
    // What is typed never writes the old search back over the address.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.getByTestId('where')).toHaveTextContent('?q=davit');
  });

  it('offers to clear a search that matches nobody', async () => {
    serve();
    const user = renderList('/app/events/e1/guests?q=zzz');
    expect(await screen.findByText('No guests match.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear the search and filter' }));
    expect(await screen.findByText('3 guests in 2 households')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^$/));
  });
});

describe('GuestList: editing a guest', () => {
  it('sends only what changed, then reloads the list', async () => {
    const reads = serve();
    const received = answer('patch', '/events/e1/guests/g1', () => HttpResponse.json({ token }));
    const user = renderList();
    const dialog = await openEdit(user, 'Armen Petrosyan');
    await user.clear(within(dialog).getByLabelText('First name'));
    await user.type(within(dialog).getByLabelText('First name'), 'Armen-Davit');
    await user.selectOptions(within(dialog).getByLabelText('Side'), 'SHARED');
    await save(user);
    expect(await screen.findByText('Changes to Armen Petrosyan were saved.')).toBeInTheDocument();
    expect(received).toEqual([{ firstName: 'Armen-Davit', attribution: 'SHARED' }]);
    expect(reads.guests).toBe(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // The row is still there, so the focus goes back to the button that opened the dialog.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit: Armen Petrosyan' })).toHaveFocus(),
    );
  });

  it('clears an email with an empty string', async () => {
    serve();
    const received = answer('patch', '/events/e1/guests/g1', () => HttpResponse.json({}));
    const user = renderList();
    const dialog = await openEdit(user, 'Armen Petrosyan');
    await user.clear(within(dialog).getByLabelText('Email'));
    await save(user);
    await waitFor(() => expect(received).toEqual([{ email: '' }]));
  });

  it('sends nothing when nothing changed', async () => {
    const reads = serve();
    const received = answer('patch', '/events/e1/guests/g1', () => HttpResponse.json({}));
    const user = renderList();
    await openEdit(user, 'Armen Petrosyan');
    await save(user);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(received).toEqual([]);
    expect(reads.guests).toBe(1);
  });

  it('moves a guest to a household with a free seat, then puts the focus on the status line', async () => {
    let households = guestList();
    const reads = serve(() => HttpResponse.json(households));
    const received = answer('patch', '/events/e1/guests/g2', () => {
      const moving = households.flatMap((one) => one.guests).find((guest) => guest.id === 'g2');
      households = households.map((one) => ({
        ...one,
        guests:
          one.id === 'h2' && moving
            ? [...one.guests, { ...moving, isPrimary: false }]
            : one.guests.filter((guest) => guest.id !== 'g2'),
      }));
      return HttpResponse.json({});
    });
    const user = renderList();
    const dialog = await openEdit(user, 'Ani Petrosyan');
    const choices = within(dialog).getByLabelText('Household');
    expect(
      within(choices)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Hakobyan (1 seat free)', 'Petrosyan family (their household now)']);
    await user.selectOptions(choices, 'h2');
    await save(user);
    const status = await screen.findByText('Changes to Ani Petrosyan were saved.');
    expect(received).toEqual([{ householdId: 'h2' }]);
    expect(reads.guests).toBe(2);
    expect(household('Hakobyan')).toHaveTextContent('Ani Petrosyan');
    // The row that opened the dialog was drawn again in another household, so the button is new.
    await waitFor(() => expect(status).toHaveFocus());
  });

  it('offers no edit for a guest erased at their request', async () => {
    serve([
      householdWire({ id: 'h1', guests: [guestWire({ id: 'g1', isAnonymized: true, token })] }),
    ]);
    renderList();
    expect(await screen.findByText('Details erased at their request')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit: Armen Petrosyan' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove: Armen Petrosyan' })).toBeInTheDocument();
  });

  it('puts a refused email under its field', async () => {
    serve();
    answer(
      'patch',
      '/events/e1/guests/g1',
      refusal(400, ['email: "armen@@example" does not look like an email address']),
    );
    const user = renderList();
    const dialog = await openEdit(user, 'Armen Petrosyan');
    await user.type(within(dialog).getByLabelText('Email'), 'x');
    await save(user);
    expect(
      await within(dialog).findByText('This doesn’t look like an email address.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Some details weren’t accepted.');
  });

  it('reads a refusal that names no field as an erased guest, and reloads the list', async () => {
    const reads = serve();
    answer(
      'patch',
      '/events/e1/guests/g1',
      refusal(400, "This guest's details were erased at their request"),
    );
    const user = renderList();
    const dialog = await openEdit(user, 'Armen Petrosyan');
    await user.type(within(dialog).getByLabelText('Last name'), 's');
    await save(user);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This guest’s details can no longer be changed.',
    );
    await waitFor(() => expect(reads.guests).toBe(2));
  });

  it.each([
    [409, 'Someone moved this guest to another household just now.', 2],
    [404, 'This guest, or the household you chose, is no longer on the list.', 2],
    [403, 'lets you see the guest list but not change it', 1],
    [429, 'Too many attempts. Wait a minute', 1],
    [500, 'Reference: req-1', 1],
  ])(
    'explains a %i, reloading the list only when it is out of date',
    async (status, words, readCount) => {
      const reads = serve();
      answer('patch', '/events/e1/guests/g1', refusal(status));
      const user = renderList();
      const dialog = await openEdit(user, 'Armen Petrosyan');
      await user.type(within(dialog).getByLabelText('Last name'), 's');
      await save(user);
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(words);
      await waitFor(() => expect(reads.guests).toBe(readCount));
    },
  );

  // The dialog opens only from a click, so after hydration; its form still posts (PD-41).
  it('posts its form, from a submit button', async () => {
    serve();
    const user = renderList();
    const dialog = await openEdit(user, 'Armen Petrosyan');
    const form = dialog.querySelector('form');
    expect(form).toHaveAttribute('method', 'post');
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toHaveAttribute(
      'type',
      'submit',
    );
  });
});

describe('GuestList: adding a guest', () => {
  it('gives a new guest a household of their own, with its seats', async () => {
    const reads = serve();
    const received = answer('post', '/events/e1/guests', savedGuest);
    const user = renderList();
    await user.click(await screen.findByRole('button', { name: 'Add a guest' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('First name'), 'Lilit');
    await user.type(within(dialog).getByLabelText('Email'), 'lilit@example.am');
    await user.clear(within(dialog).getByLabelText('Seats'));
    await user.type(within(dialog).getByLabelText('Seats'), '2');
    await user.click(within(dialog).getByRole('button', { name: 'Add the guest' }));
    expect(await screen.findByText('Lilit was added.')).toBeInTheDocument();
    expect(received).toEqual([{ firstName: 'Lilit', email: 'lilit@example.am', seatsAllotted: 2 }]);
    expect(reads.guests).toBe(2);
  });

  it('adds into the household it was opened from', async () => {
    serve();
    const received = answer('post', '/events/e1/guests', savedGuest);
    const user = renderList();
    await user.click(await screen.findByRole('button', { name: 'Add a guest here: Hakobyan' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Household')).toHaveValue('h2');
    expect(within(dialog).queryByLabelText('Seats')).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('First name'), 'Lilit');
    await user.click(within(dialog).getByRole('button', { name: 'Add the guest' }));
    await waitFor(() => expect(received).toEqual([{ firstName: 'Lilit', householdId: 'h2' }]));
  });

  it('checks the first name before sending anything', async () => {
    serve();
    const received = answer('post', '/events/e1/guests', savedGuest);
    const user = renderList();
    await user.click(await screen.findByRole('button', { name: 'Add a guest' }));
    await user.click(await screen.findByRole('button', { name: 'Add the guest' }));
    expect(await screen.findByText('Fill this in.')).toBeInTheDocument();
    expect(received).toEqual([]);
  });

  it('puts a full household under the household field', async () => {
    serve();
    answer(
      'post',
      '/events/e1/guests',
      refusal(400, [
        'householdId: This household has 2 seat(s) and would have 3 guests; raise seatsAllotted first',
      ]),
    );
    const user = renderList();
    await user.click(await screen.findByRole('button', { name: 'Add a guest here: Hakobyan' }));
    await user.type(await screen.findByLabelText('First name'), 'Lilit');
    await user.click(screen.getByRole('button', { name: 'Add the guest' }));
    expect(await screen.findByText(/That household has no free seat left/)).toBeInTheDocument();
  });

  it('explains a 403: this role may read the list but not add to it', async () => {
    serve();
    answer('post', '/events/e1/guests', refusal(403));
    const user = renderList();
    await user.click(await screen.findByRole('button', { name: 'Add a guest' }));
    await user.type(await screen.findByLabelText('First name'), 'Lilit');
    await user.click(screen.getByRole('button', { name: 'Add the guest' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'lets you see the guest list but not add to it',
    );
  });
});

describe('GuestList: a household', () => {
  it('renames it and changes its seats, sending only what changed', async () => {
    const reads = serve();
    const received = answer('patch', '/events/e1/households/h1', () => HttpResponse.json({}));
    const user = renderList();
    await user.click(
      await screen.findByRole('button', { name: 'Edit household: Petrosyan family' }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Seats'));
    await user.type(within(dialog).getByLabelText('Seats'), '5');
    await save(user);
    expect(await screen.findByText('Petrosyan family was saved.')).toBeInTheDocument();
    expect(received).toEqual([{ seatsAllotted: 5 }]);
    expect(reads.guests).toBe(2);
  });

  it('refuses fewer seats than guests named, before and after sending', async () => {
    serve();
    answer(
      'patch',
      '/events/e1/households/h1',
      refusal(400, [
        'seatsAllotted: 3 guest(s) are already named in this household; remove or move some first',
      ]),
    );
    const user = renderList();
    await user.click(
      await screen.findByRole('button', { name: 'Edit household: Petrosyan family' }),
    );
    const dialog = await screen.findByRole('dialog');
    const seats = within(dialog).getByLabelText('Seats');
    await user.clear(seats);
    await user.type(seats, '1');
    await save(user);
    expect(await within(dialog).findByText(/can’t have fewer seats/)).toBeInTheDocument();
    await user.clear(seats);
    await user.type(seats, '2');
    await save(user);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Some details weren’t accepted.',
    );
  });
});

describe('GuestList: removing a guest', () => {
  it('asks first, then removes and reloads the list', async () => {
    let households = guestList();
    const reads = serve(() => HttpResponse.json(households));
    const received = answer('delete', '/events/e1/guests/g1', () => {
      households = households.map((one) => ({
        ...one,
        guests: one.guests.filter((guest) => guest.id !== 'g1'),
      }));
      return HttpResponse.json({ removed: 'g1', isHouseholdRemoved: false });
    });
    const user = renderList();
    await user.click(await screen.findByRole('button', { name: 'Remove: Armen Petrosyan' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Their answer and their seat go with them');
    expect(dialog).toHaveTextContent('Someone else in their household will receive the invitation');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    const status = await screen.findByText('Armen Petrosyan was removed.');
    expect(received).toEqual(['deleted']);
    expect(reads.guests).toBe(2);
    expect(screen.queryByText('Armen Petrosyan')).not.toBeInTheDocument();
    // The row that opened the dialog is gone, so the focus goes to the line that says why.
    await waitFor(() => expect(status).toHaveFocus());
  });

  it('removes nothing when the host cancels', async () => {
    serve();
    const received = answer('delete', '/events/e1/guests/g1', () =>
      HttpResponse.json({ removed: 'g1', isHouseholdRemoved: false }),
    );
    const user = renderList();
    await user.click(await screen.findByRole('button', { name: 'Remove: Armen Petrosyan' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    );
    expect(received).toEqual([]);
  });

  it('says a household left empty goes too', async () => {
    serve();
    answer('delete', '/events/e1/guests/g1', () =>
      HttpResponse.json({ removed: 'g1', isHouseholdRemoved: true }),
    );
    const user = renderList();
    await user.click(await screen.findByRole('button', { name: 'Remove: Armen Petrosyan' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }),
    );
    expect(
      await screen.findByText('Armen Petrosyan was removed, and so was their household.'),
    ).toBeInTheDocument();
  });

  it('explains why a checked-in guest cannot be removed, and offers nothing to confirm', async () => {
    serve();
    const user = renderList();
    await user.click(await screen.findByRole('button', { name: 'Remove: Davit Hakobyan' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Davit Hakobyan can’t be removed');
    expect(dialog).toHaveTextContent('the record that they came');
    expect(within(dialog).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('reads a refused removal as a check-in made meanwhile, and reloads the list', async () => {
    const reads = serve();
    answer('delete', '/events/e1/guests/g1', refusal(400, 'This guest was checked in at the door'));
    const user = renderList();
    await user.click(await screen.findByRole('button', { name: 'Remove: Armen Petrosyan' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('checked in at the door');
    await waitFor(() => expect(reads.guests).toBe(2));
  });

  it('reads a 409 as a move made at the same moment, and reloads the list', async () => {
    const reads = serve();
    answer(
      'delete',
      '/events/e1/guests/g1',
      refusal(409, 'This guest was moved to another household just now; try again'),
    );
    const user = renderList();
    await user.click(await screen.findByRole('button', { name: 'Remove: Armen Petrosyan' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Someone moved this guest to another household just now.',
    );
    await waitFor(() => expect(reads.guests).toBe(2));
  });
});

describe('GuestList: the invitation', () => {
  const sendResult = (overrides: Record<string, unknown> = {}) =>
    HttpResponse.json({
      queued: 1,
      alreadySent: 0,
      recipients: [
        { householdName: 'Petrosyan family', toAddress: 'armen@example.am', channel: 'EMAIL' },
      ],
      suppressed: [],
      unreachable: [],
      ...overrides,
    });

  it('says what happened to each household’s invitation, in the event’s zone', async () => {
    serve();
    renderList();
    await screen.findByText('3 guests in 2 households');
    expect(household('Petrosyan family')).toHaveTextContent(
      'Invitation: Sent · to Armen Petrosyan · by email, armen@example.am · 1 May 2027, 14:00',
    );
    expect(household('Hakobyan')).toHaveTextContent(
      'Invitation: Not sent yet · to Davit Hakobyan · by email, davit@example.am',
    );
    expect(document.body.innerHTML).not.toContain(token);
  });

  it('shows the mail server’s words, in English, only to a role that sees the address', async () => {
    const reason = '550 5.1.1 <davit@example.am>: Recipient address rejected';
    const bounced = deliveryReport();
    const [, hakobyans] = bounced.households;
    if (!hakobyans) throw new Error('No row');
    Object.assign(hakobyans, { status: 'BOUNCED', attempts: 1, failureReason: reason });
    serve(guestList(), { delivery: bounced });
    renderList();
    await screen.findByText('3 guests in 2 households');
    expect(within(household('Hakobyan')).getByText(reason)).toHaveAttribute('lang', 'en');
    expect(household('Hakobyan')).toHaveTextContent('Correct the address, then send again.');
  });

  it('keeps the server’s words and the address from a role without contact access (FR-35)', async () => {
    const reason = '550 5.1.1 <davit@example.am>: Recipient address rejected';
    const bounced = deliveryReport();
    bounced.households = bounced.households.map(({ toAddress: _hidden, ...row }) => ({
      ...row,
      status: 'BOUNCED',
      failureReason: reason,
    }));
    serve(guestList(), { delivery: bounced });
    renderList();
    await screen.findByText('3 guests in 2 households');
    expect(household('Hakobyan')).toHaveTextContent(
      'Invitation: Bounced · to Davit Hakobyan · by email',
    );
    expect(screen.queryByText(reason)).not.toBeInTheDocument();
  });

  it('says why nothing can reach a household, in English', async () => {
    serve(guestList(), {
      delivery: deliveryReport({
        households: deliveryReport().households.slice(0, 1),
        unreachable: [
          {
            householdId: 'h2',
            householdName: 'Hakobyan',
            reason: 'The email address on file for Davit Hakobyan does not look valid',
          },
        ],
      }),
    });
    renderList();
    await screen.findByText('3 guests in 2 households');
    const hakobyans = household('Hakobyan');
    expect(hakobyans).toHaveTextContent('Invitation: Can’t be sent');
    expect(within(hakobyans).getByText(/does not look valid/)).toHaveAttribute('lang', 'en');
    expect(hakobyans).toHaveTextContent('Add or correct an address, then send again.');
  });

  it('filters by what happened to the invitation, from the address and into it', async () => {
    serve();
    const user = renderList('/app/events/e1/guests?invite=notSent');
    expect(await screen.findByText('Showing 1 guest in 1 household')).toBeInTheDocument();
    expect(screen.getByLabelText('Invitation')).toHaveValue('notSent');
    expect(screen.getByText('Davit Hakobyan')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Invitation'), 'sent');
    expect(await screen.findByText('Showing 2 guests in 1 household')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('?invite=sent');
  });

  it('sends to the households chosen, naming one guest of each, then reloads', async () => {
    const reads = serve();
    const sent = answer('post', '/invitations/anna-davit-3f8a1c20/send', () => sendResult());
    const user = renderList();
    await user.click(await screen.findByRole('checkbox', { name: 'Choose Petrosyan family' }));
    expect(screen.getByText('1 household chosen')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send to 1 household' }));
    expect(await screen.findByRole('heading', { name: 'What happened' })).toHaveFocus();
    expect(sent).toEqual([{ guestIds: ['g1'] }]);
    expect(screen.getByText('On its way to 1 household. Nothing more to do.')).toBeInTheDocument();
    await waitFor(() => expect(reads.delivery).toBe(2));
    expect(reads.guests).toBe(2);
    expect(screen.getByText('0 households chosen')).toBeInTheDocument();
  });

  it('chooses every household shown, and still names each household’s first guest', async () => {
    serve();
    const sent = answer('post', '/invitations/anna-davit-3f8a1c20/send', () => sendResult());
    const user = renderList('/app/events/e1/guests?answer=pending');
    await screen.findByText('Showing 1 guest in 1 household');
    await user.click(screen.getByRole('button', { name: 'Choose all shown' }));
    await user.click(screen.getByRole('button', { name: 'Send to 1 household' }));
    await screen.findByRole('heading', { name: 'What happened' });
    expect(sent).toEqual([{ guestIds: ['g1'] }]);
  });

  it('asks first when nothing has been sent yet', async () => {
    serve(guestList(), { delivery: deliveryReport({ invited: 0, notSent: 2 }) });
    const sent = answer('post', '/invitations/anna-davit-3f8a1c20/send', () => sendResult());
    const user = renderList();
    await user.click(await screen.findByRole('checkbox', { name: 'Choose Hakobyan' }));
    await user.click(screen.getByRole('button', { name: 'Send to 1 household' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Send the invitation to 1 household?');
    expect(sent).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sent).toEqual([{ guestIds: ['g3'] }]));
  });

  it('explains a refused send, and keeps the choice', async () => {
    serve();
    answer('post', '/invitations/anna-davit-3f8a1c20/send', refusal(403));
    const user = renderList();
    await user.click(await screen.findByRole('checkbox', { name: 'Choose Hakobyan' }));
    await user.click(screen.getByRole('button', { name: 'Send to 1 household' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your role on this event can’t publish or send the invitation.',
    );
    expect(screen.getByText('1 household chosen')).toBeInTheDocument();
  });

  it('offers nothing to send, and reads no report, while the invitation is a draft', async () => {
    const reads = serve(guestList(), {
      event: { ...EVENT, invitation: { slug: 'anna-davit-3f8a1c20', status: 'DRAFT' } },
    });
    renderList();
    expect(
      await screen.findByText(/The invitation is a draft, so nothing has been sent yet./),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Publish and send' })).toHaveAttribute(
      'href',
      '/app/events/e1/invitation',
    );
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Invitation')).not.toBeInTheDocument();
    expect(reads.delivery).toBe(0);
  });

  it('leaves the list standing when the report fails, with the reference', async () => {
    serve(guestList(), { delivery: refusal(500) });
    renderList();
    expect(await screen.findByText('3 guests in 2 households')).toBeInTheDocument();
    expect(screen.getByText('Reference: req-1')).toBeInTheDocument();
  });
});
