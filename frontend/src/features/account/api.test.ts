import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createAppApi } from '@/api/client';
import { organizationChoice } from '@/api/session';

import { ownOrganization } from './api';

const ORIGIN = 'http://api.test';
const MEMBERSHIPS = `${ORIGIN}/api/v1/me/organizations`;

const server = setupServer();
const api = createAppApi(ORIGIN, {});

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  organizationChoice.clear();
});
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
      role: 'OWNER',
    });
  });

  it('says so when the account has none', async () => {
    server.use(http.get(MEMBERSHIPS, () => HttpResponse.json({ items: [], nextCursor: null })));
    await expect(ownOrganization(api)).resolves.toBeNull();
  });

  it('names none among several until this tab chooses, then the one chosen', async () => {
    const several = [
      { organizationId: 'o1', name: 'Petrosyan Wedding', role: 'OWNER' },
      { organizationId: 'o2', name: 'Ani Events', role: 'STAFF' },
    ];
    server.use(
      http.get(MEMBERSHIPS, () => HttpResponse.json({ items: several, nextCursor: null })),
    );
    await expect(ownOrganization(api)).resolves.toBeNull();
    organizationChoice.choose('o2');
    await expect(ownOrganization(api)).resolves.toMatchObject({ organizationId: 'o2' });
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
