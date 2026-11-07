import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '@/api/client';
import { organizationChoice } from '@/api/session';

import { clientLoader } from './organizations';

const signedIn = vi.hoisted((): { api?: ApiClient } => ({}));
vi.mock('@/features/account', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireSignedIn: () => Promise.resolve({ api: signedIn.api }),
}));

const one = { organizationId: 'a', name: 'A', role: 'OWNER' };
const two = { organizationId: 'b', name: 'B', role: 'OWNER' };

function memberOf(...items: unknown[]) {
  const GET = vi.fn(() =>
    Promise.resolve({ data: { items, nextCursor: null }, response: new Response() }),
  );
  signedIn.api = { GET } as unknown as ApiClient;
}

const load = (address: string) =>
  clientLoader({
    request: new Request(new URL(address, 'http://app.test')),
  } as unknown as Parameters<typeof clientLoader>[0]);

afterEach(() => organizationChoice.clear());

describe('the organization chooser’s loader', () => {
  it('sends an account with one organization home, and forgets a choice it held', async () => {
    memberOf(one);
    organizationChoice.choose('gone');
    const thrown = await load('/app/organizations').catch((error: unknown) => error);
    expect(thrown instanceof Response ? thrown.headers.get('Location') : null).toBe('/app');
    expect(organizationChoice.read()).toBeUndefined();
  });

  it('goes on only to a page of this client once chosen', async () => {
    memberOf(one, two);
    await expect(load('/app/organizations?next=https://evil.example')).resolves.toMatchObject({
      next: '/app',
    });
    await expect(load('/app/organizations?next=%2Fapp%2Fbilling')).resolves.toMatchObject({
      next: '/app/billing',
    });
  });
});
