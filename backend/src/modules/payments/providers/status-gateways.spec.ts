import { PaymentProvider } from '@prisma/client';
import { AmeriabankGateway } from './ameriabank.gateway';
import { ArcaGateway } from './arca.gateway';

/**
 * B85: an unrecognised code, or one meaning "still in progress", marked the
 * payment FAILED — which is final — so a payment the bank later captured was
 * already written off.
 */
describe('reading a payment’s status from the bank', () => {
  const bankReplying = (reply: Record<string, unknown>) =>
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(reply) } as Response);

  afterEach(() => jest.restoreAllMocks());

  describe('ArCa', () => {
    const gateway = new ArcaGateway(PaymentProvider.INECOBANK, { baseUrl: 'https://arca.test', username: 'u', password: 'p' });

    it.each([
      { label: 'an unknown code', reply: { orderStatus: 9, amount: '100' } },
      { label: 'no status during an outage', reply: { errorCode: '7', errorMessage: 'System error' } },
      { label: 'authentication under way', reply: { orderStatus: 5, amount: '100' } },
    ])('keeps it pending on $label', async ({ reply }) => {
      bankReplying(reply);

      await expect(gateway.getStatus('order-1')).resolves.toMatchObject({ outcome: { kind: 'pending' } });
    });

    it('fails it only on a real decline', async () => {
      bankReplying({ orderStatus: 6, amount: '100', actionCodeDescription: 'Insufficient funds' });

      await expect(gateway.getStatus('order-1')).resolves.toMatchObject({ outcome: { kind: 'failed', reason: 'Insufficient funds' } });
    });
  });

  describe('Ameriabank', () => {
    const gateway = new AmeriabankGateway({ baseUrl: 'https://bank.test', clientId: 'c', username: 'u', password: 'p' });

    it.each([
      { label: 'registered and unpaid', reply: { ResponseCode: '0-100', OrderStatus: 0, Amount: 100, Currency: '051' } },
      { label: 'a code we do not know, with no order status', reply: { ResponseCode: '0-2000' } },
    ])('keeps it pending when $label', async ({ reply }) => {
      bankReplying(reply);

      await expect(gateway.getStatus('pay-1')).resolves.toMatchObject({ outcome: { kind: 'pending' } });
    });

    it('fails it when the bank reports the payment declined', async () => {
      bankReplying({ ResponseCode: '0116', OrderStatus: 6, ResponseMessage: 'Insufficient funds', Amount: 100 });

      await expect(gateway.getStatus('pay-1')).resolves.toMatchObject({ outcome: { kind: 'failed', reason: 'Insufficient funds' } });
    });

    it('captures on success', async () => {
      bankReplying({ ResponseCode: '00', OrderStatus: 2, Amount: 25000, Currency: 'AMD' });

      await expect(gateway.getStatus('pay-1')).resolves.toMatchObject({ outcome: { kind: 'captured', amountMinor: 25000n } });
    });
  });
});
