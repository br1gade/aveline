import { invoiceReturnUrl } from './billing-return';

describe('invoice return identity', () => {
  it('overwrites caller identity while retaining the approved destination and language', () => {
    const url = new URL(invoiceReturnUrl('https://app.test/billing/return?lang=hy&invoice=wrong&organization=wrong#paid',
      { number: 'AV-2026-000123', organizationId: 'org-one' }));
    expect(url.searchParams.get('invoice')).toBe('AV-2026-000123');
    expect(url.searchParams.get('organization')).toBe('org-one');
    expect(url.searchParams.get('lang')).toBe('hy');
    expect(url.hash).toBe('#paid');
  });
});
