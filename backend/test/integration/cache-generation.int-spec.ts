import Redis from 'ioredis';
import { CacheService, invitationCacheKey, invitationGenerationKey } from '../../src/infra/cache/cache.service';

/**
 * B87: a request that read the old page, then saw a write invalidate the
 * cache, then stored what it had read put the stale page back for the whole
 * TTL. Against real Redis, because the guard is a script Redis runs.
 */
describe('invitation cache generations (integration)', () => {
  let redis: Redis;
  let cache: CacheService;
  const slug = `generation-${Date.now()}`;
  const key = invitationCacheKey(slug, 'hy');

  beforeAll(() => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380', { lazyConnect: false, maxRetriesPerRequest: 1 });
    cache = new CacheService(redis);
  });

  afterEach(async () => {
    await redis.del(key, invitationGenerationKey(slug));
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('does not store a page that was invalidated while it loaded', async () => {
    const loaded = await cache.readThrough(
      key,
      60,
      async () => {
        await cache.invalidateInvitation(slug);
        return { title: 'before the edit' };
      },
      invitationGenerationKey(slug),
    );

    expect(loaded).toEqual({ title: 'before the edit' });
    expect(await redis.get(key)).toBeNull();
  });

  it('stores a page when nothing changed meanwhile', async () => {
    await cache.invalidateInvitation(slug);

    await cache.readThrough(key, 60, () => Promise.resolve({ title: 'current' }), invitationGenerationKey(slug));

    expect(JSON.parse((await redis.get(key)) ?? 'null')).toEqual({ title: 'current' });
  });
});
