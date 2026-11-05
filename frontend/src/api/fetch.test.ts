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

  it.each([
    ['/api/v1/subscription', 'org-1'],
    ['/api/v1/events', 'org-1'],
    ['/api/v1/events/e1/guests', null],
    ['/api/v1/me/organizations', null],
  ])('says which organization on %s only where it takes one', async (path, expected) => {
    const fetchMock = vi.fn((_request: Request) => Promise.resolve(respond(200)));
    vi.stubGlobal('fetch', fetchMock);

    await createApiFetch({ getOrganizationId: () => 'org-1' })(
      new Request(`http://api.test${path}`),
    );

    expect(fetchMock.mock.calls[0]?.[0].headers.get('x-aveline-organization-id')).toBe(expected);
  });

  it('keeps the organization a call names itself, over the one this tab chose', async () => {
    const fetchMock = vi.fn((_request: Request) => Promise.resolve(respond(200)));
    vi.stubGlobal('fetch', fetchMock);

    await createApiFetch({ getOrganizationId: () => 'org-1' })(
      new Request('http://api.test/api/v1/organizations/current/members', {
        headers: { 'x-aveline-organization-id': 'org-2' },
      }),
    );

    expect(fetchMock.mock.calls[0]?.[0].headers.get('x-aveline-organization-id')).toBe('org-2');
  });

  it('says none when this tab chose none', async () => {
    const fetchMock = vi.fn((_request: Request) => Promise.resolve(respond(200)));
    vi.stubGlobal('fetch', fetchMock);

    await createApiFetch({ getOrganizationId: () => undefined })(
      new Request('http://api.test/api/v1/subscription'),
    );

    expect(fetchMock.mock.calls[0]?.[0].headers.has('x-aveline-organization-id')).toBe(false);
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

  it('asks for errors in the page’s language, unless the call names one', async () => {
    const fetchMock = vi.fn((_request: Request) => Promise.resolve(respond(200)));
    vi.stubGlobal('fetch', fetchMock);
    const send = createApiFetch({ getLanguage: () => 'hy' });

    await send(new Request('http://api.test/api/v1/x'));
    await send(new Request('http://api.test/api/v1/x', { headers: { 'accept-language': 'ru' } }));

    expect(fetchMock.mock.calls[0]?.[0].headers.get('accept-language')).toBe('hy');
    expect(fetchMock.mock.calls[1]?.[0].headers.get('accept-language')).toBe('ru');
  });

  it('sends no language when it knows none', async () => {
    const fetchMock = vi.fn((_request: Request) => Promise.resolve(respond(200)));
    vi.stubGlobal('fetch', fetchMock);

    await createApiFetch({ getLanguage: () => undefined })(new Request('http://api.test/api/v1/x'));
    await createApiFetch()(new Request('http://api.test/api/v1/x'));

    expect(fetchMock.mock.calls[0]?.[0].headers.has('accept-language')).toBe(false);
    expect(fetchMock.mock.calls[1]?.[0].headers.has('accept-language')).toBe(false);
  });
});
