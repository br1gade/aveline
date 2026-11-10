import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it } from 'vitest';

import {
  createAppApi,
  createPublicApi,
  expectData,
  type ApiClient,
  type PublicApiClient,
  type ResponseOf,
} from './client';
import { isApiError } from './errors';

const ORIGIN = 'http://api.test';
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const TOKENS: ResponseOf<'AuthController_loginResponse'> = {
  accessToken: 'a',
  refreshToken: 'r',
  tokenType: 'Bearer',
  expiresIn: 900,
};

function logIn() {
  return createPublicApi(ORIGIN).POST('/api/v1/auth/login', {
    body: { email: 'anna@example.am', password: 'secret-enough' },
  });
}

describe('a response body read through the client (FR-1)', () => {
  it('is typed by the schema the operation declares', async () => {
    server.use(http.post(`${ORIGIN}/api/v1/auth/login`, () => HttpResponse.json(TOKENS)));
    const body = await expectData(logIn());
    expectTypeOf(body).toEqualTypeOf<ResponseOf<'AuthController_loginResponse'>>();
    expect(body).toEqual(TOKENS);
  });

  it('is an ApiError, with the status, when the answer is not a success', async () => {
    server.use(
      http.post(`${ORIGIN}/api/v1/auth/login`, () =>
        HttpResponse.json({ statusCode: 401, message: 'Invalid credentials' }, { status: 401 }),
      ),
    );
    const failure: unknown = await expectData(logIn()).catch((error: unknown) => error);
    expect(isApiError(failure) && failure.status).toBe(401);
  });

  it('is a network error, with the reference it was given, when no answer came', async () => {
    server.use(http.post(`${ORIGIN}/api/v1/auth/login`, () => HttpResponse.error()));
    const failure: unknown = await expectData(logIn(), 'req-1').catch((error: unknown) => error);
    expect(isApiError(failure) && [failure.status, failure.requestId]).toEqual([0, 'req-1']);
  });
});

describe('which operations each client may call (FR-2)', () => {
  it('lets the public client call only what the spec declares public', () => {
    const publicApi = createPublicApi(ORIGIN);
    // @ts-expect-error `GET /me` needs a session, so the public client has no such operation.
    void publicApi.GET('/api/v1/me', {});
    expectTypeOf(publicApi).not.toMatchTypeOf<ApiClient>();
  });

  it('lets a function a public page calls be given the signed-in client too', () => {
    expectTypeOf(createAppApi(ORIGIN, {})).toMatchTypeOf<PublicApiClient>();
  });
});
