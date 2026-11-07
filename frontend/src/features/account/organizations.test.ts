import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '@/api/client';
import { organizationChoice } from '@/api/session';

import { forgetSettledOrganization, settleChoice, settleOrganization } from './organizations';

const session = vi.hoisted(() => ({ signedOut: new Set<() => void>() }));
vi.mock('@/api/session', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  browserSession: () => ({
    onSignedOut: (listener: () => void) => {
      session.signedOut.add(listener);
      return () => session.signedOut.delete(listener);
    },
  }),
}));

const one = { organizationId: 'a', name: 'A' };
const two = { organizationId: 'b', name: 'B' };

afterEach(() => organizationChoice.clear());

describe('settling which organization a tab works in', () => {
  it('asks nothing of an account with none', () => {
    expect(settleChoice([])).toEqual({ current: null, needsChoice: false, canChange: false });
  });

  it('asks nothing of an account with one, and sends no selection', () => {
    expect(settleChoice([one])).toEqual({ current: one, needsChoice: false, canChange: false });
    expect(organizationChoice.read()).toBeUndefined();
  });

  it('forgets a choice left over once there is one membership', () => {
    organizationChoice.choose('b');
    expect(settleChoice([one]).current).toEqual(one);
    expect(organizationChoice.read()).toBeUndefined();
  });

  it('asks an account with several that has not chosen, with nothing picked for them', () => {
    expect(settleChoice([one, two])).toEqual({ current: null, needsChoice: true, canChange: true });
  });

  it('keeps a choice that is still theirs', () => {
    organizationChoice.choose('b');
    expect(settleChoice([one, two])).toEqual({ current: two, needsChoice: false, canChange: true });
  });

  it('asks again when the choice is no longer theirs, and forgets it', () => {
    organizationChoice.choose('gone');
    expect(settleChoice([one, two]).needsChoice).toBe(true);
    expect(organizationChoice.read()).toBeUndefined();
  });
});

describe('what the layout reads, once a tab', () => {
  afterEach(forgetSettledOrganization);

  function apiCounting(organizations: unknown[]) {
    const GET = vi.fn(() =>
      Promise.resolve({
        data: { items: organizations, nextCursor: null },
        response: new Response(),
      }),
    );
    return { api: { GET } as unknown as ApiClient, GET };
  }
  const row = { organizationId: 'a', name: 'A', kind: 'HOST', role: 'OWNER', joinedAt: 'x' };

  it('reads the memberships once, however many pages open', async () => {
    const { api, GET } = apiCounting([row]);
    await settleOrganization(api);
    await settleOrganization(api);
    expect(GET).toHaveBeenCalledOnce();
  });

  it('reads them again after a choice says it changed', async () => {
    const { api, GET } = apiCounting([row]);
    await settleOrganization(api);
    forgetSettledOrganization();
    await settleOrganization(api);
    expect(GET).toHaveBeenCalledTimes(2);
  });

  it('reads them again for whoever signs in next in this tab', async () => {
    const { api, GET } = apiCounting([row]);
    await settleOrganization(api);
    for (const listener of session.signedOut) listener();
    await settleOrganization(api);
    expect(GET).toHaveBeenCalledTimes(2);
  });

  it('reads them again after a read that failed', async () => {
    const GET = vi
      .fn()
      .mockRejectedValueOnce(new Error('no answer'))
      .mockResolvedValue({ data: { items: [row], nextCursor: null }, response: new Response() });
    const api = { GET } as unknown as ApiClient;
    await expect(settleOrganization(api)).rejects.toBeDefined();
    await expect(settleOrganization(api)).resolves.toMatchObject({ current: { name: 'A' } });
  });
});
