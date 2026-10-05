import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CommunicationsService } from '../../modules/communications/communications.service';
import { PaymentsService } from '../../modules/payments/payments.service';
import { TicketingService } from '../../modules/ticketing/ticketing.service';
import { JobLockService, SCHEDULES } from './job-lock.service';

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
    private readonly lock: JobLockService,
    private readonly payments: PaymentsService,
    private readonly ticketing: TicketingService,
    private readonly communications: CommunicationsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async dispatchMessages(): Promise<void> {
    await this.lock.runExclusively(
      { name: 'messages.dispatch', ttlSeconds: 55, crontab: SCHEDULES.everyMinute },
      async () => {
        const result = await this.communications.dispatchDue();
        if (result.sent + result.failed > 0) {
          this.logger.log(`messages: ${result.sent} sent, ${result.failed} failed`);
        }
      },
    );
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcilePayments(): Promise<void> {
    await this.lock.runExclusively(
      { name: 'payments.reconcile', ttlSeconds: 280, crontab: SCHEDULES.everyFiveMinutes },
      async () => {
        const result = await this.payments.reconcile();
        if (result.changed > 0) {
          this.logger.log(`payments: ${result.changed} of ${result.checked} changed`);
        }
      },
    );
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async releaseExpiredReservations(): Promise<void> {
    await this.lock.runExclusively(
      { name: 'tickets.release', ttlSeconds: 280, crontab: SCHEDULES.everyFiveMinutes },
      async () => {
        const result = await this.ticketing.releaseExpiredReservations();
        if (result.released > 0) this.logger.log(`tickets: released ${result.released} holds`);
      },
    );
  }
}
