import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import { ArrivalStatus } from '@/features/events';
import { createI18n } from '@/lib/i18n';

import { RecordAnswerPage } from './components/record-answer-page';
import { loadRecordAnswer, type RecordAnswerData } from './load';
import type { GuestAnswerWire } from './types';

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
const SLUG = 'anna-davit';
const server = setupServer();
/** A stand-in for the guest's credential; the page must never show it. */
const TOKEN = 'guest-token-fixture-7f3a';

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

const OFF = { isEnabled: false, options: null };

function design() {
  return {
    slug: SLUG,
    status: 'PUBLISHED',
    isExpired: false,
    event: {
      id: 'e1',
      title: 'Anna & Davit',
      locales: ['hy', 'en'],
      defaultLocale: 'en',
      timezone: 'Asia/Yerevan',
    },
    template: { key: 'classic', name: 'Classic' },
    theme: {},
    effectiveTheme: {},
    rsvpFields: {
      dietary: { isEnabled: true, options: [{ key: 'vegetarian', label: { en: 'Vegetarian' } }] },
      drinkPreference: { isEnabled: true, options: null },
      songRequest: OFF,
      message: OFF,
      attribution: OFF,
    },
    blocks: [],
    questions: [
      {
        id: 'q-meal',
        type: 'SINGLE_CHOICE',
        required: true,
        prompt: { en: 'Meal', hy: 'Ճաշ' },
        options: { en: ['Meat', 'Fish'], hy: ['Միս', 'Ձուկ'] },
        answerCount: 1,
        statementVersionId: null,
      },
      {
        id: 'q-photos',
        type: 'SIGNATURE',
        required: true,
        prompt: { en: 'I agree to be photographed' },
        options: {},
        answerCount: 0,
        statementVersionId: 'sv1',
      },
    ],
    publishBlockers: [],
  };
}

function guest(overrides: Partial<GuestAnswerWire> = {}): GuestAnswerWire {
  return {
    id: 'g1',
    name: 'Armen Petrosyan',
    token: TOKEN,
    email: 'armen@example.am',
    phone: null,
    isAnonymized: false,
    attendance: { mode: 'EVENT_WIDE', revision: 1, status: 'PENDING', venues: [] },
    rsvpStatus: 'PENDING',
    answers: [],
    ...overrides,
  };
}

function serve(read: () => Response = () => HttpResponse.json(guest())) {
  const reads = { guest: 0 };
  server.use(
    http.get(`${API}/events/e1`, () =>
      HttpResponse.json({
        id: 'e1',
        title: 'Anna & Davit',
        type: 'WEDDING',
        hostsLabel: 'Anna & Davit',
        startsAt: '2027-06-12T11:00:00.000Z',
        endsAt: null,
        timezone: 'Asia/Yerevan',
        locales: ['hy', 'en'],
        defaultLocale: 'en',
        sideALabel: null,
        sideBLabel: null,
        invitation: { slug: SLUG, status: 'PUBLISHED' },
      }),
    ),
    http.get(`${API}/invitations/${SLUG}/design`, () => HttpResponse.json(design())),
    http.get(`${API}/events/e1/guests/g1`, () => {
      reads.guest += 1;
      return read();
    }),
  );
  return reads;
}

function answer(response: () => Response = () => HttpResponse.json({ status: 'ATTENDING' })) {
  const received: unknown[] = [];
  server.use(
    http.patch(`${API}/events/e1/guests/g1/rsvp`, async ({ request }) => {
      received.push(await request.json());
      return response();
    }),
  );
  return received;
}

const refused =
  (status: number, message = 'refused') =>
  () =>
    HttpResponse.json({ statusCode: status, message, requestId: 'req-1' }, { status });

function Page() {
  return <RecordAnswerPage data={useLoaderData<RecordAnswerData>()} />;
}

function renderPage(language: 'en' | 'hy' = 'en') {
  const Stub = createRoutesStub([
    {
      path: '/app/events/:eventId/guests/:guestId/answer',
      loader: ({ params }) =>
        loadRecordAnswer(session().api, params.eventId ?? '', params.guestId ?? ''),
      Component: Page,
    },
    { path: '/app/events/:eventId/guests', Component: () => <ArrivalStatus /> },
  ]);
  render(
    <I18nextProvider i18n={createI18n(language)}>
      <Stub initialEntries={['/app/events/e1/guests/g1/answer']} />
    </I18nextProvider>,
  );
  return userEvent.setup();
}

async function save(user: ReturnType<typeof userEvent.setup>) {
  const button = await screen.findByRole('button', { name: 'Save the answer' });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
}

describe('recording an answer, one for the event', () => {
  it('records what changed, leaves the required meal for later, and returns to the list', async () => {
    serve();
    const received = answer();
    const user = renderPage();
    expect(await screen.findByText('Armen Petrosyan')).toBeInTheDocument();
    expect(
      screen.getByText('Only the guest can agree, through their own link.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Coming' }));
    await user.click(screen.getByRole('checkbox', { name: 'Vegetarian' }));
    await user.type(screen.getByLabelText('Drink'), 'Wine');
    await save(user);
    const status = await screen.findByText('The answer for Armen Petrosyan is recorded.');
    await waitFor(() => expect(status).toHaveFocus());
    expect(received).toEqual([
      {
        attendanceRevision: 1,
        status: 'ATTENDING',
        dietary: ['vegetarian'],
        drinkPreference: 'Wine',
      },
    ]);
  });

  it('sends a choice as its position, and tells the guest only when ticked', async () => {
    serve();
    const received = answer();
    const user = renderPage();
    await user.click(await screen.findByRole('radio', { name: 'Not coming' }));
    await user.selectOptions(screen.getByLabelText('Meal'), 'Fish');
    await user.click(screen.getByRole('checkbox', { name: 'Tell the guest it was recorded' }));
    await save(user);
    await screen.findByText(/is recorded/);
    expect(received).toEqual([
      {
        attendanceRevision: 1,
        status: 'DECLINED',
        answers: [{ questionId: 'q-meal', value: 1 }],
        notifyGuest: true,
      },
    ]);
  });

  it('asks whether they’re coming before sending', async () => {
    serve();
    const received = answer();
    const user = renderPage();
    await save(user);
    expect(await screen.findByText('Choose whether they’re coming.')).toBeInTheDocument();
    expect(received).toEqual([]);
  });

  it('never shows the guest’s token', async () => {
    serve();
    renderPage();
    await screen.findByText('Armen Petrosyan');
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });
});

describe('recording an answer, one per venue', () => {
  it('asks for each venue guests see, and sends the one changed with the revision', async () => {
    serve(() =>
      HttpResponse.json(
        guest({
          attendance: {
            mode: 'PER_VENUE',
            revision: 2,
            status: 'ATTENDING',
            venues: [
              { venueId: 'church', venue: 'Saint Gayane', status: 'ATTENDING' },
              { venueId: 'hall', venue: 'The hall', status: 'PENDING' },
            ],
          },
        }),
      ),
    );
    const received = answer();
    const user = renderPage();
    expect(await screen.findByText('Saint Gayane')).toBeInTheDocument();
    const radios = screen.getAllByRole('radio', { name: 'Not coming' });
    expect(radios).toHaveLength(2);
    await user.click(radios[1] as HTMLElement);
    await save(user);
    await screen.findByText(/is recorded/);
    expect(received).toEqual([
      { attendanceRevision: 2, venueAttendance: [{ venueId: 'hall', status: 'DECLINED' }] },
    ]);
  });
});

describe('a refused answer', () => {
  it('reloads with a fresh form when how guests answer changed', async () => {
    const reads = serve();
    answer(
      refused(
        409,
        'attendanceRevision: attendance policy changed; reload the invitation and reconfirm',
      ),
    );
    const user = renderPage();
    await user.click(await screen.findByRole('radio', { name: 'Coming' }));
    await save(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('How guests answer changed');
    await waitFor(() => expect(reads.guest).toBe(2));
  });

  it('puts a refused question’s answer on its field', async () => {
    serve();
    answer(refused(400, 'answers: q-meal must be the position of one of its options'));
    const user = renderPage();
    await user.click(await screen.findByRole('radio', { name: 'Coming' }));
    await user.selectOptions(screen.getByLabelText('Meal'), 'Fish');
    await save(user);
    await waitFor(() =>
      expect(screen.getByLabelText('Meal')).toHaveAccessibleDescription(
        expect.stringContaining('the question may have changed'),
      ),
    );
  });

  it('gives a fresh form for each venue when the event changed to answering per venue', async () => {
    let isPerVenue = false;
    serve(() =>
      HttpResponse.json(
        isPerVenue
          ? guest({
              attendance: {
                mode: 'PER_VENUE',
                revision: 2,
                status: 'PENDING',
                venues: [{ venueId: 'hall', venue: 'The hall', status: 'PENDING' }],
              },
            })
          : guest(),
      ),
    );
    answer(() => {
      isPerVenue = true;
      return refused(
        409,
        'attendanceRevision: attendance policy changed; reload the invitation and reconfirm',
      )();
    });
    const user = renderPage();
    await user.click(await screen.findByRole('radio', { name: 'Coming' }));
    await save(user);
    expect(await screen.findByText('The hall')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('How guests answer changed');
    expect(screen.queryByText('Are they coming?')).not.toBeInTheDocument();
  });

  it('says when the invitation’s questions couldn’t be read, and keeps the answer', async () => {
    serve();
    server.use(http.get(`${API}/invitations/${SLUG}/design`, refused(500)));
    renderPage();
    expect(await screen.findByText(/questions couldn’t be read/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Coming' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Meal')).not.toBeInTheDocument();
  });

  it('words a 403', async () => {
    serve();
    answer(refused(403));
    const user = renderPage();
    await user.click(await screen.findByRole('radio', { name: 'Coming' }));
    await save(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your role on this event can’t record answers.',
    );
  });

  it('words a void ticket without reloading', async () => {
    const reads = serve();
    answer(refused(400, 'Ticket is no longer valid; attendance cannot be reconfirmed'));
    const user = renderPage();
    await user.click(await screen.findByRole('radio', { name: 'Coming' }));
    await save(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('ticket is no longer valid');
    expect(reads.guest).toBe(1);
  });

  it('tells a role that can’t read guests who can', async () => {
    serve(refused(403));
    renderPage();
    expect(
      await screen.findByText(/Your role can’t see the guest list, so it can’t record an answer/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save the answer' })).not.toBeInTheDocument();
  });

  it('records nothing for an erased guest', async () => {
    serve(() => HttpResponse.json(guest({ isAnonymized: true })));
    renderPage();
    expect(await screen.findByText(/erased at their request/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save the answer' })).not.toBeInTheDocument();
  });
});

describe('in Armenian', () => {
  it('words the page, and the question in the event’s language', async () => {
    serve();
    renderPage('hy');
    expect(await screen.findByRole('heading', { name: 'Գրանցել պատասխանը' })).toBeInTheDocument();
    expect(screen.getByLabelText('Meal')).toBeInTheDocument();
  });
});
