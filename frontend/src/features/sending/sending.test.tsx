import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData, useLocation } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import type { EventDetail, InvitationStatus } from '@/features/events';
import { createI18n } from '@/lib/i18n';

import { InvitationPage } from './components/invitation-page';
import { loadInvitationPage, type InvitationPageData } from './load';
import type { DeliveryWire, SendResultWire } from './types';

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

const VENUE = 'Add a venue with an address, so guests know where to go';
const STARTED = 'This event has already started; an invitation now would arrive late';

function event(status: InvitationStatus | null, lifetime: Lifetime = {}): EventDetail {
  return {
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
    invitation: status ? { slug: SLUG, status, ...lifetime } : null,
  };
}

/** The invitation's time, as the event detail carries it since `eb77cd4`. */
interface Lifetime {
  expiresAt?: string | null;
  isExpired?: boolean;
}

function report(overrides: Partial<DeliveryWire> = {}): DeliveryWire {
  return {
    invited: 0,
    notSent: 3,
    unreachable: [
      { householdId: 'h4', householdName: 'No Contact', reason: 'No email address for anyone' },
    ],
    households: [],
    ...overrides,
  };
}

function sendResult(overrides: Partial<SendResultWire> = {}): SendResultWire {
  return {
    queued: 2,
    alreadySent: 0,
    recipients: [
      { householdName: 'Petrosyan family', toAddress: 'armen@example.am', channel: 'EMAIL' },
      { householdName: 'Hakobyan', toAddress: '123456789', channel: 'TELEGRAM' },
    ],
    suppressed: [{ householdName: 'Sargsyan', toAddress: 'ani@example.am' }],
    unreachable: [
      {
        householdId: 'h4',
        householdName: 'No Contact',
        reason: 'No email address for anyone in this household',
      },
    ],
    ...overrides,
  };
}

interface Served {
  status: InvitationStatus | null;
  blockers: string[];
  delivery: DeliveryWire | (() => Response);
  lifetime: Lifetime;
}

/** A stateful backend: publishing, closing and reopening move the invitation it serves. */
function serve(initial: Partial<Served> = {}) {
  const state: Served = {
    status: 'DRAFT',
    blockers: [],
    delivery: report(),
    lifetime: {},
    ...initial,
  };
  const reads = { event: 0, design: 0, delivery: 0 };
  server.use(
    http.get(`${API}/events/e1`, () => {
      reads.event += 1;
      return HttpResponse.json(event(state.status, state.lifetime));
    }),
    http.get(`${API}/invitations/${SLUG}/design`, () => {
      reads.design += 1;
      return HttpResponse.json({
        slug: SLUG,
        status: state.status,
        publishBlockers: state.blockers,
        blocks: [{ type: 'RSVP', enabled: true, content: { en: { token } } }],
      });
    }),
    http.get(`${API}/invitations/${SLUG}/delivery`, () => {
      reads.delivery += 1;
      const { delivery } = state;
      return typeof delivery === 'function' ? delivery() : HttpResponse.json(delivery);
    }),
  );
  const move = (to: InvitationStatus) => () => {
    state.status = to;
    return HttpResponse.json({ slug: SLUG, status: to }, { status: 201 });
  };
  return { state, reads, move };
}

/** Records each request's JSON body, and answers with `response`. */
function answer(path: string, response: () => Response) {
  const received: unknown[] = [];
  server.use(
    http.post(`${API}${path}`, async ({ request }) => {
      const text = await request.text();
      received.push(text ? (JSON.parse(text) as unknown) : null);
      return response();
    }),
  );
  return received;
}

const refusal =
  (status: number, message: string | string[] = 'refused') =>
  () =>
    HttpResponse.json({ statusCode: status, message, requestId: 'req-1' }, { status });

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function Page() {
  return <InvitationPage data={useLoaderData<InvitationPageData>()} />;
}

function renderPage(language: 'en' | 'ru' = 'en') {
  const Stub = createRoutesStub([
    {
      path: '/app/events/:eventId/invitation',
      loader: ({ params }) => loadInvitationPage(session().api, params.eventId ?? ''),
      Component: Page,
    },
    { path: '/app/events/:eventId/guests', Component: Where },
    { path: '/app/events/:eventId/venues/new', Component: Where },
  ]);
  render(
    <I18nextProvider i18n={createI18n(language)}>
      <Stub initialEntries={['/app/events/e1/invitation']} />
    </I18nextProvider>,
  );
  return userEvent.setup();
}

const publishButton = () => screen.findByRole('button', { name: 'Publish the invitation' });

describe('InvitationPage: a draft', () => {
  it('says everything that blocks publishing at once, with the way to fix each', async () => {
    serve({ blockers: [VENUE, STARTED] });
    renderPage();
    expect(await screen.findByText('Before you can publish:')).toBeInTheDocument();
    expect(
      screen.getByText('Add a venue with an address, so guests know where to go.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a venue' })).toHaveAttribute(
      'href',
      '/app/events/e1/venues/new',
    );
    expect(screen.getByRole('link', { name: 'Edit the details' })).toHaveAttribute(
      'href',
      '/app/events/e1/edit',
    );
    expect(await publishButton()).toBeDisabled();
    expect(screen.getByText('Publishing waits for the items above.')).toBeInTheDocument();
  });

  it('shows a blocker it does not know in English, marked as English', async () => {
    serve({ blockers: ['Choose a template first'] });
    renderPage('ru');
    const unknown = await screen.findByText('Choose a template first');
    expect(unknown).toHaveAttribute('lang', 'en');
    expect(screen.getByText('Некоторые пункты пока на английском.')).toBeInTheDocument();
  });

  it('says before publishing that there is no way back to draft, then publishes', async () => {
    const { move, reads } = serve();
    const published = answer(`/invitations/${SLUG}/publish`, move('PUBLISHED'));
    const user = renderPage();
    expect(await screen.findByText('Nothing stands in the way of publishing.')).toBeInTheDocument();
    await user.click(await publishButton());
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Once published, it can’t go back to being a draft.');
    expect(published).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Publish' }));
    const status = await screen.findByText('The invitation is published.');
    await waitFor(() => expect(status).toHaveFocus());
    expect(published).toEqual([null]);
    expect(
      screen.getByText('Published: guests can open their links and reply'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop replies' })).toBeInTheDocument();
    expect(status).toHaveFocus();
    expect(reads.delivery).toBe(1);
  });

  it('publishes nothing when the host cancels', async () => {
    serve();
    const published = answer(`/invitations/${SLUG}/publish`, refusal(500));
    const user = renderPage();
    await user.click(await publishButton());
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(published).toEqual([]);
  });

  it('lists what the server says blocks publishing, when it says so on the press', async () => {
    serve();
    answer(`/invitations/${SLUG}/publish`, refusal(400, [VENUE, STARTED]));
    const user = renderPage();
    await user.click(await publishButton());
    await user.click(await screen.findByRole('button', { name: 'Publish' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Add a venue with an address, so guests know where to go.',
    );
    expect(within(dialog).getByRole('button', { name: 'Publish' })).toBeDisabled();
  });

  it.each([
    [403, 'Your role on this event can’t publish or send the invitation.'],
    [409, 'Someone changed the invitation just now.'],
    [429, 'Too many attempts. Wait a minute, then try again.'],
    [500, 'Something went wrong on our side.'],
  ])('explains a %i', async (status, words) => {
    serve();
    answer(`/invitations/${SLUG}/publish`, refusal(status));
    const user = renderPage();
    await user.click(await publishButton());
    await user.click(await screen.findByRole('button', { name: 'Publish' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(words);
  });

  it('explains a state that changed meanwhile, with the server’s own words', async () => {
    const { reads } = serve();
    answer(`/invitations/${SLUG}/publish`, refusal(400, 'This invitation is already published'));
    const user = renderPage();
    await user.click(await publishButton());
    await user.click(await screen.findByRole('button', { name: 'Publish' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('That can’t be done in the invitation’s current state.');
    expect(within(alert).getByText('This invitation is already published')).toHaveAttribute(
      'lang',
      'en',
    );
    await waitFor(() => expect(reads.event).toBe(2));
  });
});

describe('InvitationPage: replies', () => {
  it('stops replies and takes them again, each without asking', async () => {
    const { move } = serve({ status: 'PUBLISHED' });
    const closed = answer(`/invitations/${SLUG}/close`, move('CLOSED'));
    const reopened = answer(`/invitations/${SLUG}/reopen`, move('PUBLISHED'));
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Stop replies' }));
    const status = await screen.findByText(
      'Replies are stopped. Guests can still open the invitation.',
    );
    await waitFor(() => expect(status).toHaveFocus());
    expect(closed).toEqual([null]);
    // The line speaks with the reloaded page, never beside the old state.
    expect(
      screen.getByText(
        'Replies are stopped, so the invitation can’t be sent. Take replies again to send it.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Take replies again' }));
    expect(await screen.findByText('Guests can reply again.')).toBeInTheDocument();
    expect(reopened).toEqual([null]);
  });
});

describe('InvitationPage: its time', () => {
  it('says until when guests can open it, in the event’s zone', async () => {
    serve({
      status: 'PUBLISHED',
      lifetime: { expiresAt: '2027-09-10T20:00:00.000Z', isExpired: false },
    });
    renderPage();
    expect(await screen.findByText('until 11 September 2027, 00:00')).toBeInTheDocument();
  });

  it('offers no sending once its time has run out, and says reopening keeps it so', async () => {
    serve({
      status: 'CLOSED',
      lifetime: { expiresAt: '2027-09-10T20:00:00.000Z', isExpired: true },
    });
    renderPage();
    expect(await screen.findByText('no longer: its time has run out')).toBeInTheDocument();
    expect(screen.getByText(/taking replies again won’t let guests open it/)).toBeInTheDocument();
    expect(
      screen.getByText(/guests can no longer open it, so it can’t be sent/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Send to every household not yet invited' }),
    ).toBeNull();
  });

  it('explains a send refused because its time ran out meanwhile', async () => {
    serve({ status: 'PUBLISHED', delivery: report({ invited: 2 }) });
    answer(`/invitations/${SLUG}/send`, refusal(400, 'This invitation has expired'));
    const user = renderPage();
    await user.click(
      await screen.findByRole('button', { name: 'Send to every household not yet invited' }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This invitation’s time has run out, so it can’t be sent.');
    expect(within(alert).getByText('This invitation has expired')).toHaveAttribute('lang', 'en');
  });
});

describe('InvitationPage: sending', () => {
  it('asks once before the event’s first send, saying how many it reaches', async () => {
    serve({ status: 'PUBLISHED' });
    const sent = answer(`/invitations/${SLUG}/send`, () => HttpResponse.json(sendResult()));
    const user = renderPage();
    expect(
      await screen.findByText(/0 households invited · 3 not yet · 1 can’t be reached/),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Send to every household not yet invited' }),
    );
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Send the invitation to 3 households?');
    expect(dialog).toHaveTextContent('Sent messages can’t be recalled.');
    expect(dialog).toHaveTextContent('1 household has no usable address');
    expect(sent).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('heading', { name: 'What happened' })).toHaveFocus();
    expect(sent).toEqual([{}]);
  });

  it('shows the three outcomes, each with what to do', async () => {
    serve({ status: 'PUBLISHED', delivery: report({ invited: 5 }) });
    answer(`/invitations/${SLUG}/send`, () =>
      HttpResponse.json({ ...sendResult({ alreadySent: 5 }), token }),
    );
    const user = renderPage('en');
    await user.click(
      await screen.findByRole('button', { name: 'Send to every household not yet invited' }),
    );
    const outcome = await screen.findByRole('region', { name: 'What happened' });
    expect(outcome).toHaveTextContent('On its way to 2 households. Nothing more to do.');
    expect(outcome).toHaveTextContent('Petrosyan family · by email, armen@example.am');
    expect(outcome).toHaveTextContent('Hakobyan · on Telegram');
    expect(outcome).not.toHaveTextContent('123456789');
    expect(outcome).toHaveTextContent('5 households already had it');
    expect(outcome).toHaveTextContent('Not sent: 1 household');
    expect(outcome).toHaveTextContent('For a bounce, correct the address on the guest list');
    expect(outcome).toHaveTextContent('Can’t be reached: 1 household');
    expect(
      within(outcome).getByText('No email address for anyone in this household'),
    ).toHaveAttribute('lang', 'en');
    expect(
      within(outcome).getByRole('link', { name: 'Show them on the guest list' }),
    ).toHaveAttribute('href', '/app/events/e1/guests?invite=attention');
    expect(document.body.innerHTML).not.toContain(token);
  });

  it('sends again at once once something has been sent: a second press is safe', async () => {
    const { reads } = serve({ status: 'PUBLISHED', delivery: report({ invited: 2, notSent: 1 }) });
    const sent = answer(`/invitations/${SLUG}/send`, () =>
      HttpResponse.json(sendResult({ queued: 0, alreadySent: 3, recipients: [] })),
    );
    const user = renderPage();
    const button = await screen.findByRole('button', {
      name: 'Send to every household not yet invited',
    });
    await user.click(button);
    expect(await screen.findByText(/3 households already had it/)).toBeInTheDocument();
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await waitFor(() => expect(sent).toEqual([{}, {}]));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => expect(reads.delivery).toBe(3));
  });

  it('asks without a count when the report could not be read, and says why it is missing', async () => {
    serve({ status: 'PUBLISHED', delivery: refusal(403) });
    const user = renderPage();
    expect(
      await screen.findByText('Who was invited isn’t shown to your role on this event.'),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Send to every household not yet invited' }),
    );
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Send the invitation?');
  });

  it('says when the report failed, with the reference', async () => {
    serve({ status: 'PUBLISHED', delivery: refusal(500) });
    renderPage();
    expect(await screen.findByText('Reference: req-1')).toBeInTheDocument();
  });

  it.each([
    [400, 'The invitation can’t be sent right now.'],
    [403, 'Your role on this event can’t publish or send the invitation.'],
    [429, 'Too many attempts. Wait a minute, then try again.'],
    [500, 'Reference: req-1'],
  ])('explains a send refused with %i', async (status, words) => {
    serve({ status: 'PUBLISHED', delivery: report({ invited: 1 }) });
    answer(`/invitations/${SLUG}/send`, refusal(status, 'This event has no guests to invite yet'));
    const user = renderPage();
    await user.click(
      await screen.findByRole('button', { name: 'Send to every household not yet invited' }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(words);
    if (status === 400) {
      expect(within(alert).getByText('This event has no guests to invite yet')).toHaveAttribute(
        'lang',
        'en',
      );
    }
  });

  it('says when the event has no invitation', async () => {
    serve({ status: null });
    renderPage();
    expect(await screen.findByText('This event has no invitation yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
