import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createAppApi } from '@/api/client';

import { ownOrganization } from './api';

const ORIGIN = 'http://api.test';
const MEMBERSHIPS = `${ORIGIN}/api/v1/me/organizations`;

const server = setupServer();
const api = createAppApi(ORIGIN, {});

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('ownOrganization', () => {
  it('reads the account’s organization, keeping only what the page uses', async () => {
    server.use(
      http.get(MEMBERSHIPS, () =>
        HttpResponse.json({
          items: [
            {
              organizationId: 'o1',
              name: 'Petrosyan Wedding',
              kind: 'HOST',
              role: 'OWNER',
              joinedAt: '2026-10-01T10:00:00.000Z',
            },
          ],
          nextCursor: null,
        }),
      ),
    );
    await expect(ownOrganization(api)).resolves.toEqual({
      organizationId: 'o1',
      name: 'Petrosyan Wedding',
    });
  });

  it('says so when the account has none', async () => {
    server.use(http.get(MEMBERSHIPS, () => HttpResponse.json({ items: [], nextCursor: null })));
    await expect(ownOrganization(api)).resolves.toBeNull();
  });

  it('does not read a refusal as having none', async () => {
    server.use(
      http.get(MEMBERSHIPS, () =>
        HttpResponse.json({ statusCode: 403, message: 'No' }, { status: 403 }),
      ),
    );
    await expect(ownOrganization(api)).rejects.toMatchObject({ status: 403 });
  });
});
