import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { JobLockService } from '../../../src/infra/jobs/job-lock.service';

/**
 * The sweep lock against a real Redis (backend/docs/ARCHITECTURE.md §3).
 *
 * The unit test fakes SET NX EX with a Map and ignores the release script's
 * text, so neither the atomic acquire, the TTL nor the compare-and-delete Lua
 * had ever run. Two services on two connections stand in for two instances.
 */
describe('JobLockService on real Redis', () => {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6380';
  let first: Redis;
  let second: Redis;
  let job: { name: string; ttlSeconds: number; crontab: string };
  const key = () => `aveline:lock:${job.name}`;

  /**
   * Work that stays running until the test lets it finish. finish() releases
   * every call, so a lock that wrongly admitted two runs fails the count
   * rather than hanging the test.
   */
  const heldWork = () => {
    const finishers: (() => void)[] = [];
    let markStarted: () => void = () => undefined;
    let markStartedAgain: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const startedAgain = new Promise<void>((resolve) => { markStartedAgain = resolve; });
    const work = jest.fn(() => new Promise<void>((resolve) => {
      finishers.push(resolve);
      (finishers.length === 1 ? markStarted : markStartedAgain)();
    }));
    return { work, started, startedAgain, finish: () => finishers.forEach((resolve) => resolve()) };
  };

  beforeAll(() => {
    first = new Redis(url, { maxRetriesPerRequest: 1 });
    second = new Redis(url, { maxRetriesPerRequest: 1 });
  });

  beforeEach(() => {
    job = { name: `coverage.${randomUUID()}`, ttlSeconds: 55, crontab: '* * * * *' };
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await first.del(key());
  });

  afterAll(async () => {
    await first.quit();
    await second.quit();
  });

  it('runs the work on exactly one of two instances racing for the lock', async () => {
    const held = heldWork();
    const runs = [new JobLockService(first), new JobLockService(second)].map((instance) => instance.runExclusively(job, held.work));

    // The loser returns at once while the winner is still inside its work —
    // unless the lock let both in, which the count below then reports.
    await held.started;
    await Promise.race([...runs, held.startedAgain]);
    held.finish();
    await Promise.all(runs);

    expect(held.work).toHaveBeenCalledTimes(1);
  });

  it('skips the second instance while the first is still running', async () => {
    const held = heldWork();
    const running = new JobLockService(first).runExclusively(job, held.work);
    await held.started;
    const skipped = jest.fn(() => Promise.resolve());

    await new JobLockService(second).runExclusively(job, skipped);
    held.finish();
    await running;

    expect(skipped).not.toHaveBeenCalled();
  });

  it('takes the lock with the job TTL, so a holder that dies cannot block the sweep forever', async () => {
    const held = heldWork();
    const running = new JobLockService(first).runExclusively({ ...job, ttlSeconds: 30 }, held.work);
    await held.started;

    const ttl = await second.ttl(key());
    held.finish();
    await running;

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);
  });

  it('releases the lock when the work finishes, so the next run proceeds', async () => {
    await new JobLockService(first).runExclusively(job, () => Promise.resolve());
    const next = jest.fn(() => Promise.resolve());

    expect(await second.exists(key())).toBe(0);
    await new JobLockService(second).runExclusively(job, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('releases the lock when the work fails', async () => {
    await expect(new JobLockService(first).runExclusively(job, () => Promise.reject(new Error('sweep broke')))).rejects.toThrow('sweep broke');

    expect(await second.exists(key())).toBe(0);
  });

  it("leaves another run's lock in place when its own expired mid-run", async () => {
    const held = heldWork();
    const running = new JobLockService(first).runExclusively(job, held.work);
    await held.started;
    // What expiry followed by the next run's SET NX looks like from here.
    await second.set(key(), 'the-next-run', 'EX', 55);

    held.finish();
    await running;

    expect(await second.get(key())).toBe('the-next-run');
  });

  it('does not run while a lock some other process left behind is still live', async () => {
    await second.set(key(), 'abandoned', 'EX', 55);
    const work = jest.fn(() => Promise.resolve());

    await new JobLockService(first).runExclusively(job, work);

    expect(work).not.toHaveBeenCalled();
    expect(await second.get(key())).toBe('abandoned');
  });

  // Redis's clock cannot be faked, so instead of waiting out the TTL the
  // abandoned lock's expiry is moved into the past: Redis then expires it
  // itself, exactly as it would once the TTL ran out.
  it('runs again once an abandoned lock has expired', async () => {
    await second.set(key(), 'abandoned', 'EX', 55);
    await second.pexpireat(key(), 1);
    const work = jest.fn(() => Promise.resolve());

    await new JobLockService(first).runExclusively(job, work);

    expect(work).toHaveBeenCalledTimes(1);
  });
});
