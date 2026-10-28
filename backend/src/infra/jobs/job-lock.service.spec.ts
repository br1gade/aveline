import type Redis from 'ioredis';
import { JobLockService } from './job-lock.service';

/**
 * B80: the lock was released with a bare DEL, so a run that outlived its TTL
 * deleted the lock the next run had taken, and a third could start.
 */
describe('JobLockService', () => {
  /** Enough of Redis for SET NX EX and a compare-and-delete script. */
  const fakeRedis = () => {
    const store = new Map<string, string>();
    const redis = {
      set: (key: string, value: string) => {
        if (store.has(key)) return Promise.resolve(null);
        store.set(key, value);
        return Promise.resolve('OK');
      },
      eval: (_script: string, _keys: number, key: string, owner: string) => {
        if (store.get(key) !== owner) return Promise.resolve(0);
        store.delete(key);
        return Promise.resolve(1);
      },
      del: (key: string) => Promise.resolve(store.delete(key) ? 1 : 0),
    };
    return { redis: redis as unknown as Redis, store };
  };

  const job = { name: 'test.job', ttlSeconds: 60, crontab: '* * * * *' };

  it('runs the work once while the lock is held', async () => {
    const { redis } = fakeRedis();
    const locks = new JobLockService(redis);
    let runs = 0;

    await Promise.all([
      locks.runExclusively(job, async () => { runs += 1; await new Promise((resolve) => setTimeout(resolve, 20)); }),
      locks.runExclusively(job, () => { runs += 1; return Promise.resolve(); }),
    ]);

    expect(runs).toBe(1);
  });

  it('does not release a lock another run has taken since', async () => {
    const { redis, store } = fakeRedis();
    const locks = new JobLockService(redis);

    await locks.runExclusively(job, () => {
      // Our TTL ran out mid-run and another instance took the lock.
      store.set('aveline:lock:test.job', 'someone-else');
      return Promise.resolve();
    });

    expect(store.get('aveline:lock:test.job')).toBe('someone-else');
  });

  it('reports a failed sweep to its monitor while still releasing its lock', async () => {
    const { redis, store } = fakeRedis();
    const locks = new JobLockService(redis);
    await expect(locks.runExclusively(job, () => Promise.reject(new Error('sweep failed')))).rejects.toThrow('sweep failed');
    expect(store.size).toBe(0);
  });

  it('reports unavailable locking without running the unsafe sweep', async () => {
    const { redis } = fakeRedis();
    jest.spyOn(redis, 'set').mockRejectedValue(new Error('redis unavailable'));
    const work = jest.fn().mockResolvedValue(undefined);
    await expect(new JobLockService(redis).runExclusively(job, work)).rejects.toThrow('redis unavailable');
    expect(work).not.toHaveBeenCalled();
  });
});
