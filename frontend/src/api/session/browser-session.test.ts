import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createBrowserSession } from './browser-session';
import type { SessionChannel } from './channel';
import type { TokenStore } from './token-store';

const ORIGIN = 'http://api.test';
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function memoryStore(refreshToken?: string): TokenStore {
  let access: string | undefined;
  let refresh = refreshToken;
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

/** A channel whose other tabs the test plays: `fromAnotherTab` delivers their logout. */
function testChannel() {
  let deliver: (() => void) | undefined;
  const announced = vi.fn();
  const channel: SessionChannel = {
    announceLogout: announced,
    onLogout(listener) {
      deliver = listener;
      return () => undefined;
    },
  };
  return { channel, announced, fromAnotherTab: () => deliver?.() };
}

/** Records what the session scheduled, so a test can run it. */
function manualSchedule() {
  const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
  return {
    scheduled,
    schedule: (callback: () => void, delayMs: number) => {
      scheduled.push({ callback, delayMs });
      return () => undefined;
    },
  };
}

const TOKENS = { accessToken: 'a1', refreshToken: 'r1', tokenType: 'Bearer', expiresIn: 900 };

function setUp(refreshToken?: string) {
  const store = memoryStore(refreshToken);
  const channel = testChannel();
  const timers = manualSchedule();
  const session = createBrowserSession({
    baseUrl: ORIGIN,
    store,
    channel: channel.channel,
    schedule: timers.schedule,
  });
  const signedOut = vi.fn();
  session.onSignedOut(signedOut);
  return { session, store, signedOut, ...channel, ...timers };
}

function refreshAnswers(response: () => Response) {
  const presented: unknown[] = [];
  server.use(
    http.post(`${ORIGIN}/api/v1/auth/refresh`, async ({ request }) => {
      presented.push(await request.json());
      return response();
    }),
  );
  return presented;
}

describe('createBrowserSession', () => {
  it('keeps a login and refreshes a minute before the access token expires', () => {
    const { session, store, scheduled } = setUp();

    session.start(TOKENS);

    expect(store.getAccessToken()).toBe('a1');
    expect(scheduled.map((entry) => entry.delayMs)).toEqual([840_000]);
  });

  it('refreshes on a reload, when only the refresh token survived', async () => {
    const presented = refreshAnswers(() =>
      HttpResponse.json({ ...TOKENS, accessToken: 'a2', refreshToken: 'r2' }),
    );
    const { session, store } = setUp('r1');

    expect(await session.ensureSignedIn()).toBe(true);
    expect(presented).toEqual([{ refreshToken: 'r1' }]);
    expect(store.getAccessToken()).toBe('a2');
  });

  it('is not signed in with nothing stored, and asks nobody', async () => {
    const { session } = setUp();
    expect(await session.ensureSignedIn()).toBe(false);
  });

  it('ends the session in every tab when the server refuses the token', async () => {
    refreshAnswers(() => HttpResponse.json({ statusCode: 401, message: 'no' }, { status: 401 }));
    const { session, store, signedOut, announced } = setUp('revoked');

    expect(await session.ensureSignedIn()).toBe(false);
    expect(store.getRefreshToken()).toBeUndefined();
    expect(signedOut).toHaveBeenCalledOnce();
    expect(announced).toHaveBeenCalledOnce();
  });

  it('keeps the session when the server cannot answer', async () => {
    refreshAnswers(() => HttpResponse.json({ statusCode: 503, message: 'down' }, { status: 503 }));
    const { session, store, signedOut } = setUp('r1');

    await expect(session.ensureSignedIn()).rejects.toMatchObject({ status: 503 });
    expect(store.getRefreshToken()).toBe('r1');
    expect(signedOut).not.toHaveBeenCalled();
  });

  it('signs out here and tells the other tabs, even if the server did not hear', async () => {
    server.use(http.post(`${ORIGIN}/api/v1/auth/logout`, () => HttpResponse.error()));
    const { session, store, signedOut, announced } = setUp();
    session.start(TOKENS);

    await session.signOut();

    expect(store.getRefreshToken()).toBeUndefined();
    expect(announced).toHaveBeenCalledOnce();
    expect(signedOut).toHaveBeenCalledOnce();
  });

  it('follows a sign-out in another tab', () => {
    const { session, store, signedOut, fromAnotherTab } = setUp();
    session.start(TOKENS);

    fromAnotherTab();

    expect(store.getAccessToken()).toBeUndefined();
    expect(signedOut).toHaveBeenCalledOnce();
  });

  it('keeps the session when signing out everywhere fails', async () => {
    server.use(
      http.post(`${ORIGIN}/api/v1/auth/logout-everywhere`, () =>
        HttpResponse.json({ statusCode: 500, message: 'no' }, { status: 500 }),
      ),
    );
    const { session, store, signedOut } = setUp();
    session.start(TOKENS);

    await expect(session.signOutEverywhere()).rejects.toMatchObject({ status: 500 });
    expect(store.getAccessToken()).toBe('a1');
    expect(signedOut).not.toHaveBeenCalled();
  });

  it('signs out everywhere with the bearer token', async () => {
    let authorization: string | null = null;
    server.use(
      http.post(`${ORIGIN}/api/v1/auth/logout-everywhere`, ({ request }) => {
        authorization = request.headers.get('authorization');
        return HttpResponse.json({ revoked: 2 });
      }),
    );
    const { session, signedOut } = setUp();
    session.start(TOKENS);

    await session.signOutEverywhere();

    expect(authorization).toBe('Bearer a1');
    expect(signedOut).toHaveBeenCalledOnce();
  });
});
