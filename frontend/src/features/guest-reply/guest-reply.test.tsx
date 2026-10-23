import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Invitation } from '@/features/invitation-renderer';
import { createI18n } from '@/lib/i18n';

import { GuestReply, type GuestReplyProps } from './components/guest-reply';
import type { ReplyRecord } from './types';

const ORIGIN = 'http://api.test';
const RSVP = `${ORIGIN}/api/v1/invitations/:slug/g/:guestToken/rsvp`;
const LINK = { slug: 'anna-davit', guestToken: 'SAMPLE' };

const INVITATION: Invitation = {
  slug: 'anna-davit',
  isAcceptingResponses: true,
  template: 'classic',
  theme: {},
  allowedFonts: [],
  musicUrl: null,
  coverUrl: null,
  locale: 'en',
  availableLocales: ['en'],
  event: {
    type: 'WEDDING',
    title: 'Anna & Davit',
    hosts: 'Anna & Davit',
    startsAt: '2027-06-12T12:00:00.000Z',
    endsAt: null,
    timezone: 'Asia/Yerevan',
    sides: { a: 'Anna', b: 'Davit' },
  },
  guest: null,
  blocks: [],
  rsvpFields: {
    dietary: {
      isEnabled: true,
      options: [
        { key: 'vegetarian', label: 'Vegetarian' },
        { key: 'vegan', label: 'Vegan' },
      ],
    },
  },
  rsvpQuestions: [
    {
      id: 'q-main',
      type: 'SINGLE_CHOICE',
      required: true,
      prompt: 'Main course',
      options: ['Beef', 'Fish'],
    },
  ],
};

function recordWith(rsvp: Partial<ReplyRecord['rsvp']> = {}): ReplyRecord {
  return {
    guest: { id: 'g1', firstName: 'Armen', lastName: 'Petrosyan' },
    household: {
      name: 'Petrosyan family',
      seatsAllotted: 3,
      members: [
        {
          id: 'g2',
          firstName: 'Lusine',
          lastName: 'Petrosyan',
          addedByGuest: false,
          status: 'PENDING',
          dietary: [],
          dietaryNotes: null,
        },
      ],
    },
    rsvp: { status: 'PENDING', answers: [], ...rsvp },
  };
}

const server = setupServer();
let sent: unknown[] = [];

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  sent = [];
  vi.stubEnv('VITE_API_BASE_URL', ORIGIN);
});
afterEach(() => {
  server.resetHandlers();
  vi.unstubAllEnvs();
});
afterAll(() => server.close());

/** Answers POST with `response`, and GET with the saved reply that follows. */
function replyWith(
  response: () => Response,
  after: ReplyRecord = recordWith({ status: 'ATTENDING' }),
) {
  server.use(
    http.post(RSVP, async ({ request }) => {
      sent.push(await request.json());
      return response();
    }),
    http.get(RSVP, () => HttpResponse.json(after)),
  );
}

function renderReply(overrides: Partial<GuestReplyProps> = {}) {
  const props: GuestReplyProps = {
    invitation: INVITATION,
    link: LINK,
    record: recordWith(),
    onReplied: vi.fn(),
    onSentChange: vi.fn(),
    ...overrides,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={createI18n('en')}>{children}</I18nextProvider>
  );
  render(<GuestReply {...props} />, { wrapper });
  return { props, user: userEvent.setup() };
}

/** Inside one field or fieldset, by its id: the same question appears once per person. */
function inField(id: string) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`No field ${id}`);
  return within(element);
}

/** Every main course on the form, for the respondent and each person with them. */
async function chooseMainCourses(user: ReturnType<typeof userEvent.setup>, ids: string[]) {
  for (const id of ids) {
    await user.click(inField(id).getByLabelText('Fish'));
  }
}

const SENT = {
  status: 'ATTENDING',
  respondedAt: '2027-03-14T10:00:00.000Z',
  partyAdded: 1,
  membersAnswered: 1,
  seatsRemaining: 0,
};

describe('GuestReply', () => {
  it('sends a household reply with a plus-one and confirms who is coming', async () => {
    replyWith(() => HttpResponse.json(SENT, { status: 201 }));
    const { props, user } = renderReply();

    await user.click(screen.getByLabelText('Joyfully attending'));
    await user.click(screen.getByRole('button', { name: 'Add a guest' }));
    await user.type(screen.getByLabelText('First name'), 'Narek');
    await chooseMainCourses(user, [
      'reply-answers-q-main',
      'reply-members-0-answers-q-main',
      'reply-party-0-answers-q-main',
    ]);
    await user.click(inField('reply-dietary').getByLabelText('Vegetarian'));
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    expect(await screen.findByText('Your reply has been received.')).toBeInTheDocument();
    // Each name is its own unbreakable span (PD-29), so the line is checked as a whole.
    expect(screen.getByText('Coming:', { exact: false })).toHaveTextContent(
      'Coming: Armen Petrosyan, Lusine Petrosyan, Narek',
    );
    expect(sent).toEqual([
      {
        status: 'ATTENDING',
        party: [{ firstName: 'Narek', answers: [{ questionId: 'q-main', value: 1 }] }],
        dietary: ['vegetarian'],
        members: [
          { guestId: 'g2', status: 'ATTENDING', answers: [{ questionId: 'q-main', value: 1 }] },
        ],
        answers: [{ questionId: 'q-main', value: 1 }],
      },
    ]);
    expect(props.onSentChange).toHaveBeenCalledWith(true);
    expect(props.onReplied).toHaveBeenCalled();
  });

  it('checks the form before sending and moves focus to the summary', async () => {
    const { user } = renderReply();

    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    const summary = await screen.findByRole('alert');
    expect(within(summary).getByRole('link', { name: 'Choose an answer.' })).toHaveAttribute(
      'href',
      '#reply-status',
    );
    expect(summary).toHaveFocus();
    expect(sent).toEqual([]);
  });

  it('asks everyone coming the host’s required question, each for themselves', async () => {
    const { user } = renderReply();

    await user.click(screen.getByLabelText('Joyfully attending'));
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    const links = await screen.findAllByRole('link', { name: 'This question needs an answer.' });
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#reply-answers-q-main',
      '#reply-members-0-answers-q-main',
    ]);
  });

  it('asks only the built-in questions the invitation asks, with the host’s choices', async () => {
    const { user } = renderReply({
      invitation: {
        ...INVITATION,
        rsvpFields: {
          drinkPreference: { isEnabled: true, options: [{ key: 'wine', label: 'Wine' }] },
          songRequest: { isEnabled: false, options: null },
          message: { isEnabled: false, options: null },
        },
      },
    });

    await user.click(screen.getByLabelText('Joyfully attending'));

    expect(screen.getByRole('radio', { name: 'Wine' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Your song/)).toBeNull();
    expect(screen.queryByLabelText(/A message for the hosts/)).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Vegetarian' })).toBeNull();
  });

  it('stores the language the guest switched the page to', async () => {
    replyWith(() => HttpResponse.json({ ...SENT, status: 'UNDECIDED' }, { status: 201 }));
    const { user } = renderReply({
      invitation: {
        ...INVITATION,
        locale: 'en',
        guest: {
          id: 'g1',
          name: 'Armen Petrosyan',
          locale: 'hy',
          household: { name: 'Petrosyan family', seatsAllotted: 3, members: [] },
          rsvp: null,
        },
      },
    });

    await user.click(screen.getByLabelText('Not sure yet'));
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    await screen.findByText('Your reply has been received.');
    expect(sent).toEqual([
      { status: 'UNDECIDED', members: [{ guestId: 'g2', status: 'UNDECIDED' }], locale: 'en' },
    ]);
  });

  it('maps the server’s seat count onto the guests section', async () => {
    replyWith(() =>
      HttpResponse.json(
        {
          statusCode: 400,
          message: 'This invitation allows 3 guest(s); 2 already named and 2 more were submitted',
        },
        { status: 400 },
      ),
    );
    const { user } = renderReply();

    await user.click(screen.getByLabelText('Joyfully attending'));
    await user.click(screen.getByRole('button', { name: 'Add a guest' }));
    await user.type(screen.getByLabelText('First name'), 'Narek');
    await chooseMainCourses(user, [
      'reply-answers-q-main',
      'reply-members-0-answers-q-main',
      'reply-party-0-answers-q-main',
    ]);
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    const message = 'You have named more guests than your seats allow (3).';
    expect(await screen.findByRole('link', { name: message })).toHaveAttribute(
      'href',
      '#reply-party',
    );
  });

  it('links a refused question the form does not show to the top of the form (PD-23)', async () => {
    replyWith(() =>
      HttpResponse.json(
        { statusCode: 400, message: 'answers: q-sign is required for a guest who is coming' },
        { status: 400 },
      ),
    );
    const { user } = renderReply({
      invitation: {
        ...INVITATION,
        rsvpQuestions: [
          ...INVITATION.rsvpQuestions,
          { id: 'q-sign', type: 'SIGNATURE', required: true, prompt: 'Sign here', options: [] },
        ],
      },
    });

    await user.click(screen.getByLabelText('Joyfully attending'));
    await chooseMainCourses(user, ['reply-answers-q-main', 'reply-members-0-answers-q-main']);
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    expect(
      await screen.findByRole('link', { name: 'This question needs an answer.' }),
    ).toHaveAttribute('href', '#reply-status');
    expect(screen.queryByText('Sign here')).toBeNull();
  });

  it('keeps the entries and says to wait when there are too many attempts', async () => {
    replyWith(() =>
      HttpResponse.json({ statusCode: 429, message: 'Too Many Requests' }, { status: 429 }),
    );
    const { user } = renderReply();

    await user.click(screen.getByLabelText('Regretfully declining'));
    await user.type(screen.getByLabelText(/A message for the hosts/), 'Congratulations');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    expect(
      await screen.findByText('Too many attempts. Please wait a minute and try again.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/A message for the hosts/)).toHaveValue('Congratulations');
  });

  it('offers to try again with a reference code when the server fails', async () => {
    replyWith(() =>
      HttpResponse.json(
        { statusCode: 500, message: 'Internal' },
        { status: 500, headers: { 'x-request-id': 'ref-123' } },
      ),
    );
    const { user } = renderReply();

    await user.click(screen.getByLabelText('Not sure yet'));
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    expect(await screen.findByText('Reference: ref-123')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows the closed banner and disables the form when replies close mid-send', async () => {
    replyWith(() =>
      HttpResponse.json(
        { statusCode: 400, message: 'This invitation has closed' },
        { status: 400 },
      ),
    );
    const { user } = renderReply();

    await user.click(screen.getByLabelText('Regretfully declining'));
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    expect(
      await screen.findByText('Replies are closed. The details remain here for you.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Regretfully declining')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Send reply' })).toBeNull();
  });

  it('shows a saved reply first, and Change reply opens it filled in', async () => {
    const saved = recordWith({
      status: 'ATTENDING',
      respondedAt: '2027-03-14T10:00:00.000Z',
      answers: [{ questionId: 'q-main', value: 0 }],
    });
    saved.household.members[0]!.status = 'ATTENDING';
    const { user } = renderReply({ record: saved });

    expect(screen.getByText('Attending · 2 people')).toBeInTheDocument();
    expect(screen.getByText('Sent on 14 March 2027')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change reply' }));

    expect(screen.getByLabelText('Joyfully attending')).toBeChecked();
    expect(inField('reply-answers-q-main').getByLabelText('Beef')).toBeChecked();
  });

  it('shows only the last reply once replies are closed', () => {
    renderReply({
      invitation: { ...INVITATION, isAcceptingResponses: false },
      record: recordWith({ status: 'DECLINED', respondedAt: '2027-03-14T10:00:00.000Z' }),
    });

    expect(screen.getByText('Not attending')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change reply' })).toBeNull();
  });
});

describe('before hydration', () => {
  it('posts, and keeps Send disabled, so a reply never lands in the link’s address', () => {
    const html = renderToString(
      <I18nextProvider i18n={createI18n('en')}>
        <GuestReply
          invitation={INVITATION}
          link={LINK}
          record={recordWith()}
          onReplied={vi.fn()}
          onSentChange={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>[^<]*Send reply/);
  });

  it('enables Send once the page runs in the browser', () => {
    renderReply();
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeEnabled();
  });
});
