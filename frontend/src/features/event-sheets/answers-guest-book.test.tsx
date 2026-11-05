import { render, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ComponentType } from 'react';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import { createI18n, type Language } from '@/lib/i18n';

import { AnswersPage } from './components/answers-page';
import { GuestBookPage } from './components/guest-book-page';
import { loadAnswers, loadGuestBook, type AnswersData, type GuestBookData } from './load';
import { readAnswers, readGuestBook } from './read';

const ORIGIN = 'http://api.test';
const API = `${ORIGIN}/api/v1`;
const server = setupServer();
let session: BrowserSession;

const event = {
  id: 'e1',
  title: 'Anna & Davit',
  attendanceMode: 'EVENT_WIDE',
  timezone: 'Asia/Yerevan',
  locales: ['hy', 'en'],
  defaultLocale: 'hy',
};

const meal = {
  id: 'q1',
  type: 'SINGLE_CHOICE',
  required: true,
  prompt: 'Meat or fish?',
  options: ['Meat', 'Fish'],
  answered: 2,
  tally: [
    { option: 'Meat', attending: 1, total: 1 },
    { option: 'Fish', attending: 0, total: 1 },
  ],
  responses: [
    {
      guestId: 'g1',
      name: 'Lusine Petrosyan',
      household: 'Petrosyan family',
      status: 'ATTENDING',
      value: 0,
      display: 'Meat',
    },
    {
      guestId: 'g2',
      name: 'Aram Sargsyan',
      household: 'Sargsyan',
      status: 'DECLINED',
      value: 1,
      display: 'Fish',
    },
  ],
};

const wish = {
  id: 'q2',
  type: 'LONG_TEXT',
  required: false,
  prompt: 'A wish for the couple',
  options: [],
  answered: 1,
  tally: null,
  responses: [
    {
      guestId: 'g1',
      name: 'Lusine Petrosyan',
      household: 'Petrosyan family',
      status: 'ATTENDING',
      value: 'Be happy',
      display: 'Be happy',
    },
  ],
};

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  session = createBrowserSession({
    baseUrl: ORIGIN,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
  server.use(http.get(`${API}/events/e1`, () => HttpResponse.json(event)));
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function AnswersRoute() {
  return <AnswersPage data={useLoaderData<AnswersData>()} />;
}

function GuestBookRoute() {
  return <GuestBookPage data={useLoaderData<GuestBookData>()} />;
}

interface Opening {
  Component: ComponentType;
  loader: (args: LoaderFunctionArgs) => Promise<unknown>;
  heading: string;
  path?: string;
  language?: Language;
}

async function open({ Component, loader, heading, path = '/page', language = 'en' }: Opening) {
  const Stub = createRoutesStub([
    { path: '/page', Component, HydrateFallback: () => null, loader },
  ]);
  render(
    <I18nextProvider i18n={createI18n(language)}>
      <Stub initialEntries={[path]} />
    </I18nextProvider>,
  );
  await screen.findByRole('heading', { level: 1, name: heading });
}

const openAnswers = (path = '/page', language: Language = 'en') =>
  open({
    Component: AnswersRoute,
    loader: ({ request }) =>
      loadAnswers(session.api, 'e1', new URL(request.url).searchParams.get('locale')),
    heading: language === 'hy' ? 'Պատասխաններ ձեր հարցերին' : 'Answers to your questions',
    path,
    language,
  });

const openGuestBook = () =>
  open({
    Component: GuestBookRoute,
    loader: () => loadGuestBook(session.api, 'e1'),
    heading: 'Guest book',
  });

describe('reading the answers and the guest book', () => {
  it('keeps only the fields named, and drops what the backend stored', () => {
    const stored = { ...meal, extra: 'x' };
    const sheet = readAnswers({ locale: 'en', questions: [stored] });
    expect(sheet.questions[0]).toEqual({
      id: 'q1',
      type: 'SINGLE_CHOICE',
      prompt: 'Meat or fish?',
      answered: 2,
      tally: meal.tally,
      responses: meal.responses.map(({ guestId, name, household, status, display }) => ({
        guestId,
        name,
        household,
        status,
        display,
      })),
    });
  });

  it('keeps a free-text question without a tally', () => {
    expect(readAnswers({ locale: 'en', questions: [wish] }).questions[0]?.tally).toBeNull();
  });

  it('keeps each message with who wrote it and when, dropping anything else', () => {
    const stored = { from: 'Ani', message: 'Congratulations', at: null, guestId: 'g1' };
    expect(readGuestBook([stored])).toEqual([
      { from: 'Ani', message: 'Congratulations', at: null },
    ]);
  });
});

describe('the answers to the host’s own questions', () => {
  it('counts each choice among guests coming and among everyone, and lists who answered', async () => {
    server.use(
      http.get(`${API}/events/e1/answers`, () =>
        HttpResponse.json({ locale: 'en', questions: [meal, wish] }),
      ),
    );
    await openAnswers();
    const region = screen.getByRole('region', { name: 'Meat or fish?' });
    expect(within(region).getByText('2 answered')).toBeInTheDocument();
    // Once in the tally, once as Lusine's answer.
    expect(within(region).getAllByText('Meat')).toHaveLength(2);
    expect(within(region).getByText('1 coming · 1 in all')).toBeInTheDocument();
    expect(within(region).getByText('Who answered what')).toBeInTheDocument();
    expect(within(region).getByText('Aram Sargsyan')).toBeInTheDocument();
    expect(within(region).getByText('Not coming')).toBeInTheDocument();
    const free = screen.getByRole('region', { name: 'A wish for the couple' });
    expect(within(free).getByText('Be happy')).toBeInTheDocument();
  });

  it('asks in the language in the address, and shows the one the response names', async () => {
    const asked: (string | null)[] = [];
    server.use(
      http.get(`${API}/events/e1/answers`, ({ request }) => {
        asked.push(new URL(request.url).searchParams.get('locale'));
        return HttpResponse.json({
          locale: 'hy',
          questions: [{ ...meal, prompt: 'Միս, թե՞ ձուկ' }],
        });
      }),
    );
    await openAnswers('/page?locale=fr');
    expect(asked).toEqual(['fr']);
    const region = screen.getByRole('region', { name: 'Միս, թե՞ ձուկ' });
    // The prompt and the options are the event's words; the counts are the page's own.
    expect(within(region).getByRole('heading', { level: 2 })).toHaveAttribute('lang', 'hy');
    expect(within(region).getAllByText('Meat')[0]).toHaveAttribute('lang', 'hy');
    expect(within(region).getByText('1 coming · 1 in all').closest('[lang="hy"]')).toBeNull();
    expect(
      screen.getByText(
        'The questions aren’t published in that language, so they are shown in Հայերեն.',
      ),
    ).toBeInTheDocument();
    const choice = screen.getByRole('navigation', { name: 'Language of the questions' });
    expect(within(choice).getByRole('link', { name: 'Հայերեն' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('asks in the event’s own language when the address names none', async () => {
    const asked: (string | null)[] = [];
    server.use(
      http.get(`${API}/events/e1/answers`, ({ request }) => {
        asked.push(new URL(request.url).searchParams.get('locale'));
        return HttpResponse.json({ locale: 'hy', questions: [] });
      }),
    );
    await openAnswers('/page', 'hy');
    expect(asked).toEqual([null]);
    expect(screen.getByText('Հրավերը սեփական հարցեր չի տալիս։')).toBeInTheDocument();
  });

  it('tells a role refused the answers so', async () => {
    server.use(
      http.get(`${API}/events/e1/answers`, () =>
        HttpResponse.json({ statusCode: 403, message: 'Forbidden' }, { status: 403 }),
      ),
    );
    await openAnswers();
    expect(
      screen.getByText('These numbers aren’t available to your role on this event.'),
    ).toBeInTheDocument();
  });
});

describe('the guest book', () => {
  it('shows each message with who wrote it, dated in the event’s time zone', async () => {
    server.use(
      http.get(`${API}/events/e1`, () =>
        HttpResponse.json({ ...event, timezone: 'America/Los_Angeles' }),
      ),
      http.get(`${API}/events/e1/guest-book`, () =>
        HttpResponse.json([
          // 03:00 UTC on 2 May is still 1 May in Los Angeles, and 2 May in UTC and in Yerevan.
          { from: 'Ani Petrosyan', message: 'Congratulations!', at: '2027-05-02T03:00:00.000Z' },
          { from: 'Aram', message: 'See you there', at: null },
        ]),
      ),
    );
    await openGuestBook();
    const entries = screen.getAllByRole('listitem');
    expect(entries).toHaveLength(2);
    expect(within(entries[0] as HTMLElement).getByText('Congratulations!')).toBeInTheDocument();
    expect(within(entries[0] as HTMLElement).getByText('Ani Petrosyan')).toBeInTheDocument();
    expect(within(entries[0] as HTMLElement).getByText(/1 May 2027, 20:00/)).toBeInTheDocument();
    expect(within(entries[1] as HTMLElement).getByText('Aram')).toBeInTheDocument();
  });

  it('says when nobody has written yet', async () => {
    server.use(http.get(`${API}/events/e1/guest-book`, () => HttpResponse.json([])));
    await openGuestBook();
    expect(screen.getByText('Nobody has left a message yet.')).toBeInTheDocument();
  });
});
