import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useForm } from 'react-hook-form';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, Link } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession, type TokenStore } from '@/api/session';
import { createI18n } from '@/lib/i18n';
import { useLeaveGuard } from '@/ui/app-form';
import { guardedRoutes } from '@/ui/app-form/guarded-routes';

import { AppShell } from './components/app-shell';

const current = vi.hoisted(() => ({ session: undefined as BrowserSession | undefined }));
vi.mock('@/api/session', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  browserSession: () => {
    if (!current.session) throw new Error('No session in this test');
    return current.session;
  },
}));

const ORIGIN = 'http://api.test';
const TOKENS = { accessToken: 'a1', refreshToken: 'r1', tokenType: 'Bearer', expiresIn: 900 };
const server = setupServer();
let store: TokenStore;

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  let access: string | undefined;
  let refresh: string | undefined;
  store = {
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
  current.session = createBrowserSession({
    baseUrl: ORIGIN,
    store,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
  current.session.start(TOKENS);
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderShell(unverifiedEmail: string | null = null) {
  const Stub = createRoutesStub([
    {
      path: '/app',
      Component: () => <AppShell unverifiedEmail={unverifiedEmail}>{<p>Your events</p>}</AppShell>,
    },
    { path: '/sign-in', Component: () => <p>Sign-in page</p> },
  ]);
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={['/app']} />
    </I18nextProvider>,
  );
  return userEvent.setup();
}

describe('AppShell', () => {
  it('says the next page is loading while a click waits for its data', async () => {
    let release: () => void = () => undefined;
    const Stub = createRoutesStub([
      {
        path: '/app',
        Component: () => (
          <AppShell>
            <Link to="/app/events/e1">Open the event</Link>
          </AppShell>
        ),
      },
      {
        path: '/app/events/e1',
        loader: () =>
          new Promise<null>((resolve) => {
            release = () => resolve(null);
          }),
        Component: () => <p>Event page</p>,
      },
    ]);
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <Stub initialEntries={['/app']} />
      </I18nextProvider>,
    );
    const user = userEvent.setup();
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('');
    await user.click(screen.getByRole('link', { name: 'Open the event' }));
    expect(await screen.findByText('Loading…')).toBe(status);
    release();
    expect(await screen.findByText('Event page')).toBeInTheDocument();
  });

  it('keeps the page’s search and filter when the language changes', () => {
    const Stub = createRoutesStub([
      {
        path: '/app/events/:eventId/guests',
        Component: () => <AppShell>{<p>Guests</p>}</AppShell>,
      },
    ]);
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <Stub initialEntries={['/app/events/e1/guests?lang=hy&q=Ani&answer=pending']} />
      </I18nextProvider>,
    );
    expect(screen.getByRole('link', { name: 'Русский', hidden: true })).toHaveAttribute(
      'href',
      '/app/events/e1/guests?lang=ru&q=Ani&answer=pending',
    );
    expect(screen.getByRole('link', { name: 'Français', hidden: true })).toHaveAttribute(
      'href',
      '/app/events/e1/guests?lang=fr&q=Ani&answer=pending',
    );
  });

  it('signs out here and goes to sign in', async () => {
    const sent: unknown[] = [];
    server.use(
      http.post(`${ORIGIN}/api/v1/auth/logout`, async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    );
    const user = renderShell();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Sign-in page')).toBeInTheDocument();
    expect(sent).toEqual([{ refreshToken: 'r1' }]);
    expect(store.getRefreshToken()).toBeUndefined();
  });

  it('goes to sign in without asking about unsaved changes, which can no longer be saved', async () => {
    server.use(http.post(`${ORIGIN}/api/v1/auth/logout`, () => HttpResponse.json({ ok: true })));
    function Unsaved() {
      const form = useForm({ defaultValues: { name: '' } });
      useLeaveGuard(form);
      return (
        <label>
          Name
          <input {...form.register('name')} />
        </label>
      );
    }
    const Stub = createRoutesStub(
      guardedRoutes([
        { path: '/app', Component: () => <AppShell>{<Unsaved />}</AppShell> },
        { path: '/sign-in', Component: () => <p>Sign-in page</p> },
      ]),
    );
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <Stub initialEntries={['/app']} />
      </I18nextProvider>,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Name'), 'Ani');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Sign-in page')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('asks before signing out on every device, then goes to sign in', async () => {
    server.use(
      http.post(`${ORIGIN}/api/v1/auth/logout-everywhere`, () => HttpResponse.json({ revoked: 2 })),
    );
    const user = renderShell();
    await user.click(screen.getByRole('button', { name: 'Sign out on every device' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('this one included');
    await user.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    expect(await screen.findByText('Sign-in page')).toBeInTheDocument();
  });

  it('says so, and keeps the session, when the other devices could not be signed out', async () => {
    server.use(
      http.post(`${ORIGIN}/api/v1/auth/logout-everywhere`, () =>
        HttpResponse.json({ statusCode: 500, message: 'no' }, { status: 500 }),
      ),
    );
    const user = renderShell();
    await user.click(screen.getByRole('button', { name: 'Sign out on every device' }));
    await user.click(await screen.findByRole('button', { name: 'Sign out everywhere' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We couldn’t sign out your other devices',
    );
    expect(screen.getByText('Your events')).toBeInTheDocument();
    expect(store.getRefreshToken()).toBe('r1');
  });
});

describe('an address not yet confirmed (FR-5)', () => {
  const VERIFY = `${ORIGIN}/api/v1/auth/verify-email`;

  it('says which address, and sends a new link when asked', async () => {
    let sent = 0;
    server.use(
      http.post(VERIFY, () => {
        sent += 1;
        return HttpResponse.json({ sent: true });
      }),
    );
    const user = renderShell('anna@example.am');
    expect(screen.getByText(/Confirm your email address/)).toHaveTextContent('anna@example.am');
    await user.click(screen.getByRole('button', { name: 'Send a new link' }));
    expect(
      await screen.findByText(
        'A new link is on its way to anna@example.am. Links sent before it no longer work.',
      ),
    ).toBeInTheDocument();
    expect(sent).toBe(1);
  });

  it('says why when no link could be sent, and lets them try again', async () => {
    server.use(
      http.post(VERIFY, () =>
        HttpResponse.json({ statusCode: 429, message: 'Too Many Requests' }, { status: 429 }),
      ),
    );
    const user = renderShell('anna@example.am');
    await user.click(screen.getByRole('button', { name: 'Send a new link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts.');
    expect(screen.getByRole('button', { name: 'Send a new link' })).toBeEnabled();
  });

  it('says nothing once the address is confirmed', () => {
    renderShell(null);
    expect(screen.queryByText(/Confirm your email address/)).not.toBeInTheDocument();
  });
});
