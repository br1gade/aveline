import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type Redis from 'ioredis';
import { CacheModule } from './cache.module';
import { REDIS_CLIENT } from './cache.service';

/**
 * A Redis outage must fail a command at once so CacheService falls through to
 * Postgres (backend/docs/DATA_STORES.md §2). With ioredis's default offline
 * queue, every cached read would wait behind an unreachable server instead.
 */
describe('CacheModule Redis client', () => {
  let moduleRef: TestingModule;
  let client: Redis;

  beforeAll(async () => {
    // Port 1 on loopback: nothing listens there, so the client never connects.
    const values: Record<string, string> = { REDIS_URL: 'redis://127.0.0.1:1' };
    @Global()
    @Module({ providers: [{ provide: ConfigService, useValue: { get: (key: string) => values[key] } }], exports: [ConfigService] })
    class EnvironmentModule {}

    moduleRef = await Test.createTestingModule({ imports: [EnvironmentModule, CacheModule] }).compile();
    client = moduleRef.get<Redis>(REDIS_CLIENT);
    client.on('error', () => undefined);
  });

  afterAll(() => {
    client.disconnect();
  });

  it('is built to fail fast rather than queue behind an outage', () => {
    expect(client.options).toMatchObject({ enableOfflineQueue: false, maxRetriesPerRequest: 1, host: '127.0.0.1', port: 1 });
  });

  it('rejects a command immediately while Redis is unreachable', async () => {
    // This error is raised synchronously by the offline-queue check, before
    // any retry: the command never waits for a connection.
    await expect(client.get('anything')).rejects.toThrow(/enableOfflineQueue options is false/);
  });

  it('keeps reconnecting with a backoff capped at two seconds', () => {
    const retryStrategy = client.options.retryStrategy as (times: number) => number;

    expect([1, 5, 10, 100].map((times) => retryStrategy(times))).toEqual([200, 1000, 2000, 2000]);
  });
});
