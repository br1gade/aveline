import { buildSeatingPlan } from '../modules/seating/seating-plan';
import { describeJobRecovery } from './interceptors/job-recovery.interceptor';

it.each(['en', 'ru', 'fr', 'hy'])('adds actionable seating explanations in %s to existing persisted reason strings', (locale) => {
  const household = { householdId: 'family', guestIds: ['one', 'two'], side: 'UNKNOWN' as const };
  const table = { tableId: 'table', capacity: 1, occupied: 0, side: null };
  const cases = [
    [buildSeatingPlan([household], [], 1), 'SEATING_VENUE_CAPACITY'],
    [buildSeatingPlan([{ ...household, seatedAt: ['table'] }], [table]), 'SEATING_FAMILY_TABLE_FULL'],
    [buildSeatingPlan([household], []), 'SEATING_NO_TABLES'],
    [buildSeatingPlan([household], [{ ...table, occupied: 1 }]), 'SEATING_TABLES_FULL'],
    [buildSeatingPlan([household], [table]), 'SEATING_NO_TABLE_FITS'],
  ] as const;
  for (const [result, code] of cases) {
    const value = describeJobRecovery({ status: 'COMPLETED', failureReason: null, result }, locale);
    expect(value).toMatchObject({ result: { unseated: [{ reason: result.unseated[0].reason, explanation: { code, locale, action: 'EDIT' } }] } });
  }
});
