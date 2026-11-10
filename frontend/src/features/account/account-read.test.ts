import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '@/api/client';

import { forgetAccount, readAccountOnce } from './account-read';

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

const account = (isEmailVerified: boolean) => ({
  id: 'u1',
  email: 'anna@example.am',
  name: 'Anna',
  platformRole: 'NONE',
  createdAt: '2026-10-01T10:00:00Z',
  emailVerifiedAt: isEmailVerified ? '2026-10-01T10:05:00Z' : null,
  isEmailVerified,
});

function apiAnswering(...answers: boolean[]) {
  let call = 0;
  const GET = vi.fn(() => {
    const isVerified = answers[Math.min(call, answers.length - 1)] ?? true;
    call += 1;
    return Promise.resolve({ data: account(isVerified), response: new Response() });
  });
  return { api: { GET } as unknown as ApiClient, GET };
}

describe('who is signed in, read once a session (FR-5)', () => {
  afterEach(forgetAccount);

  it('shares one read between the layout and the page loading beside it', async () => {
    const { api, GET } = apiAnswering(true);
    await Promise.all([readAccountOnce(api), readAccountOnce(api)]);
    expect(GET).toHaveBeenCalledOnce();
  });

  it('keeps a confirmed address for the session', async () => {
    const { api, GET } = apiAnswering(true);
    await readAccountOnce(api);
    await readAccountOnce(api);
    expect(GET).toHaveBeenCalledOnce();
  });

  it('asks again on each page while the address is not confirmed, so the notice goes once it is', async () => {
    const { api, GET } = apiAnswering(false, true);
    await expect(readAccountOnce(api)).resolves.toMatchObject({ isEmailVerified: false });
    await expect(readAccountOnce(api)).resolves.toMatchObject({ isEmailVerified: true });
    await readAccountOnce(api);
    expect(GET).toHaveBeenCalledTimes(2);
  });

  it('asks again for whoever signs in next in this tab', async () => {
    const { api, GET } = apiAnswering(true);
    await readAccountOnce(api);
    for (const listener of session.signedOut) listener();
    await readAccountOnce(api);
    expect(GET).toHaveBeenCalledTimes(2);
  });

  it('asks again after a read that failed', async () => {
    const GET = vi
      .fn()
      .mockRejectedValueOnce(new Error('no answer'))
      .mockResolvedValue({ data: account(true), response: new Response() });
    const api = { GET } as unknown as ApiClient;
    await expect(readAccountOnce(api)).rejects.toBeDefined();
    await expect(readAccountOnce(api)).resolves.toMatchObject({ email: 'anna@example.am' });
  });
});
