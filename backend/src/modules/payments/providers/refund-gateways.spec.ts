import { PaymentProvider } from '@prisma/client';
import { AmeriabankGateway } from './ameriabank.gateway';
import { ArcaGateway } from './arca.gateway';

/**
 * B40: refunds sent the wrong amount for any currency but AMD, and treated
 * every HTTP 200 as success without reading the bank's own answer.
 */
describe('refunds at the bank', () => {
  let sent: Record<string, unknown>[] = [];
  let signals: (AbortSignal | null | undefined)[] = [];

  /** A bank that answers every call with `reply`, recording what it was sent. */
  const bankReplying = (reply: Record<string, unknown>) => {
    sent = [];
    signals = [];
    jest.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      signals.push(init?.signal);
      const body = typeof init?.body === 'string' ? init.body : '';
      sent.push(body.startsWith('{') ? (JSON.parse(body) as Record<string, unknown>) : Object.fromEntries(new URLSearchParams(body)));
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(reply) } as Response);
    });
  };

  afterEach(() => jest.restoreAllMocks());

  describe('Ameriabank', () => {
    const gateway = new AmeriabankGateway({ baseUrl: 'https://bank.test', clientId: 'c', username: 'u', password: 'p' });

    it.each([
      { currency: 'AMD', minor: 25000n, amount: '25000' },
      { currency: 'USD', minor: 2550n, amount: '25.50' },
    ])('sends $minor $currency minor units as $amount', async ({ currency, minor, amount }) => {
      bankReplying({ ResponseCode: '00' });

      await gateway.refund('pay-1', minor, currency);

      expect(String(sent[0].Amount)).toBe(amount);
    });

    it('fails when the bank declines the refund, whatever the HTTP status', async () => {
      bankReplying({ ResponseCode: '05', ResponseMessage: 'Refund amount exceeds balance' });

      await expect(gateway.refund('pay-1', 100n, 'AMD')).rejects.toThrow(/exceeds balance/);
    });
  });

  describe('ArCa', () => {
    const gateway = new ArcaGateway(PaymentProvider.INECOBANK, { baseUrl: 'https://arca.test', username: 'u', password: 'p' });

    it('succeeds when the bank reports error code 0', async () => {
      bankReplying({ errorCode: '0' });

      await expect(gateway.refund('ord-1', 2550n, 'USD')).resolves.toMatchObject({ outcome: { kind: 'refunded', refundedMinor: 2550n } });
      expect(sent[0].amount).toBe('2550');
    });

    it('fails when the bank declines the refund, whatever the HTTP status', async () => {
      bankReplying({ errorCode: '7', errorMessage: 'Refund amount exceeds deposited amount' });

      await expect(gateway.refund('ord-1', 100n, 'AMD')).rejects.toThrow(/exceeds deposited/);
    });
  });

  // B79: a bank that hangs held a buyer's checkout open, and every money
  // sweep behind it, for as long as Node's own defaults allow.
  it.each([
    ['Ameriabank', () => new AmeriabankGateway({ baseUrl: 'https://bank.test', clientId: 'c', username: 'u', password: 'p' })],
    ['ArCa', () => new ArcaGateway(PaymentProvider.INECOBANK, { baseUrl: 'https://arca.test', username: 'u', password: 'p' })],
  ])('gives every %s call a timeout', async (_name, gateway) => {
    bankReplying({ ResponseCode: '00', errorCode: '0', orderStatus: 2 });

    await gateway().getStatus('ref-1');

    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });
});
