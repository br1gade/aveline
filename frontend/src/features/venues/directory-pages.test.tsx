import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData, useRevalidator } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import { createI18n } from '@/lib/i18n';
import { guardedRoutes, isLeavingAsked } from '@/ui/app-form/guarded-routes';

import { VenueDirectoryPage } from './components/directory-page';
import { NewVenue } from './components/venue-pages';
import { loadDirectoryPage, loadNewVenue, type DirectoryPageData, type NewVenueData } from './load';

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

const GRAND = {
  id: 'p1',
  name: 'Grand Hall',
  address: '1 Abovyan Street',
  city: 'Yerevan',
  capacity: 300,
  vendorId: 'v1',
  vendor: { id: 'v1', name: 'Hall Group' },
};
const SMALL = {
  id: 'p2',
  name: 'Small Hall',
  address: '2 Tumanyan Street',
  city: null,
  capacity: null,
  vendorId: null,
  vendor: null,
};

const VENDORS = [
  { id: 'v1', name: 'Hall Group', category: 'VENUE', isCurated: true, email: 'hg@example.am' },
  { id: 'v2', name: 'Other Halls', category: 'VENUE', isCurated: true },
  { id: 'v3', name: 'Private Hall', category: 'VENUE', isCurated: false },
  { id: 'v4', name: 'A Caterer', category: 'CATERING', isCurated: true },
];

const refused =
  (status: number, message = 'refused') =>
  () =>
    HttpResponse.json({ statusCode: status, message, requestId: 'req-1' }, { status });

function serve({
  directory = () => HttpResponse.json([GRAND, SMALL]),
  vendors = () => HttpResponse.json(VENDORS),
}: { directory?: () => Response; vendors?: () => Response } = {}) {
  const reads = { directory: 0 };
  server.use(
    http.get(`${API}/events/e1`, () =>
      HttpResponse.json({
        id: 'e1',
        title: 'The wedding',
        type: 'WEDDING',
        hostsLabel: 'Anna',
        startsAt: '2027-06-12T11:00:00.000Z',
        endsAt: null,
        timezone: 'Asia/Yerevan',
        locales: ['en'],
        defaultLocale: 'en',
        sideALabel: null,
        sideBLabel: null,
        invitation: null,
      }),
    ),
    http.get(`${API}/events/e1/venue-profiles`, () => {
      reads.directory += 1;
      return directory();
    }),
    http.get(`${API}/vendors`, vendors),
  );
  return reads;
}

function DirectoryRoute() {
  return <VenueDirectoryPage data={useLoaderData<DirectoryPageData>()} />;
}

function NewRoute() {
  const data = useLoaderData<NewVenueData>();
  const { revalidate } = useRevalidator();
  return (
    <NewVenue
      event={data.event}
      directory={data.directory}
      onHallRetired={() => void revalidate()}
    />
  );
}

function renderDirectory() {
  const Stub = createRoutesStub([
    {
      path: '/app/events/:eventId/venues/directory',
      loader: ({ params }) => loadDirectoryPage(session().api, params.eventId ?? ''),
      Component: DirectoryRoute,
    },
  ]);
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={['/app/events/e1/venues/directory']} />
    </I18nextProvider>,
  );
  return userEvent.setup();
}

function renderNew() {
  const Stub = createRoutesStub(
    guardedRoutes([
      {
        path: '/app/events/:eventId/venues/new',
        loader: ({ params }) => loadNewVenue(session().api, params.eventId ?? ''),
        Component: NewRoute,
      },
      { path: '/app/events/:eventId/venues', Component: () => <p>The venues</p> },
    ]),
  );
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={['/app/events/e1/venues/new']} />
    </I18nextProvider>,
  );
  return userEvent.setup();
}

const NOTICE = { isSuggested: false, changed: ['venues'], householdsInvited: 0 };

describe('starting a venue from the directory', () => {
  const picker = () => screen.findByLabelText('Start from the directory (optional)');

  it('fills the name and address, says who runs it, and sends the hall’s id', async () => {
    serve();
    const received: unknown[] = [];
    server.use(
      http.post(`${API}/events/e1/venues`, async ({ request }) => {
        received.push(await request.json());
        return HttpResponse.json({ id: 'x', notice: NOTICE }, { status: 201 });
      }),
    );
    const user = renderNew();
    await user.selectOptions(await picker(), 'Grand Hall');
    expect(screen.getByLabelText('Name')).toHaveValue('Grand Hall');
    expect(screen.getByLabelText('Address')).toHaveValue('1 Abovyan Street');
    expect(screen.getByText(/Run by Hall Group · 300 guests/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('What happens there'), 'RECEPTION');
    const add = screen.getByRole('button', { name: 'Add the venue' });
    await waitFor(() => expect(add).toBeEnabled());
    await user.click(add);
    expect(await screen.findByText('The venues')).toBeInTheDocument();
    expect(received).toEqual([
      {
        role: 'RECEPTION',
        name: 'Grand Hall',
        address: '1 Abovyan Street',
        profileId: 'p1',
      },
    ]);
  });

  it('asks before the page is left once a hall filled the form in', async () => {
    serve();
    const user = renderNew();
    await user.selectOptions(await picker(), 'Grand Hall');
    await waitFor(() => expect(isLeavingAsked()).toBe(true));
  });

  it('groups halls by city, and one with none apart', async () => {
    serve();
    renderNew();
    const select = await picker();
    expect(within(select).getByRole('group', { name: 'Yerevan' })).toHaveTextContent('Grand Hall');
    expect(within(select).getByRole('group', { name: 'No city set' })).toHaveTextContent(
      'Small Hall',
    );
  });

  it('shows nothing when the directory is empty, as it is after seeding', async () => {
    serve({ directory: () => HttpResponse.json([]) });
    renderNew();
    expect(await screen.findByLabelText('Name')).toBeInTheDocument();
    expect(screen.queryByLabelText('Start from the directory (optional)')).not.toBeInTheDocument();
  });

  it('leaves the form usable when the directory can’t be read', async () => {
    serve({ directory: refused(500) });
    renderNew();
    expect(await screen.findByText(/req-1/)).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });

  it('drops the choice and reads the directory again when the hall was retired meanwhile', async () => {
    const reads = serve();
    server.use(
      http.post(`${API}/events/e1/venues`, refused(404, 'No such venue in the directory')),
    );
    const user = renderNew();
    await user.selectOptions(await picker(), 'Grand Hall');
    await user.selectOptions(screen.getByLabelText('What happens there'), 'RECEPTION');
    const add = screen.getByRole('button', { name: 'Add the venue' });
    await waitFor(() => expect(add).toBeEnabled());
    await user.click(add);
    expect(await screen.findByRole('alert')).toHaveTextContent('has left the directory');
    await waitFor(() => expect(reads.directory).toBe(2));
    expect(await picker()).toHaveValue('');
    expect(screen.getByLabelText('Name')).toHaveValue('Grand Hall');
  });
});

describe('the directory’s own page', () => {
  it('says it is staff-only, and lists each hall and its operator', async () => {
    serve();
    renderDirectory();
    expect(
      await screen.findByText(/only they can add, correct or retire a hall/),
    ).toBeInTheDocument();
    expect(screen.getByText('Grand Hall')).toBeInTheDocument();
    expect(screen.getByText('Yerevan · 300 guests · Run by Hall Group')).toBeInTheDocument();
    expect(screen.getByText('No city set · No operator')).toBeInTheDocument();
  });

  it('says so when it is empty', async () => {
    serve({ directory: () => HttpResponse.json([]) });
    renderDirectory();
    expect(await screen.findByText('The directory has no halls yet.')).toBeInTheDocument();
  });

  it('offers a customer every change, and words the 403 (FR-6)', async () => {
    serve();
    server.use(http.post(`${API}/venue-profiles`, refused(403)));
    const user = renderDirectory();
    await user.click(await screen.findByRole('button', { name: 'Add a hall' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'New Hall');
    await user.type(within(dialog).getByLabelText('Address'), '3 Street');
    const save = within(dialog).getByRole('button', { name: 'Save' });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Only Aveline staff can change the directory.',
    );
  });

  it('adds a hall, offering only who the backend accepts to run it', async () => {
    const reads = serve();
    const received: unknown[] = [];
    server.use(
      http.post(`${API}/venue-profiles`, async ({ request }) => {
        received.push(await request.json());
        return HttpResponse.json({ id: 'p3' }, { status: 201 });
      }),
    );
    const user = renderDirectory();
    await user.click(await screen.findByRole('button', { name: 'Add a hall' }));
    const dialog = await screen.findByRole('dialog');
    const operator = within(dialog).getByLabelText('Who runs it (optional)');
    expect(
      within(operator)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['No operator', 'Hall Group', 'Other Halls']);
    await user.type(within(dialog).getByLabelText('Name'), 'New Hall');
    await user.type(within(dialog).getByLabelText('Address'), '3 Street');
    await user.type(within(dialog).getByLabelText('How many guests it holds (optional)'), '120');
    await user.selectOptions(operator, 'Other Halls');
    const save = within(dialog).getByRole('button', { name: 'Save' });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);
    expect(await screen.findByText('New Hall is in the directory.')).toBeInTheDocument();
    expect(received).toEqual([
      { name: 'New Hall', address: '3 Street', capacity: 120, vendorId: 'v2' },
    ]);
    expect(reads.directory).toBe(2);
    expect(document.body.innerHTML).not.toContain('hg@example.am');
  });

  it('unlinks an operator with null, sending nothing else', async () => {
    serve();
    const received: unknown[] = [];
    server.use(
      http.patch(`${API}/venue-profiles/p1`, async ({ request }) => {
        received.push(await request.json());
        return HttpResponse.json({ id: 'p1' });
      }),
    );
    const user = renderDirectory();
    await user.click(await screen.findByRole('button', { name: 'Edit Grand Hall' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(
      within(dialog).getByLabelText('Who runs it (optional)'),
      'No operator',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Grand Hall is saved.')).toBeInTheDocument();
    expect(received).toEqual([{ vendorId: null }]);
  });

  it('sends nothing when nothing changed', async () => {
    serve();
    const received: unknown[] = [];
    server.use(
      http.patch(`${API}/venue-profiles/p1`, () => {
        received.push('x');
        return HttpResponse.json({});
      }),
    );
    const user = renderDirectory();
    await user.click(await screen.findByRole('button', { name: 'Edit Grand Hall' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(received).toEqual([]);
  });

  it('refuses emptying a city once set', async () => {
    serve();
    const user = renderDirectory();
    await user.click(await screen.findByRole('button', { name: 'Edit Grand Hall' }));
    const dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByLabelText('City (optional)'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      await within(dialog).findByText('Once set, this can be changed but not emptied.'),
    ).toBeInTheDocument();
  });

  it('says a role that can’t read the vendors leaves the operator as it is', async () => {
    serve({ vendors: refused(403) });
    const user = renderDirectory();
    await user.click(await screen.findByRole('button', { name: 'Edit Grand Hall' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/who runs this hall stays as it is/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Who runs it (optional)')).not.toBeInTheDocument();
  });

  it('retires after asking, saying it can’t be brought back', async () => {
    const reads = serve();
    const received: unknown[] = [];
    server.use(
      http.patch(`${API}/venue-profiles/p1`, async ({ request }) => {
        received.push(await request.json());
        return HttpResponse.json({ id: 'p1' });
      }),
    );
    const user = renderDirectory();
    await user.click(await screen.findByRole('button', { name: 'Retire Grand Hall' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('can’t be brought back');
    expect(received).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Retire' }));
    expect(await screen.findByText('Grand Hall is retired.')).toBeInTheDocument();
    expect(received).toEqual([{ isActive: false }]);
    expect(reads.directory).toBe(2);
  });

  it.each([
    [
      refused(400, 'vendorId: choose an active curated VENUE vendor'),
      'can’t run a hall any more',
      2,
    ],
    [refused(404, 'No such venue in the directory'), 'no longer in the directory', 2],
    [() => HttpResponse.error(), 'No answer came.', 1],
  ])('words refusal %#', async (response, words, directoryReads) => {
    const reads = serve();
    server.use(http.patch(`${API}/venue-profiles/p1`, response));
    const user = renderDirectory();
    await user.click(await screen.findByRole('button', { name: 'Edit Grand Hall' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(
      within(dialog).getByLabelText('Who runs it (optional)'),
      'Other Halls',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(words);
    await waitFor(() => expect(reads.directory).toBe(directoryReads));
  });
});

describe('the picker, once used', () => {
  const picker = () => screen.findByLabelText('Start from the directory (optional)');

  async function submit(user: ReturnType<typeof userEvent.setup>) {
    await user.selectOptions(screen.getByLabelText('What happens there'), 'RECEPTION');
    const add = screen.getByRole('button', { name: 'Add the venue' });
    await waitFor(() => expect(add).toBeEnabled());
    await user.click(add);
  }

  it('names no hall after going back to none, and keeps what was filled in', async () => {
    serve();
    const received: Array<Record<string, unknown>> = [];
    server.use(
      http.post(`${API}/events/e1/venues`, async ({ request }) => {
        received.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ id: 'x', notice: NOTICE }, { status: 201 });
      }),
    );
    const user = renderNew();
    await user.selectOptions(await picker(), 'Grand Hall');
    await user.selectOptions(await picker(), 'Don’t use the directory');
    expect(screen.queryByText(/Run by/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Grand Hall');
    await submit(user);
    await screen.findByText('The venues');
    expect(received[0]).toMatchObject({ name: 'Grand Hall' });
    expect(received[0]).not.toHaveProperty('profileId');
  });

  it('keeps the hall through any other refusal, and doesn’t read the directory again', async () => {
    const reads = serve();
    server.use(http.post(`${API}/events/e1/venues`, refused(403)));
    const user = renderNew();
    await user.selectOptions(await picker(), 'Grand Hall');
    await submit(user);
    await screen.findByRole('alert');
    expect(await picker()).toHaveValue('p1');
    expect(reads.directory).toBe(1);
  });

  it('clears the name and address’s errors when a hall fills them in', async () => {
    serve();
    const user = renderNew();
    await picker();
    await submit(user);
    expect((await screen.findAllByText('Fill this in.')).length).toBeGreaterThan(1);
    await user.selectOptions(await picker(), 'Grand Hall');
    await waitFor(() => expect(screen.queryByText('Fill this in.')).not.toBeInTheDocument());
  });

  it('says a role refused the directory can type the venue in', async () => {
    serve({ directory: refused(403) });
    renderNew();
    expect(await screen.findByText(/Type the venue in below/)).toBeInTheDocument();
  });
});

describe('the directory’s page, when its read fails', () => {
  it('says a refused read is refused, never that the role can read it', async () => {
    serve({ directory: refused(403) });
    renderDirectory();
    expect(await screen.findByText(/can’t read the directory/)).toBeInTheDocument();
    expect(screen.queryByText(/can read it/)).not.toBeInTheDocument();
  });

  it('gives a failed read’s reference', async () => {
    serve({ directory: refused(500) });
    renderDirectory();
    expect(await screen.findByText(/req-1/)).toBeInTheDocument();
  });
});

describe('a refused retirement', () => {
  async function retire(response: () => Response) {
    const reads = serve();
    server.use(http.patch(`${API}/venue-profiles/p1`, response));
    const user = renderDirectory();
    await user.click(await screen.findByRole('button', { name: 'Retire Grand Hall' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Retire' }));
    return { dialog, reads };
  }

  it('words a customer’s 403, and lets them press again', async () => {
    const { dialog, reads } = await retire(refused(403));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Only Aveline staff can change the directory.',
    );
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Retire' })).toBeEnabled(),
    );
    expect(reads.directory).toBe(1);
  });

  it('reloads when the hall had already gone', async () => {
    const { dialog, reads } = await retire(refused(404, 'No such venue in the directory'));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'no longer in the directory',
    );
    await waitFor(() => expect(reads.directory).toBe(2));
  });
});

describe('correcting a hall', () => {
  async function openEdit() {
    const user = renderDirectory();
    await user.click(await screen.findByRole('button', { name: 'Edit Grand Hall' }));
    return { user, dialog: await screen.findByRole('dialog') };
  }

  it('starts from what the hall holds', async () => {
    serve();
    const { dialog } = await openEdit();
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Grand Hall');
    expect(within(dialog).getByLabelText('City (optional)')).toHaveValue('Yerevan');
    expect(within(dialog).getByLabelText('How many guests it holds (optional)')).toHaveValue('300');
    expect(within(dialog).getByLabelText('Who runs it (optional)')).toHaveValue('v1');
  });

  it('drops an operator the server refused, rather than sending it again', async () => {
    let isFirst = true;
    const received: unknown[] = [];
    serve();
    server.use(
      http.patch(`${API}/venue-profiles/p1`, async ({ request }) => {
        received.push(await request.json());
        if (isFirst) {
          isFirst = false;
          return refused(400, 'vendorId: choose an active curated VENUE vendor')();
        }
        return HttpResponse.json({ id: 'p1' });
      }),
    );
    const { user, dialog } = await openEdit();
    await user.selectOptions(
      within(dialog).getByLabelText('Who runs it (optional)'),
      'Other Halls',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await within(dialog).findByRole('alert');
    expect(within(dialog).getByLabelText('Who runs it (optional)')).toHaveValue('');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await screen.findByText('Grand Hall is saved.');
    expect(received).toEqual([{ vendorId: 'v2' }, { vendorId: null }]);
  });

  it('moves the focus to the status line, not the opener still on the page, after a save', async () => {
    serve();
    server.use(http.patch(`${API}/venue-profiles/p1`, () => HttpResponse.json({ id: 'p1' })));
    const { user, dialog } = await openEdit();
    await user.selectOptions(
      within(dialog).getByLabelText('Who runs it (optional)'),
      'Other Halls',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    const status = await screen.findByText('Grand Hall is saved.');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Radix moves the focus on the tick after it closes: past that, nothing can steal it.
    await act(() => new Promise((resolve) => setTimeout(resolve)));
    expect(status).toHaveFocus();
  });

  it('returns the focus to the button that opened it when cancelled', async () => {
    serve();
    const { user, dialog } = await openEdit();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit Grand Hall' })).toHaveFocus(),
    );
  });

  it('can’t be dismissed while saving, so a refusal is never lost', async () => {
    serve();
    let release = () => undefined as void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.patch(`${API}/venue-profiles/p1`, async () => {
        await held;
        return refused(403)();
      }),
    );
    const { user, dialog } = await openEdit();
    await user.clear(within(dialog).getByLabelText('Name'));
    await user.type(within(dialog).getByLabelText('Name'), 'Great Hall');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled(),
    );
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    release();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Only Aveline staff');
  });
});
