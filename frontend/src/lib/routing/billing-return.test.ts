import { describe, expect, it } from 'vitest';
import { billingReturnContext, billingReturnPath } from './billing-return';

describe('billing return correlation', () => {
  it('preserves only app identity and language across sign-in', () => {
    expect(
      billingReturnPath(
        new URL(
          'https://app.test/billing/return?invoice=AV-2026-000001&organization=org-two&orderId=secret&lang=hy',
        ),
      ),
    ).toBe('/billing/return?invoice=AV-2026-000001&organization=org-two&lang=hy');
  });
  it.each([
    '',
    '?invoice=AV-2026-000001',
    '?invoice=bad&organization=a',
    '?invoice=AV-2026-000001&organization=../x',
    '?invoice=AV-2026-000001&invoice=AV-2026-000002&organization=a',
  ])('rejects incomplete or ambiguous identity %s', (query) => {
    expect(billingReturnContext(new URL(`https://app.test/billing/return${query}`))).toBeNull();
  });
});
