import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, organizationChoice, type BrowserSession } from '@/api/session';
import { GrantedPermissions, type Granted } from '@/features/permissions';
import { createI18n } from '@/lib/i18n';
import { LeaveGuard } from '@/ui/app-form';

import { isUnloadAsked } from '../../../test/unload';

import { inviteMember } from './api';
import { OrganizationPage } from './components/organization-page';
import { loadOrganization, type OrganizationData } from './load';

const current = vi.hoisted(() => ({ session: undefined as BrowserSession | undefined }));
vi.mock('@/api/session', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  browserSession: () => {
    if (!current.session) throw new Error('No session in this test');
    return current.session;
  },
}));
const forgotten = vi.hoisted(() => vi.fn());
vi.mock('@/features/account', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  forgetSettledOrganization: forgotten,
}));

const ORIGIN = 'http://api.test';
const API = `${ORIGIN}/api/v1`;
const server = setupServer();
const REVISION = 7;

/** Not the members' on purpose: leaving reads this one, as a non-owner can't read theirs. */
const CURRENT_REVISION = 5;
const organization = {
  id: 'o1',
  name: 'Petrosyan Wedding',
  kind: 'HOST',
  accessRevision: CURRENT_REVISION,
  closureReview: null,
};
const ani = {
  userId: 'u1',
  name: 'Ani Petrosyan',
  role: 'OWNER',
  joinedAt: '2026-10-01T22:00:00Z',
  isActive: true,
  isCurrentUser: true,
};
const aram = {
  userId: 'u2',
  name: 'Aram Sargsyan',
  role: 'MEMBER',
  joinedAt: '2026-10-02T10:00:00Z',
  isActive: true,
  isCurrentUser: false,
};
const invite = { email: 'new@example.am', role: 'MANAGER', expiresAt: '2026-11-20T10:00:00Z' };
const NOW = Date.parse('2026-11-05T10:00:00Z');
const writes: Array<{ path: string; body: unknown; query: string }> = [];
const reads = { members: 0, current: 0 };

function refusal(status: number, message: string, code?: string) {
  return HttpResponse.json(
    { statusCode: status, message, code, requestId: 'r-1' },
    { status, headers: { 'x-request-id': 'r-1' } },
  );
}

function serve(
  over: { members?: () => Response; invites?: () => Response; current?: () => Response } = {},
) {
  server.use(
    http.get(`${API}/organizations/current`, () => {
      reads.current += 1;
      return over.current?.() ?? HttpResponse.json(organization);
    }),
    http.get(`${API}/organizations/current/members`, () => {
      reads.members += 1;
      return (
        over.members?.() ??
        HttpResponse.json({ items: [ani, aram], nextCursor: null, accessRevision: REVISION })
      );
    }),
    http.get(`${API}/organization/invites`, () => over.invites?.() ?? HttpResponse.json([invite])),
  );
}

/** Records a write and gives the answer, which is a plain success unless told otherwise. */
function answer(method: 'post' | 'patch' | 'delete', path: string, reply?: () => Response) {
  server.use(
    http[method](`${API}${path}`, async ({ request }) => {
      const text = await request.text();
      const url = new URL(request.url);
      writes.push({
        path: url.pathname.replace('/api/v1', ''),
        query: url.search,
        body: text ? (JSON.parse(text) as unknown) : null,
      });
      return reply?.() ?? HttpResponse.json({ ok: true });
    }),
  );
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  writes.length = 0;
  reads.members = 0;
  reads.current = 0;
  forgotten.mockClear();
  current.session = createBrowserSession({
    baseUrl: ORIGIN,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
});
afterEach(() => {
  server.resetHandlers();
  organizationChoice.clear();
});
afterAll(() => server.close());

async function open(permissions: Granted = null) {
  const Stub = createRoutesStub([
    {
      path: '/app/organization',
      HydrateFallback: () => null,
      loader: () => {
        if (!current.session) throw new Error('No session in this test');
        return loadOrganization(current.session.api, NOW);
      },
      Component: function Loaded() {
        return (
          <GrantedPermissions permissions={permissions}>
            <LeaveGuard>
              <OrganizationPage data={useLoaderData<OrganizationData>()} />
            </LeaveGuard>
          </GrantedPermissions>
        );
      },
    },
    { path: '/app', Component: () => <h1>Your events</h1> },
  ]);
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={['/app/organization']} />
    </I18nextProvider>,
  );
  await screen.findByRole('heading', { level: 1, name: 'Your organization' });
  return userEvent.setup();
}

const member = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

describe('the organization’s name (PD-159)', () => {
  it('saves it trimmed, forgets the name the app shell holds, and says so', async () => {
    serve();
    answer('patch', '/organizations/current');
    const user = await open();
    const name = screen.getByLabelText('The organization’s name');
    expect(name).toHaveValue('Petrosyan Wedding');
    await user.clear(name);
    await user.type(name, '  Grand Hall Events ');
    await user.click(screen.getByRole('button', { name: 'Save the name' }));
    expect(await screen.findByText('The name is saved.')).toBeInTheDocument();
    expect(writes).toEqual([
      { path: '/organizations/current', query: '', body: { name: 'Grand Hall Events' } },
    ]);
    expect(forgotten).toHaveBeenCalledOnce();
  });

  it.each(['x', ' x ', 'y'.repeat(161)])('sends nothing for the name “%s”', async (typed) => {
    serve();
    answer('patch', '/organizations/current');
    const user = await open();
    const name = screen.getByLabelText('The organization’s name');
    await user.clear(name);
    await user.click(name);
    await user.paste(typed);
    await user.click(screen.getByRole('button', { name: 'Save the name' }));
    expect(await screen.findByText('Use 2 to 160 characters.')).toBeInTheDocument();
    expect(writes).toEqual([]);
  });

  it.each(['ab', 'y'.repeat(160)])('sends the name “%s”, at the limits', async (typed) => {
    serve();
    answer('patch', '/organizations/current');
    const user = await open();
    const name = screen.getByLabelText('The organization’s name');
    await user.clear(name);
    await user.click(name);
    await user.paste(typed);
    await user.click(screen.getByRole('button', { name: 'Save the name' }));
    await screen.findByText('The name is saved.');
    expect(writes[0]?.body).toEqual({ name: typed });
  });

  it('puts the backend’s refusal of a name on the field', async () => {
    serve();
    answer('patch', '/organizations/current', () => refusal(400, 'name must be longer'));
    const user = await open();
    await user.type(screen.getByLabelText('The organization’s name'), ' Ltd');
    await user.click(screen.getByRole('button', { name: 'Save the name' }));
    await waitFor(() =>
      expect(screen.getByLabelText('The organization’s name')).toHaveAttribute('aria-invalid'),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('gives a reference when a save gets no answer', async () => {
    serve();
    answer('patch', '/organizations/current', () => refusal(500, 'Boom'));
    const user = await open();
    await user.type(screen.getByLabelText('The organization’s name'), ' Ltd');
    await user.click(screen.getByRole('button', { name: 'Save the name' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('r-1');
  });

  it('asks before a name typed is lost', async () => {
    serve();
    const user = await open();
    expect(isUnloadAsked()).toBe(false);
    await user.type(screen.getByLabelText('The organization’s name'), ' Ltd');
    expect(isUnloadAsked()).toBe(true);
  });

  it('words a role that may not rename it, keeping what was typed', async () => {
    serve();
    answer('patch', '/organizations/current', () => refusal(403, 'Forbidden resource'));
    const user = await open();
    const name = screen.getByLabelText('The organization’s name');
    await user.type(name, ' Ltd');
    await user.click(screen.getByRole('button', { name: 'Save the name' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only an owner can do this.');
    expect(name).toHaveValue('Petrosyan Wedding Ltd');
  });
});

describe('the members (PD-159)', () => {
  it('lists each with their role in words, with what they were given dates in Yerevan', async () => {
    serve();
    await open();
    expect(member('Ani Petrosyan')).toHaveTextContent('Owner · joined 2 October 2026');
    expect(member('Aram Sargsyan')).toHaveTextContent('Member · joined 2 October 2026');
    expect(screen.getByText('Dates here are in Yerevan time.')).toBeInTheDocument();
  });

  it('calls a role it doesn’t know another role, never one it knows', async () => {
    serve({
      members: () =>
        HttpResponse.json({
          items: [{ ...aram, role: 'NEW_ROLE' }],
          nextCursor: null,
          accessRevision: REVISION,
        }),
    });
    await open();
    expect(member('Aram Sargsyan')).toHaveTextContent('Another role');
  });

  it('shows more by the cursor, keeping those already read', async () => {
    const asked: string[] = [];
    server.use(
      http.get(`${API}/organizations/current`, () => HttpResponse.json(organization)),
      http.get(`${API}/organization/invites`, () => HttpResponse.json([])),
      http.get(`${API}/organizations/current/members`, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        asked.push(cursor ?? 'first');
        return HttpResponse.json(
          cursor
            ? { items: [aram], nextCursor: null, accessRevision: REVISION }
            : { items: [ani], nextCursor: 'c-1', accessRevision: REVISION },
        );
      }),
    );
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Show more members' }));
    expect(await screen.findByText('Aram Sargsyan')).toBeInTheDocument();
    expect(screen.getByText('Ani Petrosyan')).toBeInTheDocument();
    expect(asked).toEqual(['first', 'c-1']);
    expect(screen.queryByRole('button', { name: 'Show more members' })).not.toBeInTheDocument();
  });

  it('says so when more can’t be read, and can be asked again', async () => {
    let attempts = 0;
    server.use(
      http.get(`${API}/organizations/current`, () => HttpResponse.json(organization)),
      http.get(`${API}/organization/invites`, () => HttpResponse.json([])),
      http.get(`${API}/organizations/current/members`, ({ request }) => {
        if (!new URL(request.url).searchParams.get('cursor')) {
          return HttpResponse.json({ items: [ani], nextCursor: 'c-1', accessRevision: REVISION });
        }
        attempts += 1;
        return attempts === 1
          ? refusal(500, 'Boom')
          : HttpResponse.json({ items: [aram], nextCursor: null, accessRevision: REVISION });
      }),
    );
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Show more members' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('couldn’t be loaded');
    await user.click(screen.getByRole('button', { name: 'Show more members' }));
    expect(await screen.findByText('Aram Sargsyan')).toBeInTheDocument();
  });

  it('marks the caller’s own row (FR-121)', async () => {
    serve();
    await open();
    expect(member('Ani Petrosyan')).toHaveTextContent('You');
    expect(member('Aram Sargsyan')).not.toHaveTextContent('You');
  });

  it('marks an account that is no longer active, and offers nothing for it (FR-125)', async () => {
    serve({
      members: () =>
        HttpResponse.json({
          items: [ani, { ...aram, isActive: false }],
          nextCursor: null,
          accessRevision: REVISION,
        }),
    });
    await open();
    expect(member('Aram Sargsyan')).toHaveTextContent('This account is no longer active.');
    expect(within(member('Aram Sargsyan')).queryByRole('button')).not.toBeInTheDocument();
    expect(within(member('Ani Petrosyan')).getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('offers what only an owner may do to nobody the access read says can’t (FR-6)', async () => {
    serve({
      members: () => refusal(403, 'Forbidden resource'),
      invites: () => refusal(403, 'Forbidden resource'),
    });
    await open(['event:read']);
    expect(screen.queryByRole('button', { name: 'Save the name' })).not.toBeInTheDocument();
    expect(screen.getByText('Petrosyan Wedding')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send the invitation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask to close it' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave the organization' })).toBeInTheDocument();
  });

  it('tells someone who isn’t an owner, and leaves them the rest of the page', async () => {
    serve({
      members: () => refusal(403, 'Forbidden resource'),
      invites: () => refusal(403, 'Forbidden resource'),
    });
    await open();
    expect(screen.getByText(/Only an owner can see the members/)).toBeInTheDocument();
    expect(screen.getByText('Only an owner can see the invitations.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send the invitation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave the organization' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask to close it' })).toBeInTheDocument();
  });

  it('tells an account in no organization, with nothing to press', async () => {
    const denied = () => refusal(403, 'organizationId: unavailable', 'ORGANIZATION_ACCESS_DENIED');
    serve({ current: denied, members: denied, invites: denied });
    await open();
    expect(screen.getByText(/isn’t in an organization yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('gives a reference when the organization can’t be read', async () => {
    serve({ current: () => refusal(500, 'Boom') });
    await open();
    expect(document.body).toHaveTextContent('r-1');
    expect(screen.queryByRole('button', { name: 'Leave the organization' })).toBeNull();
  });
});

describe('changing what a member may do', () => {
  it('changes a role with the revision read, and reads the page again', async () => {
    serve();
    answer('patch', '/organizations/current/members/:userId');
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Change role: Aram Sargsyan' }));
    const dialog = await screen.findByRole('dialog');
    const before = reads.members;
    await user.selectOptions(within(dialog).getByLabelText('Role'), 'MANAGER');
    await user.click(within(dialog).getByRole('button', { name: 'Change role' }));
    expect(await screen.findByText('Aram Sargsyan is now: Manager.')).toBeInTheDocument();
    expect(writes).toEqual([
      {
        path: '/organizations/current/members/u2',
        query: '',
        body: { role: 'MANAGER', expectedRevision: REVISION },
      },
    ]);
    expect(reads.members).toBeGreaterThan(before);
  });

  it('offers no change until another role is chosen', async () => {
    serve();
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Change role: Aram Sargsyan' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Change role' })).toBeDisabled();
  });

  it('shows what the write came to and uses its revision next, after reading again', async () => {
    let isChanged = false;
    serve({
      members: () =>
        HttpResponse.json({
          items: [ani, { ...aram, role: isChanged ? 'MANAGER' : 'MEMBER' }],
          nextCursor: null,
          accessRevision: isChanged ? REVISION + 1 : REVISION,
        }),
    });
    answer('patch', '/organizations/current/members/:userId', () => {
      isChanged = true;
      return HttpResponse.json({});
    });
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Change role: Aram Sargsyan' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Role'), 'MANAGER');
    await user.click(within(dialog).getByRole('button', { name: 'Change role' }));
    await waitFor(() => expect(member('Aram Sargsyan')).toHaveTextContent('Manager · joined'));
    await user.click(screen.getByRole('button', { name: 'Remove: Aram Sargsyan' }));
    answer('delete', '/organizations/current/members/:userId');
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }),
    );
    await screen.findByText('Aram Sargsyan is no longer in the organization.');
    expect(writes[1]?.query).toBe(`?expectedRevision=${REVISION + 1}`);
  });

  it('reads again when someone else changed things first, and trying again can work', async () => {
    let isChanged = false;
    serve({
      members: () =>
        HttpResponse.json({
          items: [ani, aram],
          nextCursor: null,
          accessRevision: isChanged ? REVISION + 1 : REVISION,
        }),
    });
    answer('patch', '/organizations/current/members/:userId', () => {
      if (isChanged) return HttpResponse.json({});
      isChanged = true;
      return refusal(409, 'expectedRevision: changed', 'REVISION_CHANGED');
    });
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Change role: Aram Sargsyan' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Role'), 'VIEWER');
    const save = within(dialog).getByRole('button', { name: 'Change role' });
    await user.click(save);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('please try again');
    await waitFor(() => expect(reads.members).toBeGreaterThan(1));
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);
    await screen.findByText('Aram Sargsyan is now: Viewer.');
    expect(writes.map(({ body }) => body)).toEqual([
      { role: 'VIEWER', expectedRevision: REVISION },
      { role: 'VIEWER', expectedRevision: REVISION + 1 },
    ]);
  });

  it('keeps the focus on the page when what opened the dialog has been read away', async () => {
    let isChanged = false;
    serve({
      members: () =>
        HttpResponse.json({
          items: [ani, aram],
          nextCursor: null,
          accessRevision: isChanged ? REVISION + 1 : REVISION,
        }),
    });
    answer('patch', '/organizations/current/members/:userId', () => {
      isChanged = true;
      return refusal(409, 'expectedRevision: changed', 'REVISION_CHANGED');
    });
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Change role: Aram Sargsyan' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Role'), 'VIEWER');
    await user.click(within(dialog).getByRole('button', { name: 'Change role' }));
    await within(dialog).findByRole('alert');
    await waitFor(() => expect(reads.members).toBeGreaterThan(1));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  });

  it('asks before a role chosen is lost, and not once it is put back', async () => {
    serve();
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Change role: Aram Sargsyan' }));
    const role = within(await screen.findByRole('dialog')).getByLabelText('Role');
    await user.selectOptions(role, 'VIEWER');
    expect(isUnloadAsked()).toBe(true);
    await user.selectOptions(role, 'MEMBER');
    expect(isUnloadAsked()).toBe(false);
  });

  it('sends each row’s write with the revision it was read at, whichever page it came on', async () => {
    server.use(
      http.get(`${API}/organizations/current`, () => HttpResponse.json(organization)),
      http.get(`${API}/organization/invites`, () => HttpResponse.json([])),
      http.get(`${API}/organizations/current/members`, ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.get('cursor')
            ? { items: [aram], nextCursor: null, accessRevision: REVISION + 1 }
            : { items: [ani], nextCursor: 'c-1', accessRevision: REVISION },
        ),
      ),
    );
    answer('patch', '/organizations/current/members/:userId', () =>
      refusal(409, 'x', 'REVISION_CHANGED'),
    );
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Show more members' }));
    await screen.findByText('Aram Sargsyan');
    await user.click(screen.getByRole('button', { name: 'Change role: Ani Petrosyan' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Role'), 'VIEWER');
    await user.click(within(dialog).getByRole('button', { name: 'Change role' }));
    await within(dialog).findByRole('alert');
    expect(writes[0]?.body).toEqual({ role: 'VIEWER', expectedRevision: REVISION });
  });

  it('shows a role it doesn’t know as another role, not as the first on the list', async () => {
    serve({
      members: () =>
        HttpResponse.json({
          items: [{ ...aram, role: 'NEW_ROLE' }],
          nextCursor: null,
          accessRevision: REVISION,
        }),
    });
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Change role: Aram Sargsyan' }));
    const role = within(await screen.findByRole('dialog')).getByLabelText('Role');
    expect(role).toHaveDisplayValue('Another role');
    await user.selectOptions(role, 'OWNER');
    expect(role).toHaveDisplayValue('Owner');
  });

  it.each([
    ['Aram Sargsyan', 'someone else', false],
    ['Ani Petrosyan', 'the caller', true],
  ])(
    'after removing %s, %s, forgets the organization the tab holds only for the caller (FR-121)',
    async (name, _who, isForgotten) => {
      serve();
      answer('delete', '/organizations/current/members/:userId');
      const user = await open();
      await user.click(screen.getByRole('button', { name: `Remove: ${name}` }));
      const dialog = await screen.findByRole('alertdialog');
      expect(dialog.textContent?.includes('This is you: you lose access at once.')).toBe(
        isForgotten,
      );
      await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
      await screen.findByText(`${name} is no longer in the organization.`);
      expect(forgotten).toHaveBeenCalledTimes(isForgotten ? 1 : 0);
    },
  );

  it('warns only the caller that a change is to their own role (FR-121)', async () => {
    serve();
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Change role: Ani Petrosyan' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('This is your own role');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Change role: Aram Sargsyan' }));
    expect(await screen.findByRole('dialog')).not.toHaveTextContent('your own role');
  });

  it('asks before removing, naming what goes, and sends the revision in the address', async () => {
    serve();
    answer('delete', '/organizations/current/members/:userId');
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Remove: Aram Sargsyan' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('every role');
    expect(dialog).not.toHaveTextContent('This is you');
    expect(writes).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(
      await screen.findByText('Aram Sargsyan is no longer in the organization.'),
    ).toBeInTheDocument();
    expect(writes).toEqual([
      {
        path: '/organizations/current/members/u2',
        query: `?expectedRevision=${REVISION}`,
        body: null,
      },
    ]);
  });

  it('says an owner has to stay when one would be left with none', async () => {
    serve();
    answer('delete', '/organizations/current/members/:userId', () =>
      refusal(409, 'Ownership handover is required', 'OWNER_HANDOVER_REQUIRED'),
    );
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Remove: Ani Petrosyan' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('An owner has to stay');
  });

  it('makes someone an owner, saying the caller stays one too', async () => {
    serve();
    answer('post', '/organizations/current/owner-transfers');
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Make owner: Aram Sargsyan' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('You stay an owner too.');
    await user.click(within(dialog).getByRole('button', { name: 'Make owner' }));
    expect(await screen.findByText('Aram Sargsyan is now an owner too.')).toBeInTheDocument();
    expect(writes[0]?.body).toEqual({ successorUserId: 'u2', expectedRevision: REVISION });
  });

  it('offers no making an owner of someone who already is one', async () => {
    serve();
    await open();
    expect(screen.queryByRole('button', { name: 'Make owner: Ani Petrosyan' })).toBeNull();
  });
});

describe('inviting (PD-159)', () => {
  it('lists those waiting, with their role and how long the link lasts', async () => {
    serve();
    await open();
    expect(member('new@example.am')).toHaveTextContent('Manager · until 20 November 2026');
  });

  it('says when an invitation has run out, as the list keeps those too', async () => {
    serve({
      invites: () => HttpResponse.json([{ ...invite, expiresAt: '2026-11-04T10:00:00Z' }]),
    });
    await open();
    expect(member('new@example.am')).toHaveTextContent('Manager · expired 4 November 2026');
  });

  it('sends the address and role, says so, and empties the form', async () => {
    serve();
    answer('post', '/organization/invites', () =>
      HttpResponse.json({
        sent: true,
        email: 'sona@example.am',
        role: 'VIEWER',
        devLink: 'https://app.test/accept-invite?token=SENTINEL',
      }),
    );
    const user = await open();
    const email = screen.getByLabelText('Email address');
    await user.type(email, 'sona@example.am');
    await user.selectOptions(screen.getByLabelText('Role'), 'VIEWER');
    await user.click(screen.getByRole('button', { name: 'Send the invitation' }));
    expect(await screen.findByText('An invitation has gone to sona@example.am.')).toBeVisible();
    expect(writes[0]?.body).toEqual({ email: 'sona@example.am', role: 'VIEWER' });
    expect(email).toHaveValue('');
    expect(document.body.innerHTML).not.toContain('SENTINEL');
  });

  it('keeps nothing of the answer but the address and role, as a development link is a credential', async () => {
    answer('post', '/organization/invites', () =>
      HttpResponse.json({
        sent: true,
        email: 'sona@example.am',
        role: 'VIEWER',
        devLink: 'https://app.test/accept-invite?token=SENTINEL',
      }),
    );
    if (!current.session) throw new Error('No session in this test');
    await expect(
      inviteMember(current.session.api, { email: 'sona@example.am', role: 'VIEWER' }),
    ).resolves.toEqual({ email: 'sona@example.am', role: 'VIEWER' });
  });

  it('asks before an address typed is lost', async () => {
    serve();
    const user = await open();
    expect(isUnloadAsked()).toBe(false);
    await user.type(screen.getByLabelText('Email address'), 'sona@example.am');
    expect(isUnloadAsked()).toBe(true);
  });

  it('warns beforehand that someone in another organization can’t join yet', async () => {
    serve();
    await open();
    expect(screen.getByText(/already in another organization can’t join yet/)).toBeInTheDocument();
  });

  it.each(['nope', `${'a'.repeat(190)}@example.am`])('sends nothing for “%s”', async (typed) => {
    serve();
    answer('post', '/organization/invites');
    const user = await open();
    await user.click(screen.getByLabelText('Email address'));
    await user.paste(typed);
    await user.click(screen.getByRole('button', { name: 'Send the invitation' }));
    expect(await screen.findByText('Type a valid email address.')).toBeInTheDocument();
    expect(writes).toEqual([]);
  });

  it.each(['анна@пример.рф', `${'a'.repeat(189)}@example.am`])(
    'leaves “%s” for the backend to judge, as its rules are wider than a browser’s',
    async (typed) => {
      serve();
      answer('post', '/organization/invites', () =>
        HttpResponse.json({ sent: true, email: typed, role: 'MEMBER' }),
      );
      const user = await open();
      await user.click(screen.getByLabelText('Email address'));
      await user.paste(typed);
      await user.click(screen.getByRole('button', { name: 'Send the invitation' }));
      await screen.findByText(`An invitation has gone to ${typed}.`);
      expect(writes).toHaveLength(1);
    },
  );

  it('puts the backend’s refusal of an address on the field', async () => {
    serve();
    answer('post', '/organization/invites', () => refusal(400, 'email must be an email'));
    const user = await open();
    await user.type(screen.getByLabelText('Email address'), 'odd@example.am');
    await user.click(screen.getByRole('button', { name: 'Send the invitation' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Email address')).toHaveAttribute('aria-invalid'),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says someone is already a member, and reads the list again', async () => {
    serve();
    answer('post', '/organization/invites', () => refusal(400, 'That person is already a member'));
    const user = await open();
    const before = reads.members;
    await user.type(screen.getByLabelText('Email address'), 'ani@example.am');
    await user.click(screen.getByRole('button', { name: 'Send the invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already a member');
    await waitFor(() => expect(reads.members).toBeGreaterThan(before));
  });

  it('asks before withdrawing, and sends the address in the path', async () => {
    serve();
    answer('delete', '/organization/invites/:email');
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Withdraw: new@example.am' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    expect(await screen.findByText('The invitation to new@example.am is withdrawn.')).toBeVisible();
    expect(decodeURIComponent(writes[0]?.path ?? '')).toBe('/organization/invites/new@example.am');
  });
});

describe('leaving (PD-162)', () => {
  it('asks, sends the revision, forgets the choice and goes to the events, asking nothing', async () => {
    serve();
    answer('post', '/organizations/current/leave');
    organizationChoice.choose('o1');
    const user = await open();
    await user.type(screen.getByLabelText('Email address'), 'half-typed@example.am');
    await user.click(screen.getByRole('button', { name: 'Leave the organization' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(writes).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }));
    expect(await screen.findByRole('heading', { name: 'Your events' })).toBeInTheDocument();
    expect(writes[0]?.body).toEqual({ expectedRevision: CURRENT_REVISION });
    expect(organizationChoice.read()).toBeUndefined();
    expect(forgotten).toHaveBeenCalledOnce();
  });

  it('lets someone who can’t read the members leave, by the revision anyone can read', async () => {
    serve({ members: () => refusal(403, 'Forbidden resource') });
    answer('post', '/organizations/current/leave');
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Leave the organization' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' }),
    );
    await screen.findByRole('heading', { name: 'Your events' });
    expect(writes[0]?.body).toEqual({ expectedRevision: CURRENT_REVISION });
  });

  it('reads again when someone else changed things first, and trying again can work', async () => {
    let isChanged = false;
    serve({
      current: () =>
        HttpResponse.json({
          ...organization,
          accessRevision: isChanged ? CURRENT_REVISION + 1 : CURRENT_REVISION,
        }),
    });
    answer('post', '/organizations/current/leave', () => {
      if (isChanged) return HttpResponse.json({});
      isChanged = true;
      return refusal(409, 'expectedRevision: changed', 'REVISION_CHANGED');
    });
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Leave the organization' }));
    const dialog = await screen.findByRole('alertdialog');
    const leave = within(dialog).getByRole('button', { name: 'Leave' });
    await user.click(leave);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('please try again');
    await waitFor(() => expect(reads.current).toBeGreaterThan(1));
    await waitFor(() => expect(leave).toBeEnabled());
    await user.click(leave);
    await screen.findByRole('heading', { name: 'Your events' });
    expect(writes.map(({ body }) => body)).toEqual([
      { expectedRevision: CURRENT_REVISION },
      { expectedRevision: CURRENT_REVISION + 1 },
    ]);
  });

  it('stays and says what to do when an owner has to hand over first', async () => {
    serve();
    answer('post', '/organizations/current/leave', () =>
      refusal(409, 'Ownership handover is required', 'OWNER_HANDOVER_REQUIRED'),
    );
    organizationChoice.choose('o1');
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Leave the organization' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('An owner has to stay');
    expect(organizationChoice.read()).toBe('o1');
  });
});

describe('asking to close (PD-163)', () => {
  it('asks, promising nothing is removed, then says it has gone to staff', async () => {
    serve();
    answer('post', '/organizations/current/closure-reviews', () =>
      HttpResponse.json({ reviewId: 'r', status: 'OPEN', revision: 1 }),
    );
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Ask to close it' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Everyone keeps access until staff decide.');
    await user.click(within(dialog).getByRole('button', { name: 'Ask to close it' }));
    expect(await screen.findByText(/has gone to Aveline’s staff/)).toBeVisible();
    expect(writes[0]?.body).toEqual({ expectedRevision: CURRENT_REVISION });
  });

  it.each([
    ['a role without the permission (FR-124)', 403, 'This account may not member:manage'],
    [
      'one with the permission and no ownership',
      403,
      'Only a current owner may request closure review',
    ],
    [
      'staff, who hold the permission and are no member',
      404,
      'No active member in this organization',
    ],
  ])('words %s', async (_, status, message) => {
    serve();
    answer('post', '/organizations/current/closure-reviews', () =>
      refusal(status, message, status === 403 ? 'FORBIDDEN' : 'NOT_FOUND'),
    );
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Ask to close it' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Ask to close it' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Only an owner can ask for this.',
    );
  });

  it('says a caller no longer in the organization so, not that only an owner may ask', async () => {
    serve();
    answer('post', '/organizations/current/closure-reviews', () =>
      refusal(403, 'organizationId: access is unavailable', 'ORGANIZATION_ACCESS_DENIED'),
    );
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Ask to close it' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Ask to close it' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This account isn’t in that organization any more.',
    );
  });

  it('says a request is waiting, and since when, offering no second (FR-122)', async () => {
    serve({
      current: () =>
        HttpResponse.json({
          ...organization,
          closureReview: {
            id: 'r1',
            status: 'OPEN',
            revision: 1,
            openedAt: '2026-11-03T10:00:00Z',
            resolvedAt: null,
          },
        }),
    });
    await open();
    expect(screen.getByText(/You asked Aveline’s staff to close it/)).toBeInTheDocument();
    expect(screen.queryByText(/3 November 2026/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask to close it' })).not.toBeInTheDocument();
  });

  it.each([
    ['DECLINE', 'decided on 4 November 2026 not to close it'],
    ['HANDOVER', 'made another member an owner on 4 November 2026'],
    ['SOMETHING_NEW', 'answered on 4 November 2026'],
  ])('says what staff decided (%s), and lets an owner ask again', async (status, words) => {
    serve({
      current: () =>
        HttpResponse.json({
          ...organization,
          closureReview: {
            id: 'r1',
            status,
            revision: 2,
            openedAt: '2026-11-03T10:00:00Z',
            resolvedAt: '2026-11-04T10:00:00Z',
          },
        }),
    });
    await open();
    expect(screen.getByText(new RegExp(words))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask to close it' })).toBeInTheDocument();
  });
});
