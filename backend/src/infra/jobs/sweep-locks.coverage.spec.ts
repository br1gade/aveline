import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { CronExpression } from '@nestjs/schedule';
import { ContributionSweepService } from './contribution-sweep.service';
import { EmailFeedbackSweepService } from './email-feedback-sweep.service';
import { ImageSweepService } from './image-sweep.service';
import { InvitationMaintenanceSweepService } from './invitation-maintenance-sweep.service';
import { JobsService } from './jobs.service';
import { MoneySweepService } from './money-sweep.service';
import { PrivacySweepService } from './privacy-sweep.service';
import { ReminderSweepService } from './reminder-sweep.service';
import { WhatsAppReceiptSweepService } from './whatsapp-receipt-sweep.service';

/**
 * Every Redis-locked sweep, against the locking rules in
 * backend/docs/ARCHITECTURE.md §3: each runs only inside runExclusively, under
 * its own lock name, with a TTL shorter than its schedule (so a dead holder
 * delays one run, never two) and a Sentry crontab matching its @Cron.
 *
 * SalesPrivacySweepService is deliberately absent: it relies on database
 * batch locks, not Redis. HealthWatchService only reads.
 */
interface Job { name: string; ttlSeconds: number; crontab: string }
type SweepClass = new (...dependencies: never[]) => object;

const SCHEDULE: Record<string, { crontab: string; intervalSeconds: number }> = {
  [CronExpression.EVERY_MINUTE]: { crontab: '* * * * *', intervalSeconds: 60 },
  [CronExpression.EVERY_5_MINUTES]: { crontab: '*/5 * * * *', intervalSeconds: 300 },
  [CronExpression.EVERY_HOUR]: { crontab: '0 * * * *', intervalSeconds: 3600 },
  [CronExpression.EVERY_DAY_AT_9AM]: { crontab: '0 9 * * *', intervalSeconds: 86_400 },
};

const SWEEPS: SweepClass[] = [
  MoneySweepService, JobsService, ReminderSweepService, PrivacySweepService, WhatsAppReceiptSweepService,
  ImageSweepService, InvitationMaintenanceSweepService, EmailFeedbackSweepService, ContributionSweepService,
];

/** Any collaborator: every method resolves to an empty result. */
function collaborator(): { calls: () => number; value: unknown } {
  const methods = new Map<PropertyKey, jest.Mock>();
  const value = new Proxy({}, { get: (_target, key) => {
    if (!methods.has(key)) methods.set(key, jest.fn().mockResolvedValue({}));
    return methods.get(key);
  } });
  return { value, calls: () => [...methods.values()].reduce((total, method) => total + method.mock.calls.length, 0) };
}

function cronMethods(sweep: SweepClass): { method: string; cron: string }[] {
  return Object.getOwnPropertyNames(sweep.prototype).flatMap((method) => {
    const handler = (sweep.prototype as Record<string, unknown>)[method];
    const options = typeof handler === 'function' ? Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, handler) as { cronTime: string } | undefined : undefined;
    return options ? [{ method, cron: options.cronTime }] : [];
  });
}

async function runSweep(sweep: SweepClass, method: string, isLockAcquired: boolean) {
  const jobs: Job[] = [];
  const lock = { runExclusively: jest.fn((job: Job, work: () => Promise<void>) => { jobs.push(job); return isLockAcquired ? work() : Promise.resolve(); }) };
  const collaborators = Array.from({ length: 4 }, collaborator);
  const instance = new sweep(lock as unknown as never, ...collaborators.map((entry) => entry.value as never)) as Record<string, () => Promise<void>>;
  await instance[method]();
  return { jobs, collaboratorCalls: collaborators.reduce((total, entry) => total + entry.calls(), 0) };
}

const CASES = SWEEPS.flatMap((sweep) => cronMethods(sweep).map((entry) => ({ label: `${sweep.name}.${entry.method}`, sweep, ...entry })));

describe('scheduled sweep locking', () => {
  it('finds all ten locked sweeps', () => {
    expect(CASES).toHaveLength(10);
  });

  it.each(CASES)('$label does no work when another instance holds the lock', async ({ sweep, method }) => {
    const { jobs, collaboratorCalls } = await runSweep(sweep, method, false);

    expect(jobs).toHaveLength(1);
    expect(collaboratorCalls).toBe(0);
  });

  it.each(CASES)('$label runs its work inside the lock it holds', async ({ sweep, method }) => {
    const { collaboratorCalls } = await runSweep(sweep, method, true);

    expect(collaboratorCalls).toBeGreaterThan(0);
  });

  it.each(CASES)('$label holds its lock for less than its interval, with a matching monitor schedule', async ({ sweep, method, cron }) => {
    const { jobs: [job] } = await runSweep(sweep, method, false);
    const schedule = SCHEDULE[cron];

    expect(schedule).toBeDefined();
    expect(job.crontab).toBe(schedule.crontab);
    expect(job.ttlSeconds).toBeGreaterThan(0);
    expect(job.ttlSeconds).toBeLessThan(schedule.intervalSeconds);
  });

  it('gives every sweep its own lock name', async () => {
    const names = await Promise.all(CASES.map(async ({ sweep, method }) => (await runSweep(sweep, method, false)).jobs[0].name));

    expect(new Set(names).size).toBe(CASES.length);
  });
});
