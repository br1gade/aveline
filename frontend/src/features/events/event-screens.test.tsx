import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useState, type ComponentType } from 'react';
import { renderToString } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, MemoryRouter, useParams } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/errors';
import { createBrowserSession, type BrowserSession } from '@/api/session';
import { createI18n } from '@/lib/i18n';

import { CreateEvent } from './components/create-event';
import { EditEvent } from './components/edit-event';
import { EventOverview } from './components/event-overview';
import { EventUnavailable } from './components/event-unavailable';
import type { EventOverviewData } from './load';
import type { EventDetail } from './types';

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

const EVENT: EventDetail = {
  id: 'e1',
  title: 'The wedding of Anna and Davit',
  type: 'WEDDING',
  hostsLabel: 'Anna & Davit',
  startsAt: '2027-06-12T11:00:00.000Z',
  endsAt: null,
  timezone: 'America/Los_Angeles',
  locales: ['en', 'hy'],
  defaultLocale: 'hy',
  invitation: { slug: 'anna-davit-3f8a1c20', status: 'DRAFT' },
};

/** Where the page sent the host. */
function EventPage() {
  return <p>{`Event page ${useParams().eventId ?? ''}`}</p>;
}

function renderAt(path: string, pattern: string, Page: ComponentType) {
  const Stub = createRoutesStub([
    { path: pattern, Component: Page },
    { path: '/app/events/:eventId', Component: EventPage },
  ]);
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={[path]} />
    </I18nextProvider>,
  );
  return userEvent.setup();
}

/** Records each request's JSON body, and answers with `response`. */
function answer(method: 'post' | 'patch', path: string, response: () => Response) {
  const received: unknown[] = [];
  server.use(
    http[method](`${API}${path}`, async ({ request }) => {
      received.push(await request.json());
      return response();
    }),
  );
  return received;
}

const refusal =
  (status: number, message: string | string[] = 'refused') =>
  () =>
    HttpResponse.json({ statusCode: status, message, requestId: 'req-1' }, { status });

/** Date and time inputs take their value whole, as a browser's picker gives it. */
async function typeWhen(date: string, time: string) {
  fireEvent.change(await screen.findByLabelText('Date'), { target: { value: date } });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: time } });
}

async function fillNewEvent(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(await screen.findByLabelText('Kind of event'), 'WEDDING');
  await user.type(screen.getByLabelText('Title'), 'The wedding of Anna and Davit');
  await typeWhen('2027-06-12', '15:00');
}

const submitCreate = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Create the event' }));

describe('CreateEvent', () => {
  const at = () => renderAt('/app/events/new', '/app/events/new', CreateEvent);

  it('starts in Yerevan, in Armenian, with no kind of event chosen', async () => {
    at();
    expect(await screen.findByLabelText('Kind of event')).toHaveValue('');
    expect(screen.getByLabelText('Time zone')).toHaveValue('Asia/Yerevan');
    expect(screen.getByRole('checkbox', { name: 'Հայերեն' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Հայերեն' })).toBeChecked();
  });

  it('checks the fields before sending anything', async () => {
    const received = answer('post', '/events', () => HttpResponse.json(EVENT, { status: 201 }));
    const user = at();
    await submitCreate(user);
    expect(await screen.findByText('Choose one.')).toBeInTheDocument();
    expect(screen.getAllByText('Fill this in.')).toHaveLength(3);
    expect(received).toEqual([]);
  });

  it('sends the time typed in Yerevan as UTC, then opens the new event', async () => {
    const received = answer('post', '/events', () => HttpResponse.json(EVENT, { status: 201 }));
    const user = at();
    await fillNewEvent(user);
    await user.click(screen.getByRole('checkbox', { name: 'English' }));
    await submitCreate(user);
    expect(await screen.findByText('Event page e1')).toBeInTheDocument();
    expect(received).toEqual([
      {
        type: 'WEDDING',
        title: 'The wedding of Anna and Davit',
        startsAt: '2027-06-12T11:00:00.000Z',
        timezone: 'Asia/Yerevan',
        locales: ['hy', 'en'],
        defaultLocale: 'hy',
      },
    ]);
  });

  it('refuses a time the clocks skip, without sending', async () => {
    const received = answer('post', '/events', () => HttpResponse.json(EVENT, { status: 201 }));
    const user = at();
    await fillNewEvent(user);
    await typeWhen('2027-03-28', '01:30');
    await user.selectOptions(screen.getByLabelText('Time zone'), 'Europe/London');
    await submitCreate(user);
    expect(await screen.findByText(/The clocks go forward at this time/)).toBeInTheDocument();
    expect(received).toEqual([]);
  });

  it('moves the default language when its own is unticked', async () => {
    const user = at();
    await user.click(await screen.findByRole('checkbox', { name: 'English' }));
    await user.click(screen.getByRole('checkbox', { name: 'Հայերեն' }));
    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked();
    expect(screen.queryByRole('radio', { name: 'Հայերեն' })).not.toBeInTheDocument();
  });

  it('puts a refused time zone under its field', async () => {
    answer(
      'post',
      '/events',
      refusal(400, ['timezone: "Asia/Nowhere" is not an IANA time zone, such as Asia/Yerevan']),
    );
    const user = at();
    await fillNewEvent(user);
    await submitCreate(user);
    expect(await screen.findByText('Choose a time zone from the list.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Some details weren’t accepted.');
  });

  it('explains a 403: the account cannot create events', async () => {
    answer('post', '/events', refusal(403));
    const user = at();
    await fillNewEvent(user);
    await submitCreate(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('This account can’t create events');
  });

  it('explains a 409: the event’s state changed underneath', async () => {
    answer('post', '/events', refusal(409));
    const user = at();
    await fillNewEvent(user);
    await submitCreate(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That can’t be done in the event’s current state.',
    );
  });

  it('asks the host to wait when rate-limited', async () => {
    answer('post', '/events', refusal(429));
    const user = at();
    await fillNewEvent(user);
    await submitCreate(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Wait a minute');
  });

  it('shows the reference when the server fails', async () => {
    answer('post', '/events', refusal(500));
    const user = at();
    await fillNewEvent(user);
    await submitCreate(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Reference: req-1');
  });

  it('posts, with its submit disabled, before the page is hydrated (PD-41)', () => {
    const html = renderToString(
      <I18nextProvider i18n={createI18n('en')}>
        <MemoryRouter>
          <CreateEvent />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(html).toContain('method="post"');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });
});

function overview(data: Partial<EventOverviewData> = {}) {
  const page = () => (
    <EventOverview
      data={{
        event: EVENT,
        headcount: {
          kind: 'ready',
          headcount: {
            invited: 412,
            households: 160,
            attending: 230,
            declined: 41,
            undecided: 12,
            pending: 129,
            responseRate: 69,
          },
        },
        ...data,
      }}
    />
  );
  renderAt('/app/events/e1/overview', '/app/events/:eventId/overview', page);
}

describe('EventOverview', () => {
  it('dates the event in its own zone, and names the zone', async () => {
    overview();
    expect(
      await screen.findByText('Saturday, 12 June 2027, 04:00 (America/Los Angeles)'),
    ).toBeInTheDocument();
  });

  it('lists the languages with the default marked, and the invitation', async () => {
    overview();
    expect(await screen.findByText('English, Հայերեն (default)')).toBeInTheDocument();
    expect(screen.getByText('Draft: guests can’t open it yet')).toBeInTheDocument();
    expect(screen.getByText('anna-davit-3f8a1c20')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit details' })).toHaveAttribute(
      'href',
      '/app/events/e1/edit',
    );
  });

  it('shows the headcount', async () => {
    overview();
    const numbers = await screen.findByRole('region', { name: 'Guests' });
    expect(numbers).toHaveTextContent('On the list412');
    expect(numbers).toHaveTextContent('Coming230');
    expect(numbers).toHaveTextContent('Answered69%');
  });

  it('says when there are no guests yet', async () => {
    overview({
      headcount: {
        kind: 'ready',
        headcount: {
          invited: 0,
          households: 0,
          attending: 0,
          declined: 0,
          undecided: 0,
          pending: 0,
          responseRate: 0,
        },
      },
    });
    expect(await screen.findByText('No guests on the list yet.')).toBeInTheDocument();
  });

  it('says when this role cannot see the numbers, and still shows the event', async () => {
    overview({ headcount: { kind: 'refused' } });
    expect(
      await screen.findByText('The guest numbers aren’t available to your role on this event.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: EVENT.title })).toBeInTheDocument();
  });

  it('says when the numbers failed to load, with the reference', async () => {
    overview({ headcount: { kind: 'failed', requestId: 'req-7' } });
    expect(await screen.findByText('Reference: req-7')).toBeInTheDocument();
  });

  it('says when the event has no invitation yet', async () => {
    overview({ event: { ...EVENT, invitation: null } });
    expect(await screen.findByText('No invitation yet.')).toBeInTheDocument();
  });
});

describe('EventUnavailable', () => {
  function show(error: unknown) {
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <MemoryRouter>
          <EventUnavailable error={error} />
        </MemoryRouter>
      </I18nextProvider>,
    );
  }

  it.each([403, 404])('reads the same for %i: missing and not yours look alike', (status) => {
    show(new ApiError({ status, messages: [], requestId: 'req-2' }));
    expect(screen.getByRole('heading', { name: 'This event isn’t available' })).toBeInTheDocument();
    expect(screen.queryByText(/Reference/)).not.toBeInTheDocument();
  });

  it('shows the reference for any other failure', () => {
    show(new ApiError({ status: 500, messages: [], requestId: 'req-3' }));
    expect(screen.getByText('Reference: req-3')).toBeInTheDocument();
  });
});

describe('EditEvent', () => {
  const at = () =>
    renderAt('/app/events/e1/edit', '/app/events/:eventId/edit', () => <EditEvent event={EVENT} />);
  const save = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole('button', { name: 'Save changes' }));
  const saved = (notice: object) => () =>
    HttpResponse.json({
      ...EVENT,
      notice: { isSuggested: false, changed: [], householdsInvited: 0, ...notice },
    });

  it('shows the start in the event’s own zone', async () => {
    at();
    expect(await screen.findByLabelText('Date')).toHaveValue('2027-06-12');
    expect(screen.getByLabelText('Time')).toHaveValue('04:00');
    expect(screen.getByLabelText('Time zone')).toHaveValue('America/Los_Angeles');
  });

  it('sends only what changed, then returns to the event', async () => {
    const received = answer('patch', '/events/e1', saved({}));
    const user = at();
    const title = await screen.findByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Anna and Davit');
    await save(user);
    expect(await screen.findByText('Event page e1')).toBeInTheDocument();
    expect(received).toEqual([{ title: 'Anna and Davit' }]);
  });

  it('sends nothing when nothing changed', async () => {
    const received = answer('patch', '/events/e1', saved({}));
    const user = at();
    await save(user);
    expect(await screen.findByText('Event page e1')).toBeInTheDocument();
    expect(received).toEqual([]);
  });

  it('offers to let guests know, and sends only when asked', async () => {
    const patched = answer(
      'patch',
      '/events/e1',
      saved({ isSuggested: true, changed: ['startsAt'], householdsInvited: 3 }),
    );
    const notified = answer('post', '/invitations/anna-davit-3f8a1c20/notify-changes', () =>
      HttpResponse.json({ queued: 3, alreadyNotified: 0, recipients: [], unreachable: [] }),
    );
    const user = at();
    await typeWhen('2027-07-03', '04:00');
    await save(user);
    expect(await screen.findByRole('heading', { name: 'Your changes are saved' })).toHaveFocus();
    expect(screen.getByText(/3 households already have the invitation/)).toBeInTheDocument();
    expect(patched).toEqual([{ startsAt: '2027-07-03T11:00:00.000Z' }]);
    expect(notified).toEqual([]);

    await user.type(
      screen.getByLabelText(/A note for your guests/),
      'We have moved to the garden.',
    );
    await user.click(screen.getByRole('button', { name: 'Let your guests know' }));
    expect(
      await screen.findByText('The update is on its way to 3 households.'),
    ).toBeInTheDocument();
    expect(notified).toEqual([{ note: 'We have moved to the garden.' }]);
    expect(screen.queryByRole('button', { name: 'Let your guests know' })).not.toBeInTheDocument();
  });

  it('sends nothing to guests when the host chooses "Not now"', async () => {
    answer('patch', '/events/e1', saved({ isSuggested: true, householdsInvited: 1 }));
    const notified = answer('post', '/invitations/anna-davit-3f8a1c20/notify-changes', () =>
      HttpResponse.json({ queued: 1, alreadyNotified: 0, recipients: [], unreachable: [] }),
    );
    const user = at();
    await user.selectOptions(await screen.findByLabelText('Time zone'), 'Europe/London');
    await save(user);
    expect(await screen.findByText(/1 household already has the invitation/)).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Not now' }));
    expect(await screen.findByText('Event page e1')).toBeInTheDocument();
    expect(notified).toEqual([]);
  });

  it('explains a 403: this role cannot change the details', async () => {
    answer('patch', '/events/e1', refusal(403));
    const user = at();
    await user.type(await screen.findByLabelText('Hosts'), '!');
    await save(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your role on this event can’t change its details.',
    );
  });

  it('sends no note when the host writes none', async () => {
    answer('patch', '/events/e1', saved({ isSuggested: true, householdsInvited: 2 }));
    const notified = answer('post', '/invitations/anna-davit-3f8a1c20/notify-changes', () =>
      HttpResponse.json({ queued: 2, alreadyNotified: 0, recipients: [], unreachable: [] }),
    );
    const user = at();
    await user.selectOptions(await screen.findByLabelText('Time zone'), 'Europe/London');
    await save(user);
    await user.click(await screen.findByRole('button', { name: 'Let your guests know' }));
    expect(
      await screen.findByText('The update is on its way to 2 households.'),
    ).toBeInTheDocument();
    expect(notified).toEqual([{}]);
  });

  it('says when nobody holds the invitation yet, and keeps the offer to try again', async () => {
    answer('patch', '/events/e1', saved({ isSuggested: true, householdsInvited: 2 }));
    answer(
      'post',
      '/invitations/anna-davit-3f8a1c20/notify-changes',
      refusal(400, 'This invitation has not been published, so nobody has it yet'),
    );
    const user = at();
    await user.selectOptions(await screen.findByLabelText('Time zone'), 'Europe/London');
    await save(user);
    await user.click(await screen.findByRole('button', { name: 'Let your guests know' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This invitation isn’t published yet, so no guest has it.',
    );
    expect(screen.getByRole('button', { name: 'Let your guests know' })).toBeInTheDocument();
  });

  it('compares with the event as the form first showed it, even after the page reloads', async () => {
    const received = answer('patch', '/events/e1', saved({}));
    // A reload of the page's data (a language switch, say) brings a title someone else changed.
    function Reloading() {
      const [event, setEvent] = useState(EVENT);
      return (
        <>
          <button type="button" onClick={() => setEvent({ ...EVENT, title: 'Renamed elsewhere' })}>
            Reload
          </button>
          <EditEvent key={event.id} event={event} />
        </>
      );
    }
    const user = renderAt('/app/events/e1/edit', '/app/events/:eventId/edit', Reloading);
    await user.click(await screen.findByRole('button', { name: 'Reload' }));
    await user.type(screen.getByLabelText('Hosts'), '!');
    await save(user);
    expect(await screen.findByText('Event page e1')).toBeInTheDocument();
    expect(received).toEqual([{ hostsLabel: 'Anna & Davit!' }]);
  });

  it('explains an end time it cannot change, at the date', async () => {
    answer('patch', '/events/e1', refusal(400, ['endsAt: must be after startsAt']));
    const user = at();
    await typeWhen('2027-08-01', '04:00');
    await save(user);
    await waitFor(() =>
      expect(screen.getByLabelText('Date')).toHaveAccessibleDescription(
        'The event’s end time is earlier than this, and it can’t be changed here yet.',
      ),
    );
  });
});
