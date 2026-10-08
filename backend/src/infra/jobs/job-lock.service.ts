import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../cache/cache.service';
import { Sentry } from '../observability/sentry';

/**
 * Runs a periodic sweep on exactly one instance, and notices when it stops.
 *
 * Extracted from the sweeps themselves so each one can be a small service with
 * its own dependencies. The locking rules are the interesting part and they
 * are identical for all of them:
 *
 * `SET NX EX` is a single atomic operation, so exactly one instance acquires
 * the lock. The TTL is shorter than the schedule interval and is never
 * extended: an instance that dies holding it delays one run rather than
 * stopping the sweep forever.
 *
 * A Redis outage means no sweeps run. That is visibly wrong rather than
 * quietly wrong — running them unguarded would risk sending twice.
 */
@Injectable()
export class JobLockService {
  private readonly logger = new Logger(JobLockService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async runExclusively(
    job: { name: string; ttlSeconds: number; crontab: string },
    work: () => Promise<void>,
  ): Promise<void> {
    // Wrapped in a Sentry check-in so a sweep that stops running entirely is
    // noticed. That is the failure mode worth catching: three of these were
    // implemented and inert for weeks and nothing said so. A check-in is not
    // tracing — no spans, no sampling.
    //
    // The crontab is passed in rather than inferred: a monitor registered with
    // the wrong schedule reports a missed check-in on every run that never
    // should have happened, which trains everyone to ignore the alert.
    return Sentry.withMonitor(job.name, () => this.runGuarded(job, work), {
      schedule: { type: 'crontab', value: job.crontab },
      checkinMargin: 2,
      maxRuntime: Math.ceil(job.ttlSeconds / 60),
    });
  }

  private async runGuarded(
    job: { name: string; ttlSeconds: number },
    work: () => Promise<void>,
  ): Promise<void> {
    const key = `aveline:lock:${job.name}`;
    let wasAcquired: boolean;

    try {
      wasAcquired =
        (await this.redis.set(key, process.pid.toString(), 'EX', job.ttlSeconds, 'NX')) === 'OK';
    } catch (error) {
      this.logger.warn(`skipping ${job.name}: lock unavailable (${describeError(error)})`);
      return;
    }

    if (!wasAcquired) return;

    try {
      await work();
    } catch (error) {
      this.logger.error(`${job.name} failed: ${describeError(error)}`);
    } finally {
      await this.redis.del(key).catch(() => undefined);
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Crontab expressions matching the @Cron decorators, for Sentry's monitors. */
export const SCHEDULES = {
  everyMinute: '* * * * *',
  everyFiveMinutes: '*/5 * * * *',
  hourly: '0 * * * *',
  dailyAt9: '0 9 * * *',
} as const;
