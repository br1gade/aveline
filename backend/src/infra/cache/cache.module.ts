import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CacheService, REDIS_CLIENT } from './cache.service';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis(config.get<string>('REDIS_URL') ?? 'redis://localhost:6380', {
          // Fail fast and let CacheService fall through to Postgres rather
          // than queueing requests behind an unreachable Redis.
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          lazyConnect: false,
          retryStrategy: (times) => Math.min(times * 200, 2000),
        }),
    },
    CacheService,
  ],
  exports: [CacheService, REDIS_CLIENT],
})
export class CacheModule implements OnApplicationShutdown {
  constructor(private readonly cache: CacheService) {}

  async onApplicationShutdown(): Promise<void> {
    await this.cache.disconnect();
  }
}
