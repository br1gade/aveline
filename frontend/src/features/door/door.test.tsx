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
import { MAX_ROSTER_PAGES } from './components/use-guest-read';
import { loadDoor, type DoorData } from './load';

const current = vi.hoisted(() => ({ session: undefined as BrowserSession | undefined }));
const decoder = vi.hoisted(() => ({ read: (): unknown => null }));
vi.mock('jsqr', () => ({ default: () => decoder.read() }));
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

/**
 * A roster row as the API sends it (docs/API.md §6, "Door roster"), with a token and an address
 * planted beside it: whatever the door doesn't show must go nowhere.
 */
function rosterWire(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    guestId: id,
    name,
    householdName: 'Petrosyan family',
    attendance: 'ATTENDING',
    arrivedAt: null,
    hasTicket: false,
    seating: [{ venue: 'Hall', table: 'Table 4', position: null }],
    token: TOKEN,
    email: 'planted@example.am',
    ...extra,
  };
}

const ROSTER = {
  items: [rosterWire('g1', 'Armen Petrosyan'), rosterWire('g2', 'Lusine Petrosyan')],
  nextCursor: null,
};
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
const sent: Array<{ method: string; path: string; search: string }> = [];

function refusal(status: number, message: string) {
  return HttpResponse.json(
    { statusCode: status, message, requestId: `r-${status}` },
    { status, headers: { 'x-request-id': `r-${status}` } },
  );
}

/** A refusal with its stable code and the `admission` facts (FR-76). */
function codedRefusal(
  status: number,
  code: string,
  admission: Record<string, unknown> = {},
  message = 'Words',
) {
  return HttpResponse.json(
    { statusCode: status, message, code, requestId: `r-${status}`, admission },
    { status, headers: { 'x-request-id': `r-${status}` } },
  );
}

function record(reply: () => Response) {
  return ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    sent.push({ method: request.method, path: url.pathname, search: url.search });
    return reply();
  };
}

const writes = () =>
  sent.filter(({ method }) => method !== 'GET').map(({ method, path }) => ({ method, path }));
/** Whole reads; a search for one person after a check-in is a refresh (`refreshes`). */
const reads = (path: string) =>
  sent.filter(
    ({ method, path: sentPath, search }) =>
      method === 'GET' && sentPath.endsWith(path) && !search.includes('search='),
  );
const refreshes = () => sent.filter(({ search }) => search.includes('search='));

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
      `${API}/events/e1/door-roster`,
      record(() => HttpResponse.json(ROSTER)),
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
    const before = reads('/door-roster').length;
    await user.click(screen.getByRole('button', { name: 'Check in Armen Petrosyan' }));
    expect(await within(outcome()).findByText('Already here.')).toBeInTheDocument();
    await waitFor(() => expect(reads('/door-roster').length).toBe(before + 1));
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
    server.use(
      http.get(`${API}/events/e1/door-roster`, () =>
        HttpResponse.json({ items: [], nextCursor: null }),
      ),
    );
    renderAt();
    expect(await screen.findByText(/No guests on the list yet/)).toBeInTheDocument();
  });

  it('says when the list can’t be read, and offers to read it again', async () => {
    server.use(http.get(`${API}/events/e1/door-roster`, () => refusal(404, 'Gone')));
    const { user } = renderAt();
    expect(await screen.findByText('The guest list couldn’t be read.')).toBeInTheDocument();
    server.use(http.get(`${API}/events/e1/door-roster`, () => HttpResponse.json(ROSTER)));
    await user.click(screen.getByRole('button', { name: 'Read the list again' }));
    await searchFor(user, 'armen');
    expect(screen.getByRole('heading', { name: 'Armen Petrosyan' })).toBeInTheDocument();
  });

  it('reads the list again on coming back after a minute, and not sooner', async () => {
    renderAt();
    await screen.findByRole('button', { name: 'Read the list again' });
    const before = reads('/door-roster').length;
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 59_000);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reads('/door-roster')).toHaveLength(before);
    clock.mockReturnValue(now + 61_000);
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(reads('/door-roster')).toHaveLength(before + 1));
    clock.mockRestore();
  });

  it('keeps the last list and says when, when reading it again fails', async () => {
    const { user } = renderAt();
    await searchFor(user, 'armen');
    server.use(http.get(`${API}/events/e1/door-roster`, () => refusal(500, 'Internal')));
    await user.click(screen.getByRole('button', { name: 'Read the list again' }));
    expect(await screen.findByText(/reading it again failed/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Armen Petrosyan' })).toBeInTheDocument();
  });
});

describe('a walk-in, added at the door (PD-148)', () => {
  const NAREK = {
    ...CHECKED_IN,
    guestId: 'g9',
    name: 'Narek Sargsyan',
    seating: [],
    wasExpected: false,
  };
  const withNarek = {
    items: [
      ...ROSTER.items,
      rosterWire('g9', 'Narek Sargsyan', {
        householdName: 'Narek Sargsyan',
        attendance: 'PENDING',
        seating: [],
      }),
    ],
    nextCursor: null,
  };

  /** Adding answers with the new guest's token, as the API does; the list then has them. */
  function answerAdd(reply: () => Response = () => HttpResponse.json({ id: 'g9', token: TOKEN })) {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/events/e1/guests`, async ({ request }) => {
        bodies.push(await request.clone().json());
        sent.push({ method: 'POST', path: new URL(request.url).pathname, search: '' });
        const answer = reply();
        if (answer.ok) {
          server.use(http.get(`${API}/events/e1/door-roster`, () => HttpResponse.json(withNarek)));
        }
        return answer;
      }),
    );
    return bodies;
  }

  function answerNarek(reply: () => Response) {
    server.use(http.post(`${API}/events/e1/guests/g9/check-in`, record(reply)));
  }

  async function addWalkIn(user: ReturnType<typeof userEvent.setup>, first: string, last = '') {
    await user.click(await screen.findByText('Someone not on the list'));
    await user.type(screen.getByLabelText('First name'), first);
    if (last) await user.type(screen.getByLabelText('Last name'), last);
    await user.click(screen.getByRole('button', { name: 'Add and check in' }));
  }

  it('adds them in a household of their own and checks them in, never showing the token', async () => {
    const bodies = answerAdd();
    answerNarek(() => HttpResponse.json(NAREK, { status: 201 }));
    const { user, container } = renderAt();
    await addWalkIn(user, 'Narek', 'Sargsyan');
    expect(await within(outcome()).findByText(/They weren’t expected/)).toBeInTheDocument();
    expect(bodies).toEqual([{ firstName: 'Narek', lastName: 'Sargsyan', seatsAllotted: 1 }]);
    expect(writes()).toEqual([
      { method: 'POST', path: '/api/v1/events/e1/guests' },
      { method: 'POST', path: '/api/v1/events/e1/guests/g9/check-in' },
    ]);
    expect(await within(outcome()).findByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(screen.queryByLabelText('First name')).not.toBeVisible();
    expect(container.innerHTML).not.toContain(TOKEN);
  });

  it('says they were added but not checked in when that is refused, and checks them in again', async () => {
    answerAdd();
    answerNarek(() => refusal(503, 'Service Unavailable'));
    const { user } = renderAt();
    await addWalkIn(user, 'Narek', 'Sargsyan');
    expect(
      await within(outcome()).findByText('Added to the guest list, but not checked in yet.'),
    ).toBeInTheDocument();
    answerNarek(() => HttpResponse.json(NAREK, { status: 201 }));
    await user.click(await within(outcome()).findByRole('button', { name: 'Try again' }));
    expect(await within(outcome()).findByText(/They weren’t expected/)).toBeInTheDocument();
  });

  it('keeps what was typed when adding is refused, and checks nobody in', async () => {
    answerAdd(() => refusal(403, 'Forbidden'));
    const { user } = renderAt();
    await addWalkIn(user, 'Narek');
    expect(
      await screen.findByText(
        'Your role on this event can’t let people in. Ask the event’s owner to add you as a coordinator.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('First name')).toHaveValue('Narek');
    expect(writes()).toEqual([{ method: 'POST', path: '/api/v1/events/e1/guests' }]);
  });

  it('looks for them by the name typed after no answer, and says to search before adding again', async () => {
    answerAdd(() => refusal(502, 'Bad Gateway'));
    const { user } = renderAt();
    await addWalkIn(user, 'Narek');
    expect(await screen.findByText(/they may have been added all the same/)).toBeInTheDocument();
    await waitFor(() => expect(refreshes()).toHaveLength(1));
    expect(new URLSearchParams(refreshes()[0]?.search).get('search')).toBe('Narek');
    expect(reads('/events/e1/door-roster')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Add and check in' })).toBeEnabled();
  });

  it('asks for a first name before sending anything', async () => {
    const { user } = renderAt();
    await user.click(await screen.findByText('Someone not on the list'));
    await user.click(screen.getByRole('button', { name: 'Add and check in' }));
    expect(await screen.findByText('Type their first name.')).toBeInTheDocument();
    expect(writes()).toEqual([]);
  });
});

describe('a ticket scanned at the door (PD-173)', () => {
  const SCANNED = 'ABCDEFGH12345678';
  let code = SCANNED;
  const track = { stop: () => undefined, addEventListener: () => undefined };

  beforeEach(() => {
    code = SCANNED;
    decoder.read = () => ({ data: code });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => Promise.resolve({ getTracks: () => [track] }) },
    });
    Element.prototype.scrollIntoView = () => undefined;
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(640);
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(480);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: () => undefined,
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    } as unknown as RenderingContext);
  });
  afterEach(() => vi.restoreAllMocks());

  async function scan() {
    const { user } = renderAt('/app/events/e1/door?by=code');
    await user.click(await screen.findByRole('button', { name: 'Scan a ticket' }));
    return user;
  }
  const admitted = () =>
    HttpResponse.json(
      { code: SCANNED, admittedAt: ARRIVED_AT, holderName: 'Anna', guestId: null },
      { status: 201 },
    );
  const field = () => screen.getByRole('textbox', { name: 'Ticket code' });

  it('leaves the typed field empty when it goes through', async () => {
    answerCode(admitted);
    await scan();
    expect(await screen.findByText('Anna')).toBeInTheDocument();
    expect(field()).toHaveValue('');
  });

  it('puts a code with no answer in the field, so “press again” has something to press', async () => {
    let answers = [() => HttpResponse.error(), admitted];
    answerCode(() => {
      const [answer, ...rest] = answers;
      answers = rest;
      return answer ? answer() : admitted();
    });
    const user = await scan();
    expect(await screen.findByText(/No answer came/)).toBeInTheDocument();
    await waitFor(() => expect(field()).toHaveValue(SCANNED));
    await user.click(screen.getByRole('button', { name: 'Admit' }));
    expect(await screen.findByText('Anna')).toBeInTheDocument();
    expect(field()).toHaveValue('');
  });

  it('doesn’t call another ticket your earlier press', async () => {
    let answers = [() => HttpResponse.error(), () => refusal(400, 'Ticket already used')];
    answerCode(() => {
      const [answer, ...rest] = answers;
      answers = rest;
      return answer ? answer() : refusal(400, 'Ticket already used');
    });
    await scan();
    expect(await screen.findByText(/No answer came/)).toBeInTheDocument();
    code = 'ZZZZZZZZ12345678';
    expect(await screen.findByText(/already been admitted/)).toBeInTheDocument();
    expect(screen.queryByText(/your earlier press/)).not.toBeInTheDocument();
  });

  it('keeps a lost code in the field when another goes through', async () => {
    let answers = [() => HttpResponse.error(), admitted];
    answerCode(() => {
      const [answer, ...rest] = answers;
      answers = rest;
      return answer ? answer() : admitted();
    });
    await scan();
    await waitFor(() => expect(field()).toHaveValue(SCANNED));
    code = 'ZZZZZZZZ12345678';
    expect(await screen.findByText('Anna')).toBeInTheDocument();
    // Still the first one's: that guest may be standing there, and it hasn't been answered.
    expect(field()).toHaveValue(SCANNED);
  });
});

describe('the door, by code (PD-91)', () => {
  it('offers the camera above the typed field, and not by name', async () => {
    const byCode = renderAt('/app/events/e1/door?by=code');
    const scan = await screen.findByRole('button', { name: 'Scan a ticket' });
    const field = await screen.findByRole('textbox', { name: 'Ticket code' });
    expect(scan.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    byCode.unmount();
    renderAt('/app/events/e1/door');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: 'Scan a ticket' })).not.toBeInTheDocument();
  });

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

  it('words a coded refusal by its own labels, and only that person’s statements', async () => {
    const [first] = DESIGN.questions;
    server.use(
      http.get(`${API}/invitations/autumn/design`, () =>
        HttpResponse.json({
          ...DESIGN,
          questions: [
            ...DESIGN.questions,
            {
              ...first,
              id: 'q3',
              prompt: { en: 'Photographs may be taken' },
              statementVersionId: 'v3',
            },
          ],
        }),
      ),
    );
    answerCheckIn(() =>
      codedRefusal(400, 'ADMISSION_ACKNOWLEDGEMENTS_REQUIRED', {
        guestId: 'g1',
        missingAcknowledgements: [
          { questionId: 'q1', labels: { en: 'The rules, as the refusal words them' } },
        ],
      }),
    );
    const { user } = renderAt();
    await searchFor(user, 'armen');
    await user.click(screen.getByRole('button', { name: 'Check in Armen Petrosyan' }));
    await waitFor(() =>
      expect(outcome()).toHaveTextContent('The rules, as the refusal words them'),
    );
    expect(outcome()).not.toHaveTextContent('I accept the venue’s rules');
    expect(outcome()).not.toHaveTextContent('Photographs may be taken');
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
    await waitFor(() => expect(reads('/door-roster').length).toBeGreaterThan(0));
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
      http.get(`${API}/events/e1/door-roster`, () => refusal(403, 'Forbidden')),
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
        `${API}/events/e1/door-roster`,
        record(() => refusal(403, 'Forbidden')),
      ),
    );
    renderAt();
    expect(await screen.findByText('Your role can’t see the guest list.')).toBeInTheDocument();
    expect(reads('/door-roster')).toHaveLength(1);
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(reads('/door-roster')).toHaveLength(1);
    clock.mockRestore();
  });

  it('keeps the code field working while the list can’t be read', async () => {
    server.use(http.get(`${API}/events/e1/door-roster`, () => refusal(500, 'Internal')));
    const { user } = renderAt('/app/events/e1/door?by=code');
    answerCode(() => refusal(404, 'Ticket not recognised'));
    await typeCode(user, CODE);
    expect(await within(outcome()).findByText(/isn’t recognised/)).toBeInTheDocument();
  });
});

describe('what a refused code or check-in says (FR-76)', () => {
  async function admitOnceListRead(user: ReturnType<typeof userEvent.setup>) {
    await waitFor(() => expect(reads('/door-roster')).toHaveLength(1));
    await typeCode(user, CODE);
  }

  it('says when a used code was admitted, and whose it is, with their Undo', async () => {
    answerCode(() =>
      codedRefusal(400, 'TICKET_ALREADY_USED', {
        guestId: 'g1',
        holderName: 'Armen Petrosyan',
        usedAt: ARRIVED_AT,
      }),
    );
    const { user } = renderAt('/app/events/e1/door?by=code');
    await admitOnceListRead(user);
    await waitFor(() => expect(outcome()).toHaveTextContent('This ticket was admitted at 22:02.'));
    expect(within(outcome()).getByText('Armen Petrosyan')).toBeVisible();
    expect(within(outcome()).getByRole('button', { name: 'Undo' })).toBeEnabled();
  });

  it.each([
    [{ orderStatus: 'CANCELLED' }, /order was cancelled\./],
    [{ orderStatus: 'REFUNDED' }, /order was refunded\./],
    [{ orderStatus: 'EXPIRED' }, /order was never paid\./],
    [{ orderStatus: 'PAID', isCancellationPending: true }, /order is being cancelled\./],
  ])('words an order it can’t admit by its state: %o', async (facts, words) => {
    answerCode(() => codedRefusal(400, 'TICKET_ORDER_UNAVAILABLE', facts));
    const { user } = renderAt('/app/events/e1/door?by=code');
    await admitOnceListRead(user);
    await waitFor(() => expect(outcome()).toHaveTextContent(words));
  });

  it('lists only that person’s missing agreements, in the page’s language', async () => {
    answerCheckIn(() =>
      codedRefusal(400, 'ADMISSION_ACKNOWLEDGEMENTS_REQUIRED', {
        guestId: 'g1',
        holderName: 'Armen Petrosyan',
        missingAcknowledgements: [
          { questionId: 'q1', labels: { hy: 'Տան կանոնները', en: 'The house rules' } },
          { questionId: 'q2', labels: { hy: 'Լուսանկարները' } },
        ],
      }),
    );
    const { user } = renderAt();
    await searchFor(user, 'armen');
    await user.click(screen.getByRole('button', { name: 'Check in Armen Petrosyan' }));
    await waitFor(() => expect(outcome()).toHaveTextContent('The house rules'));
    // Not in English: the next language the statement has.
    expect(outcome()).toHaveTextContent('Լուսանկարները');
  });
});

describe('the roster, read whole (FR-79)', () => {
  it('reads every page, a hundred at a time, and keeps nothing the door doesn’t show', async () => {
    const asked: string[] = [];
    server.use(
      http.get(`${API}/events/e1/door-roster`, ({ request }) => {
        const url = new URL(request.url);
        asked.push(url.search);
        return url.searchParams.get('cursor')
          ? HttpResponse.json({ items: [rosterWire('g2', 'Lusine Petrosyan')], nextCursor: null })
          : HttpResponse.json({ items: [rosterWire('g1', 'Armen Petrosyan')], nextCursor: 'g1' });
      }),
    );
    const { user, container } = renderAt();
    await searchFor(user, 'lusine');
    expect(screen.getByRole('heading', { name: 'Lusine Petrosyan' })).toBeInTheDocument();
    // The rest of the household, from another page.
    expect(screen.getByRole('heading', { name: 'Armen Petrosyan' })).toBeInTheDocument();
    expect(asked).toEqual(['?limit=100', '?limit=100&cursor=g1']);
    expect(screen.queryByText(/Only the first/)).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain(TOKEN);
    expect(container.innerHTML).not.toContain('planted@example.am');
  });

  it('says the list is partial when it stops at its page limit, and ticket codes still work', async () => {
    let page = 0;
    server.use(
      http.get(`${API}/events/e1/door-roster`, () => {
        page += 1;
        return HttpResponse.json({
          items: [rosterWire(`g${page}`, `Guest ${page}`)],
          nextCursor: `g${page}`,
        });
      }),
    );
    answerCode(() =>
      HttpResponse.json({ admittedAt: ARRIVED_AT, holderName: 'Anna Sargsyan', guestId: null }),
    );
    const { user } = renderAt('/app/events/e1/door?by=code');
    await typeCode(user, CODE);
    expect(await within(outcome()).findByText(/Ticket admitted at 22:02/)).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'By name' }));
    const notice = `Only the first ${MAX_ROSTER_PAGES} guests were read`;
    expect(await screen.findByText(new RegExp(notice), {}, { timeout: 8000 })).toBeInTheDocument();
    expect(page).toBe(MAX_ROSTER_PAGES);
  }, 15_000);

  it('keeps the pages read when one is refused for too many requests, and says the list is partial', async () => {
    server.use(
      http.get(`${API}/events/e1/door-roster`, ({ request }) =>
        new URL(request.url).searchParams.get('cursor')
          ? refusal(429, 'Too Many Requests')
          : HttpResponse.json({ items: ROSTER.items, nextCursor: 'g2' }),
      ),
    );
    const { user } = renderAt();
    expect(await screen.findByText(/Only the first 2 guests were read/)).toBeInTheDocument();
    await searchFor(user, 'armen');
    expect(screen.getByRole('heading', { name: 'Armen Petrosyan' })).toBeInTheDocument();
  });

  it('lets a whole read that began after a refresh win over it', async () => {
    answerCheckIn(() => HttpResponse.json(CHECKED_IN, { status: 201 }));
    const { user } = renderAt();
    await searchFor(user, 'armen');
    let releaseRefresh: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    server.use(
      http.get(`${API}/events/e1/door-roster`, async ({ request }) => {
        const url = new URL(request.url);
        sent.push({ method: 'GET', path: url.pathname, search: url.search });
        if (!url.searchParams.get('search')) return HttpResponse.json(ROSTER);
        await held;
        return HttpResponse.json({
          items: [rosterWire('g1', 'Armen Petrosyan', { arrivedAt: ARRIVED_AT })],
          nextCursor: null,
        });
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Check in Armen Petrosyan' }));
    await waitFor(() => expect(refreshes()).toHaveLength(1));
    // Someone else undid it; this phone's whole read, begun after the check-in, says so.
    await user.click(screen.getByRole('button', { name: 'Read the list again' }));
    expect(await screen.findByRole('button', { name: 'Check in Armen Petrosyan' })).toBeEnabled();
    releaseRefresh();
    // The late answer must not mark them here again: it never appears, however long it is given.
    await expect(screen.findByText('Here since 22:02', {}, { timeout: 500 })).rejects.toThrow();
  });

  it('reads that person again after a check-in, by their name', async () => {
    answerCheckIn(() => HttpResponse.json(CHECKED_IN, { status: 201 }));
    const { user } = renderAt();
    await searchFor(user, 'armen');
    server.use(
      http.get(`${API}/events/e1/door-roster`, ({ request }) => {
        const url = new URL(request.url);
        sent.push({ method: 'GET', path: url.pathname, search: url.search });
        const moved = { seating: [{ venue: 'Hall', table: 'Table 9', position: null }] };
        return HttpResponse.json({
          items: [rosterWire('g1', 'Armen Petrosyan', { arrivedAt: ARRIVED_AT, ...moved })],
          nextCursor: null,
        });
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Check in Armen Petrosyan' }));
    await waitFor(() => expect(refreshes()).toHaveLength(1));
    const asked = new URLSearchParams(refreshes()[0]?.search);
    expect([asked.get('limit'), asked.get('search')]).toEqual(['100', 'Armen Petrosyan']);
    const row = screen.getByRole('heading', { name: 'Armen Petrosyan' }).closest('li');
    if (!row) throw new Error('No row');
    await waitFor(() => expect(row).toHaveTextContent('Table 9 (Hall)'));
    expect(row).toHaveTextContent('Here since 22:02');
  });

  it('keeps the check-in when reading that person again fails', async () => {
    answerCheckIn(() => HttpResponse.json(CHECKED_IN, { status: 201 }));
    const { user } = renderAt();
    await searchFor(user, 'armen');
    server.use(
      http.get(`${API}/events/e1/door-roster`, ({ request }) => {
        const url = new URL(request.url);
        sent.push({ method: 'GET', path: url.pathname, search: url.search });
        return refusal(500, 'Internal');
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Check in Armen Petrosyan' }));
    await waitFor(() => expect(refreshes()).toHaveLength(1));
    expect(screen.getByText('Here since 22:02')).toBeInTheDocument();
    expect(screen.queryByText(/couldn’t be read/)).not.toBeInTheDocument();
  });

  it('reads a ticket’s holder again after the code admits them', async () => {
    answerCode(() =>
      HttpResponse.json({ admittedAt: ARRIVED_AT, holderName: 'Armen Petrosyan', guestId: 'g1' }),
    );
    const { user } = renderAt('/app/events/e1/door?by=code');
    await waitFor(() => expect(reads('/door-roster')).toHaveLength(1));
    await typeCode(user, CODE);
    await waitFor(() => expect(refreshes()).toHaveLength(1));
    const asked = new URLSearchParams(refreshes()[0]?.search);
    expect([asked.get('limit'), asked.get('search')]).toEqual(['100', 'Armen Petrosyan']);
  });
});
