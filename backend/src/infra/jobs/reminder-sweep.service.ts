import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReminderService } from '../../modules/invitations/sending/reminder.service';
import { JobLockService, SCHEDULES } from './job-lock.service';

/**
 * Chases the guests who have not answered.
 *
 * Hourly, and it does nothing most of the time. A reminder milestone is a
 * window days wide, so checking more often costs queries and changes nothing a
 * guest would notice — while checking less often risks missing the last
 * milestone of a wedding two days away.
 *
 * It keeps no state: a milestone's reminder carries a dedupe key derived from
 * the milestone itself, so the outbox's unique constraint makes every run
 * after the first a no-op.
 */
@Injectable()
export class ReminderSweepService {
  private readonly logger = new Logger(ReminderSweepService.name);

  constructor(
    private readonly lock: JobLockService,
    private readonly reminders: ReminderService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sendDueReminders(): Promise<void> {
    await this.lock.runExclusively(
      { name: 'reminders.send', ttlSeconds: 3_300, crontab: SCHEDULES.hourly },
      async () => {
        const result = await this.reminders.sendDueReminders();
        if (result.queued > 0) {
          this.logger.log(`reminders: ${result.queued} queued across ${result.events} event(s)`);
        }
      },
    );
  }
}
