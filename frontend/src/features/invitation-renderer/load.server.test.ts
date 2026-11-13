// @vitest-environment node
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { plantedToken } from '../../../test/tokens';
import { block, invitationFixture } from './fixtures';
import { loadInvitationPage } from './load.server';

const ORIGIN = 'http://api.internal';
const token = plantedToken();
const artwork = (id: string) => `/api/v1/invitations/anna/g/${token}/design-assets/${id}/file`;
const server = setupServer();
const visitorPage = new Request('https://aveline.test/invitations/anna');

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => vi.stubEnv('API_INTERNAL_URL', ORIGIN));
afterEach(() => {
  server.resetHandlers();
  vi.unstubAllEnvs();
});
afterAll(() => server.close());

describe('a personal page whose template has private artwork', () => {
  it('keeps the guest’s token out of everything the page is given', async () => {
    server.use(
      http.get(`${ORIGIN}/api/v1/invitations/anna/g/:token`, () =>
        HttpResponse.json(
          invitationFixture({
            coverUrl: artwork('cover'),
            blocks: [block('cover', { content: { photo: artwork('a1') } })],
          }) as never,
        ),
      ),
    );
    const page = await loadInvitationPage({ slug: 'anna', guestToken: token }, visitorPage);
    expect(JSON.stringify(page)).not.toContain(token);
    expect(page).toMatchObject({
      state: 'found',
      invitation: { coverUrl: null },
      preview: { image: null },
    });
  });

  it('tells the API whose page it is, so each visitor has their own allowance', async () => {
    let forwardedFor: string | null = null;
    server.use(
      http.get(`${ORIGIN}/api/v1/invitations/anna/g/:token`, ({ request }) => {
        forwardedFor = request.headers.get('x-forwarded-for');
        return HttpResponse.json(invitationFixture() as never);
      }),
    );
    const behindProxy = new Request('https://aveline.test/invitations/anna', {
      headers: { 'x-forwarded-for': '198.51.100.9, 203.0.113.7' },
    });
    await loadInvitationPage({ slug: 'anna', guestToken: token }, behindProxy);
    expect(forwardedFor).toBe('203.0.113.7');
  });

  it('calls a wrong link not found', async () => {
    server.use(
      http.get(`${ORIGIN}/api/v1/invitations/anna/g/:token`, () =>
        HttpResponse.json({ statusCode: 404, message: 'Not found' }, { status: 404 }),
      ),
    );
    await expect(
      loadInvitationPage({ slug: 'anna', guestToken: token }, visitorPage),
    ).resolves.toEqual({
      state: 'not-found',
    });
  });
});
