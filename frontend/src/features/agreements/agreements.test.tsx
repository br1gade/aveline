import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import { createI18n } from '@/lib/i18n';
import { APP_PATHS } from '@/route-paths';

import { AgreementsPage } from './components/agreements-page';
import { loadAgreements, type AgreementsData } from './load';
import { recordWire } from './test-data';

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
/** Made at run time: the guest list carries each guest's link, which must go nowhere. */
const TOKEN = `tok-${crypto.randomUUID()}`;

const EVENT = {
  id: 'e1',
  title: 'The wedding of Anna and Davit',
  type: 'WEDDING',
  hostsLabel: 'Anna & Davit',
  startsAt: '2027-06-12T11:00:00.000Z',
  endsAt: null,
  timezone: 'Asia/Yerevan',
  locales: ['hy', 'en'],
  defaultLocale: 'hy',
  sideALabel: null,
  sideBLabel: null,
  invitation: { slug: 'anna-davit', status: 'PUBLISHED' },
};

function question(
  id: string,
  type: string,
  prompt: Record<string, string>,
  version: string | null,
) {
  return {
    id,
    type,
    required: true,
    prompt,
    options: {},
    answerCount: 0,
    statementVersionId: version,
  };
}

const DESIGN = {
  slug: 'anna-davit',
  status: 'PUBLISHED',
  event: {
    id: 'e1',
    title: EVENT.title,
    locales: ['hy', 'en'],
    defaultLocale: 'hy',
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
    question('q-main', 'SINGLE_CHOICE', { en: 'Main course' }, null),
    question(
      'q-photos',
      'SIGNATURE',
      { hy: 'Լուսանկարները կարող են տարածվել', en: 'Photos may be shared' },
      'v2',
    ),
    question('q-rules', 'SIGNATURE', { en: 'I accept the venue’s rules' }, 'r1'),
  ],
  publishBlockers: [],
};

function guest(id: string, firstName: string) {
  return {
    id,
    firstName,
    lastName: 'Petrosyan',
    name: `${firstName} Petrosyan`,
    token: TOKEN,
    email: `${firstName.toLowerCase()}@example.am`,
    locale: 'hy',
    attribution: 'SIDE_A',
    isPrimary: id === 'g1',
    addedByGuest: false,
    isAnonymized: false,
    rsvpStatus: 'ATTENDING',
    table: null,
    isCheckedIn: false,
  };
}

const HOUSEHOLDS = [
  {
    id: 'h1',
    name: 'Petrosyan family',
    seatsAllotted: 2,
    seatsNamed: 2,
    guests: [guest('g1', 'Armen'), guest('g2', 'Lusine')],
  },
];

const RECORDS = [
  recordWire({
    id: 'a3',
    subjectGuestId: 'g2',
    signerGuestId: 'g1',
    isRepresentative: true,
    method: 'DRAWN',
    mediaId: 'sig-1',
  }),
  recordWire({ id: 'a2', statementVersionId: 'v1', statement: 'Photos may be posted' }),
  recordWire({ id: 'a1' }),
];

const server = setupServer();
const files: string[] = [];

function serve(records = RECORDS, nextCursor: string | null = null) {
  server.use(
    http.get(`${API}/events/e1/acknowledgements`, ({ request }) => {
      const after = new URL(request.url).searchParams.get('after');
      return after
        ? HttpResponse.json({
            items: [
              recordWire({
                id: 'a0',
                statementVersionId: 'v1',
                statement: 'Photos may be posted',
                createdAt: '2027-03-01T09:00:00.000Z',
              }),
            ],
            nextCursor: null,
          })
        : HttpResponse.json({ items: records, nextCursor });
    }),
  );
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  files.length = 0;
  current.session = createBrowserSession({
    baseUrl: ORIGIN,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
  server.use(
    http.get(`${API}/events/e1`, () => HttpResponse.json(EVENT)),
    http.get(`${API}/invitations/anna-davit/design`, () => HttpResponse.json(DESIGN)),
    http.get(`${API}/events/e1/guests`, () => HttpResponse.json(HOUSEHOLDS)),
    http.get(`${API}/events/e1/acknowledgements/:id/file`, ({ params }) => {
      files.push(String(params.id));
      return new HttpResponse(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } });
    }),
  );
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderPage() {
  const Stub = createRoutesStub([
    {
      path: APP_PATHS.agreements,
      loader: ({ params }) => {
        if (!current.session) throw new Error('No session in this test');
        return loadAgreements(current.session.api, params.eventId ?? '');
      },
      Component: () => <AgreementsPage data={useLoaderData<AgreementsData>()} />,
    },
    { path: APP_PATHS.event, Component: () => <p>Event page</p> },
  ]);
  const view = render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={['/app/events/e1/agreements']} />
    </I18nextProvider>,
  );
  return { ...view, user: userEvent.setup() };
}

const statement = (name: string) =>
  screen.getByRole('heading', { level: 2, name }).closest('section') as HTMLElement;

describe('the hosts’ agreements (PD-66)', () => {
  it('groups by statement in the design’s order, the current wording first, each guest named', async () => {
    serve();
    const { container } = renderPage();
    await screen.findByRole('heading', { level: 2, name: 'Photos may be shared' });
    const photos = statement('Photos may be shared');
    const wordings = within(photos).getAllByRole('heading', { level: 3 });
    expect(wordings.map((heading) => heading.textContent)).toEqual([
      'Current wording · 2 agreements',
      'Earlier wording · 1 agreement',
    ]);
    expect(
      within(photos).getByText('Agreed by Armen Petrosyan on their behalf'),
    ).toBeInTheDocument();
    expect(within(photos).getByText('Lusine Petrosyan')).toBeInTheDocument();
    expect(within(photos).getByText('Photos may be posted').closest('blockquote')).toHaveAttribute(
      'lang',
      'en',
    );
    expect(
      within(statement('I accept the venue’s rules')).getByText('Nobody has agreed yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Main course')).toBeNull();
    expect(container.innerHTML).not.toContain(TOKEN);
  });

  it('shows a drawn signature only when asked, read with the session', async () => {
    serve();
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Show the signature' }));
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Signature of Armen Petrosyan' })).toHaveAttribute(
        'src',
        expect.stringMatching(/^blob:/),
      ),
    );
    expect(files).toEqual(['a3']);
  });

  it('reads older agreements a page at a time', async () => {
    serve(RECORDS, 'a1');
    const { user } = renderPage();
    expect(await screen.findByText('The newest 3 agreements are shown.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show older agreements' }));
    await waitFor(() =>
      expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toContain(
        'Earlier wording · 2 agreements',
      ),
    );
    expect(screen.queryByRole('button', { name: 'Show older agreements' })).toBeNull();
  });

  it('tells a role without contact access that agreements are not theirs to read', async () => {
    server.use(
      http.get(`${API}/events/e1/acknowledgements`, () =>
        HttpResponse.json({ statusCode: 403, message: 'Forbidden' }, { status: 403 }),
      ),
    );
    renderPage();
    expect(
      await screen.findByText(
        'Agreements are not available to your role: they need access to guests’ contact details.',
      ),
    ).toBeInTheDocument();
  });

  it('says when the invitation asks guests to agree to nothing', async () => {
    serve([]);
    server.use(
      http.get(`${API}/invitations/anna-davit/design`, () =>
        HttpResponse.json({ ...DESIGN, questions: [DESIGN.questions[0]] }),
      ),
    );
    renderPage();
    expect(
      await screen.findByText('This invitation asks guests to agree to nothing.'),
    ).toBeInTheDocument();
  });

  it('still lists the agreements when the guest list cannot be read', async () => {
    serve();
    server.use(
      http.get(`${API}/events/e1/guests`, () =>
        HttpResponse.json({ statusCode: 500, message: 'Boom' }, { status: 500 }),
      ),
    );
    renderPage();
    expect((await screen.findAllByText('Name not available')).length).toBeGreaterThan(0);
  });

  it('neither calls a statement gone nor a wording current when the design cannot be read', async () => {
    serve();
    server.use(
      http.get(`${API}/invitations/anna-davit/design`, () =>
        HttpResponse.json({ statusCode: 500, message: 'Boom' }, { status: 500 }),
      ),
    );
    renderPage();
    await screen.findByRole('heading', { level: 2, name: 'Photos may be shared' });
    expect(screen.queryByText('A statement no longer on the invitation')).toBeNull();
    expect(screen.queryByText(/Current wording/)).toBeNull();
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'As guests read it · 2 agreements',
      'As guests read it · 1 agreement',
    ]);
  });

  it('starts again from the newest when an older page’s cursor is gone (404)', async () => {
    serve(RECORDS, 'a1');
    const { user } = renderPage();
    await screen.findByText('The newest 3 agreements are shown.');
    server.use(
      http.get(`${API}/events/e1/acknowledgements`, ({ request }) =>
        new URL(request.url).searchParams.get('after')
          ? HttpResponse.json(
              { statusCode: 404, message: 'Unknown acknowledgement cursor' },
              { status: 404 },
            )
          : HttpResponse.json({ items: RECORDS, nextCursor: 'a1' }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Show older agreements' }));
    expect(
      await screen.findByText(
        'The agreements changed meanwhile, so the list starts again from the newest.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('The newest 3 agreements are shown.')).toBeInTheDocument();
  });
});

describe('who still has to agree (PD-155)', () => {
  const SHOW = 'See who still has to agree';
  const region = () => screen.getByRole('region', { name: 'Who still has to agree' });
  const everyoneAgreed = () =>
    ['g1', 'g2'].flatMap((subjectGuestId) =>
      ['v2', 'r1'].map((statementVersionId) =>
        recordWire({
          id: `${subjectGuestId}-${statementVersionId}`,
          subjectGuestId,
          statementVersionId,
        }),
      ),
    );

  /** Counts each read of the agreements, the page's own first one included. */
  function countingReads(records: unknown[], nextCursor: string | null = null) {
    const reads = { count: 0 };
    server.use(
      http.get(`${API}/events/e1/acknowledgements`, () => {
        reads.count += 1;
        return HttpResponse.json({ items: records, nextCursor } as never);
      }),
    );
    return reads;
  }

  it('reads nothing more until asked, then names those who owe each statement', async () => {
    serve();
    const reads = countingReads([recordWire({ subjectGuestId: 'g1', statementVersionId: 'r1' })]);
    const { user } = renderPage();
    const show = await screen.findByRole('button', { name: SHOW });
    expect(reads.count).toBe(1);
    await user.click(show);
    const rules = await within(region()).findByRole('heading', {
      level: 3,
      name: 'I accept the venue’s rules',
    });
    expect(reads.count).toBe(2);
    expect(rules.parentElement).toHaveTextContent('Lusine Petrosyan');
    expect(rules.parentElement).not.toHaveTextContent('Armen Petrosyan');
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it('says when everyone coming has agreed', async () => {
    serve();
    countingReads(everyoneAgreed());
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: SHOW }));
    expect(await within(region()).findByText('Everyone coming has agreed.')).toBeInTheDocument();
  });

  it('says so when there were too many to read', async () => {
    serve();
    const reads = countingReads(everyoneAgreed(), 'more');
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: SHOW }));
    expect(await within(region()).findByText(/too many agreements/)).toBeInTheDocument();
    expect(reads.count).toBe(21);
  });

  it('doesn’t say everyone has agreed when it couldn’t read them all', async () => {
    serve();
    countingReads(everyoneAgreed(), 'more');
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: SHOW }));
    await within(region()).findByText(/too many agreements/);
    expect(within(region()).queryByText('Everyone coming has agreed.')).not.toBeInTheDocument();
  });

  it('leaves out someone already through the door, who agreed to get there', async () => {
    serve();
    countingReads([]);
    server.use(
      http.get(`${API}/events/e1/guests`, () =>
        HttpResponse.json([
          {
            ...HOUSEHOLDS[0],
            guests: [guest('g1', 'Armen'), { ...guest('g2', 'Lusine'), isCheckedIn: true }],
          },
        ]),
      ),
    );
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: SHOW }));
    const said = await within(region()).findByRole('status');
    expect(said).toHaveTextContent('Armen Petrosyan');
    expect(said).not.toHaveTextContent('Lusine Petrosyan');
  });

  it('calls a statement with no words a statement, rather than nothing', async () => {
    serve();
    countingReads([]);
    server.use(
      http.get(`${API}/invitations/anna-davit/design`, () =>
        HttpResponse.json({ ...DESIGN, questions: [question('q-x', 'SIGNATURE', {}, 'x1')] }),
      ),
    );
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: SHOW }));
    expect(
      await within(region()).findByText('A statement without words in this language'),
    ).toBeInTheDocument();
  });

  it('can’t be pressed again while it reads', async () => {
    serve();
    const { user } = renderPage();
    const show = await screen.findByRole('button', { name: SHOW });
    let letGo = () => undefined as void;
    const held = new Promise<void>((resolve) => {
      letGo = resolve;
    });
    server.use(
      http.get(`${API}/events/e1/guests`, async () => {
        await held;
        return HttpResponse.json(HOUSEHOLDS);
      }),
    );
    await user.click(show);
    expect(show).toBeDisabled();
    letGo();
    await within(region()).findByText(/Lusine Petrosyan/);
  });

  it('offers trying again after a failure, which reads again', async () => {
    serve();
    let isDown = true;
    server.use(
      http.get(`${API}/events/e1/guests`, () =>
        isDown
          ? HttpResponse.json({ statusCode: 500, message: 'Boom' }, { status: 500 })
          : HttpResponse.json(HOUSEHOLDS),
      ),
    );
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: SHOW }));
    expect(await within(region()).findByRole('alert')).toHaveTextContent('couldn’t be read');
    isDown = false;
    await user.click(within(region()).getByRole('button', { name: 'Try again' }));
    expect(await within(region()).findByRole('status')).toHaveTextContent('Lusine Petrosyan');
  });

  it('words a role that can’t see the guest list, with nothing to press', async () => {
    serve();
    const { user } = renderPage();
    const show = await screen.findByRole('button', { name: SHOW });
    server.use(
      http.get(`${API}/events/e1/guests`, () =>
        HttpResponse.json({ statusCode: 403, message: 'Forbidden' }, { status: 403 }),
      ),
    );
    await user.click(show);
    expect(await within(region()).findByRole('alert')).toHaveTextContent(
      'not available to your role',
    );
    expect(within(region()).queryByRole('button')).not.toBeInTheDocument();
  });

  it('isn’t offered when nothing has to be agreed to', async () => {
    serve([]);
    server.use(
      http.get(`${API}/invitations/anna-davit/design`, () =>
        HttpResponse.json({ ...DESIGN, questions: [DESIGN.questions[0]] }),
      ),
    );
    renderPage();
    await screen.findByText('This invitation asks guests to agree to nothing.');
    expect(screen.queryByRole('button', { name: SHOW })).not.toBeInTheDocument();
  });
});
