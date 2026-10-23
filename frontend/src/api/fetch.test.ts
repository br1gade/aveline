import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiFetch, REQUEST_ID_HEADER } from './fetch';

function respond(status: number) {
  return new Response(null, { status });
}

describe('createApiFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends its own request id', async () => {
    const fetchMock = vi.fn((_request: Request) => Promise.resolve(respond(200)));
    vi.stubGlobal('fetch', fetchMock);

    await createApiFetch()(new Request('http://api.test/api/v1/x'));

    const sent = fetchMock.mock.calls[0]?.[0];
    expect(sent?.headers.get(REQUEST_ID_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    let token = 'old';
    const fetchMock = vi
      .fn((_request: Request) => Promise.resolve(respond(200)))
      .mockResolvedValueOnce(respond(401));
    vi.stubGlobal('fetch', fetchMock);
    const refreshSession = vi.fn(() => {
      token = 'new';
      return Promise.resolve(true);
    });

    const response = await createApiFetch({ getAccessToken: () => token, refreshSession })(
      new Request('http://api.test/api/v1/x'),
    );

    expect(response.status).toBe(200);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0].headers.get('authorization')).toBe('Bearer new');
  });

  it('never retries a 403', async () => {
    const fetchMock = vi.fn((_request: Request) => Promise.resolve(respond(403)));
    vi.stubGlobal('fetch', fetchMock);
    const refreshSession = vi.fn(() => Promise.resolve(true));

    const response = await createApiFetch({ getAccessToken: () => 't', refreshSession })(
      new Request('http://api.test/api/v1/x'),
    );

    expect(response.status).toBe(403);
    expect(refreshSession).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns the 401 when the refresh fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_request: Request) => Promise.resolve(respond(401))),
    );

    const response = await createApiFetch({
      getAccessToken: () => 't',
      refreshSession: () => Promise.resolve(false),
    })(new Request('http://api.test/api/v1/x'));

    expect(response.status).toBe(401);
  });
});
