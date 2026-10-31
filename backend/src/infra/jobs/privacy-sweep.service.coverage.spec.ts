import { CronExpression } from '@nestjs/schedule';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { PrivacyService } from '../../modules/privacy/privacy.service';
import { JobLockService, SCHEDULES } from './job-lock.service';
import { PrivacySweepService } from './privacy-sweep.service';

type Work = () => Promise<void>;

describe('the daily GDPR deadline sweep', () => {
  const sweepWith = (runExclusively: jest.Mock) => {
    const privacy = { reportDueRequests: jest.fn().mockResolvedValue({ overdue: 0, dueSoon: 0 }) };
    const sweep = new PrivacySweepService(
      { runExclusively } as unknown as JobLockService,
      privacy as unknown as PrivacyService,
    );
    return { sweep, privacy };
  };

  it('reports due requests under the privacy.due-requests lock on the 9am schedule', async () => {
    const runExclusively = jest.fn((_job: unknown, work: Work) => work());
    const { sweep, privacy } = sweepWith(runExclusively);

    await sweep.reportDueRequests();

    expect(runExclusively).toHaveBeenCalledTimes(1);
    expect(runExclusively.mock.calls[0][0]).toEqual({
      name: 'privacy.due-requests',
      ttlSeconds: 3_300,
      crontab: SCHEDULES.dailyAt9,
    });
    expect(privacy.reportDueRequests).toHaveBeenCalledTimes(1);
  });

  it('does not report when another instance holds the lock', async () => {
    const runExclusively = jest.fn().mockResolvedValue(undefined);
    const { sweep, privacy } = sweepWith(runExclusively);

    await sweep.reportDueRequests();

    expect(privacy.reportDueRequests).not.toHaveBeenCalled();
  });

  it('is scheduled daily at 9am, matching the crontab its monitor is registered with', () => {
    const options = Reflect.getMetadata(
      SCHEDULE_CRON_OPTIONS,
      PrivacySweepService.prototype.reportDueRequests,
    ) as { cronTime: string; waitForCompletion?: boolean };

    // The enum writes "09"; the monitor's crontab writes "9". Same schedule.
    const fields = (cron: string) => cron.split(' ').map((field) => (/^\d+$/.test(field) ? String(Number(field)) : field));
    expect(options.cronTime).toBe(CronExpression.EVERY_DAY_AT_9AM);
    expect(fields(options.cronTime)).toEqual(fields(SCHEDULES.dailyAt9));
    expect(options.waitForCompletion).toBe(true);
  });
});
