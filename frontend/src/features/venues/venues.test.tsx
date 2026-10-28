import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { renderToString } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, MemoryRouter, useLoaderData } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import { getEvent, type EventDetail, type EventNotice } from '@/features/events';
import { createI18n } from '@/lib/i18n';

import { EditVenue, NewVenue } from './components/venue-pages';
import { VenueList } from './components/venue-list';
import { loadVenueEdit, loadVenueList, type VenueEditData, type VenueListData } from './load';
import type { VenueWire } from './types';

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

/** Made afresh for each test and put into every answer, to check it goes nowhere. */
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
  sideALabel: null,
  sideBLabel: null,
  invitation: { slug: 'anna-davit-3f8a1c20', status: 'PUBLISHED' },
};

const CHURCH: VenueWire = {
  id: 'v1',
  role: 'CEREMONY',
  name: 'Saint Hripsime Church',
  address: 'Mesrop Mashtots St, Vagharshapat',
  mapUrl: 'https://maps.example.com/?q=hripsime',
  arriveAt: '2027-06-12T10:30:00.000Z',
};

function venueList(): VenueWire[] {
  return [
    { ...CHURCH, token } as VenueWire,
    {
      id: 'v2',
      role: 'PREPARATION',
      name: 'Bride’s home',
      address: '5 Abovyan St, Yerevan',
      mapUrl: 'javascript:alert(1)',
      arriveAt: null,
    },
  ];
}

const QUIET: EventNotice = { isSuggested: false, changed: ['venues'], householdsInvited: 0 };

/** Serves the event and its venues, and counts each read of the list. */
function serve(venues: VenueWire[] = venueList()) {
  const reads = { venues: 0 };
  server.use(
    http.get(`${API}/events/e1`, () => HttpResponse.json(EVENT)),
    http.get(`${API}/events/e1/venues`, () => {
      reads.venues += 1;
      return HttpResponse.json(venues);
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

/** A write's answer: the venue, as the backend returns it, with its notice. */
const saved =
  (notice: EventNotice = QUIET, status = 200) =>
  () =>
    HttpResponse.json({ ...CHURCH, token, notice }, { status });

const refusal =
  (status: number, message: string | string[] = 'refused') =>
  () =>
    HttpResponse.json({ statusCode: status, message, requestId: 'req-1' }, { status });

function ListPage() {
  return <VenueList data={useLoaderData<VenueListData>()} />;
}
function NewPage() {
  return <NewVenue event={useLoaderData<EventDetail>()} />;
}
function EditPage() {
  return <EditVenue data={useLoaderData<VenueEditData>()} />;
}

function renderAt(path: string) {
  const Stub = createRoutesStub([
    {
      path: '/app/events/:eventId/venues',
      loader: ({ params }) => loadVenueList(session().api, params.eventId ?? ''),
      Component: ListPage,
    },
    {
      path: '/app/events/:eventId/venues/new',
      loader: ({ params }) => getEvent(session().api, params.eventId ?? ''),
      Component: NewPage,
    },
    {
      path: '/app/events/:eventId/venues/:venueId/edit',
      loader: ({ params }) =>
        loadVenueEdit(session().api, params.eventId ?? '', params.venueId ?? ''),
      Component: EditPage,
    },
    { path: '/app/events/:eventId', Component: () => <p>Event page</p> },
  ]);
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={[path]} />
    </I18nextProvider>,
  );
  return userEvent.setup();
}

/** Date and time inputs take their value whole, as a browser's picker gives it. */
function typeArrival(date: string, time: string) {
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: date } });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: time } });
}

async function fillNewVenue(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(await screen.findByLabelText('What happens there'), 'RECEPTION');
  await user.type(screen.getByLabelText('Name'), 'Garden Hall');
  await user.type(screen.getByLabelText('Address'), '12 Garden Lane, Yerevan');
}

const card = (name: string) => {
  const heading = screen.getByRole('heading', { name });
  const item = heading.closest('li');
  if (!item) throw new Error(`No card for ${name}`);
  return item;
};

describe('VenueList', () => {
  it('lists the venues in the order they came, each arrival in the event’s zone', async () => {
    serve();
    renderAt('/app/events/e1/venues');
    expect(await screen.findByRole('heading', { name: 'Venues' })).toBeInTheDocument();
    const names = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent);
    expect(names).toEqual(['Saint Hripsime Church', 'Bride’s home']);
    const church = card('Saint Hripsime Church');
    expect(church).toHaveTextContent('Ceremony');
    expect(church).toHaveTextContent('Mesrop Mashtots St, Vagharshapat');
    expect(church).toHaveTextContent(
      'Guests arrive at 14:30, Saturday, 12 June 2027 (Asia/Yerevan)',
    );
  });

  it('gives directions only through a web link, in a new tab, as the guest page does', async () => {
    serve();
    renderAt('/app/events/e1/venues');
    const directions = await within(await waitFor(() => card('Saint Hripsime Church'))).findByRole(
      'link',
      { name: /Directions/ },
    );
    expect(directions).toHaveAttribute('href', 'https://maps.example.com/?q=hripsime');
    expect(directions).toHaveAttribute('target', '_blank');
    expect(directions).toHaveAttribute('rel', 'noreferrer noopener');
    const home = card('Bride’s home');
    expect(within(home).queryByRole('link', { name: /Directions/ })).not.toBeInTheDocument();
    expect(home).toHaveTextContent('The map link isn’t a web address');
    expect(home).toHaveTextContent('Getting ready: not shown to guests');
  });

  it('never puts anything else the answer carried on the page', async () => {
    serve();
    renderAt('/app/events/e1/venues');
    await screen.findByRole('heading', { name: 'Venues' });
    expect(document.body.innerHTML).not.toContain(token);
  });

  it('says when there are no venues yet, and offers to add one', async () => {
    serve([]);
    renderAt('/app/events/e1/venues');
    expect(await screen.findByText('No venues yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a venue' })).toHaveAttribute(
      'href',
      '/app/events/e1/venues/new',
    );
  });
});

describe('Adding a venue', () => {
  it('sends the arrival typed in the event’s zone as UTC, then returns to the list', async () => {
    const reads = serve();
    const posted = answer('post', '/events/e1/venues', saved(QUIET, 201));
    const user = renderAt('/app/events/e1/venues/new');
    await fillNewVenue(user);
    await user.type(screen.getByLabelText('Map link (optional)'), 'https://maps.example.com/g');
    typeArrival('2027-06-12', '17:30');
    await user.click(screen.getByRole('button', { name: 'Add the venue' }));
    expect(await screen.findByRole('heading', { name: 'Venues' })).toBeInTheDocument();
    expect(posted).toEqual([
      {
        role: 'RECEPTION',
        name: 'Garden Hall',
        address: '12 Garden Lane, Yerevan',
        mapUrl: 'https://maps.example.com/g',
        arriveAt: '2027-06-12T13:30:00.000Z',
      },
    ]);
    expect(reads.venues).toBe(1);
  });

  it('checks the fields before sending anything', async () => {
    serve();
    const posted = answer('post', '/events/e1/venues', saved());
    const user = renderAt('/app/events/e1/venues/new');
    await user.type(await screen.findByLabelText('Map link (optional)'), 'maps.example.com/g');
    typeArrival('2027-06-12', '');
    await user.click(screen.getByRole('button', { name: 'Add the venue' }));
    expect(await screen.findByText('Choose one.')).toBeInTheDocument();
    expect(screen.getAllByText('Fill this in.')).toHaveLength(2);
    expect(screen.getByText(/Use a web address starting with https:\/\//)).toBeInTheDocument();
    expect(
      screen.getByText('Fill in both the date and the time, or leave both empty.'),
    ).toBeInTheDocument();
    expect(posted).toEqual([]);
  });

  it('puts a refused field under itself', async () => {
    serve();
    answer(
      'post',
      '/events/e1/venues',
      refusal(400, ['name must be shorter than or equal to 160 characters']),
    );
    const user = renderAt('/app/events/e1/venues/new');
    await fillNewVenue(user);
    await user.click(screen.getByRole('button', { name: 'Add the venue' }));
    expect(
      await screen.findByText('Some details weren’t accepted. Check them and try again.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription(
      expect.stringContaining('This wasn’t accepted. Check it.'),
    );
  });

  it.each([
    [403, 'Your role on this event can’t change its venues.'],
    [429, 'Too many attempts. Wait a minute, then try again.'],
    [500, 'Something went wrong on our side.'],
  ])('explains a %i', async (status, words) => {
    serve();
    answer('post', '/events/e1/venues', refusal(status));
    const user = renderAt('/app/events/e1/venues/new');
    await fillNewVenue(user);
    await user.click(screen.getByRole('button', { name: 'Add the venue' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(words);
    if (status === 500) expect(alert).toHaveTextContent('Reference: req-1');
  });

  it('offers to let guests know when they hold the invitation, and sends only when asked', async () => {
    serve();
    answer(
      'post',
      '/events/e1/venues',
      saved({ isSuggested: true, changed: ['venues'], householdsInvited: 12 }, 201),
    );
    const notified = answer('post', '/invitations/anna-davit-3f8a1c20/notify-changes', () =>
      HttpResponse.json({ queued: 12, alreadyNotified: 0, recipients: [], unreachable: [] }),
    );
    const user = renderAt('/app/events/e1/venues/new');
    await fillNewVenue(user);
    await user.click(screen.getByRole('button', { name: 'Add the venue' }));
    expect(await screen.findByRole('heading', { name: 'Your changes are saved' })).toHaveFocus();
    expect(notified).toEqual([]);
    await user.type(screen.getByLabelText(/A note for your guests/), 'A new hall for dinner.');
    await user.click(screen.getByRole('button', { name: 'Let your guests know' }));
    expect(
      await screen.findByText('The update is on its way to 12 households.'),
    ).toBeInTheDocument();
    expect(notified).toEqual([{ note: 'A new hall for dinner.' }]);
    expect(screen.getByRole('link', { name: 'Back to the venues' })).toHaveAttribute(
      'href',
      '/app/events/e1/venues',
    );
  });

  it('posts, with its submit disabled, before the page is hydrated (PD-41)', () => {
    const html = renderToString(
      <I18nextProvider i18n={createI18n('en')}>
        <MemoryRouter>
          <NewVenue event={EVENT} />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(html).toContain('method="post"');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });
});

describe('Correcting a venue', () => {
  it('shows the venue as stored, its arrival in the event’s zone', async () => {
    serve();
    renderAt('/app/events/e1/venues/v1/edit');
    expect(await screen.findByLabelText('Name')).toHaveValue('Saint Hripsime Church');
    expect(screen.getByLabelText('What happens there')).toHaveValue('CEREMONY');
    expect(screen.getByLabelText('Date')).toHaveValue('2027-06-12');
    expect(screen.getByLabelText('Time')).toHaveValue('14:30');
  });

  it('sends only what changed, then returns to the list', async () => {
    serve();
    const patched = answer('patch', '/events/e1/venues/v1', saved());
    const user = renderAt('/app/events/e1/venues/v1/edit');
    const address = await screen.findByLabelText('Address');
    await user.clear(address);
    await user.type(address, '1 Church Square, Vagharshapat');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('heading', { name: 'Venues' })).toBeInTheDocument();
    expect(patched).toEqual([{ address: '1 Church Square, Vagharshapat' }]);
  });

  it('clears the map link and the arrival with null', async () => {
    serve();
    const patched = answer('patch', '/events/e1/venues/v1', saved());
    const user = renderAt('/app/events/e1/venues/v1/edit');
    await user.clear(await screen.findByLabelText('Map link (optional)'));
    typeArrival('', '');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByRole('heading', { name: 'Venues' });
    expect(patched).toEqual([{ mapUrl: null, arriveAt: null }]);
  });

  it('sends nothing when nothing changed', async () => {
    serve();
    const patched = answer('patch', '/events/e1/venues/v1', saved());
    const user = renderAt('/app/events/e1/venues/v1/edit');
    await screen.findByLabelText('Name');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('heading', { name: 'Venues' })).toBeInTheDocument();
    expect(patched).toEqual([]);
  });

  it('says when the venue is no longer on the event', async () => {
    serve();
    renderAt('/app/events/e1/venues/v9/edit');
    expect(
      await screen.findByRole('heading', { name: 'This venue is no longer on the event' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the venues' })).toHaveAttribute(
      'href',
      '/app/events/e1/venues',
    );
  });

  it('explains a venue removed while the form was open', async () => {
    serve();
    answer('patch', '/events/e1/venues/v1', refusal(404, 'No such venue on this event'));
    const user = renderAt('/app/events/e1/venues/v1/edit');
    await user.type(await screen.findByLabelText('Name'), ' (old)');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This venue is no longer on the event.',
    );
  });
});

describe('Removing a venue', () => {
  it('asks first, then removes it, reloads the list and says so with the focus', async () => {
    const venues = venueList();
    const reads = serve(venues);
    const removed = answer('delete', '/events/e1/venues/v2', () => {
      venues.splice(1, 1);
      return HttpResponse.json({ ok: true, notice: QUIET });
    });
    const user = renderAt('/app/events/e1/venues');
    await user.click(await screen.findByRole('button', { name: 'Remove: Bride’s home' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Guests will no longer see it on the invitation.');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    const status = await screen.findByText('Bride’s home was removed.');
    await waitFor(() => expect(status).toHaveFocus());
    expect(removed).toEqual(['deleted']);
    expect(reads.venues).toBe(2);
    expect(screen.queryByRole('heading', { name: 'Bride’s home' })).not.toBeInTheDocument();
  });

  it('removes nothing when the host cancels', async () => {
    serve();
    const removed = answer('delete', '/events/e1/venues/v1', () =>
      HttpResponse.json({ ok: true, notice: QUIET }),
    );
    const user = renderAt('/app/events/e1/venues');
    const opener = await screen.findByRole('button', { name: 'Remove: Saint Hripsime Church' });
    await user.click(opener);
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(opener).toHaveFocus());
    expect(removed).toEqual([]);
  });

  it('explains a venue still in use, with the backend’s own words in English', async () => {
    serve();
    answer(
      'delete',
      '/events/e1/venues/v1',
      refusal(
        400,
        '2 timeline entr(ies) and 0 table(s) still point at this venue; move them first',
      ),
    );
    const user = renderAt('/app/events/e1/venues');
    await user.click(await screen.findByRole('button', { name: 'Remove: Saint Hripsime Church' }));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('can’t be removed while the running order or a table');
    const english = within(alert).getByText(/still point at this venue/);
    expect(english).toHaveAttribute('lang', 'en');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('explains a 403', async () => {
    serve();
    answer('delete', '/events/e1/venues/v1', refusal(403));
    const user = renderAt('/app/events/e1/venues');
    await user.click(await screen.findByRole('button', { name: 'Remove: Saint Hripsime Church' }));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your role on this event can’t change its venues.',
    );
  });

  it('offers to let guests know in place of the list, and goes back to it on “Not now”', async () => {
    serve();
    const notified = answer('post', '/invitations/anna-davit-3f8a1c20/notify-changes', () =>
      HttpResponse.json({ queued: 1, alreadyNotified: 0, recipients: [], unreachable: [] }),
    );
    answer('delete', '/events/e1/venues/v1', () =>
      HttpResponse.json({
        ok: true,
        notice: { isSuggested: true, changed: ['venues'], householdsInvited: 40 },
      }),
    );
    const user = renderAt('/app/events/e1/venues');
    await user.click(await screen.findByRole('button', { name: 'Remove: Saint Hripsime Church' }));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('heading', { name: 'Your changes are saved' })).toHaveFocus();
    expect(screen.getByText(/40 households already have the invitation/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    const status = await screen.findByText('Saint Hripsime Church was removed.');
    await waitFor(() => expect(status).toHaveFocus());
    expect(notified).toEqual([]);
  });
});
