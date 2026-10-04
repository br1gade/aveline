import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../cache/cache.service';
import { CommunicationsService } from '../../modules/communications/communications.service';
import { PaymentsService } from '../../modules/payments/payments.service';
import { TicketingService } from '../../modules/ticketing/ticketing.service';

/**
 * Runs the sweeps that keep the system honest.
 *
 * Three pieces of logic were implemented and inert until this existed:
 * payment reconciliation, ticket reservation release and message dispatch.
 * Each is correctness-critical — unrun, they mean a paid order stuck pending,
 * seats held by abandoned baskets forever, or an invitation never sent.
 *
 * Every sweep takes a Redis lock first. Without it, running two API instances
 * would run each sweep twice concurrently, which for message dispatch means
 * sending twice.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly payments: PaymentsService,
    private readonly ticketing: TicketingService,
    private readonly communications: CommunicationsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async dispatchMessages(): Promise<void> {
    await this.runExclusively('messages.dispatch', 55, async () => {
      const result = await this.communications.dispatchDue();
      if (result.sent + result.failed > 0) {
        this.logger.log(`messages: ${result.sent} sent, ${result.failed} failed`);
      }
    });
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcilePayments(): Promise<void> {
    await this.runExclusively('payments.reconcile', 280, async () => {
      const result = await this.payments.reconcile();
      if (result.changed > 0) {
        this.logger.log(`payments: ${result.changed} of ${result.checked} changed`);
      }
    });
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async releaseExpiredReservations(): Promise<void> {
    await this.runExclusively('tickets.release', 280, async () => {
      const result = await this.ticketing.releaseExpiredReservations();
      if (result.released > 0) this.logger.log(`tickets: released ${result.released} holds`);
    });
  }

  /**
   * Runs `work` only if this instance wins the lock.
   *
   * SET NX EX is a single atomic operation, so exactly one instance acquires
   * it. The TTL is shorter than the schedule interval and is never extended:
   * if an instance dies holding the lock, the next run proceeds rather than
   * the sweep stopping forever.
   *
   * A Redis outage means no sweeps run, which is visibly wrong rather than
   * quietly wrong — running them unguarded would risk double-sending.
   */
  private async runExclusively(
    name: string,
    ttlSeconds: number,
    work: () => Promise<void>,
  ): Promise<void> {
    const key = `aveline:lock:${name}`;
    let wasAcquired = false;

    try {
      wasAcquired = (await this.redis.set(key, process.pid.toString(), 'EX', ttlSeconds, 'NX')) === 'OK';
    } catch (error) {
      this.logger.warn(`skipping ${name}: lock unavailable (${describeError(error)})`);
      return;
    }

    if (!wasAcquired) return;

    try {
      await work();
    } catch (error) {
      this.logger.error(`${name} failed: ${describeError(error)}`);
    } finally {
      await this.redis.del(key).catch(() => undefined);
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
