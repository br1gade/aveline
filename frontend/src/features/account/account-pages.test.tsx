import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { StrictMode, type ComponentType } from 'react';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLocation } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession, type TokenStore } from '@/api/session';
import { createI18n } from '@/lib/i18n';

import { AcceptInvite } from './components/accept-invite';
import { CreateOrganization } from './components/create-organization';
import { Register } from './components/register';
import { ResetPassword } from './components/reset-password';
import { SignIn } from './components/sign-in';
import { VerifyEmail } from './components/verify-email';

// Each test gets its own session, against the mock server below.
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
const TOKEN = 'SAMPLE-LINK-TOKEN';
const TOKENS = { accessToken: 'a1', refreshToken: 'r1', tokenType: 'Bearer', expiresIn: 900 };

const server = setupServer();
let store: TokenStore;

function memoryStore(): TokenStore {
  let access: string | undefined;
  let refresh: string | undefined;
  return {
    getAccessToken: () => access,
    getRefreshToken: () => refresh,
    save(pair) {
      access = pair.accessToken;
      refresh = pair.refreshToken;
    },
    clear() {
      access = undefined;
      refresh = undefined;
    },
  };
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  store = memoryStore();
  current.session = createBrowserSession({
    baseUrl: ORIGIN,
    store,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Shows where the page sent the person, and what the address bar still holds. */
function Landed({ name }: { name: string }) {
  const location = useLocation();
  return <p>{`${name} ${location.search}`}</p>;
}

function WithAddress({ Page }: { Page: ComponentType }) {
  const location = useLocation();
  return (
    <>
      <Page />
      <output data-testid="address">{location.search}</output>
    </>
  );
}

function renderAt(path: string, Page: ComponentType, { isStrict = false } = {}) {
  const pathname = path.split('?')[0] ?? path;
  const Stub = createRoutesStub([
    { path: pathname, Component: () => <WithAddress Page={Page} /> },
    { path: '/app', Component: () => <Landed name="App home" /> },
    { path: '/app/welcome', Component: () => <Landed name="Welcome page" /> },
    { path: '/sign-in', Component: () => <Landed name="Sign-in page" /> },
  ]);
  const tree = (
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={[path]} />
    </I18nextProvider>
  );
  render(isStrict ? <StrictMode>{tree}</StrictMode> : tree);
  return userEvent.setup();
}

function answer(method: 'post' | 'get', path: string, response: () => Response) {
  const received: unknown[] = [];
  server.use(
    http[method](`${API}${path}`, async ({ request }) => {
      received.push(method === 'post' ? await request.json() : null);
      return response();
    }),
  );
  return received;
}

const refusal = (status: number) => () =>
  HttpResponse.json({ statusCode: status, message: 'refused' }, { status });

describe('SignIn', () => {
  it('checks the fields before sending anything', async () => {
    const user = renderAt('/sign-in', SignIn);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findAllByText('Fill this in.')).toHaveLength(2);
  });

  it('says the email and password do not match, never which one', async () => {
    answer('post', '/auth/login', refusal(401));
    const user = renderAt('/sign-in', SignIn);
    await user.type(screen.getByLabelText('Email'), 'ani@example.am');
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('That email and password don’t match an account.');
    expect(alert).toHaveFocus();
  });

  it('keeps the session and goes where the person was heading', async () => {
    const sent = answer('post', '/auth/login', () => HttpResponse.json(TOKENS));
    const user = renderAt('/sign-in?next=%2Fapp%2Fwelcome', SignIn);
    await user.type(screen.getByLabelText('Email'), 'ani@example.am');
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/Welcome page/)).toBeInTheDocument();
    expect(sent).toEqual([{ email: 'ani@example.am', password: 'correct horse' }]);
    expect(store.getAccessToken()).toBe('a1');
  });

  it('never follows ?next= out of the app', async () => {
    answer('post', '/auth/login', () => HttpResponse.json(TOKENS));
    const user = renderAt('/sign-in?next=%2F%2Fevil.example', SignIn);
    await user.type(screen.getByLabelText('Email'), 'ani@example.am');
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/App home/)).toBeInTheDocument();
  });

  it('asks the person to wait when rate-limited', async () => {
    answer('post', '/auth/login', refusal(429));
    const user = renderAt('/sign-in', SignIn);
    await user.type(screen.getByLabelText('Email'), 'ani@example.am');
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wait a minute');
  });
});

describe('Register', () => {
  async function fillIn(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText('Your name'), 'Ani Grigoryan');
    await user.type(screen.getByLabelText('Email'), 'ani@example.am');
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
  }

  it('signs a new account in and sends it to set up its organization', async () => {
    answer('post', '/auth/register', () => HttpResponse.json({ accepted: true }, { status: 202 }));
    answer('post', '/auth/login', () => HttpResponse.json(TOKENS));
    const user = renderAt('/register', Register);
    await fillIn(user);
    expect(await screen.findByText(/Welcome page/)).toBeInTheDocument();
  });

  it('says "check your email" for an address that already had an account', async () => {
    answer('post', '/auth/register', () => HttpResponse.json({ accepted: true }, { status: 202 }));
    answer('post', '/auth/login', refusal(401));
    const user = renderAt('/register', Register);
    await fillIn(user);
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
  });
});

describe('ResetPassword', () => {
  it('answers the same for any address', async () => {
    const sent = answer('post', '/auth/password-reset', () => HttpResponse.json({ sent: true }));
    const user = renderAt('/reset-password', ResetPassword);
    await user.type(screen.getByLabelText('Email'), 'nobody@example.am');
    await user.click(screen.getByRole('button', { name: 'Send the link' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(sent).toEqual([{ email: 'nobody@example.am' }]);
  });

  it('takes the token out of the address bar, and keeps it for the request', async () => {
    const sent = answer('post', '/auth/password-reset/confirm', () =>
      HttpResponse.json({ ok: true, sessionsRevoked: true }),
    );
    const user = renderAt(`/reset-password?lang=hy&token=${TOKEN}`, ResetPassword);
    await waitFor(() => expect(screen.getByTestId('address')).toHaveTextContent('?lang=hy'));
    expect(screen.getByTestId('address')).not.toHaveTextContent(TOKEN);

    await user.type(screen.getByLabelText('New password'), 'a new long password');
    await user.click(screen.getByRole('button', { name: 'Save the new password' }));
    expect(await screen.findByRole('heading', { name: 'Password changed' })).toBeInTheDocument();
    expect(sent).toEqual([{ token: TOKEN, password: 'a new long password' }]);
  });

  it('never puts the token in a link, and keeps it across a language switch', async () => {
    const sent = answer('post', '/auth/password-reset/confirm', () =>
      HttpResponse.json({ ok: true }),
    );
    const user = renderAt(`/reset-password?token=${TOKEN}`, ResetPassword);
    for (const link of document.querySelectorAll('a')) {
      expect(link.getAttribute('href')).not.toContain(TOKEN);
    }

    await user.click(screen.getByText('Русский'));
    await waitFor(() => expect(screen.getByTestId('address')).toHaveTextContent('?lang=ru'));
    await user.type(screen.getByLabelText('New password'), 'a new long password');
    await user.click(screen.getByRole('button', { name: 'Save the new password' }));
    await screen.findByRole('heading', { name: 'Password changed' });
    expect(sent).toEqual([{ token: TOKEN, password: 'a new long password' }]);
  });

  it('ends the local session, since the reset ended every session', async () => {
    answer('post', '/auth/password-reset/confirm', () => HttpResponse.json({ ok: true }));
    answer('post', '/auth/logout', () => HttpResponse.json({ ok: true }));
    current.session?.start(TOKENS);
    const user = renderAt(`/reset-password?token=${TOKEN}`, ResetPassword);
    await user.type(screen.getByLabelText('New password'), 'a new long password');
    await user.click(screen.getByRole('button', { name: 'Save the new password' }));
    await screen.findByRole('heading', { name: 'Password changed' });
    expect(store.getRefreshToken()).toBeUndefined();
  });

  it('says plainly when the link is old', async () => {
    answer('post', '/auth/password-reset/confirm', refusal(400));
    const user = renderAt(`/reset-password?token=${TOKEN}`, ResetPassword);
    await user.type(screen.getByLabelText('New password'), 'a new long password');
    await user.click(screen.getByRole('button', { name: 'Save the new password' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('a newer one was sent');
    expect(screen.getByRole('link', { name: 'Ask for a new link' })).toHaveAttribute(
      'href',
      '/reset-password',
    );
  });
});

describe('VerifyEmail', () => {
  it('confirms once, even when React runs effects twice', async () => {
    const sent = answer('post', '/auth/verify-email/confirm', () =>
      HttpResponse.json({ ok: true }),
    );
    renderAt(`/verify-email?token=${TOKEN}`, VerifyEmail, { isStrict: true });
    expect(await screen.findByText('Your email address is confirmed.')).toBeInTheDocument();
    expect(sent).toEqual([{ token: TOKEN }]);
  });

  it('says when the link was used or expired', async () => {
    answer('post', '/auth/verify-email/confirm', refusal(400));
    renderAt(`/verify-email?token=${TOKEN}`, VerifyEmail);
    expect(await screen.findByRole('alert')).toHaveTextContent('expired or was already used');
  });

  it('says when the link has no token', () => {
    renderAt('/verify-email', VerifyEmail);
    expect(screen.getByText(/This link is incomplete/)).toBeInTheDocument();
  });
});

describe('AcceptInvite', () => {
  async function accept(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText('Your name'), 'Narek Hakobyan');
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Accept the invitation' }));
  }

  it('accepts a team invitation for one event, and sends the person to sign in', async () => {
    const sent = answer('post', '/event-invites/accept', () =>
      HttpResponse.json({ ok: true, eventId: 'e1', role: 'COORDINATOR', accountCreated: true }),
    );
    const user = renderAt(`/accept-event-invite?token=${TOKEN}`, () => (
      <AcceptInvite kind="event" />
    ));
    await accept(user);
    expect(await screen.findByText(/Your account is ready/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
    expect(sent).toEqual([{ token: TOKEN, name: 'Narek Hakobyan', password: 'correct horse' }]);
  });

  it('explains a 409: the address has an account with another password', async () => {
    answer('post', '/invites/accept', refusal(409));
    const user = renderAt(`/accept-invite?token=${TOKEN}`, () => (
      <AcceptInvite kind="organization" />
    ));
    await accept(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('already has an account');
  });

  it('says when the invitation is no longer valid', async () => {
    answer('post', '/invites/accept', refusal(400));
    const user = renderAt(`/accept-invite?token=${TOKEN}`, () => (
      <AcceptInvite kind="organization" />
    ));
    await accept(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer valid');
  });
});

describe('CreateOrganization', () => {
  async function create(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText('Name'), 'Petrosyan Wedding');
    await user.click(screen.getByLabelText('A planner or an agency'));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
  }

  it('creates the organization, then opens the app', async () => {
    current.session?.start(TOKENS);
    const sent = answer('post', '/organizations', () =>
      HttpResponse.json({
        id: 'o1',
        name: 'Petrosyan Wedding',
        kind: 'PLANNER',
        events: 0,
        members: 1,
      }),
    );
    const user = renderAt('/app/welcome-form', CreateOrganization);
    await create(user);
    expect(await screen.findByText(/App home/)).toBeInTheDocument();
    expect(sent).toEqual([{ name: 'Petrosyan Wedding', kind: 'PLANNER' }]);
  });

  it('opens the app when the account already has one', async () => {
    current.session?.start(TOKENS);
    answer('post', '/organizations', refusal(409));
    const user = renderAt('/app/welcome-form', CreateOrganization);
    await create(user);
    expect(await screen.findByText(/App home/)).toBeInTheDocument();
  });
});
