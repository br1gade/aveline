import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, Link } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession, type TokenStore } from '@/api/session';
import { createI18n } from '@/lib/i18n';

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

function renderShell() {
  const Stub = createRoutesStub([
    { path: '/app', Component: () => <AppShell>{<p>Your events</p>}</AppShell> },
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
