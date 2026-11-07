import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReplyRecord } from '@/features/guest-reply';
import { createI18n } from '@/lib/i18n';

import { AgreeBeforeDoor, AgreementsNotice } from './components/agree-before-door';
import { useDoorAgreements } from './components/use-door-agreements';
import { acknowledgementsWire, DAVIT_COMING, INVITATION, recordComing } from './test-data';

const ORIGIN = 'http://api.test';
const ACKS = `${ORIGIN}/api/v1/invitations/:slug/g/:guestToken/acknowledgements`;
/** Made at run time: no committed fixture holds a capability token. */
const TOKEN = `tok-${crypto.randomUUID()}`;
const LINK = { slug: 'autumn-jazz-night', guestToken: TOKEN };

const server = setupServer();
const posted: unknown[] = [];
const reads = { count: 0 };

/** Each read answers the next of `answers`, then the last again. */
function serveReads(...answers: Array<ReturnType<typeof acknowledgementsWire>>) {
  server.use(
    http.get(ACKS, () => {
      const answer = answers[Math.min(reads.count, answers.length - 1)];
      reads.count += 1;
      return HttpResponse.json(answer);
    }),
  );
}

function serveSign(reply: () => Response) {
  server.use(
    http.post(ACKS, async ({ request }) => {
      posted.push(await request.json());
      return reply();
    }),
  );
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', ORIGIN);
  posted.length = 0;
  reads.count = 0;
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function Page({ record }: { record: ReplyRecord }) {
  const door = useDoorAgreements(INVITATION, LINK, record);
  return (
    <>
      <AgreementsNotice door={door} />
      <AgreeBeforeDoor door={door} link={LINK} />
    </>
  );
}

function renderPage(record = recordComing()) {
  const view = render(
    <I18nextProvider i18n={createI18n('en')}>
      <Page record={record} />
    </I18nextProvider>,
  );
  return { ...view, user: userEvent.setup() };
}

describe('agreeing before the door (PD-83)', () => {
  it('lets a ticket holder agree on their own, without replying again', async () => {
    serveReads(acknowledgementsWire(), acknowledgementsWire([{ subjectGuestId: 'g-anna' }]));
    serveSign(() => HttpResponse.json({ records: [] }, { status: 201 }));
    const { user } = renderPage();
    expect(await screen.findByText('1 agreement is needed before the door.')).toBeInTheDocument();
    expect(screen.getByText('I accept the house rules')).toHaveAttribute('lang', 'en');
    expect(screen.getByText('For: Anna Sargsyan')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'I agree' }));
    await user.click(screen.getByRole('button', { name: 'Agree' }));
    expect(await screen.findByText('Enter your full name.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Your full name'), 'Anna Sargsyan');
    await user.click(screen.getByRole('button', { name: 'Agree' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Everyone coming has agreed.');
    expect(posted).toEqual([
      {
        statementVersionId: 'v2',
        subjectGuestIds: ['g-anna'],
        method: 'TYPED',
        signerName: 'Anna Sargsyan',
        isAcknowledged: true,
        locale: 'en',
      },
    ]);
    expect(
      screen.queryByText(/agreements? (is|are) needed before the door/),
    ).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it('agrees for others coming only with the declaration', async () => {
    serveReads(acknowledgementsWire());
    serveSign(() => HttpResponse.json({ records: [] }, { status: 201 }));
    const { user } = renderPage(recordComing([DAVIT_COMING]));
    await user.click(await screen.findByRole('checkbox', { name: 'I agree' }));
    await user.type(screen.getByLabelText('Your full name'), 'Anna Sargsyan');
    await user.click(screen.getByRole('button', { name: 'Agree' }));
    expect(
      await screen.findByText('Confirm that you agree on behalf of the others listed.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'I agree on behalf of Davit' }));
    await user.click(screen.getByRole('button', { name: 'Agree' }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      subjectGuestIds: ['g-anna', 'g-davit'],
      isRepresentative: true,
    });
  });

  it('asks only those who have not agreed, and nothing once everyone has', async () => {
    serveReads(acknowledgementsWire([{ subjectGuestId: 'g-anna' }]));
    renderPage(recordComing([DAVIT_COMING]));
    expect(await screen.findByText('For: Davit')).toBeInTheDocument();
    expect(screen.getByText('Already agreed: Anna Sargsyan')).toBeInTheDocument();
  });

  it('shows nothing when everyone coming agreed, or nobody is coming', async () => {
    serveReads(acknowledgementsWire([{ subjectGuestId: 'g-anna' }]));
    const { unmount } = renderPage();
    await waitFor(() => expect(reads.count).toBe(1));
    expect(
      screen.queryByRole('heading', { name: 'Agree before the door' }),
    ).not.toBeInTheDocument();
    unmount();
    serveReads(acknowledgementsWire());
    renderPage({ ...recordComing(), rsvp: { status: 'DECLINED', answers: [] } });
    await waitFor(() => expect(reads.count).toBe(2));
    expect(
      screen.queryByRole('heading', { name: 'Agree before the door' }),
    ).not.toBeInTheDocument();
  });

  it('reads the wording again when the hosts changed it meanwhile', async () => {
    serveReads(acknowledgementsWire());
    serveSign(() =>
      HttpResponse.json(
        { statusCode: 409, message: 'statementVersionId: this statement changed' },
        { status: 409 },
      ),
    );
    const { user } = renderPage();
    await user.click(await screen.findByRole('checkbox', { name: 'I agree' }));
    await user.type(screen.getByLabelText('Your full name'), 'Anna Sargsyan');
    await user.click(screen.getByRole('button', { name: 'Agree' }));
    await waitFor(() => expect(reads.count).toBe(2));
    const card = screen.getByRole('group', { name: 'Needed before the door' });
    expect(within(card).getByRole('checkbox', { name: 'I agree' })).not.toBeChecked();
  });
});
