import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/errors';

import type { Route } from './+types/home';
import { clientLoader } from './home';

const reads = vi.hoisted(() => ({ account: vi.fn() }));
vi.mock('@/features/account', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireSignedIn: () => Promise.resolve({ api: {} }),
  ownOrganization: () => Promise.resolve(null),
  readAccountOnce: reads.account,
}));
vi.mock('@/features/events', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listEvents: () => Promise.resolve([]),
}));

/** Where an account with no organization and no event is sent first. */
async function firstStop(): Promise<string | null> {
  try {
    await clientLoader({
      request: new Request('http://app.test/app'),
    } as unknown as Route.ClientLoaderArgs);
    return null;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown.headers.get('Location');
    throw thrown;
  }
}

describe('who is staff, from who is signed in (FR-5, design PD-165)', () => {
  it.each([
    ['NONE', '/app/welcome'],
    ['SUPPORT', '/app/staff'],
    ['ADMIN', '/app/staff'],
  ])('%s is sent to %s', async (platformRole, stop) => {
    reads.account.mockResolvedValueOnce({ platformRole });
    await expect(firstStop()).resolves.toBe(stop);
  });

  it('takes an account whose read failed for a customer: the console still asks for itself', async () => {
    reads.account.mockRejectedValueOnce(new ApiError({ status: 500, messages: [] }));
    await expect(firstStop()).resolves.toBe('/app/welcome');
  });
});
