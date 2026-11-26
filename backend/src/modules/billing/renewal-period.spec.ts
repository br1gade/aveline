import { renewalPeriod } from './renewal-period';

describe('renewal periods', () => {
  it.each([
    ['MONTHLY', '2027-02-28', '2027-01-31', '2027-03-31'],
    ['YEARLY', '2027-02-28', '2024-02-29', '2028-02-29'],
  ] as const)('preserves the calendar anchor for %s', (interval, end, anchor, expected) => {
    expect(renewalPeriod({ interval, end: new Date(end), anchor: new Date(anchor) }, new Date('2026-11-26')).end)
      .toEqual(new Date(expected));
  });

  it('starts a complete late renewal at settlement', () => {
    expect(renewalPeriod({ interval: 'MONTHLY', end: new Date('2026-10-31'), anchor: new Date('2026-09-30') },
      new Date('2026-11-26'))).toEqual({ start: new Date('2026-11-26'), end: new Date('2026-12-26') });
  });
});
