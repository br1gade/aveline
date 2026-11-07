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
    const page = await loadInvitationPage({ slug: 'anna', guestToken: token });
    expect(JSON.stringify(page)).not.toContain(token);
    expect(page).toMatchObject({
      state: 'found',
      invitation: { coverUrl: null },
      preview: { image: null },
    });
  });

  it('calls a wrong link not found', async () => {
    server.use(
      http.get(`${ORIGIN}/api/v1/invitations/anna/g/:token`, () =>
        HttpResponse.json({ statusCode: 404, message: 'Not found' }, { status: 404 }),
      ),
    );
    await expect(loadInvitationPage({ slug: 'anna', guestToken: token })).resolves.toEqual({
      state: 'not-found',
    });
  });
});
