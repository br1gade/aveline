import { PrismaService } from '../../prisma/prisma.service';
import { advanceEmailQuota, EmailQuotaSettings, EmailQuotaState } from './email-quota';

export class EmailQuotaWaitError extends Error {
  constructor(readonly retryAt: Date) { super('Waiting for the email provider budget'); }
}

/** Postgres retains the budget across deploys and Redis eviction/restarts. */
export class EmailQuotaService {
  constructor(private readonly prisma: PrismaService) {}

  async reserve(): Promise<Date | null> {
    const settings = quotaSettings();
    if (!settings) return null;
    return this.prisma.$transaction(async (tx) => {
      // An empty Prisma upsert uses read/create and races on first use.
      await tx.$executeRaw`
        INSERT INTO email_send_quotas (scope, credits, "refilledAt", "dayStartedAt", "usedToday")
        VALUES ('email', ${BigInt(settings.burst) * 60_000n}, clock_timestamp(),
                DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC'), 0)
        ON CONFLICT (scope) DO NOTHING`;
      const [state] = await tx.$queryRaw<(EmailQuotaState & { now: Date })[]>`
        SELECT "credits", "refilledAt", "dayStartedAt", "usedToday", clock_timestamp() AS now
          FROM email_send_quotas WHERE scope = 'email' FOR UPDATE`;
      const { retryAt, ...next } = advanceEmailQuota(state, settings, state.now);
      await tx.emailSendQuota.update({ where: { scope: 'email' }, data: next });
      return retryAt;
    });
  }
}

function quotaSettings(): EmailQuotaSettings | null {
  const env = process.env;
  if (env.NODE_ENV !== 'production' && !env.EMAIL_SENDS_PER_MINUTE && !env.EMAIL_SENDS_PER_DAY) return null;
  const perMinute = Number(env.EMAIL_SENDS_PER_MINUTE ?? 60);
  return { perMinute, perDay: Number(env.EMAIL_SENDS_PER_DAY ?? 1000), burst: Math.min(Number(env.EMAIL_SEND_BURST ?? 5), perMinute) };
}
