import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CLIENT } from '../cache/cache.service';
import { MONGO_CONNECTION } from '../analytics/analytics.service';
import { MongoConnection } from '../analytics/mongo-connection';
import { DependencyTransition, HealthTransitionTracker } from './health-transitions';
import { Sentry } from './sentry';

/**
 * Watches the dependencies and reports when one changes state.
 *
 * This is service health *without* tracing. Tracing would sample spans and
 * cost a budget to tell us what a four-line probe already answers: is it
 * reachable. The readiness endpoint reports the same thing, but only to
 * whoever asks — this is what notices at three in the morning.
 */
@Injectable()
export class HealthWatchService {
  private readonly logger = new Logger(HealthWatchService.name);
  private readonly tracker = new HealthTransitionTracker();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(MONGO_CONNECTION) private readonly mongo: MongoConnection,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async checkDependencies(): Promise<void> {
    const [isPostgresUp, isRedisUp, isMongoUp] = await Promise.all([
      this.isReachable(() => this.prisma.$queryRaw`SELECT 1`),
      this.isReachable(() => this.redis.ping()),
      this.isReachable(() => this.mongo.db()),
    ]);

    // Storage shares Garage's health with nothing else to probe cheaply; an
    // S3 HEAD on every tick would be a request we pay for. Reported as up
    // until there is a cheap signal worth reading.
    const readings = {
      postgres: isPostgresUp,
      redis: isRedisUp,
      mongo: isMongoUp,
      storage: true,
    };

    for (const transition of this.tracker.observe(readings)) {
      this.report(transition);
    }
  }

  private report(transition: DependencyTransition): void {
    const { dependency, isUp, heldForMs } = transition;
    const minutes = Math.round(heldForMs / 60_000);

    if (isUp) {
      this.logger.log(`${dependency} recovered after ~${minutes}m`);
      Sentry.captureMessage(`${dependency} recovered`, {
        level: 'info',
        tags: { dependency, event: 'recovered' },
        extra: { outageMinutes: minutes },
      });
      return;
    }

    // Postgres holds the domain, so losing it is an outage. Redis and Mongo
    // degrade the product rather than break it — see docs/DATA_STORES.md.
    const isRequired = dependency === 'postgres';
    this.logger.error(`${dependency} is unreachable`);
    Sentry.captureMessage(`${dependency} is unreachable`, {
      level: isRequired ? 'fatal' : 'warning',
      tags: { dependency, event: 'unreachable' },
      extra: { wasHealthyForMinutes: minutes, isRequiredForService: isRequired },
    });
  }

  private async isReachable(probe: () => Promise<unknown>): Promise<boolean> {
    try {
      await probe();
      return true;
    } catch {
      return false;
    }
  }
}
