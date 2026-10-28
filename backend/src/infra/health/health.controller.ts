import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CLIENT } from '../cache/cache.service';
import { MongoConnection } from '../analytics/mongo-connection';
import { MONGO_CONNECTION } from '../analytics/analytics.service';
import { Public } from '../auth/actor';
import { StorageService } from '../storage/storage.service';

/**
 * Liveness and readiness.
 *
 * The distinction matters for deployment: liveness says the process is up,
 * readiness says it should receive traffic. Only Postgres is required for
 * readiness — Redis and Mongo outages degrade the product rather than break
 * it (see docs/DATA_STORES.md), so taking the instance out of rotation for
 * them would turn a slowdown into an outage.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(MONGO_CONNECTION) private readonly mongo: MongoConnection,
    private readonly storage: StorageService,
  ) {}

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Process is running' })
  live() {
    return { status: 'ok', at: new Date().toISOString() };
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Dependencies reachable; only Postgres is required' })
  async ready() {
    const [postgres, redis, mongo, storage] = await Promise.all([
      this.check(() => this.prisma.$queryRaw`SELECT 1`),
      this.check(() => this.redis.ping()),
      this.check(() => this.mongo.probe()),
      this.check(() => this.storage.probe()),
    ]);

    const report = { required: { postgres }, optional: { redis, mongo, storage }, at: new Date().toISOString() };
    // Without Postgres nothing is served, so it is not ready: 503, which the
    // container's healthcheck and a load balancer act on. It used to say
    // "degraded" with a 200, and "ok" with Redis or Mongo down — the reverse.
    if (!postgres.isUp) throw new ServiceUnavailableException({ status: 'unavailable', ...report });
    return { status: redis.isUp && mongo.isUp && storage.isUp ? 'ok' : 'degraded', ...report };
  }

  private async check(probe: () => Promise<unknown>) {
    const startedAt = Date.now();
    try {
      await probe();
      return { isUp: true, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        isUp: false,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
