import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import { createI18n } from '@/lib/i18n';

import { FollowUpsPage } from './components/follow-ups-page';
import { loadFollowUps, type FollowUpsData } from './load';
import { NOT_REACHED_REASON } from './read';

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
const SLUG = 'anna-davit-3f8a1c20';
const NOW = Date.parse('2027-05-20T12:00:00.000Z');
const server = setupServer();

let token = '';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  token = crypto.randomUUID();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
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

const FUTURE = '2027-06-12T11:00:00.000Z';
const PAST = '2027-05-01T11:00:00.000Z';

interface Served {
  status: string | null;
  isExpired: boolean;
  startsAt: string;
  households: object[];
  delivery: object[];
  guestsResponse?: () => Response;
  deliveryResponse?: () => Response;
}

function wireGuest(id: string, name: string, overrides: object = {}) {
  return {
    id,
    firstName: name,
    lastName: null,
    name,
    token,
    locale: null,
    attribution: 'UNKNOWN',
    isPrimary: true,
    addedByGuest: false,
    isAnonymized: false,
    rsvpStatus: 'PENDING',
    table: null,
    isCheckedIn: false,
    arrivedAt: null,
    ...overrides,
  };
}

function wireHousehold(id: string, name: string, guests: object[]) {
  return { id, name, seatsAllotted: 2, seatsNamed: guests.length, notes: null, guests };
}

function wireRow(householdId: string, household: string, guest: string, overrides: object = {}) {
  return {
    householdId,
    household,
    guest,
    channel: 'EMAIL',
    toAddress: `${guest.toLowerCase()}@example.am`,
    status: 'SENT',
    attempts: 1,
    failureReason: null,
    sentAt: '2027-05-01T10:00:00.000Z',
    reminders: 0,
    lastRemindedAt: null,
    ...overrides,
  };
}

function serve(initial: Partial<Served> = {}) {
  const state: Served = {
    status: 'PUBLISHED',
    isExpired: false,
    startsAt: FUTURE,
    households: [wireHousehold('h1', 'Petrosyan family', [wireGuest('g1', 'Armen')])],
    delivery: [wireRow('h1', 'Petrosyan family', 'Armen')],
    ...initial,
  };
  const reads = { event: 0 };
  server.use(
    http.get(`${API}/events/e1`, () => {
      reads.event += 1;
      return HttpResponse.json({
        id: 'e1',
        title: 'The wedding of Anna and Davit',
        type: 'WEDDING',
        hostsLabel: 'Anna & Davit',
        startsAt: state.startsAt,
        endsAt: null,
        timezone: 'Asia/Yerevan',
        locales: ['en'],
        defaultLocale: 'en',
        sideALabel: null,
        sideBLabel: null,
        invitation: state.status
          ? { slug: SLUG, status: state.status, isExpired: state.isExpired }
          : null,
      });
    }),
    http.get(`${API}/events/e1/guests`, () =>
      state.guestsResponse ? state.guestsResponse() : HttpResponse.json(state.households),
    ),
    http.get(`${API}/invitations/${SLUG}/delivery`, () =>
      state.deliveryResponse
        ? state.deliveryResponse()
        : HttpResponse.json({
            invited: state.delivery.length,
            notSent: 0,
            unreachable: [],
            households: state.delivery,
          }),
    ),
  );
  return { state, reads };
}

const CHASE_ANSWER = {
  queued: 1,
  alreadyRemindedToday: 2,
  recentlyInvited: 3,
  recipients: [
    { householdName: 'Petrosyan family', toAddress: 'armen@example.am', channel: 'EMAIL' },
  ],
  notInvited: [
    { householdId: 'h2', householdName: 'Hakobyan family', reason: NOT_REACHED_REASON },
    { householdId: 'h3', householdName: 'No Contact', reason: 'No email address for anyone' },
  ],
};

const THANK_ANSWER = {
  queued: 1,
  alreadyThanked: 4,
  basis: 'ACCEPTED',
  recipients: [
    { householdName: 'Petrosyan family', toAddress: 'armen@example.am', channel: 'EMAIL' },
  ],
  notInvited: [{ householdId: 'h3', householdName: 'No Contact', reason: 'No email address' }],
};

/** Records each press, and answers with `response`. */
function answer(path: 'remind' | 'thank-you', response: () => Response) {
  const presses: unknown[] = [];
  server.use(
    http.post(`${API}/invitations/${SLUG}/${path}`, () => {
      presses.push(path);
      return response();
    }),
  );
  return presses;
}

const refused =
  (status: number, message = 'refused') =>
  () =>
    HttpResponse.json({ statusCode: status, message, requestId: 'req-1' }, { status });

function Page() {
  return <FollowUpsPage data={useLoaderData<FollowUpsData>()} />;
}

function renderPage(language: 'en' | 'ru' = 'en') {
  const Stub = createRoutesStub([
    {
      path: '/app/events/:eventId/follow-ups',
      loader: ({ params }) => loadFollowUps(session().api, params.eventId ?? ''),
      Component: Page,
    },
    { path: '/app/events/:eventId/guests', Component: () => <p>The list</p> },
  ]);
  render(
    <I18nextProvider i18n={createI18n(language)}>
      <Stub initialEntries={['/app/events/e1/follow-ups']} />
    </I18nextProvider>,
  );
  return userEvent.setup();
}

async function press(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(await screen.findByRole('button', { name: label }));
  const dialog = await screen.findByRole('alertdialog');
  return { dialog, confirm: () => user.click(within(dialog).getByRole('button', { name: label })) };
}

describe('chasing who has not answered', () => {
  it('says who is expected, asks first, and sends nothing until asked', async () => {
    serve();
    const presses = answer('remind', () => HttpResponse.json(CHASE_ANSWER, { status: 201 }));
    const user = renderPage();
    expect(await screen.findByText('Expected to get a reminder: 1 household.')).toBeInTheDocument();
    expect(screen.getByText('Petrosyan family')).toBeInTheDocument();
    const { dialog } = await press(user, 'Send reminders');
    expect(within(dialog).getByText('Remind 1 household?')).toBeInTheDocument();
    expect(presses).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(presses).toEqual([]);
  });

  it('shows each list of the outcome, with the focus on it', async () => {
    const { reads } = serve();
    const presses = answer('remind', () => HttpResponse.json(CHASE_ANSWER, { status: 201 }));
    const user = renderPage();
    const { confirm } = await press(user, 'Send reminders');
    await confirm();
    const heading = await screen.findByRole('heading', { name: 'What happened' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(presses).toEqual(['remind']);
    expect(screen.getByText('On its way to 1 household.')).toBeInTheDocument();
    expect(
      screen.getByText('Reminded or tried in the last day, so not sent: 2 households.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Invited too recently, so not sent yet: 3 households.'),
    ).toBeInTheDocument();
    expect(screen.getByText('The invitation hasn’t reached 1 household')).toBeInTheDocument();
    expect(screen.getByText('Hakobyan family')).toBeInTheDocument();
    expect(screen.queryByText(NOT_REACHED_REASON)).not.toBeInTheDocument();
    expect(screen.getByText('No email address for anyone')).toHaveAttribute('lang', 'en');
    expect(
      screen.getByText(/asked not to be contacted, or whose address bounced/),
    ).toBeInTheDocument();
    await waitFor(() => expect(reads.event).toBe(2));
  });

  it('says so when nobody was due', async () => {
    serve();
    answer('remind', () =>
      HttpResponse.json(
        { queued: 0, alreadyRemindedToday: 0, recentlyInvited: 0, recipients: [], notInvited: [] },
        { status: 201 },
      ),
    );
    const user = renderPage();
    const { confirm } = await press(user, 'Send reminders');
    await confirm();
    expect(await screen.findByText('Nobody was due a reminder.')).toBeInTheDocument();
  });

  it.each([
    ['a 403', refused(403), 'Your role on this event can’t send these.', false],
    ['a 429', refused(429), 'Too many tries.', false],
    ['a server failure', refused(500), 'No answer came.', false],
    ['no answer', () => HttpResponse.error(), 'No answer came.', false],
    [
      'an invitation not open',
      refused(400, 'This invitation has not been published, so nobody has it yet'),
      'This invitation isn’t open for replies',
      true,
    ],
    ['an expired one', refused(400, 'This invitation has expired'), 'time has run out', true],
    [
      'an event started',
      refused(400, 'This event has already started; a reminder would read oddly'),
      'already started',
      true,
    ],
    ['one gone', refused(404, 'No invitation at "x"'), 'no longer available', true],
  ])('words %s', async (_case, response, words, isReloaded) => {
    const { reads } = serve();
    const presses = answer('remind', response);
    const user = renderPage();
    const { confirm } = await press(user, 'Send reminders');
    await confirm();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(words);
    await waitFor(() => expect(alert).toHaveFocus());
    // Never retried by itself.
    expect(presses).toEqual(['remind']);
    if (isReloaded) await waitFor(() => expect(reads.event).toBe(2));
    else expect(reads.event).toBe(1);
  });

  it('gives a server failure’s reference', async () => {
    serve();
    answer('remind', refused(500));
    const user = renderPage();
    const { confirm } = await press(user, 'Send reminders');
    await confirm();
    expect(await screen.findByRole('alert')).toHaveTextContent('req-1');
  });

  it('shows a sentence it does not know as it came, marked English', async () => {
    serve();
    answer('remind', refused(400, 'Something new'));
    const user = renderPage('ru');
    const { confirm } = await press(user, 'Отправить напоминания');
    await confirm();
    expect(await screen.findByText('Something new')).toHaveAttribute('lang', 'en');
  });

  it.each([
    [{ status: 'DRAFT' }, 'Reminders can be sent once the invitation is published.'],
    [{ status: 'CLOSED' }, 'Replies are stopped, so reminders aren’t sent.'],
    [{ isExpired: true }, 'This invitation’s time has run out, so reminders aren’t sent.'],
    [{ startsAt: PAST }, 'The event has started, so reminders aren’t sent any more.'],
  ])('with %o, says why instead of offering it', async (change, words) => {
    serve(change);
    renderPage();
    expect(await screen.findByText(new RegExp(words))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send reminders' })).not.toBeInTheDocument();
  });
});

describe('thanking the guests', () => {
  const after = { startsAt: PAST };
  const accepted = wireHousehold('h1', 'Petrosyan family', [
    wireGuest('g1', 'Armen', { rsvpStatus: 'ATTENDING' }),
  ]);

  it('says the rule when nobody checked in, asks saying so, and shows the answer’s basis', async () => {
    serve({ ...after, households: [accepted] });
    const presses = answer('thank-you', () => HttpResponse.json(THANK_ANSWER, { status: 201 }));
    const user = renderPage();
    expect(await screen.findByText(/Nobody checked in, so it goes/)).toHaveTextContent(
      'Expected: 1 household.',
    );
    const { dialog, confirm } = await press(user, 'Send the thank-you');
    expect(within(dialog).getByText('Thank 1 household?')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('whether or not they came');
    expect(dialog).toHaveTextContent('once, ever');
    expect(presses).toEqual([]);
    await confirm();
    expect(
      await screen.findByText('Nobody had checked in, so it went by who said they would come.'),
    ).toBeInTheDocument();
    expect(screen.getByText('On its way to 1 household.')).toBeInTheDocument();
    expect(
      screen.getByText('Already thanked or tried, so not sent again: 4 households.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No email address')).toHaveAttribute('lang', 'en');
    expect(presses).toEqual(['thank-you']);
  });

  it('goes by arrivals once anyone checked in', async () => {
    const arrived = wireHousehold('h2', 'Hakobyan family', [
      wireGuest('g2', 'Ani', { isCheckedIn: true, arrivedAt: PAST }),
    ]);
    serve({
      ...after,
      households: [accepted, arrived],
      delivery: [
        wireRow('h1', 'Petrosyan family', 'Armen'),
        wireRow('h2', 'Hakobyan family', 'Ani'),
      ],
    });
    renderPage();
    expect(await screen.findByText(/Someone checked in, so it goes/)).toHaveTextContent(
      'Expected: 1 household.',
    );
  });

  it('says so when there was nobody to thank', async () => {
    serve(after);
    answer('thank-you', () =>
      HttpResponse.json(
        { queued: 0, alreadyThanked: 0, basis: 'ACCEPTED', recipients: [], notInvited: [] },
        { status: 201 },
      ),
    );
    const user = renderPage();
    const { confirm } = await press(user, 'Send the thank-you');
    await confirm();
    expect(await screen.findByText('There was nobody to thank.')).toBeInTheDocument();
  });

  it.each([
    [refused(403), 'Your role on this event can’t send these.'],
    [
      refused(
        400,
        'This event has not happened yet; a thank-you now would arrive before the event',
      ),
      'The event hasn’t happened yet',
    ],
    [() => HttpResponse.error(), 'No answer came.'],
  ])('words refusal %#', async (response, words) => {
    serve(after);
    answer('thank-you', response);
    const user = renderPage();
    const { confirm } = await press(user, 'Send the thank-you');
    await confirm();
    expect(await screen.findByRole('alert')).toHaveTextContent(words);
  });

  it.each([
    [{ status: 'DRAFT' }, 'once the invitation is published and the event has started'],
    [{ isExpired: true }, 'the link in a thank-you would open nothing'],
    [{ startsAt: FUTURE }, 'A thank-you can be sent once the event has started.'],
  ])('with %o, says why instead of offering it', async (change, words) => {
    serve({ ...after, ...change });
    renderPage();
    expect(await screen.findByText(new RegExp(words))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send the thank-you' })).not.toBeInTheDocument();
  });

  it('stays offered once replies are stopped, the usual state after an event', async () => {
    serve({ ...after, status: 'CLOSED' });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Send the thank-you' })).toBeEnabled();
  });
});

describe('a role that can’t read who gets it', () => {
  it('is told so, and both sends stay offered, with their 403 worded (FR-6)', async () => {
    serve({ guestsResponse: refused(403) });
    const presses = answer('remind', refused(403));
    const user = renderPage();
    expect(await screen.findByText(/can’t read the guest list/)).toBeInTheDocument();
    expect(screen.queryByText(/Expected to get a reminder/)).not.toBeInTheDocument();
    const { dialog, confirm } = await press(user, 'Send reminders');
    expect(within(dialog).getByText('Send reminders?')).toBeInTheDocument();
    await confirm();
    expect(await screen.findByRole('alert')).toHaveTextContent('can’t send these');
    expect(presses).toEqual(['remind']);
  });

  it('says a failed read failed, with its reference', async () => {
    serve({ deliveryResponse: refused(500) });
    renderPage();
    expect(await screen.findByText(/req-1/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send reminders' })).toBeEnabled();
  });
});

describe('the page', () => {
  it('says so when the event has no invitation', async () => {
    serve({ status: null });
    renderPage();
    expect(await screen.findByText(/has no invitation/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('never shows a guest’s token', async () => {
    serve();
    answer('remind', () => HttpResponse.json({ ...CHASE_ANSWER, token }, { status: 201 }));
    const user = renderPage();
    const { confirm } = await press(user, 'Send reminders');
    await confirm();
    await screen.findByRole('heading', { name: 'What happened' });
    expect(document.body.innerHTML).not.toContain(token);
  });
});

describe('the page’s clock', () => {
  it('moves when a refusal reloads the page, so the button goes with the state', async () => {
    serve({ startsAt: new Date(NOW + 3_600_000).toISOString() });
    answer('remind', () => {
      vi.mocked(Date.now).mockReturnValue(NOW + 7_200_000);
      return refused(400, 'This event has already started; a reminder would read oddly')();
    });
    const user = renderPage();
    const { confirm } = await press(user, 'Send reminders');
    await confirm();
    expect(await screen.findByRole('alert')).toHaveTextContent('already started');
    expect(
      await screen.findByText('The event has started, so reminders aren’t sent any more.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send reminders' })).not.toBeInTheDocument();
  });

  it('offers the thank-you once a reload finds the event has started', async () => {
    serve({ startsAt: new Date(NOW + 3_600_000).toISOString() });
    answer('remind', () => {
      vi.mocked(Date.now).mockReturnValue(NOW + 7_200_000);
      return refused(400, 'This event has already started; a reminder would read oddly')();
    });
    const user = renderPage();
    const { confirm } = await press(user, 'Send reminders');
    await confirm();
    expect(await screen.findByRole('button', { name: 'Send the thank-you' })).toBeEnabled();
  });
});

describe('pressing again', () => {
  it('replaces the last outcome with the new refusal, and never shows both', async () => {
    serve();
    let isFirst = true;
    answer('remind', () => {
      if (!isFirst) return refused(500)();
      isFirst = false;
      return HttpResponse.json(CHASE_ANSWER, { status: 201 });
    });
    const user = renderPage();
    await (await press(user, 'Send reminders')).confirm();
    await screen.findByRole('heading', { name: 'What happened' });
    await (await press(user, 'Send reminders')).confirm();
    expect(await screen.findByRole('alert')).toHaveTextContent('No answer came.');
    expect(screen.queryByRole('heading', { name: 'What happened' })).not.toBeInTheDocument();
  });

  it('replaces the last refusal with the new outcome', async () => {
    serve();
    let isFirst = true;
    answer('remind', () => {
      if (isFirst) {
        isFirst = false;
        return refused(500)();
      }
      return HttpResponse.json(CHASE_ANSWER, { status: 201 });
    });
    const user = renderPage();
    await (await press(user, 'Send reminders')).confirm();
    await screen.findByRole('alert');
    await (await press(user, 'Send reminders')).confirm();
    await screen.findByRole('heading', { name: 'What happened' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('can’t be pressed while its request runs', async () => {
    serve();
    let release = () => undefined as void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(`${API}/invitations/${SLUG}/remind`, async () => {
        await held;
        return HttpResponse.json(CHASE_ANSWER, { status: 201 });
      }),
    );
    const user = renderPage();
    await (await press(user, 'Send reminders')).confirm();
    expect(await screen.findByRole('button', { name: 'Sending…' })).toBeDisabled();
    release();
    await screen.findByRole('heading', { name: 'What happened' });
  });
});

describe('a thank-you being sent', () => {
  it('can’t be pressed again while its request runs', async () => {
    serve({ startsAt: PAST });
    let release = () => undefined as void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(`${API}/invitations/${SLUG}/thank-you`, async () => {
        await held;
        return HttpResponse.json(THANK_ANSWER, { status: 201 });
      }),
    );
    const user = renderPage();
    await (await press(user, 'Send the thank-you')).confirm();
    expect(await screen.findByRole('button', { name: 'Sending…' })).toBeDisabled();
    release();
    await screen.findByRole('heading', { name: 'What happened' });
  });
});

describe('going back from the question', () => {
  it('returns the focus to the button that asked', async () => {
    serve();
    const user = renderPage();
    const { dialog } = await press(user, 'Send reminders');
    await user.click(within(dialog).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send reminders' })).toHaveFocus(),
    );
  });
});

describe('what the page says of each household', () => {
  it('names how a due household would be reached', async () => {
    serve();
    renderPage();
    expect(await screen.findByText(/armen@example\.am/)).toBeInTheDocument();
  });

  it('links each group of the outcome to the guest list', async () => {
    serve();
    answer('remind', () => HttpResponse.json(CHASE_ANSWER, { status: 201 }));
    const user = renderPage();
    await (await press(user, 'Send reminders')).confirm();
    expect(await screen.findByRole('link', { name: 'Send from the guest list' })).toHaveAttribute(
      'href',
      '/app/events/e1/guests',
    );
    expect(screen.getByRole('link', { name: 'Show them on the guest list' })).toHaveAttribute(
      'href',
      '/app/events/e1/guests?invite=attention',
    );
  });

  it('says the arrivals rule in the question and in what happened', async () => {
    const arrived = wireHousehold('h1', 'Petrosyan family', [
      wireGuest('g1', 'Armen', { isCheckedIn: true, arrivedAt: PAST }),
    ]);
    serve({ startsAt: PAST, households: [arrived] });
    answer('thank-you', () =>
      HttpResponse.json({ ...THANK_ANSWER, basis: 'ARRIVED' }, { status: 201 }),
    );
    const user = renderPage();
    const { dialog, confirm } = await press(user, 'Send the thank-you');
    expect(dialog).toHaveTextContent('It goes to the households where someone checked in.');
    await confirm();
    expect(await screen.findByText('It went by who checked in.')).toBeInTheDocument();
  });

  it('links the thank-you’s unreachable households to the guest list', async () => {
    serve({ startsAt: PAST });
    answer('thank-you', () => HttpResponse.json(THANK_ANSWER, { status: 201 }));
    const user = renderPage();
    await (await press(user, 'Send the thank-you')).confirm();
    expect(
      await screen.findByRole('link', { name: 'Show them on the guest list' }),
    ).toHaveAttribute('href', '/app/events/e1/guests?invite=attention');
  });
});

describe('a draft', () => {
  it('reads no guest list or report: nobody holds it yet', async () => {
    serve({ status: 'DRAFT' });
    let reads = 0;
    server.use(
      http.get(`${API}/events/e1/guests`, () => {
        reads += 1;
        return HttpResponse.json([]);
      }),
    );
    renderPage();
    await screen.findByText('Reminders can be sent once the invitation is published.');
    expect(reads).toBe(0);
  });
});
