import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ComponentType } from 'react';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResponseOf } from '@/api/client';
import { createBrowserSession, type BrowserSession } from '@/api/session';
import { createI18n, type Language } from '@/lib/i18n';

import { AnswersPage } from './components/answers-page';
import { GuestBookPage } from './components/guest-book-page';
import { loadAnswers, loadGuestBook, type AnswersData, type GuestBookData } from './load';
import { readAnswerPage, readGuestBookPage, readQuestionPage } from './read';

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

type QuestionWire = ResponseOf<'OperationsController_questionPageResponse'>['items'][number];
type ResponseWire = ResponseOf<'OperationsController_answerPageResponse'>['items'][number];
/** A question with who answered it, as the routes give the two apart. */
type AnsweredWire = QuestionWire & { responses: Omit<ResponseWire, 'id'>[] };

const meal: AnsweredWire = {
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

const wish: AnsweredWire = {
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
  current.session = session;
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

/** A page as the bounded routes give it (docs/API.md §6). */
function page<T>(items: T[], offset = 0, hasMore = false) {
  return { items, total: items.length + offset + (hasMore ? 1 : 0), limit: 20, offset, hasMore };
}

const question = ({ responses: _responses, ...rest }: AnsweredWire): QuestionWire => rest;
const answer = (response: Omit<ResponseWire, 'id'>, id: string): ResponseWire => ({
  ...response,
  id,
});

function serveQuestions(answer: (url: URL) => object) {
  const asked: URL[] = [];
  server.use(
    http.get(`${API}/events/e1/answers/questions`, ({ request }) => {
      const url = new URL(request.url);
      asked.push(url);
      return HttpResponse.json(answer(url));
    }),
  );
  return asked;
}

describe('reading the answers and the guest book (FR-117)', () => {
  it('keeps only the fields named, and where the next page starts', () => {
    // A field the page doesn't use is dropped.
    const items = [{ ...question(meal), extra: 'x' }];
    const sheet = readQuestionPage({ ...page(items, 20, true), locale: 'en' });
    expect(sheet).toEqual({
      locale: 'en',
      items: [
        {
          id: 'q1',
          type: 'SINGLE_CHOICE',
          prompt: 'Meat or fish?',
          answered: 2,
          tally: meal.tally,
        },
      ],
      nextOffset: 21,
    });
  });

  it('keeps a free-text question without a tally, and no next page at the end', () => {
    const sheet = readQuestionPage({ ...page([question(wish)]), locale: 'en' });
    expect(sheet.items[0]?.tally).toBeNull();
    expect(sheet.nextOffset).toBeNull();
  });

  it('keeps each answer with who gave it, dropping the stored value', () => {
    const answers = readAnswerPage({
      ...page(meal.responses.slice(0, 1).map((one) => answer(one, 'r1'))),
      questionId: 'q1',
      locale: 'en',
    });
    expect(answers.items).toEqual([
      {
        id: 'r1',
        guestId: 'g1',
        name: 'Lusine Petrosyan',
        household: 'Petrosyan family',
        status: 'ATTENDING',
        display: 'Meat',
      },
    ]);
  });

  it('keeps each message with who wrote it and when, dropping anything else', () => {
    const stored = {
      id: 'm1',
      guestId: 'g1',
      from: 'Ani',
      message: 'Congratulations',
      at: null,
      extra: 'x',
    };
    expect(readGuestBookPage(page([stored])).items).toEqual([
      { id: 'm1', from: 'Ani', message: 'Congratulations', at: null },
    ]);
  });
});

describe('the answers to the host’s own questions', () => {
  it('counts each choice among guests coming and among everyone, and reads who answered on request', async () => {
    serveQuestions(() => ({ ...page([question(meal), question(wish)]), locale: 'en' }));
    const offsets: string[] = [];
    server.use(
      http.get(
        `${API}/events/e1/answers/questions/:questionId/responses`,
        ({ params, request }) => {
          const url = new URL(request.url);
          offsets.push(
            `${String(params.questionId)}@${url.searchParams.get('offset')}:${url.searchParams.get('locale')}`,
          );
          const isFirst = url.searchParams.get('offset') === '0';
          const one = meal.responses[isFirst ? 0 : 1];
          if (!one) throw new Error('No answer');
          const items = [answer(one, isFirst ? 'r1' : 'r2')];
          return HttpResponse.json({
            ...page(items, Number(url.searchParams.get('offset')), isFirst),
            questionId: 'q1',
            locale: 'en',
          });
        },
      ),
    );
    const user = userEvent.setup();
    await openAnswers();
    const region = screen.getByRole('region', { name: 'Meat or fish?' });
    expect(within(region).getByText('2 answered')).toBeInTheDocument();
    expect(within(region).getByText('1 coming · 1 in all')).toBeInTheDocument();
    expect(offsets).toEqual([]);
    await user.click(within(region).getByRole('button', { name: 'Who answered what' }));
    expect(await within(region).findByText('Lusine Petrosyan')).toBeInTheDocument();
    await user.click(within(region).getByRole('button', { name: 'Show more answers' }));
    expect(await within(region).findByText('Aram Sargsyan')).toBeInTheDocument();
    expect(within(region).getByText('Not coming')).toBeInTheDocument();
    expect(
      within(region).queryByRole('button', { name: 'Show more answers' }),
    ).not.toBeInTheDocument();
    expect(offsets).toEqual(['q1@0:en', 'q1@1:en']);
  });

  it('reads more questions on request, in the language the first came in', async () => {
    const asked = serveQuestions((url) =>
      url.searchParams.get('offset') === '0'
        ? { ...page([question(meal)], 0, true), locale: 'hy' }
        : { ...page([question(wish)], 1), locale: 'hy' },
    );
    const user = userEvent.setup();
    await openAnswers();
    await user.click(screen.getByRole('button', { name: 'Show more questions' }));
    expect(
      await screen.findByRole('region', { name: 'A wish for the couple' }),
    ).toBeInTheDocument();
    expect(
      asked.map((url) => [
        url.searchParams.get('offset'),
        url.searchParams.get('locale'),
        url.searchParams.get('limit'),
      ]),
    ).toEqual([
      ['0', null, '20'],
      ['1', 'hy', '20'],
    ]);
    expect(screen.queryByRole('button', { name: 'Show more questions' })).not.toBeInTheDocument();
  });

  it('offers no reading of who answered a question nobody has', async () => {
    serveQuestions(() => ({ ...page([{ ...question(wish), answered: 0 }]), locale: 'en' }));
    await openAnswers();
    expect(screen.queryByRole('button', { name: 'Who answered what' })).not.toBeInTheDocument();
  });

  it('can’t be pressed again while the next page is read', async () => {
    let release = () => undefined as void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`${API}/events/e1/answers/questions`, async ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset') ?? 0);
        if (offset === 0)
          return HttpResponse.json({ ...page([question(meal)], 0, true), locale: 'en' });
        await held;
        return HttpResponse.json({ ...page([question(wish)], offset), locale: 'en' });
      }),
    );
    await openAnswers();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Show more questions' }));
    expect(screen.getByRole('button', { name: 'Show more questions' })).toBeDisabled();
    release();
    expect(
      await screen.findByRole('region', { name: 'A wish for the couple' }),
    ).toBeInTheDocument();
  });

  it('asks in the language in the address, and shows the one the response names', async () => {
    const asked = serveQuestions(() => ({
      ...page([{ ...question(meal), prompt: 'Միս, թե՞ ձուկ' }]),
      locale: 'hy',
    }));
    await openAnswers('/page?locale=fr');
    expect(asked.map((url) => url.searchParams.get('locale'))).toEqual(['fr']);
    const region = screen.getByRole('region', { name: 'Միս, թե՞ ձուկ' });
    // The prompt and the options are the event's words; the counts are the page's own.
    expect(within(region).getByRole('heading', { level: 2 })).toHaveAttribute('lang', 'hy');
    expect(within(region).getByText('Meat')).toHaveAttribute('lang', 'hy');
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
    const asked = serveQuestions(() => ({ ...page([]), locale: 'hy' }));
    await openAnswers('/page', 'hy');
    expect(asked.map((url) => url.searchParams.get('locale'))).toEqual([null]);
    expect(screen.getByText('Հրավերը սեփական հարցեր չի տալիս։')).toBeInTheDocument();
  });

  it('tells a role refused the answers so', async () => {
    server.use(
      http.get(`${API}/events/e1/answers/questions`, () =>
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
  function serveBook(answer: (offset: number) => object) {
    server.use(
      http.get(`${API}/events/e1/guest-book/entries`, ({ request }) =>
        HttpResponse.json(answer(Number(new URL(request.url).searchParams.get('offset')))),
      ),
    );
  }

  it('shows each message with who wrote it, dated in the event’s time zone', async () => {
    server.use(
      http.get(`${API}/events/e1`, () =>
        HttpResponse.json({ ...event, timezone: 'America/Los_Angeles' }),
      ),
    );
    serveBook(() =>
      page([
        // 03:00 UTC on 2 May is still 1 May in Los Angeles, and 2 May in UTC and in Yerevan.
        {
          id: 'm1',
          guestId: 'g1',
          from: 'Ani Petrosyan',
          message: 'Congratulations!',
          at: '2027-05-02T03:00:00.000Z',
        },
        { id: 'm2', guestId: 'g2', from: 'Aram', message: null, at: null },
      ]),
    );
    await openGuestBook();
    const entries = screen.getAllByRole('listitem');
    expect(entries).toHaveLength(2);
    expect(within(entries[0] as HTMLElement).getByText('Congratulations!')).toBeInTheDocument();
    expect(within(entries[0] as HTMLElement).getByText('Ani Petrosyan')).toBeInTheDocument();
    expect(within(entries[0] as HTMLElement).getByText(/1 May 2027, 20:00/)).toBeInTheDocument();
    expect(within(entries[1] as HTMLElement).getByText('Aram')).toBeInTheDocument();
    expect(within(entries[1] as HTMLElement).getByText('Left no words.')).toBeInTheDocument();
  });

  it('reads more messages on request, until there are none', async () => {
    serveBook((offset) =>
      offset === 0
        ? page([{ id: 'm1', guestId: 'g1', from: 'Ani', message: 'First', at: null }], 0, true)
        : page([{ id: 'm2', guestId: 'g2', from: 'Aram', message: 'Second', at: null }], 1),
    );
    const user = userEvent.setup();
    await openGuestBook();
    await user.click(screen.getByRole('button', { name: 'Show more messages' }));
    expect(await screen.findByText('Second')).toBeInTheDocument();
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more messages' })).not.toBeInTheDocument();
  });

  it('says when more messages can’t be read, keeping those read', async () => {
    let reads = 0;
    server.use(
      http.get(`${API}/events/e1/guest-book/entries`, () => {
        reads += 1;
        return reads === 1
          ? HttpResponse.json(
              page([{ id: 'm1', guestId: 'g1', from: 'Ani', message: 'First', at: null }], 0, true),
            )
          : HttpResponse.json({ statusCode: 500, message: 'Boom' }, { status: 500 });
      }),
    );
    const user = userEvent.setup();
    await openGuestBook();
    await user.click(screen.getByRole('button', { name: 'Show more messages' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('couldn’t be read');
    expect(screen.getByText('First')).toBeInTheDocument();
  });

  it('says when nobody has written yet', async () => {
    serveBook(() => page([]));
    await openGuestBook();
    expect(screen.getByText('Nobody has left a message yet.')).toBeInTheDocument();
  });
});
