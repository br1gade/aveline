import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrivacyService } from '../../modules/privacy/privacy.service';
import { JobLockService, SCHEDULES } from './job-lock.service';

/**
 * Watches the GDPR clock.
 *
 * Daily, because the deadline is a month away and an hourly alert about the
 * same overdue request is how an alert gets muted. The schema has carried
 * `dueAt` and an index on it since the privacy work — this is what reads them,
 * and without it the clock was stored and never watched, which is the same as
 * not having one.
 */
@Injectable()
export class PrivacySweepService {
  constructor(
    private readonly lock: JobLockService,
    private readonly privacy: PrivacyService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async reportDueRequests(): Promise<void> {
    await this.lock.runExclusively(
      { name: 'privacy.due-requests', ttlSeconds: 3_300, crontab: SCHEDULES.dailyAt9 },
      async () => {
        await this.privacy.reportDueRequests();
      },
    );
  }
}
