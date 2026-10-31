import { FakeGateway } from './fake.gateway';

const register = (returnUrl: string) =>
  new FakeGateway().registerOrder({ orderNumber: '7', amountMinor: 25000n, currency: 'AMD', returnUrl });

describe('FakeGateway', () => {
  it.each([
    ['http://localhost:5173/tickets/return', 'http://localhost:5173/tickets/return?fakePayment=fake_7'],
    // FR-13: a return URL with its own query string kept it intact.
    ['http://localhost:5173/billing/return?plan=pro', 'http://localhost:5173/billing/return?plan=pro&fakePayment=fake_7'],
    ['http://localhost:5173/pay?x=1#done', 'http://localhost:5173/pay?x=1&fakePayment=fake_7#done'],
  ])('sends the payer back to %s with the order', async (returnUrl, expected) => {
    expect((await register(returnUrl)).redirectUrl).toBe(expected);
  });
});
