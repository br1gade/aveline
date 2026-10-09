import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CommunicationsService } from '../../modules/communications/communications.service';
import { JobLockService, SCHEDULES } from './job-lock.service';

/**
 * Sends what the outbox holds. The money sweeps — reconciliation, settling
 * what it finds, returning lapsed holds — are in `MoneySweepService`.
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
}
