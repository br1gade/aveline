import { CacheService, invitationCacheKey } from './cache.service';

/**
 * The rule these tests exist to protect: a cache outage must never become a
 * product outage. Every method degrades to "not cached" rather than throwing.
 */
describe('CacheService', () => {
  const makeRedis = (overrides: Record<string, jest.Mock> = {}) => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    scan: jest.fn().mockResolvedValue(['0', []]),
    ...overrides,
  });

  describe('invitationCacheKey', () => {
    it('separates locales so one language cannot be served for another', () => {
      expect(invitationCacheKey('wedding', 'hy')).not.toBe(invitationCacheKey('wedding', 'en'));
    });

    it('is stable for the same slug and locale', () => {
      expect(invitationCacheKey('wedding', 'hy')).toBe(invitationCacheKey('wedding', 'hy'));
    });

    it('namespaces keys so a flush cannot hit unrelated data', () => {
      expect(invitationCacheKey('wedding', 'hy')).toMatch(/^aveline:invitation:/);
    });
  });

  describe('read-through', () => {
    it('returns the cached value without calling the loader', async () => {
      const redis = makeRedis({ get: jest.fn().mockResolvedValue('{"cached":true}') });
      const loader = jest.fn();
      const cache = new CacheService(redis as never);

      await expect(cache.readThrough('k', 60, loader)).resolves.toEqual({ cached: true });
      expect(loader).not.toHaveBeenCalled();
    });

    it('calls the loader and stores the result on a miss', async () => {
      const redis = makeRedis();
      const cache = new CacheService(redis as never);
      const loader = jest.fn().mockResolvedValue({ fresh: true });

      await expect(cache.readThrough('k', 60, loader)).resolves.toEqual({ fresh: true });
      expect(redis.set).toHaveBeenCalledWith('k', '{"fresh":true}', 'EX', 60);
    });

    it('serves from the loader when the cache read throws', async () => {
      const redis = makeRedis({ get: jest.fn().mockRejectedValue(new Error('redis down')) });
      const cache = new CacheService(redis as never);

      await expect(cache.readThrough('k', 60, () => Promise.resolve({ ok: 1 }))).resolves.toEqual({
        ok: 1,
      });
    });

    it('still returns the value when the cache write throws', async () => {
      const redis = makeRedis({ set: jest.fn().mockRejectedValue(new Error('redis down')) });
      const cache = new CacheService(redis as never);

      await expect(cache.readThrough('k', 60, () => Promise.resolve({ ok: 1 }))).resolves.toEqual({
        ok: 1,
      });
    });

    it('treats unparseable cached data as a miss rather than failing', async () => {
      const redis = makeRedis({ get: jest.fn().mockResolvedValue('not json') });
      const cache = new CacheService(redis as never);

      await expect(cache.readThrough('k', 60, () => Promise.resolve({ ok: 1 }))).resolves.toEqual({
        ok: 1,
      });
    });
  });

  describe('invalidation', () => {
    it('removes every locale variant of an invitation in one pass', async () => {
      const redis = makeRedis({
        scan: jest.fn().mockResolvedValue(['0', ['aveline:invitation:s:hy', 'aveline:invitation:s:en']]),
      });
      const cache = new CacheService(redis as never);

      await cache.invalidateInvitation('s');

      expect(redis.del).toHaveBeenCalledWith('aveline:invitation:s:hy', 'aveline:invitation:s:en');
    });

    it('does not call del when nothing matched', async () => {
      const redis = makeRedis();
      const cache = new CacheService(redis as never);

      await cache.invalidateInvitation('s');

      expect(redis.del).not.toHaveBeenCalled();
    });

    it('swallows an invalidation failure rather than failing the write', async () => {
      const redis = makeRedis({ scan: jest.fn().mockRejectedValue(new Error('redis down')) });
      const cache = new CacheService(redis as never);

      await expect(cache.invalidateInvitation('s')).resolves.toBeUndefined();
    });
  });
});
