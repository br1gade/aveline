import { advanceEmailQuota } from './email-quota';

describe('email provider budget', () => {
  const now = new Date('2026-10-12T12:00:00.000Z');
  const settings = { perMinute: 60, perDay: 1000, burst: 2 };
  const state = { credits: 0n, refilledAt: now, dayStartedAt: new Date('2026-10-12T00:00:00Z'), usedToday: 0 };

  it('waits for capacity without consuming a send or retry attempt', () => {
    const result = advanceEmailQuota(state, settings, now);
    expect(result.retryAt).toEqual(new Date('2026-10-12T12:00:01Z'));
    expect(result.usedToday).toBe(0);
  });

  it('replenishes continuously rather than bursting twice across a minute boundary', () => {
    const result = advanceEmailQuota(state, settings, new Date(now.getTime() + 1000));
    expect(result.retryAt).toBeNull();
    expect(result.credits).toBe(0n);
    expect(result.usedToday).toBe(1);
  });

  it('caps accumulated credits at the configured burst', () => {
    expect(advanceEmailQuota(state, settings, new Date(now.getTime() + 60000)).credits).toBe(60000n);
  });

  it('does not refill when the observed clock is earlier than the previous update', () => {
    expect(advanceEmailQuota(state, settings, new Date(now.getTime() - 1000)).retryAt).not.toBeNull();
  });

  it('waits until the next UTC day after the daily budget is used', () => {
    const result = advanceEmailQuota({ ...state, credits: 120000n, usedToday: 1000 }, settings, now);
    expect(result.retryAt).toEqual(new Date('2026-10-13T00:00:00Z'));
    expect(result.usedToday).toBe(1000);
  });

  it('reopens the daily budget after midnight', () => {
    const result = advanceEmailQuota({ ...state, usedToday: 1000 }, settings, new Date('2026-10-13T00:00:00Z'));
    expect(result.retryAt).toBeNull();
    expect(result.usedToday).toBe(1);
  });

  it('cannot reopen a consumed daily budget by moving the clock back a day', () => {
    const future = { ...state, credits: 120000n, usedToday: 1000, dayStartedAt: new Date('2026-10-13T00:00:00Z'), refilledAt: new Date('2026-10-13T00:00:00Z') };
    expect(advanceEmailQuota(future, settings, now).retryAt).toEqual(new Date('2026-10-14T00:00:00Z'));
  });
});
