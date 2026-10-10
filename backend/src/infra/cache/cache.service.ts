import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

const NAMESPACE = 'aveline';

/** One key per slug AND locale — a cached Armenian page must never be served
 *  to a guest who reads Russian. */
export function invitationCacheKey(slug: string, locale: string): string {
  return `${NAMESPACE}:invitation:${slug}:${locale}`;
}

/** Who may read the page, and in which languages — beside the payload, invalidated with it. */
export function invitationMetaKey(slug: string): string {
  return `${NAMESPACE}:invitation:${slug}:_meta`;
}

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

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async readThrough<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    const cached = await this.tryGet<T>(key);
    if (cached !== null) return cached;

    const fresh = await load();
    await this.trySet(key, fresh, ttlSeconds);
    return fresh;
  }

  /** Drops every locale variant for one invitation. Called on any write that
   *  changes what the public page renders. */
  async invalidateInvitation(slug: string): Promise<void> {
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
