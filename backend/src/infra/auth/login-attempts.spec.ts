import type Redis from 'ioredis';
import { LOGIN_FAILURE_LIMIT, LoginAttempts } from './login-attempts';

/** An in-memory stand-in for the three Redis calls the rule makes. */
function fakeRedis() {
  const counts = new Map<string, number>();
  const expiries = new Map<string, number>();
  const redis = {
    get: jest.fn((key: string) => Promise.resolve(counts.has(key) ? String(counts.get(key)) : null)),
    multi: jest.fn(() => {
      const chain = {
        incr: (key: string) => { counts.set(key, (counts.get(key) ?? 0) + 1); return chain; },
        expire: (key: string, seconds: number) => { expiries.set(key, seconds); return chain; },
        exec: () => Promise.resolve([]),
      };
      return chain;
    }),
    del: jest.fn((key: string) => { counts.delete(key); return Promise.resolve(1); }),
  };
  return { redis: redis as unknown as Redis, counts, expiries };
}

/**
 * The per-address limit lets one script try thousands of passwords on one
 * account in an hour from enough addresses. This counts failures per account
 * instead (audit F-29).
 */
describe('LoginAttempts', () => {
  const email = 'ani@aveline.am';

  it(`lets the ${LOGIN_FAILURE_LIMIT}th attempt through and refuses the next`, async () => {
    const attempts = new LoginAttempts(fakeRedis().redis);
    for (let failure = 1; failure < LOGIN_FAILURE_LIMIT; failure += 1) await attempts.recordFailure(email);
    await expect(attempts.assertAllowed(email)).resolves.toBeUndefined();

    await attempts.recordFailure(email);
    await expect(attempts.assertAllowed(email)).rejects.toMatchObject({ code: 'LOGIN_TOO_MANY_ATTEMPTS' });
  });

  it('counts each account on its own, and never stores the address itself', async () => {
    const { redis, counts } = fakeRedis();
    const attempts = new LoginAttempts(redis);
    for (let failure = 0; failure < LOGIN_FAILURE_LIMIT; failure += 1) await attempts.recordFailure(email);

    await expect(attempts.assertAllowed('davit@aveline.am')).resolves.toBeUndefined();
    expect([...counts.keys()].join()).not.toContain('aveline');
  });

  it('starts the window at the first failure and lets it lapse', async () => {
    const { redis, expiries } = fakeRedis();
    await new LoginAttempts(redis).recordFailure(email);
    expect([...expiries.values()]).toEqual([15 * 60]);
  });

  it('forgets the failures after a successful sign-in', async () => {
    const attempts = new LoginAttempts(fakeRedis().redis);
    for (let failure = 0; failure < LOGIN_FAILURE_LIMIT; failure += 1) await attempts.recordFailure(email);
    await attempts.recordSuccess(email);

    await expect(attempts.assertAllowed(email)).resolves.toBeUndefined();
  });

  // Redis holds only what can be rebuilt; its outage must not stop sign-in.
  it('lets sign-in proceed when Redis is down', async () => {
    const down = jest.fn(() => Promise.reject(new Error('Connection is closed.')));
    const redis = { get: down, del: down, multi: () => ({ incr: () => ({ expire: () => ({ exec: down }) }) }) } as unknown as Redis;
    const attempts = new LoginAttempts(redis);

    await expect(attempts.assertAllowed(email)).resolves.toBeUndefined();
    await expect(attempts.recordFailure(email)).resolves.toBeUndefined();
    await expect(attempts.recordSuccess(email)).resolves.toBeUndefined();
  });
});
