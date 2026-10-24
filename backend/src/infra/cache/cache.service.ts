import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { VersionedPayloadCache } from './versioned-payload-cache';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

const NAMESPACE = 'aveline';

/** One key per slug AND locale — a cached Armenian page must never be served
 *  to a guest who reads Russian. */
export function invitationCacheKey(slug: string, locale: string): string {
  return `${NAMESPACE}:invitation:${slug}:${locale}`;
}

/**
 * How many times this invitation's cache has been invalidated. Outside the
 * pattern below on purpose: deleting it with the payloads would reset it,
 * and a reset counter cannot tell an old read from a new one.
 */
export function invitationGenerationKey(slug: string): string {
  return `${NAMESPACE}:invitation-generation:${slug}`;
}

/** Longer than any load could take; refreshed on every invalidation. */
const GENERATION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Writes the value only if the generation is still the one read before loading. */
const SET_IF_GENERATION = `
  local current = redis.call('GET', KEYS[2]) or '0'
  if current == ARGV[1] then
    redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
    return 1
  end
  return 0`;

export function invitationKeyPattern(slug: string): string {
  return `${NAMESPACE}:invitation:${slug}:*`;
}

/**
 * Read-through cache over Redis.
 *
 * The governing rule: **a cache outage must not become a product outage.**
 * Every method here degrades to "not cached" and lets the request proceed
 * against Postgres. Redis holds only data that can be rebuilt, so losing it
 * costs latency and nothing else.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly versioned = new VersionedPayloadCache();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async readVersioned<T>(scope: string, revision: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    const key = `${scope}:${revision}`;
    const cached = this.versioned.get<T>(key);
    if (cached !== null) return cached;
    const fresh = await this.readThrough(key, ttlSeconds, load);
    this.versioned.set(key, fresh, ttlSeconds);
    return fresh;
  }

  clearVersioned(): void { this.versioned.clear(); }

  rememberVersioned(scope: string, revision: string, ttlSeconds: number, value: unknown): void {
    this.versioned.set(`${scope}:${revision}`, value, ttlSeconds);
  }

  /**
   * With a `generationKey`, a value is stored only if nothing invalidated it
   * while it was loading. A request that read the old row, then saw a write
   * invalidate, then stored what it had read put the stale page back for the
   * whole TTL (B87).
   */
  async readThrough<T>(key: string, ttlSeconds: number, load: () => Promise<T>, generationKey?: string): Promise<T> {
    const cached = await this.tryGet<T>(key);
    if (cached !== null) return cached;

    const generation = generationKey ? await this.tryGetRaw(generationKey) : null;
    const identity = JSON.stringify([key, generationKey, generation]);
    return this.shareLoad(identity, async () => {
      const fresh = await load();
      await (generationKey
        ? this.trySetIfGeneration({ key, generationKey, generation: generation ?? '0' }, fresh, ttlSeconds)
        : this.trySet(key, fresh, ttlSeconds));
      return fresh;
    });
  }

  async shareLoad<T>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing as Promise<T>;
    const request = Promise.resolve().then(load);
    // Bound bookkeeping even if unrelated loaders stall; overload still reads Postgres.
    if (this.pending.size >= 1000) return request;
    this.pending.set(key, request);
    try { return await request; } finally { this.pending.delete(key); }
  }

  /** Drops every locale variant for one invitation. Called on any write that
   *  changes what the public page renders. The generation moves first, so a
   *  load already under way cannot store what it read. */
  async invalidateInvitation(slug: string): Promise<void> {
    try {
      const generationKey = invitationGenerationKey(slug);
      await this.redis.incr(generationKey);
      await this.redis.expire(generationKey, GENERATION_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(`cache generation bump failed for ${slug}: ${describe(error)}`);
    }
    await this.deleteByPattern(invitationKeyPattern(slug));
  }

  /** Closes the connection so the process can exit cleanly in tests and on
   *  shutdown. Safe to call when Redis is already unreachable. */
  async disconnect(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }

  private async tryGet<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch (error) {
      // A malformed entry or an unreachable Redis both mean "miss".
      this.logger.warn(`cache read failed for ${key}: ${describe(error)}`);
      return null;
    }
  }

  private async tryGetRaw(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch {
      return null;
    }
  }

  private async trySetIfGeneration(
    { key, generationKey, generation }: { key: string; generationKey: string; generation: string },
    value: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.redis.eval(SET_IF_GENERATION, 2, key, generationKey, generation, JSON.stringify(value), ttlSeconds);
    } catch (error) {
      this.logger.warn(`cache write failed for ${key}: ${describe(error)}`);
    }
  }

  private async trySet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(`cache write failed for ${key}: ${describe(error)}`);
    }
  }

  /**
   * SCAN rather than KEYS: KEYS blocks the Redis event loop for the whole
   * keyspace, which on a shared instance stalls every other client.
   */
  private async deleteByPattern(pattern: string): Promise<void> {
    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = next;
        if (keys.length > 0) await this.redis.del(...keys);
      } while (cursor !== '0');
    } catch (error) {
      this.logger.warn(`cache invalidation failed for ${pattern}: ${describe(error)}`);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
