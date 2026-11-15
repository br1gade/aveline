import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import { createI18n } from '@/lib/i18n';
import { APP_PATHS } from '@/route-paths';

import { StaffAccountsPage } from './components/staff-accounts-page';
import { loadStaffAccounts, type StaffAccountsData } from './load';

const current = vi.hoisted(() => ({ session: undefined as BrowserSession | undefined }));
vi.mock('@/api/session', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  browserSession: () => {
    if (!current.session) throw new Error('No session in this test');
    return current.session;
  },
}));
// Whose page it is: the signed-in administrator.
vi.mock('@/features/account', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readAccountOnce: () => Promise.resolve({ id: 'u-me', platformRole: 'ADMIN' }),
}));

const ORIGIN = 'http://api.test';
const STAFF = `${ORIGIN}/api/v1/staff`;
const server = setupServer();

const ME = { userId: 'u-me', email: 'aram@aveline.am', name: 'Aram Hakobyan', role: 'ADMIN' };
const ANI = { userId: 'u-ani', email: 'ani@aveline.am', name: 'Ani Petrosyan', role: 'SUPPORT' };

let rows: Array<typeof ME> = [];
const sent: Array<{ method: string; body?: unknown; userId?: string }> = [];

function refusal(status: number, code?: string, message = 'refused') {
  return HttpResponse.json(
    { statusCode: status, message, code, requestId: 'r-9' },
    { status, headers: { 'x-request-id': 'r-9' } },
  );
}

function serve({
  list = () => HttpResponse.json({ items: rows }),
  grant,
  revoke,
}: {
  list?: () => Response;
  grant?: (body: { email: string; role: string }) => Response;
  revoke?: () => Response;
} = {}) {
  server.use(
    http.get(STAFF, () => list()),
    http.post(STAFF, async ({ request }) => {
      const body = (await request.json()) as { email: string; role: string };
      sent.push({ method: 'POST', body });
      if (grant) return grant(body);
      const row = { ...(rows.find((r) => r.email === body.email) ?? ANI), ...body };
      rows = [...rows.filter((r) => r.email !== body.email), row];
      return HttpResponse.json(row);
    }),
    http.delete(`${STAFF}/:userId`, ({ params }) => {
      sent.push({ method: 'DELETE', userId: String(params.userId) });
      if (revoke) return revoke();
      rows = rows.filter((r) => r.userId !== params.userId);
      return new HttpResponse(null, { status: 204 });
    }),
  );
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  rows = [ME, ANI];
  sent.length = 0;
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
      path: APP_PATHS.staffAccounts,
      HydrateFallback: () => null,
      loader: () => {
        if (!current.session) throw new Error('No session in this test');
        return loadStaffAccounts(current.session.api);
      },
      Component: function Page() {
        return <StaffAccountsPage data={useLoaderData<StaffAccountsData>()} />;
      },
    },
  ]);
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={[APP_PATHS.staffAccounts]} />
    </I18nextProvider>,
  );
  await screen.findByRole('heading', { level: 1, name: 'Staff accounts' });
  return userEvent.setup();
}

const rowOf = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

describe('the staff list (design PD-200)', () => {
  it('lists each role, and offers nothing on the administrator’s own row', async () => {
    serve();
    await open();
    expect(await screen.findByText('Ani Petrosyan')).toBeVisible();
    expect(rowOf('Ani Petrosyan')).toHaveTextContent('Support');
    expect(rowOf('Aram Hakobyan')).toHaveTextContent('Admin');
    expect(rowOf('Aram Hakobyan')).toHaveTextContent('You');
    expect(within(rowOf('Aram Hakobyan')).queryByRole('button')).not.toBeInTheDocument();
    expect(
      within(rowOf('Ani Petrosyan')).getByRole('button', { name: 'Make admin: Ani Petrosyan' }),
    ).toBeEnabled();
  });

  it('tells anyone but an administrator whose page it is, and offers nothing', async () => {
    serve({ list: () => refusal(403) });
    await open();
    expect(
      await screen.findByText('Only Aveline’s administrators manage staff accounts.'),
    ).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('says when only the first 200 are shown', async () => {
    rows = Array.from({ length: 200 }, (_, i) => ({ ...ANI, userId: `u-${i}`, name: `S ${i}` }));
    serve();
    await open();
    expect(await screen.findByText('Only the first 200, by address, are shown.')).toBeVisible();
  });
});

describe('giving the role', () => {
  it('starts on Support, sends the address and role, says so and reads the list again', async () => {
    rows = [ME];
    serve();
    const user = await open();
    await screen.findByText('Aram Hakobyan');
    expect(screen.getByRole('radio', { name: 'Support' })).toBeChecked();
    await user.type(screen.getByRole('textbox', { name: 'Their email address' }), 'ani@aveline.am');
    await user.click(screen.getByRole('button', { name: 'Give the role' }));
    expect(await screen.findByText('Ani Petrosyan is now Support.')).toBeVisible();
    expect(sent).toEqual([{ method: 'POST', body: { email: 'ani@aveline.am', role: 'SUPPORT' } }]);
    expect(await screen.findByText('ani@aveline.am')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Their email address' })).toHaveValue('');
  });

  it.each([
    [
      404,
      'STAFF_ACCOUNT_NOT_FOUND',
      'No Aveline account uses this address. Ask them to create one first.',
    ],
    [
      409,
      'STAFF_EMAIL_UNVERIFIED',
      'This account hasn’t confirmed its email address yet. Ask them to open the link Aveline sent.',
    ],
  ])('puts a %s %s under the address', async (status, code, words) => {
    serve({ grant: () => refusal(status, code) });
    const user = await open();
    const email = screen.getByRole('textbox', { name: 'Their email address' });
    await user.type(email, 'new@aveline.am');
    await user.click(screen.getByRole('button', { name: 'Give the role' }));
    expect(await screen.findByText(words)).toBeVisible();
    expect(email).toHaveAccessibleDescription(words);
  });

  it('checks the address before sending it', async () => {
    serve();
    const user = await open();
    await user.type(screen.getByRole('textbox', { name: 'Their email address' }), 'not an address');
    await user.click(screen.getByRole('button', { name: 'Give the role' }));
    expect(await screen.findByText('That doesn’t look like an email address.')).toBeVisible();
    expect(sent).toEqual([]);
  });
});

describe('changing and removing (asked first)', () => {
  it('makes support an admin once asked, and sends nothing when cancelled', async () => {
    serve();
    const user = await open();
    const make = await screen.findByRole('button', { name: 'Make admin: Ani Petrosyan' });
    await user.click(make);
    let asking = await screen.findByRole('alertdialog', { name: 'Make Ani Petrosyan Admin?' });
    await user.click(within(asking).getByRole('button', { name: 'Cancel' }));
    expect(sent).toEqual([]);
    await user.click(make);
    asking = await screen.findByRole('alertdialog', { name: 'Make Ani Petrosyan Admin?' });
    await user.click(within(asking).getByRole('button', { name: 'Make admin' }));
    expect(await screen.findByText('Ani Petrosyan is now Admin.')).toBeVisible();
    expect(sent).toEqual([{ method: 'POST', body: { email: 'ani@aveline.am', role: 'ADMIN' } }]);
  });

  it('removes someone from the staff once asked', async () => {
    serve();
    const user = await open();
    await user.click(
      await screen.findByRole('button', { name: 'Remove from staff: Ani Petrosyan' }),
    );
    const asking = await screen.findByRole('alertdialog', {
      name: 'Remove Ani Petrosyan from the staff?',
    });
    await user.click(within(asking).getByRole('button', { name: 'Remove from staff' }));
    expect(await screen.findByText('Ani Petrosyan is no longer on the staff.')).toBeVisible();
    expect(sent).toEqual([{ method: 'DELETE', userId: 'u-ani' }]);
    expect(screen.queryByText('ani@aveline.am')).not.toBeInTheDocument();
  });

  it('reads the list again when the one to remove was gone already', async () => {
    serve({ revoke: () => refusal(404, 'STAFF_ACCOUNT_NOT_FOUND') });
    const user = await open();
    await user.click(
      await screen.findByRole('button', { name: 'Remove from staff: Ani Petrosyan' }),
    );
    const asking = await screen.findByRole('alertdialog');
    rows = [ME];
    await user.click(within(asking).getByRole('button', { name: 'Remove from staff' }));
    expect(
      await within(asking).findByText(
        'That account was no longer on the staff. The list is up to date again.',
      ),
    ).toBeVisible();
    expect(await screen.findByText('aram@aveline.am')).toBeVisible();
    expect(screen.queryByText('ani@aveline.am')).not.toBeInTheDocument();
  });
});
