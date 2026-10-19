import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TicketAcknowledgementInviter } from '../../modules/guest-contributions/ticket-acknowledgement-inviter';
import { JobLockService, SCHEDULES } from './job-lock.service';

@Injectable()
export class ContributionSweepService {
  constructor(private readonly lock: JobLockService, private readonly inviter: TicketAcknowledgementInviter) {}
  @Cron(CronExpression.EVERY_MINUTE, { waitForCompletion: true })
  async inviteTicketAttendees() {
    await this.lock.runExclusively({ name: 'tickets.acknowledgement-links', ttlSeconds: 55, crontab: SCHEDULES.everyMinute }, async () => { await this.inviter.sendMissing(); });
  }
}
