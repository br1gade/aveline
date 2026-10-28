import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EmailFeedbackService } from '../../modules/communications/email-feedback.service';
import { JobLockService, SCHEDULES } from './job-lock.service';

@Injectable()
export class EmailFeedbackSweepService {
  constructor(private readonly lock: JobLockService, private readonly feedback: EmailFeedbackService) {}

  @Cron(CronExpression.EVERY_MINUTE, { waitForCompletion: true })
  async reconcileFeedback(): Promise<void> {
    await this.lock.runExclusively({ name: 'email.feedback', ttlSeconds: 55, crontab: SCHEDULES.everyMinute }, () => this.feedback.reconcile());
  }
}
