import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '@/api/client';
import { organizationChoice } from '@/api/session';

import { forgetSettledOrganization } from './organizations';
import { requireOrganizationChosen } from './require-session';

vi.mock('@/api/session', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  browserSession: () => ({ onSignedOut: () => () => undefined }),
}));

const one = { organizationId: 'a', name: 'A', role: 'OWNER' };
const two = { organizationId: 'b', name: 'B', role: 'OWNER' };

function apiWith(items: unknown[]): ApiClient {
  const GET = vi.fn(() =>
    Promise.resolve({ data: { items, nextCursor: null }, response: new Response() }),
  );
  return { GET } as unknown as ApiClient;
}

/** The redirect the loader threw, or a failure if it threw none. */
async function redirectOf(run: Promise<unknown>): Promise<string | null> {
  const thrown = await run.then(
    () => null,
    (error: unknown) => error,
  );
  return thrown instanceof Response ? thrown.headers.get('Location') : null;
}

const url = (address: string) => new URL(address, 'http://app.test');

beforeEach(() => forgetSettledOrganization());
afterEach(() => organizationChoice.clear());

describe('an account that has to choose an organization', () => {
  it('goes to choose, and comes back to the whole address', async () => {
    const going = requireOrganizationChosen(apiWith([one, two]), url('/app/billing?tab=a&b=c'));
    expect(await redirectOf(going)).toBe(
      '/app/organizations?next=%2Fapp%2Fbilling%3Ftab%3Da%26b%3Dc',
    );
  });

  it('comes back only where the page says, so a bank’s query stays out', async () => {
    const going = requireOrganizationChosen(
      apiWith([one, two]),
      url('/billing/return?orderId=secret'),
      '/billing/return',
    );
    expect(await redirectOf(going)).toBe('/app/organizations?next=%2Fbilling%2Freturn');
  });

  it('isn’t sent to the chooser from the chooser', async () => {
    const settled = await requireOrganizationChosen(
      apiWith([one, two]),
      url('/app/organizations?next=%2Fapp'),
    );
    expect(settled).toMatchObject({ needsChoice: true });
  });

  it('stays once it has chosen', async () => {
    organizationChoice.choose('b');
    const settled = await requireOrganizationChosen(apiWith([one, two]), url('/app/billing'));
    expect(settled).toMatchObject({ needsChoice: false, current: { organizationId: 'b' } });
  });

  it('leaves a failed read to the page, whose own reads word it', async () => {
    const api = { GET: () => Promise.reject(new Error('no answer')) } as unknown as ApiClient;
    await expect(requireOrganizationChosen(api, url('/app/billing'))).resolves.toBeNull();
  });
});
