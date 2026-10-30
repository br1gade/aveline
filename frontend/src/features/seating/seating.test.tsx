import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import { createI18n } from '@/lib/i18n';
import { revalidateUnlessQueryOnly } from '@/lib/routing';
import { APP_PATHS } from '@/route-paths';

import { SeatingPage } from './components/seating-page';
import { loadSeating, type SeatingData } from './load';
import { ARRANGEMENTS, EVENT, jobWire, TABLES } from './test-data';
import type { JobWire } from './types';

const current = vi.hoisted(() => ({
  session: undefined as BrowserSession | undefined,
  /** The poll's wait; immediate unless a test holds it. */
  wait: (): Promise<void> => Promise.resolve(),
}));
vi.mock('@/api/session', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  browserSession: () => {
    if (!current.session) throw new Error('No session in this test');
    return current.session;
  },
}));
vi.mock('@/lib/poll', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  waitFor: () => current.wait(),
}));

const ORIGIN = 'http://api.test';
const API = `${ORIGIN}/api/v1`;
/** Made at run time: the guest list carries each guest's link, which must go nowhere. */
const TOKEN = `tok-${crypto.randomUUID()}`;

function guest(id: string, name: string, answer = 'ATTENDING') {
  const [firstName = name, lastName = null] = name.split(' ');
  return {
    id,
    firstName,
    lastName,
    name,
    token: TOKEN,
    email: null,
    phone: null,
    locale: 'hy',
    attribution: 'UNKNOWN',
    isPrimary: false,
    addedByGuest: false,
    isAnonymized: false,
    rsvpStatus: answer,
    table: null,
    isCheckedIn: false,
  };
}

const HOUSEHOLDS = [
  {
    id: 'h1',
    name: 'Petrosyan family',
    seatsAllotted: 4,
    seatsNamed: 4,
    guests: [
      guest('g1', 'Armen Petrosyan'),
      guest('g2', 'Lusine Petrosyan'),
      guest('g3', 'Davit Petrosyan'),
      guest('g8', 'Gor Petrosyan'),
    ],
  },
  {
    id: 'h2',
    name: 'Sargsyan family',
    seatsAllotted: 3,
    seatsNamed: 3,
    guests: [
      guest('g4', 'Ani Sargsyan'),
      guest('g5', 'Karen Sargsyan'),
      guest('g6', 'Mariam Sargsyan', 'DECLINED'),
    ],
  },
  {
    id: 'h3',
    name: 'Hakobyan family',
    seatsAllotted: 1,
    seatsNamed: 1,
    guests: [guest('g7', 'Narek Hakobyan', 'PENDING')],
  },
];

const server = setupServer();
const sent: Array<{ method: string; path: string; body: unknown }> = [];
let tableReads = 0;

function refusal(status: number, message = 'No') {
  return HttpResponse.json(
    { statusCode: status, message, requestId: `r-${status}` },
    { status, headers: { 'x-request-id': `r-${status}` } },
  );
}

/** Records each write, then answers it with `reply` (JSON, or a refusal). */
function write(
  method: 'post' | 'patch' | 'delete',
  path: string,
  reply: () => Response | JsonBodyType,
) {
  server.use(
    http[method](`${API}${path}`, async ({ request }) => {
      const url = new URL(request.url);
      const body = method === 'delete' ? null : await request.json().catch(() => null);
      sent.push({ method: method.toUpperCase(), path: `${url.pathname}${url.search}`, body });
      const answer = reply();
      return answer instanceof Response ? answer : HttpResponse.json(answer);
    }),
  );
}

function serveJob(...answers: JobWire[]) {
  let read = 0;
  server.use(
    http.get(`${API}/events/e1/seating/jobs/:jobId`, () => {
      const answer = answers[Math.min(read, answers.length - 1)];
      read += 1;
      return HttpResponse.json(answer ?? null);
    }),
  );
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  sent.length = 0;
  tableReads = 0;
  current.wait = () => Promise.resolve();
  current.session = createBrowserSession({
    baseUrl: ORIGIN,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
  server.use(
    http.get(`${API}/events/e1`, () => HttpResponse.json(EVENT)),
    http.get(`${API}/events/e1/seating/arrangements`, () => HttpResponse.json(ARRANGEMENTS)),
    http.get(`${API}/events/e1/tables`, () => {
      tableReads += 1;
      return HttpResponse.json(TABLES);
    }),
    http.get(`${API}/events/e1/guests`, () => HttpResponse.json(HOUSEHOLDS)),
    http.get(`${API}/events/e1/seating/jobs`, () => HttpResponse.json([])),
  );
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderPage(path = '/app/events/e1/seating?plan=a-hall') {
  const Stub = createRoutesStub([
    {
      path: APP_PATHS.seating,
      loader: ({ params }) => {
        if (!current.session) throw new Error('No session in this test');
        return loadSeating(current.session.api, params.eventId ?? '');
      },
      Component: () => <SeatingPage data={useLoaderData<SeatingData>()} />,
      // As the route module has it: a plan's tab is a change of query alone.
      shouldRevalidate: revalidateUnlessQueryOnly,
    },
    { path: APP_PATHS.event, Component: () => <p>Event page</p> },
  ]);
  const view = render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={[path]} />
    </I18nextProvider>,
  );
  return { ...view, user: userEvent.setup() };
}

const region = (name: string) => screen.getByRole('region', { name });

describe('the seating page (PD-67, PD-68)', () => {
  it('offers the venues guests see in the host’s order, tables by number, and who still needs a seat', async () => {
    const { container } = renderPage();
    const plans = await screen.findByRole('navigation', { name: 'Seating plans' });
    expect(
      within(plans)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Church · 0 seated', 'Hall · 3 seated']);
    const tables = region('Tables');
    expect(
      within(tables)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['Table 1', 'Table 2', 'Table 10']);
    expect(within(tables).getByText('Area: Terrace')).toBeInTheDocument();
    expect(within(tables).getByText('1 of 4 seats taken')).toBeInTheDocument();
    expect(within(tables).getByText(/· held until they answer/)).toBeInTheDocument();
    expect(within(tables).getByText(/· chair 3/)).toBeInTheDocument();
    expect(within(tables).getByText('Mariam Sargsyan, 3 May 2027, 12:00')).toBeInTheDocument();
    const toSeat = region('Coming, not seated yet');
    expect(
      within(toSeat)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['Petrosyan family', 'Sargsyan family']);
    expect(
      within(toSeat).getByText('Their household sits at Table 2, Table 10.'),
    ).toBeInTheDocument();
    const summary = region('This plan');
    expect(summary).toHaveTextContent('Tables3');
    expect(summary).toHaveTextContent('Seats taken3 of 16');
    expect(summary).toHaveTextContent('Coming, not seated yet3');
    expect(screen.queryByText(/Guests can’t open their invitations yet/)).toBeNull();
    expect(container.innerHTML).not.toContain(TOKEN);
  });

  it('changes plan in the address without reading anything again', async () => {
    const { user } = renderPage();
    await user.click(await screen.findByRole('link', { name: 'Church · 0 seated' }));
    expect(
      await screen.findByText('No tables yet. Add one, or several at once.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Add tables first.')).toBeInTheDocument();
    expect(tableReads).toBe(1);
  });

  it('says the plan without a venue holds its seats only when guests answer per venue', async () => {
    const withTable = ARRANGEMENTS.map((each) =>
      each.id === 'a-none' ? { ...each, _count: { tables: 1 } } : each,
    );
    const garden = {
      ...TABLES[0],
      id: 'tg',
      arrangementId: 'a-none',
      name: 'Garden 1',
      released: [],
    };
    server.use(
      http.get(`${API}/events/e1/seating/arrangements`, () => HttpResponse.json(withTable)),
      http.get(`${API}/events/e1/tables`, () => HttpResponse.json([...TABLES, garden])),
    );
    const once = renderPage('/app/events/e1/seating?plan=a-none');
    expect(await screen.findByText('These tables belong to no venue.')).toBeInTheDocument();
    expect(screen.queryByText(/stay held/)).toBeNull();
    once.unmount();
    server.use(
      http.get(`${API}/events/e1`, () =>
        HttpResponse.json({ ...EVENT, attendanceMode: 'PER_VENUE' }),
      ),
    );
    renderPage('/app/events/e1/seating?plan=a-none');
    expect(
      await screen.findByText(
        'These tables belong to no venue. Guests answer per venue, so seats here stay held until you move or unseat their guests.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Nobody has said they are coming here yet.')).toHaveLength(2);
  });

  it('says guests cannot open their invitation yet while it is a draft', async () => {
    server.use(
      http.get(`${API}/events/e1`, () =>
        HttpResponse.json({ ...EVENT, invitation: { slug: 'anna-davit', status: 'DRAFT' } }),
      ),
    );
    renderPage();
    expect(
      await screen.findByText(
        'Guests can’t open their invitations yet: they will see their tables once the invitation is published.',
      ),
    ).toBeInTheDocument();
  });

  it('tells a role without seating access that the page is not theirs', async () => {
    server.use(http.get(`${API}/events/e1/seating/arrangements`, () => refusal(403)));
    renderPage();
    expect(
      await screen.findByText('Seating is not available to your role on this event.'),
    ).toBeInTheDocument();
  });
});

describe('tables (PD-68)', () => {
  it('adds one to the plan’s venue, posting, with the status said', async () => {
    write('post', '/events/e1/tables', () => ({ id: 't3' }));
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Add a table' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a table' });
    expect(
      within(dialog).getByRole('button', { name: 'Add the table' }).closest('form'),
    ).toHaveAttribute('method', 'post');
    await user.type(within(dialog).getByLabelText('Name'), ' Table 3 ');
    await user.click(within(dialog).getByRole('button', { name: 'Add the table' }));
    expect(await screen.findByText('Table 3 added.')).toBeInTheDocument();
    expect(sent).toEqual([
      {
        method: 'POST',
        path: '/api/v1/events/e1/tables',
        body: { name: 'Table 3', capacity: 10, venueId: 'hall' },
      },
    ]);
  });

  it('puts a refused name under its field', async () => {
    write('post', '/events/e1/tables', () =>
      refusal(400, 'name: there is already a table called "Table 2" in this arrangement'),
    );
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Add a table' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a table' });
    await user.type(within(dialog).getByLabelText('Name'), 'Table 2');
    await user.click(within(dialog).getByRole('button', { name: 'Add the table' }));
    expect(
      await within(dialog).findByText('Another table in this plan has this name.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Check the fields marked below.')).toBeInTheDocument();
  });

  it('adds several at once', async () => {
    write('post', '/events/e1/tables/bulk', () => ({ created: 20 }));
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Add several tables' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add several tables' });
    const count = within(dialog).getByLabelText('How many');
    await user.clear(count);
    await user.type(count, '20');
    await user.click(within(dialog).getByRole('button', { name: 'Add the tables' }));
    expect(await screen.findByText('20 tables added.')).toBeInTheDocument();
    expect(sent[0]?.body).toEqual({
      namePrefix: 'Table',
      count: 20,
      capacity: 10,
      venueId: 'hall',
    });
  });

  it('refuses seats below those seated before sending, and sends only what changed', async () => {
    write('patch', '/events/e1/tables/t2', () => ({ id: 't2' }));
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Edit: Table 2' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Table 2' });
    const seats = within(dialog).getByLabelText('Seats');
    await user.clear(seats);
    await user.type(seats, '0');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      await within(dialog).findByText('Enter a whole number from 1 to 100.'),
    ).toBeInTheDocument();
    await user.clear(seats);
    await user.type(seats, '4');
    await user.clear(within(dialog).getByLabelText('Area (optional)'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Table 2 saved.')).toBeInTheDocument();
    expect(sent).toEqual([
      { method: 'PATCH', path: '/api/v1/events/e1/tables/t2', body: { zone: null } },
    ]);
  });

  it('sends nothing when nothing changed', async () => {
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Edit: Table 10' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Table 10' });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent).toEqual([]);
  });

  it('removes an empty table after asking, and offers only Close for one with guests', async () => {
    write('delete', '/events/e1/tables/t1', () => ({ ok: true }));
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Remove: Table 10' }));
    const occupied = await screen.findByRole('alertdialog', { name: 'Table 10 has guests' });
    expect(within(occupied).queryByRole('button', { name: 'Remove the table' })).toBeNull();
    await user.click(within(occupied).getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Remove: Table 1' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Table 1?' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove the table' }));
    expect(await screen.findByText('Table 1 removed.')).toBeInTheDocument();
    expect(sent.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'DELETE /api/v1/events/e1/tables/t1',
    ]);
  });

  it('reloads the plan when a removal finds guests seated meanwhile', async () => {
    write('delete', '/events/e1/tables/t1', () =>
      refusal(409, '1 guest(s) are seated here; move them before deleting the table'),
    );
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Remove: Table 1' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Table 1?' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove the table' }));
    expect(
      await within(dialog).findByText(
        'Guests are seated at this table now. Unseat them before removing it.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(tableReads).toBe(2));
  });
});

describe('seating by hand (PD-69)', () => {
  it('seats a household one guest at a time, stops at a refusal, and sends only the rest again', async () => {
    let posts = 0;
    write('post', '/events/e1/seats', () => {
      posts += 1;
      return posts === 2 ? refusal(409, 'Table 1 is full') : { guestId: 'x' };
    });
    const { user } = renderPage();
    await user.click(
      await screen.findByRole('button', { name: 'Seat the household: Sargsyan family' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Seat Sargsyan family' });
    expect(within(dialog).getByText('Seating: Ani Sargsyan, Karen Sargsyan')).toBeInTheDocument();
    expect(
      within(dialog)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Table 1 · 2 free seats', 'Table 2 · 3 free seats', 'Table 10 · 8 free seats']);
    await user.click(within(dialog).getByRole('button', { name: 'Seat' }));
    expect(
      await within(dialog).findByText(
        'That table filled up meanwhile. The tables are up to date again: choose another.',
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Seated at Table 1: Ani Sargsyan. Not seated: Karen Sargsyan.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Seating: Karen Sargsyan')).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Table'), 't2');
    await user.click(within(dialog).getByRole('button', { name: 'Seat' }));
    expect(await screen.findByText('Seated at Table 2: Karen Sargsyan.')).toBeInTheDocument();
    expect(sent.map(({ body }) => body)).toEqual([
      { guestId: 'g4', tableId: 't1' },
      { guestId: 'g5', tableId: 't1' },
      { guestId: 'g5', tableId: 't2' },
    ]);
  });

  it('seats one guest at their household’s table, chosen first', async () => {
    write('post', '/events/e1/seats', () => ({ guestId: 'g3' }));
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Seat: Davit Petrosyan' }));
    const dialog = await screen.findByRole('dialog', { name: 'Seat Davit Petrosyan' });
    expect(within(dialog).getByLabelText('Table')).toHaveDisplayValue(
      'Table 2 · 3 free seats (where their household sits)',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Seat' }));
    expect(await screen.findByText('Seated at Table 2: Davit Petrosyan.')).toBeInTheDocument();
    expect(sent[0]?.body).toEqual({ guestId: 'g3', tableId: 't2' });
  });

  it('says who of the household stays behind when moving a guest', async () => {
    write('post', '/events/e1/seats', () => ({ guestId: 'g1' }));
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Move: Armen Petrosyan' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move Armen Petrosyan' });
    expect(within(dialog).getByText('Gor Petrosyan stays at Table 10.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Move' }));
    expect(await screen.findByText('Armen Petrosyan moved to Table 1.')).toBeInTheDocument();
  });

  it('unseats in this plan only, with the status taking the focus', async () => {
    write('delete', '/events/e1/seats/g2', () => ({ ok: true }));
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Unseat: Lusine Petrosyan' }));
    const line = await screen.findByText('Lusine Petrosyan unseated from Table 2.');
    await waitFor(() => expect(line).toHaveFocus());
    expect(sent[0]?.path).toBe('/api/v1/events/e1/seats/g2?arrangementId=a-hall');
  });

  it('seats again, or dismisses, a seat a decline freed', async () => {
    write('post', '/events/e1/seats', () => ({ guestId: 'g6' }));
    write('delete', '/events/e1/seats/g6', () => ({ ok: true }));
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Seat again: Mariam Sargsyan' }));
    expect(await screen.findByText('Mariam Sargsyan seated again at Table 1.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss: Mariam Sargsyan' }));
    expect(
      await screen.findByText('The note about Mariam Sargsyan is dismissed.'),
    ).toBeInTheDocument();
    expect(sent.map(({ method, path, body }) => [method, path, body])).toEqual([
      ['POST', '/api/v1/events/e1/seats', { guestId: 'g6', tableId: 't1' }],
      ['DELETE', '/api/v1/events/e1/seats/g6?arrangementId=a-hall', null],
    ]);
  });

  it.each([
    [403, 'Your role can see the seating but not unseat guests.'],
    [404, 'They were no longer seated here. The page is up to date again.'],
    [429, 'Too many attempts. Wait a minute, then try again.'],
    [500, 'Something went wrong on our side. Please try again in a moment.'],
  ])('words an unseating’s %i', async (code, words) => {
    write('delete', '/events/e1/seats/g2', () => refusal(code));
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Unseat: Lusine Petrosyan' }));
    expect(await screen.findByText(words)).toBeInTheDocument();
    if (code === 500) expect(screen.getByText('Reference: r-500')).toBeInTheDocument();
  });

  it.each([
    ['Venue capacity is full', 'The venue is at its capacity: nobody more can be seated here.'],
    [
      'The table changed venue; reload the plan',
      'That table moved to another venue meanwhile. The page is up to date again.',
    ],
  ])('words a seat refused with “%s”', async (message, words) => {
    write('post', '/events/e1/seats', () => refusal(409, message));
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Seat: Davit Petrosyan' }));
    const dialog = await screen.findByRole('dialog', { name: 'Seat Davit Petrosyan' });
    await user.click(within(dialog).getByRole('button', { name: 'Seat' }));
    expect(await within(dialog).findByText(words)).toBeInTheDocument();
  });

  it('says a read-only role may not seat guests', async () => {
    write('post', '/events/e1/seats', () => refusal(403));
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Seat: Davit Petrosyan' }));
    const dialog = await screen.findByRole('dialog', { name: 'Seat Davit Petrosyan' });
    await user.click(within(dialog).getByRole('button', { name: 'Seat' }));
    expect(
      await within(dialog).findByText('Your role can see the seating but not seat guests.'),
    ).toBeInTheDocument();
  });
});

describe('automatic seating (PD-70)', () => {
  const done = jobWire({
    status: 'COMPLETED',
    attempts: 1,
    appliedRevision: 5,
    completedAt: '2027-06-01T08:00:03.000Z',
    result: {
      seated: 2,
      households: 1,
      unseated: [
        {
          householdId: 'h1',
          size: 1,
          reason: 'Needs 1 seat(s) at the table their household already sits at, which has 0 free',
          explanation: { code: 'SEATING_FAMILY_TABLE_FULL', userMessage: 'Backend words.' },
        },
        {
          householdId: 'h-gone',
          size: 2,
          reason: 'Every table is full',
          explanation: { code: 'SEATING_NEW', userMessage: 'Words for a new code.' },
        },
      ],
    },
  });

  it('starts with a new key for this plan, follows the run, then shows its result and reloads the tables', async () => {
    write('post', '/events/e1/seats/auto-assign', () => jobWire());
    serveJob(jobWire({ status: 'RUNNING', attempts: 1 }), done);
    const { user } = renderPage();
    await user.click(
      await screen.findByRole('button', { name: 'Seat everyone coming automatically' }),
    );
    const heading = await screen.findByRole('heading', { name: 'The result' });
    await waitFor(() => expect(heading).toHaveFocus());
    const panel = region('Automatic seating');
    expect(within(panel).getByText('Seated 2 guests in 1 household.')).toBeInTheDocument();
    expect(within(panel).getByText('These 2 households need a table:')).toBeInTheDocument();
    expect(within(panel).getByText(/Petrosyan family \(1 person\):/).textContent).toContain(
      'The table where this household already sits is full.',
    );
    expect(
      within(panel).getByText(/Household not on the list any more \(2 people\):/).textContent,
    ).toContain('Words for a new code.');
    expect(sent[0]?.path).toBe('/api/v1/events/e1/seats/auto-assign?arrangementId=a-hall');
    expect(sent[0]?.body).toEqual({
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
    });
    await waitFor(() => expect(tableReads).toBeGreaterThanOrEqual(2));
  });

  it('says it is trying again when something changed while planning', async () => {
    let reads = 0;
    current.wait = () => (reads++ < 2 ? Promise.resolve() : new Promise(() => undefined));
    write('post', '/events/e1/seats/auto-assign', () => jobWire());
    serveJob(
      jobWire({ status: 'RUNNING', attempts: 1 }),
      jobWire({ status: 'QUEUED', attempts: 1, failureReason: 'STATE_CHANGED' }),
    );
    const { user } = renderPage();
    await user.click(
      await screen.findByRole('button', { name: 'Seat everyone coming automatically' }),
    );
    expect(
      await screen.findByText(
        'Something changed while it was planning; trying again with the latest list (attempt 2 of 3)…',
      ),
    ).toBeInTheDocument();
  });

  it('words a failure by its code, and offers to run it again', async () => {
    write('post', '/events/e1/seats/auto-assign', () => jobWire());
    serveJob(
      jobWire({
        status: 'FAILED',
        attempts: 3,
        failureReason: 'STATE_CHANGED',
        recovery: { userMessage: 'x' },
      }),
    );
    const { user } = renderPage();
    await user.click(
      await screen.findByRole('button', { name: 'Seat everyone coming automatically' }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Automatic seating didn’t finish' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'The guest list or the tables kept changing while it was planning, so nothing was seated. Run it again.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run it again' })).toBeEnabled();
  });

  it('follows the run already going when a start is refused with 409, and starts none', async () => {
    write('post', '/events/e1/seats/auto-assign', () =>
      refusal(409, 'This arrangement already has an active seating job'),
    );
    const { user } = renderPage();
    await screen.findByRole('button', { name: 'Seat everyone coming automatically' });
    server.use(
      http.get(`${API}/events/e1/seating/jobs`, () =>
        HttpResponse.json([jobWire({ id: 'j7', status: 'RUNNING', attempts: 1 })]),
      ),
    );
    serveJob(done);
    await user.click(screen.getByRole('button', { name: 'Seat everyone coming automatically' }));
    expect(await screen.findByText('Seated 2 guests in 1 household.')).toBeInTheDocument();
    expect(sent.filter(({ method }) => method === 'POST')).toHaveLength(1);
  });

  it('words a start refused for another reason, with the backend’s sentence in English', async () => {
    write('post', '/events/e1/seats/auto-assign', () =>
      refusal(409, 'Archived events cannot start or apply automatic seating'),
    );
    const { user } = renderPage();
    await user.click(
      await screen.findByRole('button', { name: 'Seat everyone coming automatically' }),
    );
    expect(await screen.findByText('Automatic seating couldn’t start.')).toBeInTheDocument();
    expect(
      screen.getByText('Archived events cannot start or apply automatic seating'),
    ).toHaveAttribute('lang', 'en');
  });

  it('resumes a run still going when the page opens', async () => {
    server.use(
      http.get(`${API}/events/e1/seating/jobs`, () =>
        HttpResponse.json([jobWire({ id: 'j5', status: 'RUNNING', attempts: 1 })]),
      ),
    );
    serveJob(done);
    renderPage();
    expect(await screen.findByText('Seated 2 guests in 1 household.')).toBeInTheDocument();
    expect(sent).toEqual([]);
  });

  it('stops reading after a while, and reads again when asked', async () => {
    write('post', '/events/e1/seats/auto-assign', () => jobWire());
    serveJob(jobWire({ status: 'RUNNING', attempts: 1 }));
    const { user } = renderPage();
    await user.click(
      await screen.findByRole('button', { name: 'Seat everyone coming automatically' }),
    );
    expect(
      await screen.findByText(
        'Still running. It carries on without this page; check again in a moment.',
      ),
    ).toBeInTheDocument();
    serveJob(done);
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('Seated 2 guests in 1 household.')).toBeInTheDocument();
  });

  it('says a result is older than the tables shown', async () => {
    server.use(
      http.get(`${API}/events/e1/seating/jobs`, () =>
        HttpResponse.json([{ ...done, appliedRevision: 4, result: undefined }]),
      ),
    );
    serveJob({ ...done, appliedRevision: 4 });
    renderPage();
    expect(
      await screen.findByText(
        'The guest list or the seating has changed since this run. The tables below are the current ones.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Last run: 1 June 2027, 12:00')).toBeInTheDocument();
  });

  it('says a role without the right may not run it', async () => {
    write('post', '/events/e1/seats/auto-assign', () => refusal(403));
    const { user } = renderPage();
    await user.click(
      await screen.findByRole('button', { name: 'Seat everyone coming automatically' }),
    );
    expect(
      await screen.findByText('Your role can see the seating but not run automatic seating.'),
    ).toBeInTheDocument();
  });
});

describe('guests seeing their tables (PD-71)', () => {
  it('shows them, then takes them off, each said in the status line', async () => {
    let publishedAt: string | null = null;
    server.use(
      http.get(`${API}/events/e1`, () =>
        HttpResponse.json({ ...EVENT, seatingPublishedAt: publishedAt }),
      ),
    );
    write('post', '/events/e1/seating/publish', () => {
      publishedAt = '2027-06-10T09:00:00.000Z';
      return { seatingPublishedAt: publishedAt };
    });
    write('post', '/events/e1/seating/unpublish', () => {
      publishedAt = null;
      return { seatingPublishedAt: null };
    });
    const { user } = renderPage();
    expect(await screen.findByText('Guests don’t see their tables yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show guests their tables' }));
    expect(await screen.findByText('Guests now see their tables.')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Guests see their own household’s tables on their personal invitations since 10 June 2027, 13:00.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Take the tables off guests’ pages' }));
    expect(await screen.findByText('Guests no longer see their tables.')).toBeInTheDocument();
    expect(sent.map(({ path }) => path)).toEqual([
      '/api/v1/events/e1/seating/publish',
      '/api/v1/events/e1/seating/unpublish',
    ]);
  });

  it('says a role without the right may not change what guests see', async () => {
    write('post', '/events/e1/seating/publish', () => refusal(403));
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Show guests their tables' }));
    expect(
      await screen.findByText('Your role can see the seating but not change what guests see.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Guests now see their tables.')).toBeNull();
  });
});
