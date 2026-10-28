import { VersionedPayloadCache } from './versioned-payload-cache';

describe('Bounded immutable payload memory', () => {
  afterEach(() => jest.restoreAllMocks());
  it.each([NaN, Infinity, -Infinity, 0, -1])('does not retain payloads with an invalid TTL: %s', (ttl) => {
    const cache = new VersionedPayloadCache();
    cache.set('invalid', { value: 'payload' }, ttl);
    expect(cache.get('invalid')).toBeNull();
  });
  it('expires at the caller TTL and never retains a payload beyond five minutes', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(0);
    const cache = new VersionedPayloadCache();
    cache.set('long', { value: 'long' }, 3600); cache.set('short', { value: 'short' }, 1);
    now.mockReturnValue(1000);
    expect(cache.get('short')).toBeNull(); expect(cache.get('long')).toEqual({ value: 'long' });
    now.mockReturnValue(300000); expect(cache.get('long')).toBeNull();
  });
  it('bounds entries and bytes and skips oversized or unserializable payloads', () => {
    const cache = new VersionedPayloadCache();
    for (let index = 0; index < 513; index++) cache.set(`entry-${index}`, index, 60);
    expect(cache.get('entry-0')).toBeNull(); expect(cache.get('entry-512')).toBe(512);
    cache.clear();
    for (let index = 0; index < 100; index++) cache.set(`bytes-${index}`, 'x'.repeat(200000), 60);
    expect(cache.get('bytes-0')).toBeNull(); expect(cache.get('bytes-99')).toHaveLength(200000);
    cache.set('oversized', 'x'.repeat(262144), 60); expect(cache.get('oversized')).toBeNull();
    expect(() => cache.set('bigint', 1n, 60)).not.toThrow(); expect(cache.get('bigint')).toBeNull();
  });
});
