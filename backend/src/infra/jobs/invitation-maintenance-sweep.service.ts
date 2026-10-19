import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InvitationMaintenanceService } from '../../modules/invitations/invitation-maintenance.service';
import { JobLockService, SCHEDULES } from './job-lock.service';

@Injectable()
export class InvitationMaintenanceSweepService {
  constructor(private readonly lock: JobLockService, private readonly invitations: InvitationMaintenanceService) {}
  @Cron(CronExpression.EVERY_MINUTE, { waitForCompletion: true })
  async maintainAccess() {
    await this.lock.runExclusively({ name: 'invitations.maintain-access', ttlSeconds: 55, crontab: SCHEDULES.everyMinute },
      async () => { await this.invitations.maintain(); });
  }
}
