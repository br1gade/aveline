import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData, useLocation } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import { createI18n } from '@/lib/i18n';
import { APP_PATHS } from '@/route-paths';

import { DoorPage } from './components/door-page';
import { loadDoor, type DoorData } from './load';

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
/** Made at run time: whatever an answer carries beyond its fields must go nowhere. */
const TOKEN = `tok-${crypto.randomUUID()}`;
const CODE = 'SAMPLE-1';
/** 22:02 in the event's zone. */
const ARRIVED_AT = '2026-10-05T18:02:11.000Z';

const EVENT = {
  id: 'e1',
  title: 'Autumn Jazz Night',
  type: 'CONCERT',
  hostsLabel: 'The Garden',
  startsAt: '2027-10-02T15:00:00.000Z',
  endsAt: null,
  timezone: 'Asia/Yerevan',
  locales: ['en'],
  defaultLocale: 'en',
  visibility: 'PUBLIC',
  invitation: null,
  venues: [],
};

function guestWire(id: string, name: string, extra: Record<string, unknown> = {}) {
  const [firstName, lastName = null] = name.split(' ');
  return {
    id,
    firstName,
    lastName,
    name,
    locale: null,
    attribution: 'UNKNOWN',
    isPrimary: true,
    addedByGuest: false,
    isAnonymized: false,
    rsvpStatus: 'ATTENDING',
    table: null,
    seating: [
      { arrangementId: 'a1', tableId: 't1', venue: 'Hall', table: 'Table 4', isReservation: false },
    ],
    isCheckedIn: false,
    arrivedAt: null,
    email: null,
    phone: null,
    token: TOKEN,
    ...extra,
  };
}

const HOUSEHOLDS = [
  {
    id: 'h1',
    name: 'Petrosyan family',
    seatsAllotted: 2,
    seatsNamed: 2,
    guests: [guestWire('g1', 'Armen Petrosyan'), guestWire('g2', 'Lusine Petrosyan')],
  },
];
const ARRIVALS = {
  expected: 96,
  arrived: 73,
  stillToCome: 25,
  unexpected: 2,
  recent: [{ name: 'Ani Grigoryan', arrivedAt: ARRIVED_AT }],
};
const CHECKED_IN = {
  guestId: 'g1',
  name: 'Armen Petrosyan',
  arrivedAt: ARRIVED_AT,
  table: null,
  seating: [{ venue: 'Hall', table: 'Table 4' }],
  wasExpected: true,
};

const server = setupServer();
const sent: Array<{ method: string; path: string }> = [];

function refusal(status: number, message: string) {
  return HttpResponse.json(
    { statusCode: status, message, requestId: `r-${status}` },
    { status, headers: { 'x-request-id': `r-${status}` } },
  );
}

function record(reply: () => Response) {
  return ({ request }: { request: Request }) => {
    sent.push({ method: request.method, path: new URL(request.url).pathname });
    return reply();
  };
}

const writes = () => sent.filter(({ method }) => method !== 'GET');
const reads = (path: string) =>
  sent.filter(({ method, path: sentPath }) => method === 'GET' && sentPath.endsWith(path));

function answerCheckIn(reply: () => Response) {
  server.use(http.post(`${API}/events/e1/guests/g1/check-in`, record(reply)));
}

function answerCode(reply: () => Response) {
  server.use(http.post(`${API}/events/e1/tickets/:code/admit`, record(reply)));
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  sent.length = 0;
  current.session = createBrowserSession({
    baseUrl: ORIGIN,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
  server.use(
    http.get(`${API}/events/e1`, () => HttpResponse.json(EVENT)),
    http.get(
      `${API}/events/e1/guests`,
      record(() => HttpResponse.json(HOUSEHOLDS)),
    ),
    http.get(
      `${API}/events/e1/arrivals`,
      record(() => HttpResponse.json(ARRIVALS)),
    ),
  );
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function Address() {
  const { pathname, search } = useLocation();
  return <span data-testid="address">{`${pathname}${search}`}</span>;
}

function renderAt(path = '/app/events/e1/door') {
  const Stub = createRoutesStub([
    {
      path: APP_PATHS.door,
      loader: ({ params }) => {
        if (!current.session) throw new Error('No session');
        return loadDoor(current.session.api, params.eventId ?? '');
      },
      Component: () => (
        <>
          <DoorPage data={useLoaderData<DoorData>()} />
          <Address />
        </>
      ),
    },
    { path: APP_PATHS.event, Component: () => <p>Event page</p> },
    { path: APP_PATHS.guests, Component: () => <Address /> },
  ]);
  const view = render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={[path]} />
    </I18nextProvider>,
  );
  return { ...view, user: userEvent.setup() };
}

async function searchFor(user: ReturnType<typeof userEvent.setup>, name: string) {
  await screen.findByRole('button', { name: 'Read the list again' });
  await user.type(screen.getByRole('searchbox', { name: 'Their name' }), name);
}

async function typeCode(user: ReturnType<typeof userEvent.setup>, code: string) {
  const field = await screen.findByRole('textbox', { name: 'Ticket code' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Admit' })).toBeEnabled());
  await user.type(field, code);
  await user.click(screen.getByRole('button', { name: 'Admit' }));
}

const outcome = () => screen.getByRole('status');

describe('the door, by name (PD-90)', () => {
  it('shows the counts as the server gives them, and nobody until a name is typed', async () => {
    renderAt();
    expect(await screen.findByText('Still to come')).toBeInTheDocument();
    expect(screen.getByText('73')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('96')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Armen Petrosyan' })).not.toBeInTheDocument();
  });

  it('finds someone and their household, without the search reaching the address', async () => {
    const { user } = renderAt();
    await searchFor(user, 'lusine');
    expect(screen.getByRole('heading', { name: 'Lusine Petrosyan' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Armen Petrosyan' })).toBeInTheDocument();
    expect(screen.getByTestId('address')).toHaveTextContent(/^\/app\/events\/e1\/door$/);
  });

  it('finds a Latin name typed in another alphabet', async () => {
    const { user } = renderAt();
    await searchFor(user, 'лусине');
    expect(screen.getByRole('heading', { name: 'Lusine Petrosyan' })).toBeInTheDocument();
  });

  it('checks them in: their table, in the event’s zone, with Undo, and no token anywhere', async () => {
    answerCheckIn(() => HttpResponse.json(CHECKED_IN, { status: 201 }));
    const { user, container } = renderAt();
    await searchFor(user, 'armen');
    await user.click(screen.getByRole('button', { name: 'Check in Armen Petrosyan' }));
    expect(await within(outcome()).findByText('In, at 22:02.')).toBeInTheDocument();
    expect(within(outcome()).getByText('Table 4 (Hall)')).toBeInTheDocument();
    expect(within(outcome()).getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(screen.getByText('Here since 22:02')).toBeInTheDocument();
    expect(writes()).toEqual([{ method: 'POST', path: '/api/v1/events/e1/guests/g1/check-in' }]);
    expect(container.innerHTML).not.toContain(TOKEN);
  });

  it('flags someone who wasn’t expected, whom the server has let in', async () => {
    answerCheckIn(() => HttpResponse.json({ ...CHECKED_IN, wasExpected: false }, { status: 201 }));
    const { user } = renderAt();
    await searchFor(user, 'armen');
    await user.click(screen.getByRole('button', { name: 'Check in Armen Petrosyan' }));
    expect(await within(outcome()).findByText(/They weren’t expected/)).toBeInTheDocument();
  });

  it('reads a second check-in, a 409, as already here at the first time', async () => {
    answerCheckIn(() => refusal(409, `Guest was already checked in at ${ARRIVED_AT}`));
    const { user } = renderAt();
    await searchFor(user, 'armen');
    await user.click(screen.getByRole('button', { name: 'Check in Armen Petrosyan' }));
    expect(await within(outcome()).findByText('Already here, since 22:02.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Undo the check-in of Armen/ })).toBeInTheDocument();
  });

  it('reads a linked guest’s used ticket, a 400, as already here, and reads the list for the time', async () => {
    answerCheckIn(() => refusal(400, 'Ticket already used'));
    const { user } = renderAt();
    await searchFor(user, 'armen');
    const before = reads('/guests').length;
    await user.click(screen.getByRole('button', { name: 'Check in Armen Petrosyan' }));
    expect(await within(outcome()).findByText('Already here.')).toBeInTheDocument();
    await waitFor(() => expect(reads('/guests').length).toBe(before + 1));
  });

  it('never reads "the ticket was linked", also a 409, as already here', async () => {
    answerCheckIn(() => refusal(409, 'Ticket was linked; refresh and scan again'));
    const { user } = renderAt();
    await searchFor(user, 'armen');
    await user.click(screen.getByRole('button', { name: 'Check in Armen Petrosyan' }));
    expect(await within(outcome()).findByText(/link to a guest changed/)).toBeInTheDocument();
    expect(within(outcome()).queryByText(/Already here/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check in Armen Petrosyan' })).toBeInTheDocument();
  });

  it('shows a refusal it doesn’t know as it came, marked English, with its reference', async () => {
    answerCheckIn(() => refusal(409, 'Something new'));
    const { user } = renderAt();
    await searchFor(user, 'armen');
    await user.click(screen.getByRole('button', { name: 'Check in Armen Petrosyan' }));
    const sentence = await within(outcome()).findByText('Something new');
    expect(sentence).toHaveAttribute('lang', 'en');
    expect(within(outcome()).getByText('Reference: r-409')).toBeInTheDocument();
  });

  it('after no answer says it may have counted, then reads a repeat’s refusal as that press', async () => {
    answerCheckIn(() => refusal(500, 'Internal'));
    const { user } = renderAt();
    await searchFor(user, 'armen');
    await user.click(screen.getByRole('button', { name: 'Check in Armen Petrosyan' }));
    expect(await within(outcome()).findByText(/It may have counted/)).toBeInTheDocument();
    expect(screen.queryByText('Here since 22:02')).not.toBeInTheDocument();
    answerCheckIn(() => refusal(409, `Guest was already checked in at ${ARRIVED_AT}`));
    await user.click(screen.getByRole('button', { name: 'Check in Armen Petrosyan' }));
    expect(await within(outcome()).findByText(/Probably your earlier press/)).toBeInTheDocument();
  });

  it('undoes a check-in, from the outcome, through the guest', async () => {
    answerCheckIn(() => HttpResponse.json(CHECKED_IN, { status: 201 }));
    server.use(
      http.delete(
        `${API}/events/e1/guests/g1/check-in`,
        record(() => HttpResponse.json({ ok: true })),
      ),
    );
    const { user } = renderAt();
    await searchFor(user, 'armen');
    await user.click(screen.getByRole('button', { name: 'Check in Armen Petrosyan' }));
    await user.click(await within(outcome()).findByRole('button', { name: 'Undo' }));
    expect(await within(outcome()).findByText(/Taken off the arrivals/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check in Armen Petrosyan' })).toBeInTheDocument();
    expect(writes().at(-1)).toEqual({
      method: 'DELETE',
      path: '/api/v1/events/e1/guests/g1/check-in',
    });
  });

  it('words a 403 on a write, without trying again, and keeps the list for a read-only role', async () => {
    answerCheckIn(() => refusal(403, 'Forbidden'));
    const { user } = renderAt();
    await searchFor(user, 'armen');
    await user.click(screen.getByRole('button', { name: 'Check in Armen Petrosyan' }));
    expect(await within(outcome()).findByText(/can’t let people in/)).toBeInTheDocument();
    expect(writes()).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Armen Petrosyan' })).toBeInTheDocument();
  });

  it('says when nobody matches, and links to the guest list', async () => {
    const { user } = renderAt();
    await searchFor(user, 'nobody by this name');
    expect(screen.getByText('Nobody on the list by that name.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the guest list' })).toHaveAttribute(
      'href',
      '/app/events/e1/guests',
    );
  });

  it('says when the list is empty', async () => {
    server.use(http.get(`${API}/events/e1/guests`, () => HttpResponse.json([])));
    renderAt();
    expect(await screen.findByText(/No guests on the list yet/)).toBeInTheDocument();
  });

  it('says when the list can’t be read, and offers to read it again', async () => {
    server.use(http.get(`${API}/events/e1/guests`, () => refusal(404, 'Gone')));
    const { user } = renderAt();
    expect(await screen.findByText('The guest list couldn’t be read.')).toBeInTheDocument();
    server.use(http.get(`${API}/events/e1/guests`, () => HttpResponse.json(HOUSEHOLDS)));
    await user.click(screen.getByRole('button', { name: 'Read the list again' }));
    await searchFor(user, 'armen');
    expect(screen.getByRole('heading', { name: 'Armen Petrosyan' })).toBeInTheDocument();
  });

  it('reads the list again on coming back after a minute, and not sooner', async () => {
    renderAt();
    await screen.findByRole('button', { name: 'Read the list again' });
    const before = reads('/guests').length;
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 59_000);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reads('/guests')).toHaveLength(before);
    clock.mockReturnValue(now + 61_000);
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(reads('/guests')).toHaveLength(before + 1));
    clock.mockRestore();
  });

  it('keeps the last list and says when, when reading it again fails', async () => {
    const { user } = renderAt();
    await searchFor(user, 'armen');
    server.use(http.get(`${API}/events/e1/guests`, () => refusal(500, 'Internal')));
    await user.click(screen.getByRole('button', { name: 'Read the list again' }));
    expect(await screen.findByText(/reading it again failed/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Armen Petrosyan' })).toBeInTheDocument();
  });
});

describe('the door, by code (PD-91)', () => {
  it('switches in the address, keeping whatever else is there', async () => {
    const { user } = renderAt('/app/events/e1/door?lang=fr');
    await user.click(await screen.findByRole('link', { name: 'By ticket code' }));
    await waitFor(() =>
      expect(screen.getByTestId('address')).toHaveTextContent('door?lang=fr&by=code'),
    );
    await user.click(screen.getByRole('link', { name: 'By name' }));
    await waitFor(() => expect(screen.getByTestId('address')).toHaveTextContent(/door\?lang=fr$/));
  });

  it('sends the code as stored, then empties the field and keeps it out of the address', async () => {
    answerCode(() =>
      HttpResponse.json(
        { code: CODE, admittedAt: ARRIVED_AT, holderName: 'Armen Petrosyan', guestId: 'g1' },
        { status: 201 },
      ),
    );
    const { user, container } = renderAt('/app/events/e1/door?by=code');
    await typeCode(user, ' sample-1 ');
    expect(await within(outcome()).findByText('In, at 22:02.')).toBeInTheDocument();
    expect(writes()[0]?.path).toBe(`/api/v1/events/e1/tickets/${CODE}/admit`);
    expect(screen.getByRole('textbox', { name: 'Ticket code' })).toHaveValue('');
    expect(screen.getByTestId('address')).toHaveTextContent('/app/events/e1/door?by=code');
    expect(container.innerHTML).not.toContain(CODE);
  });

  it('treats a linked ticket and its guest as one arrival: table from the list, Undo by guest', async () => {
    answerCode(() =>
      HttpResponse.json(
        { code: CODE, admittedAt: ARRIVED_AT, holderName: 'Armen Petrosyan', guestId: 'g1' },
        { status: 201 },
      ),
    );
    const { user } = renderAt();
    await screen.findByRole('button', { name: 'Read the list again' });
    await user.click(screen.getByRole('link', { name: 'By ticket code' }));
    await typeCode(user, CODE);
    expect(await within(outcome()).findByText('Table 4 (Hall)')).toBeInTheDocument();
    expect(await within(outcome()).findByRole('button', { name: 'Undo' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'By name' }));
    await user.type(await screen.findByRole('searchbox', { name: 'Their name' }), 'armen');
    expect(screen.getByText('Here since 22:02')).toBeInTheDocument();
  });

  it('says a ticket with no guest can’t be undone and isn’t counted', async () => {
    answerCode(() =>
      HttpResponse.json(
        { code: CODE, admittedAt: ARRIVED_AT, holderName: 'Bought by Karen', guestId: null },
        { status: 201 },
      ),
    );
    const { user } = renderAt('/app/events/e1/door?by=code');
    await typeCode(user, CODE);
    expect(await within(outcome()).findByText(/can’t be undone here/)).toBeInTheDocument();
    expect(within(outcome()).getByText('Bought by Karen')).toBeInTheDocument();
    expect(within(outcome()).queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it.each([
    [400, 'Ticket already used', /already been admitted/],
    [400, 'Ticket already void', /this ticket is void/],
    [400, 'Ticket already refunded', /this ticket was refunded/],
    [400, 'Ticket order is cancelled or cancellation is in progress', /was cancelled or refunded/],
    [404, 'Ticket not recognised', /isn’t recognised for this event/],
  ])('words a %i "%s"', async (status, sentence, words) => {
    answerCode(() => refusal(status, sentence));
    const { user } = renderAt('/app/events/e1/door?by=code');
    await typeCode(user, CODE);
    expect(await within(outcome()).findByText(words)).toBeInTheDocument();
  });

  it('keeps a code that wasn’t recognised, to fix, and empties one that is done with', async () => {
    answerCode(() => refusal(404, 'Ticket not recognised'));
    const { user } = renderAt('/app/events/e1/door?by=code');
    await typeCode(user, CODE);
    await within(outcome()).findByText(/isn’t recognised/);
    expect(screen.getByRole('textbox', { name: 'Ticket code' })).toHaveValue(CODE);
    answerCode(() => refusal(400, 'Ticket already used'));
    await user.click(screen.getByRole('button', { name: 'Admit' }));
    await within(outcome()).findByText(/already been admitted/);
    expect(screen.getByRole('textbox', { name: 'Ticket code' })).toHaveValue('');
  });

  it('asks for a Latin keyboard, and for a code, without sending anything', async () => {
    const { user } = renderAt('/app/events/e1/door?by=code');
    await typeCode(user, 'АБВГ');
    expect(await screen.findByText(/isn’t Latin letters/)).toBeInTheDocument();
    await user.clear(screen.getByRole('textbox', { name: 'Ticket code' }));
    await user.click(screen.getByRole('button', { name: 'Admit' }));
    expect(screen.getByText('Type the code from their ticket.')).toBeInTheDocument();
    expect(writes()).toEqual([]);
  });
});

describe('who must agree before the door (PD-93)', () => {
  const INVITED = { ...EVENT, invitation: { slug: 'autumn', status: 'PUBLISHED' } };
  const DESIGN = {
    slug: 'autumn',
    status: 'PUBLISHED',
    event: {
      id: 'e1',
      title: EVENT.title,
      locales: ['en'],
      defaultLocale: 'en',
      timezone: 'Asia/Yerevan',
    },
    template: {
      key: 'classic',
      name: 'Classic',
      allowedFonts: [],
      palettes: [],
      supportedBlocks: [],
    },
    theme: {},
    effectiveTheme: {},
    blocks: [],
    questions: [
      {
        id: 'q1',
        type: 'SIGNATURE',
        required: true,
        prompt: { en: 'I accept the venue’s rules' },
        options: {},
        answerCount: 0,
        statementVersionId: 'v2',
      },
    ],
  };
  const agreed = (subjectGuestId: string) => ({
    id: `a-${subjectGuestId}`,
    questionId: 'q1',
    statementVersionId: 'v2',
    subjectGuestId,
    signerGuestId: subjectGuestId,
    signerName: 'x',
    method: 'TYPED',
    isRepresentative: false,
    locale: 'en',
    statement: 'I accept',
    mediaId: null,
    createdAt: ARRIVED_AT,
  });

  beforeEach(() => {
    server.use(
      http.get(`${API}/events/e1`, () => HttpResponse.json(INVITED)),
      http.get(`${API}/invitations/autumn/design`, () => HttpResponse.json(DESIGN)),
      http.get(
        `${API}/events/e1/acknowledgements`,
        record(() => HttpResponse.json({ items: [agreed('g2')], nextCursor: null })),
      ),
    );
  });

  it('lists who hasn’t agreed, and marks them, while Check in stays live', async () => {
    const { user } = renderAt();
    const summary = await screen.findByText('Must agree before the door (1)');
    await user.click(summary);
    await searchFor(user, 'armen');
    expect(screen.getByText(/Must agree first: I accept the venue’s rules/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check in Armen Petrosyan' })).toBeEnabled();
  });

  it('words the server’s refusal with the statement, offers what to do, and reads one page again', async () => {
    answerCheckIn(() =>
      refusal(400, 'acknowledgements: g1 must acknowledge q1 in its current version'),
    );
    const { user } = renderAt();
    await screen.findByText('Must agree before the door (1)');
    await searchFor(user, 'armen');
    const before = reads('/acknowledgements').length;
    await user.click(screen.getByRole('button', { name: 'Check in Armen Petrosyan' }));
    expect(await within(outcome()).findByText(/Not let in yet/)).toBeInTheDocument();
    expect(within(outcome()).getByText('I accept the venue’s rules')).toBeInTheDocument();
    expect(within(outcome()).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(within(outcome()).getByRole('link', { name: /Send their invitation/ })).toHaveAttribute(
      'href',
      '/app/events/e1/guests?q=Armen+Petrosyan',
    );
    await waitFor(() => expect(reads('/acknowledgements').length).toBe(before + 1));
  });

  it('reads who agreed again along with the list, so a mark doesn’t outlive it', async () => {
    const { user } = renderAt();
    await screen.findByText('Must agree before the door (1)');
    await searchFor(user, 'armen');
    expect(screen.getByText(/Must agree first/)).toBeInTheDocument();
    server.use(
      http.get(`${API}/events/e1/acknowledgements`, () =>
        HttpResponse.json({ items: [agreed('g1')], nextCursor: null }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Read the list again' }));
    await waitFor(() => expect(screen.queryByText(/Must agree first/)).not.toBeInTheDocument());
  });

  it('reads nothing when the event requires nothing', async () => {
    server.use(
      http.get(`${API}/invitations/autumn/design`, () =>
        HttpResponse.json({ ...DESIGN, questions: [] }),
      ),
    );
    renderAt();
    await screen.findByRole('button', { name: 'Read the list again' });
    await waitFor(() => expect(reads('/guests').length).toBeGreaterThan(0));
    expect(reads('/acknowledgements')).toEqual([]);
    expect(screen.queryByText(/Must agree before the door/)).not.toBeInTheDocument();
  });

  it('says so when who agreed can’t be read, and the door still works', async () => {
    server.use(http.get(`${API}/events/e1/acknowledgements`, () => refusal(403, 'Forbidden')));
    const { user } = renderAt();
    expect(await screen.findByText(/couldn’t be read. The door still checks/)).toBeInTheDocument();
    await searchFor(user, 'armen');
    expect(screen.getByRole('button', { name: 'Check in Armen Petrosyan' })).toBeEnabled();
  });
});

describe('who must agree, when the reads fail (PD-93)', () => {
  const INVITED = { ...EVENT, invitation: { slug: 'autumn', status: 'PUBLISHED' } };

  it('says so when the statements can’t be read, and tries again on a refusal', async () => {
    server.use(
      http.get(`${API}/events/e1`, () => HttpResponse.json(INVITED)),
      http.get(`${API}/invitations/autumn/design`, () => refusal(500, 'Internal')),
    );
    answerCheckIn(() =>
      refusal(400, 'acknowledgements: g1 must acknowledge q1 in its current version'),
    );
    const { user } = renderAt();
    expect(await screen.findByText(/couldn’t be read. The door still checks/)).toBeInTheDocument();
    await searchFor(user, 'armen');
    await user.click(screen.getByRole('button', { name: 'Check in Armen Petrosyan' }));
    expect(await within(outcome()).findByText(/Not let in yet/)).toBeInTheDocument();
    expect(screen.getByText(/couldn’t be read. The door still checks/)).toBeInTheDocument();
  });
});

describe('a role that may not (FR-6)', () => {
  it('tells a designer once that the door isn’t theirs', async () => {
    server.use(
      http.get(`${API}/events/e1/guests`, () => refusal(403, 'Forbidden')),
      http.get(`${API}/events/e1/arrivals`, () => refusal(403, 'Forbidden')),
    );
    renderAt();
    expect(await screen.findByText(/can’t see the door/)).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('keeps the list when only the counts are refused, and stops asking for them', async () => {
    server.use(
      http.get(
        `${API}/events/e1/arrivals`,
        record(() => refusal(403, 'Forbidden')),
      ),
    );
    const { user } = renderAt();
    expect(await screen.findByText('Your role can’t see the counts.')).toBeInTheDocument();
    await searchFor(user, 'armen');
    expect(screen.getByRole('heading', { name: 'Armen Petrosyan' })).toBeInTheDocument();
    expect(reads('/arrivals')).toHaveLength(1);
  });

  it('doesn’t ask again for a list it was refused, on coming back', async () => {
    server.use(
      http.get(
        `${API}/events/e1/guests`,
        record(() => refusal(403, 'Forbidden')),
      ),
    );
    renderAt();
    expect(await screen.findByText('Your role can’t see the guest list.')).toBeInTheDocument();
    expect(reads('/guests')).toHaveLength(1);
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(reads('/guests')).toHaveLength(1);
    clock.mockRestore();
  });

  it('keeps the code field working while the list can’t be read', async () => {
    server.use(http.get(`${API}/events/e1/guests`, () => refusal(500, 'Internal')));
    const { user } = renderAt('/app/events/e1/door?by=code');
    answerCode(() => refusal(404, 'Ticket not recognised'));
    await typeCode(user, CODE);
    expect(await within(outcome()).findByText(/isn’t recognised/)).toBeInTheDocument();
  });
});
