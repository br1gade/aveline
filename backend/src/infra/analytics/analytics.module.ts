import { Global, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongoClient } from 'mongodb';
import {
  ANALYTICS_ENABLED,
  ANALYTICS_READ_TIMEOUT_MS,
  AnalyticsService,
  MONGO_CONNECTION,
} from './analytics.service';
import { MongoConnection } from './mongo-connection';

const DEFAULT_MONGO_URL = 'mongodb://aveline:aveline@localhost:27018/aveline?authSource=admin';

@Global()
@Module({
  providers: [
    {
      provide: ANALYTICS_ENABLED,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        (config.get<string>('ANALYTICS_ENABLED') ?? 'true') !== 'false',
    },
    {
      provide: ANALYTICS_READ_TIMEOUT_MS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        Number(config.get<string>('ANALYTICS_READ_TIMEOUT_MS') ?? 300),
    },
    {
      provide: MONGO_CONNECTION,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('MONGO_URL') ?? DEFAULT_MONGO_URL;
        return new MongoConnection(
          () =>
            new MongoClient(url, {
              // Well under the dashboard's latency budget (spec §12): analytics
              // is the least important panel and must yield first.
              serverSelectionTimeoutMS: 500,
              connectTimeoutMS: 500,
            }),
        );
      },
    },
    AnalyticsService,
  ],
  exports: [AnalyticsService, MONGO_CONNECTION],
})
export class AnalyticsModule implements OnModuleInit, OnApplicationShutdown {
  constructor(private readonly analytics: AnalyticsService) {}

  async onModuleInit(): Promise<void> {
    await this.analytics.ensureIndexes();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.analytics.shutdown();
  }
}
