export interface EmailQuotaSettings { perMinute: number; perDay: number; burst: number }
export interface EmailQuotaState {
  credits: bigint;
  refilledAt: Date;
  dayStartedAt: Date;
  usedToday: number;
}

const SEND_COST = 60_000n;

export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Integer credits avoid rounding a partially refilled allowance into a send. */
export function advanceEmailQuota(state: EmailQuotaState, settings: EmailQuotaSettings, now: Date) {
  const elapsed = BigInt(Math.max(0, now.getTime() - state.refilledAt.getTime()));
  const capacity = BigInt(settings.burst) * SEND_COST;
  const available = state.credits + elapsed * BigInt(settings.perMinute);
  const credits = available > capacity ? capacity : available;
  const observedDay = utcDayStart(now);
  const dayStartedAt = observedDay > state.dayStartedAt ? observedDay : state.dayStartedAt;
  const usedToday = state.dayStartedAt.getTime() === dayStartedAt.getTime() ? state.usedToday : 0;
  const canSend = credits >= SEND_COST && usedToday < settings.perDay;
  return {
    credits: canSend ? credits - SEND_COST : credits,
    refilledAt: now > state.refilledAt ? now : state.refilledAt,
    dayStartedAt,
    usedToday: usedToday + Number(canSend),
    retryAt: canSend ? null : nextAllowanceAt({ credits, usedToday, dayStartedAt }, settings, now),
  };
}

function nextAllowanceAt(state: Pick<EmailQuotaState, 'credits' | 'usedToday' | 'dayStartedAt'>, settings: EmailQuotaSettings, now: Date): Date {
  if (state.usedToday >= settings.perDay) return new Date(state.dayStartedAt.getTime() + 86_400_000);
  return new Date(now.getTime() + Math.ceil(Number(SEND_COST - state.credits) / settings.perMinute));
}
