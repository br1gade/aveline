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

import { AccessReviewsPage } from './components/reviews-page';
import { loadAccessReviews, type AccessReviewsData } from './load';

const current = vi.hoisted(() => ({ session: undefined as BrowserSession | undefined }));
vi.mock('@/api/session', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  browserSession: () => {
    if (!current.session) throw new Error('No session in this test');
    return current.session;
  },
}));

const ORIGIN = 'http://api.test';
const REVIEWS = `${ORIGIN}/api/v1/admin/organization-access-reviews`;
const server = setupServer();

function review(over: Record<string, unknown> = {}) {
  return {
    id: 'v1',
    organizationId: 'org-petrosyan',
    status: 'OPEN',
    reason: 'LAST_OWNER_CLOSURE',
    openedAt: '2026-11-01T09:00:00Z',
    revision: 3,
    resolvedAt: null,
    resolvedByUserId: 'secret-staff-id',
    ...over,
  };
}

const NAMES: Record<string, string> = {
  'org-petrosyan': 'Petrosyan Wedding',
  'org-ani': 'Ani & Co',
};
const MEMBERS = [
  { userId: 'u-owner', name: 'Armen Petrosyan', role: 'OWNER', joinedAt: '2026-01-01T00:00:00Z' },
  { userId: 'u-lilit', name: 'Lilit Petrosyan', role: 'MANAGER', joinedAt: '2026-02-01T00:00:00Z' },
];

/** The organization each read named, by its header. */
const named: Array<string | null> = [];
const resolved: Array<{ id: string; body: unknown }> = [];
let listReads = 0;

function refusal(status: number, message: string, code?: string) {
  return HttpResponse.json(
    { statusCode: status, message, code, requestId: 'r-9' },
    { status, headers: { 'x-request-id': 'r-9' } },
  );
}

function serveOrganizations(nameOf: (id: string) => Response | undefined = () => undefined) {
  server.use(
    http.get(`${ORIGIN}/api/v1/organizations/current`, ({ request }) => {
      const id = request.headers.get('x-aveline-organization-id') ?? '';
      named.push(id || null);
      return nameOf(id) ?? HttpResponse.json({ name: NAMES[id], accessRevision: 1 });
    }),
    http.get(`${ORIGIN}/api/v1/organizations/current/members`, ({ request }) => {
      named.push(request.headers.get('x-aveline-organization-id'));
      return HttpResponse.json({ items: MEMBERS, nextCursor: null, accessRevision: 1 });
    }),
  );
}

function serve(pages: () => Response) {
  server.use(
    http.get(REVIEWS, () => {
      listReads += 1;
      return pages();
    }),
  );
}

function answerResolve(answer: () => Response = () => HttpResponse.json({})) {
  server.use(
    http.post(`${REVIEWS}/:id/resolve`, async ({ request, params }) => {
      resolved.push({ id: String(params.id), body: await request.json() });
      return answer();
    }),
  );
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  named.length = 0;
  resolved.length = 0;
  listReads = 0;
  current.session = createBrowserSession({
    baseUrl: ORIGIN,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function open() {
  const Stub = createRoutesStub([
    {
      path: APP_PATHS.staffAccessReviews,
      HydrateFallback: () => null,
      loader: () => {
        if (!current.session) throw new Error('No session in this test');
        return loadAccessReviews(current.session.api);
      },
      Component: function Page() {
        return <AccessReviewsPage data={useLoaderData<AccessReviewsData>()} />;
      },
    },
  ]);
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={[APP_PATHS.staffAccessReviews]} />
    </I18nextProvider>,
  );
  await screen.findByRole('heading', { level: 1, name: 'Access reviews' });
  return userEvent.setup();
}

const one = () => HttpResponse.json({ items: [review()], nextCursor: null });
const card = () => screen.getByText('Petrosyan Wedding').closest('li') as HTMLElement;

describe('the reviews', () => {
  it('names each organization by asking for it, and says why it was opened', async () => {
    serve(one);
    serveOrganizations();
    await open();
    expect(await screen.findByText('Petrosyan Wedding')).toBeVisible();
    expect(named).toContain('org-petrosyan');
    expect(card()).toHaveTextContent('Its last owner asked to close it.');
    expect(card()).toHaveTextContent('Opened 1 November 2026');
  });

  it('shows the reference when the name can’t be read, and still offers every decision', async () => {
    serve(one);
    serveOrganizations(() => refusal(500, 'down'));
    await open();
    const row = (await screen.findByText(/name couldn’t be read/)).closest('li') as HTMLElement;
    expect(row).toHaveTextContent('org-petrosyan');
    expect(within(row).getByRole('button', { name: 'Close it: org-petrosyan' })).toBeEnabled();
  });

  it('shows a reason it doesn’t know as it came, in English', async () => {
    serve(() => HttpResponse.json({ items: [review({ reason: 'NEW_REASON' })], nextCursor: null }));
    serveOrganizations();
    await open();
    expect(await screen.findByText('NEW_REASON')).toHaveAttribute('lang', 'en');
  });

  it('reads more past the first ten, by the cursor', async () => {
    const cursors: Array<string | null> = [];
    server.use(
      http.get(REVIEWS, ({ request }) => {
        const url = new URL(request.url);
        cursors.push(url.searchParams.get('cursor'));
        expect(url.searchParams.get('limit')).toBe('10');
        return url.searchParams.get('cursor')
          ? HttpResponse.json({
              items: [review({ id: 'v2', organizationId: 'org-ani' })],
              nextCursor: null,
            })
          : HttpResponse.json({ items: [review()], nextCursor: 'c1' });
      }),
    );
    serveOrganizations();
    const user = await open();
    await user.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('Ani & Co')).toBeVisible();
    expect(screen.getByText('Petrosyan Wedding')).toBeVisible();
    expect(cursors).toEqual([null, 'c1']);
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('says nothing waits when nothing does', async () => {
    serve(() => HttpResponse.json({ items: [], nextCursor: null }));
    await open();
    expect(screen.getByText('Nothing is waiting.')).toBeVisible();
  });

  it('tells someone who isn’t an administrator whose page it is', async () => {
    serve(() => refusal(403, 'Platform administrator review is required'));
    await open();
    expect(screen.getByText('This page is for Aveline’s administrators.')).toBeVisible();
  });
});

describe('deciding (design PD-176)', () => {
  it('hands over to a member who isn’t an owner, with the review’s own revision', async () => {
    serve(one);
    serveOrganizations();
    answerResolve();
    const user = await open();
    await user.click(await screen.findByRole('button', { name: 'Hand over: Petrosyan Wedding' }));
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'Hand over' });
    const select = await within(dialog).findByRole('combobox', { name: 'Who becomes an owner' });
    expect(within(select).queryByRole('option', { name: 'Armen Petrosyan' })).toBeNull();
    expect(confirm).toBeDisabled();
    await user.selectOptions(select, 'u-lilit');
    await user.click(confirm);
    await waitFor(() =>
      expect(resolved).toEqual([
        {
          id: 'v1',
          body: { decision: 'HANDOVER', expectedRevision: 3, successorUserId: 'u-lilit' },
        },
      ]),
    );
    expect(await screen.findByText('Petrosyan Wedding has a new owner.')).toBeVisible();
    expect(named.filter((id) => id !== 'org-petrosyan')).toEqual([]);
  });

  it('closes only once the name is typed, whatever its capitals and spaces', async () => {
    serve(one);
    serveOrganizations();
    answerResolve();
    const user = await open();
    await user.click(await screen.findByRole('button', { name: 'Close it: Petrosyan Wedding' }));
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'Close it' });
    const box = within(dialog).getByRole('textbox', { name: /Type the organization’s name/ });
    await user.type(box, 'Petrosyan');
    expect(confirm).toBeDisabled();
    await user.clear(box);
    await user.type(box, '  petrosyan WEDDING ');
    await user.click(confirm);
    await waitFor(() =>
      expect(resolved).toEqual([{ id: 'v1', body: { decision: 'CLOSE', expectedRevision: 3 } }]),
    );
  });

  it('asks for the reference instead when the name couldn’t be read', async () => {
    serve(one);
    serveOrganizations(() => refusal(500, 'down'));
    answerResolve();
    const user = await open();
    await user.click(await screen.findByRole('button', { name: 'Close it: org-petrosyan' }));
    const dialog = await screen.findByRole('alertdialog');
    const box = within(dialog).getByRole('textbox', { name: /Type the organization’s reference/ });
    await user.type(box, 'ORG-PETROSYAN');
    await user.click(within(dialog).getByRole('button', { name: 'Close it' }));
    await waitFor(() =>
      expect(resolved).toEqual([{ id: 'v1', body: { decision: 'CLOSE', expectedRevision: 3 } }]),
    );
  });

  it('declines with no successor named', async () => {
    serve(one);
    serveOrganizations();
    answerResolve();
    const user = await open();
    await user.click(await screen.findByRole('button', { name: 'Decline: Petrosyan Wedding' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Decline' }),
    );
    await waitFor(() =>
      expect(resolved).toEqual([{ id: 'v1', body: { decision: 'DECLINE', expectedRevision: 3 } }]),
    );
  });

  it('reads the page again when the review changed meanwhile', async () => {
    serve(one);
    serveOrganizations();
    answerResolve(() =>
      refusal(409, 'expectedRevision: organization revision changed', 'REVISION_CHANGED'),
    );
    const user = await open();
    await user.click(await screen.findByRole('button', { name: 'Decline: Petrosyan Wedding' }));
    const dialog = await screen.findByRole('alertdialog');
    const before = listReads;
    await user.click(within(dialog).getByRole('button', { name: 'Decline' }));
    expect(await within(dialog).findByText(/has moved on since the page was read/)).toBeVisible();
    await waitFor(() => expect(listReads).toBe(before + 1));
  });

  it('says a decision with no answer may have happened, and reads nothing again', async () => {
    serve(one);
    serveOrganizations();
    answerResolve(() => HttpResponse.error());
    const user = await open();
    await user.click(await screen.findByRole('button', { name: 'Decline: Petrosyan Wedding' }));
    const dialog = await screen.findByRole('alertdialog');
    const before = listReads;
    await user.click(within(dialog).getByRole('button', { name: 'Decline' }));
    expect(await within(dialog).findByText(/it may have happened/)).toBeVisible();
    expect(listReads).toBe(before);
  });

  it('words a successor who can’t own it on the dialog', async () => {
    serve(one);
    serveOrganizations();
    answerResolve(() => refusal(404, 'No active member in this organization'));
    const user = await open();
    await user.click(await screen.findByRole('button', { name: 'Hand over: Petrosyan Wedding' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.selectOptions(await within(dialog).findByRole('combobox'), 'u-lilit');
    await user.click(within(dialog).getByRole('button', { name: 'Hand over' }));
    expect(await within(dialog).findByText(/can’t become an owner/)).toBeVisible();
  });
});
