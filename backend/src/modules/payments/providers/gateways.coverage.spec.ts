import { PaymentProvider } from '@prisma/client';
import { AmeriabankGateway } from './ameriabank.gateway';
import { ArcaGateway } from './arca.gateway';
import { outcomeForOrderStatus } from './card-order-status';

/**
 * The adapters are where a bank's vocabulary becomes ours. A wrong mapping or
 * a wrong amount here is a payment recorded as something it is not, or a
 * charge a hundred times too large, and nothing upstream can notice.
 */
/** Both adapters pass fetch a string; the other shapes are here for the type. */
function addressOf(url: string | URL | Request): string {
  if (typeof url === 'string') return url;
  return url instanceof URL ? url.href : url.url;
}

describe('bank adapters', () => {
  let sent: Record<string, unknown>[] = [];
  let urls: string[] = [];

  /** A bank that answers every call with `reply`, recording what it was sent and where. */
  const bankReplying = (reply: Record<string, unknown>) => {
    sent = [];
    urls = [];
    jest.spyOn(global, 'fetch').mockImplementation((url, init) => {
      urls.push(addressOf(url));
      const body = typeof init?.body === 'string' ? init.body : '';
      sent.push(body.startsWith('{') ? (JSON.parse(body) as Record<string, unknown>) : Object.fromEntries(new URLSearchParams(body)));
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(reply) } as Response);
    });
  };

  afterEach(() => jest.restoreAllMocks());

  describe('the shared card order status', () => {
    it.each([
      { code: 0, outcome: { kind: 'pending' } },
      { code: 5, outcome: { kind: 'pending' } },
      { code: 1, outcome: { kind: 'authorized', amountMinor: 700n } },
      { code: 2, outcome: { kind: 'captured', amountMinor: 700n } },
      { code: 3, outcome: { kind: 'cancelled' } },
      { code: 4, outcome: { kind: 'refunded', refundedMinor: 700n } },
      { code: 6, outcome: { kind: 'failed', reason: 'Do not honour' } },
    ])('reads code $code as $outcome.kind', ({ code, outcome }) => {
      expect(outcomeForOrderStatus(code, 700n, 'Do not honour')).toEqual(outcome);
    });

    it('reads a code sent as a string the same as a number', () => {
      expect(outcomeForOrderStatus('2', 700n)).toEqual({ kind: 'captured', amountMinor: 700n });
    });

    it('names a decline with no reason "Declined"', () => {
      expect(outcomeForOrderStatus(6, 700n)).toEqual({ kind: 'failed', reason: 'Declined' });
    });

    it.each([
      { label: 'absent', status: undefined },
      { label: 'unknown', status: 9 },
      { label: 'fractional', status: 2.5 },
      { label: 'not a number', status: 'paid' },
      { label: 'an object', status: { code: 2 } },
    ])('answers null for a status that is $label, so it is never written off', ({ status }) => {
      expect(outcomeForOrderStatus(status, 700n)).toBeNull();
    });
  });

  describe('reading a status, ArCa (Inecobank and IDBank)', () => {
    it.each([PaymentProvider.INECOBANK, PaymentProvider.IDBANK])('%s asks getOrderStatusExtended.do for the order', async (provider) => {
      const gateway = new ArcaGateway(provider, { baseUrl: 'https://arca.test', username: 'u', password: 'p' });
      bankReplying({ orderStatus: 2, amount: '25000' });

      await gateway.getStatus('ord-1');

      expect(urls[0]).toBe('https://arca.test/getOrderStatusExtended.do');
      expect(sent[0]).toMatchObject({ orderId: 'ord-1', userName: 'u', password: 'p' });
    });

    const gateway = new ArcaGateway(PaymentProvider.INECOBANK, { baseUrl: 'https://arca.test', username: 'u', password: 'p' });

    it.each([
      { orderStatus: 1, outcome: { kind: 'authorized', amountMinor: 25000n } },
      { orderStatus: 2, outcome: { kind: 'captured', amountMinor: 25000n } },
      { orderStatus: 3, outcome: { kind: 'cancelled' } },
      { orderStatus: 4, outcome: { kind: 'refunded', refundedMinor: 25000n } },
    ])('maps orderStatus $orderStatus to $outcome.kind with the amount the bank reports', async ({ orderStatus, outcome }) => {
      const reply = { orderStatus, amount: '25000' };
      bankReplying(reply);

      await expect(gateway.getStatus('ord-1')).resolves.toEqual({ outcome, raw: reply });
    });
  });

  describe('reading a status, Ameriabank', () => {
    const gateway = new AmeriabankGateway({ baseUrl: 'https://bank.test', clientId: 'c', username: 'u', password: 'p' });

    it.each([
      { OrderStatus: 1, outcome: { kind: 'authorized', amountMinor: 2550n } },
      { OrderStatus: 2, outcome: { kind: 'captured', amountMinor: 2550n } },
      { OrderStatus: 3, outcome: { kind: 'cancelled' } },
      { OrderStatus: 4, outcome: { kind: 'refunded', refundedMinor: 2550n } },
    ])('maps OrderStatus $OrderStatus to $outcome.kind, converting the major-unit amount', async ({ OrderStatus, outcome }) => {
      const reply = { ResponseCode: '00', OrderStatus, Amount: '25.50', Currency: 'USD' };
      bankReplying(reply);

      await expect(gateway.getStatus('pay-1')).resolves.toEqual({ outcome, raw: reply });
    });

    it('captures on response code 00 when the bank sends no order status', async () => {
      bankReplying({ ResponseCode: '00', Amount: '100', Currency: 'AMD' });

      await expect(gateway.getStatus('pay-1')).resolves.toMatchObject({ outcome: { kind: 'captured', amountMinor: 100n } });
    });

    it('asks GetPaymentDetails for the payment', async () => {
      bankReplying({ ResponseCode: '00', OrderStatus: 0 });

      await gateway.getStatus('pay-1');

      expect(urls[0]).toBe('https://bank.test/VPOS/api/VPOS/GetPaymentDetails');
      expect(sent[0]).toMatchObject({ PaymentID: 'pay-1', Username: 'u', Password: 'p' });
    });
  });

  describe('registering an order, Ameriabank', () => {
    const gateway = new AmeriabankGateway({ baseUrl: 'https://bank.test', clientId: 'client-7', username: 'u', password: 'p' });
    const order = (amountMinor: bigint, currency: string, locale?: string) => ({
      orderNumber: 'AVL-1',
      amountMinor,
      currency,
      returnUrl: 'https://app.test/billing/return',
      description: 'Plan',
      locale,
    });

    it.each([
      { minor: 25000n, currency: 'AMD', amount: '25000' },
      { minor: 2550n, currency: 'USD', amount: '25.50' },
    ])('sends $minor $currency minor units as Amount $amount', async ({ minor, currency, amount }) => {
      bankReplying({ PaymentID: 'P1' });

      await gateway.registerOrder(order(minor, currency));

      expect(urls[0]).toBe('https://bank.test/VPOS/api/VPOS/InitPayment');
      expect(sent[0]).toMatchObject({
        ClientID: 'client-7',
        OrderID: 'AVL-1',
        Amount: amount,
        Currency: currency,
        BackURL: 'https://app.test/billing/return',
        Description: 'Plan',
      });
    });

    it('sends the payer to the vPOS form for the payment, in Armenian by default', async () => {
      bankReplying({ PaymentID: 'P1' });

      await expect(gateway.registerOrder(order(25000n, 'AMD'))).resolves.toEqual({
        providerRef: 'P1',
        redirectUrl: 'https://bank.test/VPOS/Payments/Pay?id=P1&lang=am',
      });
    });

    it('opens the form in the requested language', async () => {
      bankReplying({ PaymentID: 'P1' });

      const registered = await gateway.registerOrder(order(25000n, 'AMD', 'en'));

      expect(registered.redirectUrl).toBe('https://bank.test/VPOS/Payments/Pay?id=P1&lang=en');
    });

    it('throws, with the bank’s message, when no PaymentID comes back', async () => {
      bankReplying({ ResponseCode: '05', ResponseMessage: 'Invalid merchant' });

      await expect(gateway.registerOrder(order(25000n, 'AMD'))).rejects.toThrow(/refused the order: Invalid merchant/);
    });
  });

  describe('registering an order, ArCa', () => {
    const gateway = new ArcaGateway(PaymentProvider.IDBANK, { baseUrl: 'https://arca.test', username: 'u', password: 'p' });
    const order = (currency: string, locale?: string) => ({
      orderNumber: 'AVL-1',
      amountMinor: 25000n,
      currency,
      returnUrl: 'https://app.test/billing/return',
      locale,
    });

    it('sends the amount in minor units with the numeric currency, return URL and Armenian by default', async () => {
      bankReplying({ orderId: 'O1', formUrl: 'https://arca.test/form?mdOrder=O1' });

      await gateway.registerOrder(order('AMD'));

      expect(urls[0]).toBe('https://arca.test/register.do');
      expect(sent[0]).toEqual({
        userName: 'u',
        password: 'p',
        orderNumber: 'AVL-1',
        amount: '25000',
        currency: '051',
        returnUrl: 'https://app.test/billing/return',
        description: '',
        language: 'hy',
      });
    });

    it.each([
      { currency: 'USD', numeric: '840' },
      { currency: 'EUR', numeric: '978' },
      { currency: 'RUB', numeric: '643' },
    ])('sends $currency as $numeric', async ({ currency, numeric }) => {
      bankReplying({ orderId: 'O1', formUrl: 'https://arca.test/form' });

      await gateway.registerOrder(order(currency, 'en'));

      expect(sent[0]).toMatchObject({ currency: numeric, language: 'en' });
    });

    it('sends the payer to the form URL the bank returned', async () => {
      bankReplying({ orderId: 'O1', formUrl: 'https://arca.test/form?mdOrder=O1' });

      await expect(gateway.registerOrder(order('AMD'))).resolves.toEqual({
        providerRef: 'O1',
        redirectUrl: 'https://arca.test/form?mdOrder=O1',
      });
    });

    it.each([
      { label: 'no orderId', reply: { formUrl: 'https://arca.test/form', errorMessage: 'Order number is duplicated' } },
      { label: 'no formUrl', reply: { orderId: 'O1', errorMessage: 'Order number is duplicated' } },
    ])('throws, naming the bank, when the reply has $label', async ({ reply }) => {
      bankReplying(reply);

      await expect(gateway.registerOrder(order('AMD'))).rejects.toThrow(/IDBANK refused the order: Order number is duplicated/);
    });
  });
});
