import { checkoutFingerprint, rosterProblem } from './checkout-roster';

describe('Named checkout intent', () => {
  const items = [{ ticketTypeId: 'general', quantity: 2 }, { ticketTypeId: 'vip', quantity: 1 }];
  const person = (ticketTypeId: string) => ({ ticketTypeId, firstName: 'Anna' });
  it.each([
    { roster: undefined, problem: 'supply one named' },
    { roster: [], problem: 'supply one named' },
    { roster: [person('general'), person('vip')], problem: 'exactly match' },
    { roster: [person('general'), person('general'), person('other')], problem: 'exactly match' },
  ])('rejects an incomplete or mismatched roster: $problem', ({ roster, problem }) => {
    expect(rosterProblem(items, roster)).toContain(problem);
  });
  it('accepts exact per-type counts regardless of attendee ordering', () => {
    expect(rosterProblem(items, [person('vip'), person('general'), person('general')])).toBeNull();
  });
  it('detects a repeated basket type', () => {
    expect(rosterProblem([items[0], items[0]], [person('general')])).toContain('once');
  });
  it('fingerprints semantic object fields consistently and rejects changed people', async () => {
    const dto = { items, attendees: [person('general')], buyerName: 'Buyer', buyerEmail: 'buyer@test.local', idempotencyKey: 'key' };
    const reordered = { ...dto, attendees: [{ firstName: 'Anna', ticketTypeId: 'general' }] };
    expect(await checkoutFingerprint('event', dto)).toBe(await checkoutFingerprint('event', reordered));
    expect(await checkoutFingerprint('event', dto)).not.toBe(await checkoutFingerprint('event', { ...dto, attendees: [{ ...person('general'), firstName: 'Davit' }] }));
  });
});
