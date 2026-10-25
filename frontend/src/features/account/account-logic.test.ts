import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createBrowserSession, type TokenStore } from '@/api/session';

import { registerAndSignIn } from './flows';
import { needsOrganization } from './landing';
import { safeNext } from './safe-next';
import { organizationSchema, registerSchema, signInSchema } from './schemas';

describe('safeNext', () => {
  it.each([
    ['/app', '/app'],
    ['/app/welcome', '/app/welcome'],
    ['/app?lang=hy', '/app?lang=hy'],
    [null, '/app'],
    ['', '/app'],
    ['//evil.example/app', '/app'],
    ['https://evil.example/app', '/app'],
    ['/apple', '/app'],
    ['/sign-in', '/app'],
    ['/app\\..\\evil', '/app'],
  ])('%s → %s', (next, expected) => {
    expect(safeNext(next)).toBe(expected);
  });
});

describe('needsOrganization', () => {
  const organization = {
    id: 'o1',
    name: 'Petrosyan Wedding',
    kind: 'HOST',
    events: 0,
    members: 1,
  } as const;

  it('sends a new account, with no organization and no event, to create one', () => {
    expect(needsOrganization(null, 0)).toBe(true);
  });

  it('lets someone brought onto one event in without an organization', () => {
    expect(needsOrganization(null, 1)).toBe(false);
  });

  it('lets an organization with no events yet in', () => {
    expect(needsOrganization(organization, 0)).toBe(false);
  });
});

describe('the schemas keep the backend’s limits', () => {
  it('asks for a 10-character password, and keeps it exactly as typed', () => {
    const short = signInSchema.safeParse({ email: 'ani@example.am', password: 'nine-char' });
    expect(short.error?.issues.map((issue) => issue.message)).toEqual(['passwordShort']);
    const spaced = signInSchema.parse({ email: ' ani@example.am ', password: ' ten chars ' });
    expect(spaced).toEqual({ email: 'ani@example.am', password: ' ten chars ' });
  });

  it('says which rule a field broke', () => {
    const result = registerSchema.safeParse({ name: 'A', email: 'not-an-address', password: '' });
    expect(result.error?.issues.map((issue) => [issue.path[0], issue.message])).toEqual([
      ['name', 'nameShort'],
      ['email', 'email'],
      ['password', 'required'],
    ]);
  });

  it('takes only the organization kinds the backend has', () => {
    expect(
      organizationSchema.safeParse({ name: 'Petrosyan Wedding', kind: 'AGENCY' }).success,
    ).toBe(false);
  });
});

const ORIGIN = 'http://api.test';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

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

describe('registerAndSignIn', () => {
  const values = { name: 'Ani Grigoryan', email: 'ani@example.am', password: 'correct horse' };

  function answerLogin(response: () => Response) {
    server.use(
      http.post(`${ORIGIN}/api/v1/auth/register`, () =>
        HttpResponse.json({ accepted: true }, { status: 202 }),
      ),
      http.post(`${ORIGIN}/api/v1/auth/login`, response),
    );
    const store = memoryStore();
    const session = createBrowserSession({
      baseUrl: ORIGIN,
      store,
      schedule: () => () => undefined,
    });
    return { session, store };
  }

  it('signs a new account in with the same credentials', async () => {
    const { session, store } = answerLogin(() =>
      HttpResponse.json({
        accessToken: 'a1',
        refreshToken: 'r1',
        tokenType: 'Bearer',
        expiresIn: 900,
      }),
    );
    expect(await registerAndSignIn(session, values)).toBe('signed-in');
    expect(store.getAccessToken()).toBe('a1');
  });

  it('says "check your email" when the address already had an account', async () => {
    const { session, store } = answerLogin(() =>
      HttpResponse.json({ statusCode: 401, message: 'Invalid email or password' }, { status: 401 }),
    );
    expect(await registerAndSignIn(session, values)).toBe('check-email');
    expect(store.getAccessToken()).toBeUndefined();
  });

  it('passes on anything else', async () => {
    const { session } = answerLogin(() => HttpResponse.json({ statusCode: 429 }, { status: 429 }));
    await expect(registerAndSignIn(session, values)).rejects.toMatchObject({ status: 429 });
  });
});
