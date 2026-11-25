import { PaymentEventSource, PaymentProvider, PaymentPurpose, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentGatewayRegistry } from './payment-gateway.registry';
import { PaymentsService } from './payments.service';
import { PaymentGateway } from './providers/payment-provider';

const request = { organizationId: 'organization', purpose: PaymentPurpose.DEPOSIT,
  provider: PaymentProvider.FAKE, amountMinor: '25000', currency: 'AMD',
  returnUrl: 'https://app.example.test/return', idempotencyKey: 'registration-outcome' };

function fixture(status: PaymentStatus) {
  const row = { id: 'payment', ...request, orderNumber: 'AVL-OUTCOME', status,
    amountMinor: 25000n, refundedMinor: 0n, providerRef: 'reference' as string | null, redirectUrl: null,
    failureReason: null, registrationStartedAt: new Date('2026-11-01T00:00:00Z') as Date | null,
    outcomeUnknownAt: new Date('2026-11-01T01:00:00Z') as Date | null, expiresAt: new Date('2026-11-01T01:00:00Z'),
    invoiceId: null, ticketOrderId: null };
  const payment = { findUnique: jest.fn().mockResolvedValue(row),
    findUniqueOrThrow: jest.fn().mockResolvedValue(row),
    create: jest.fn().mockResolvedValue(row),
    updateMany: jest.fn().mockImplementation(({ data }: { data: object }) => {
      Object.assign(row, data);
      return Promise.resolve({ count: 1 });
    }),
    update: jest.fn().mockImplementation(({ data }: { data: object }) => Promise.resolve(Object.assign(row, data))) };
  const database = { payment, paymentEvent: { create: jest.fn() },
    $transaction: jest.fn().mockImplementation((work: (tx: object) => unknown) => work(database)) };
  const gateway: PaymentGateway = { provider: PaymentProvider.FAKE,
    registerOrder: jest.fn(), getStatus: jest.fn().mockResolvedValue({ outcome: { kind: 'captured', amountMinor: 25000n }, raw: {} }),
    refund: jest.fn(), cancel: jest.fn() };
  const service = new PaymentsService(database as unknown as PrismaService, new PaymentGatewayRegistry([gateway]));
  return { row, database, gateway, service };
}

describe('bank outcome remains authoritative after local uncertainty', () => {
  it.each([PaymentStatus.CREATED, PaymentStatus.FAILED, PaymentStatus.EXPIRED])(
    'refuses to confirm a no-reference %s attempt whose registration outcome is unknown', async (status) => {
      const { service, row, gateway } = fixture(status);
      row.providerRef = null;
      await expect(service.confirm('AVL-OUTCOME', PaymentEventSource.API)).rejects.toMatchObject({ code: 'PAYMENT_OUTCOME_UNKNOWN', status: 502 });
      expect(gateway.getStatus).not.toHaveBeenCalled();
    },
  );

  it.each([PaymentStatus.FAILED, PaymentStatus.EXPIRED])('keeps a proven unpaid no-reference %s outcome', async (status) => {
    const { service, row, gateway } = fixture(status);
    row.providerRef = null;
    row.outcomeUnknownAt = null;
    if (status === PaymentStatus.EXPIRED) row.registrationStartedAt = null;
    expect(await service.confirm('AVL-OUTCOME', PaymentEventSource.API)).toMatchObject({ status });
    expect(gateway.getStatus).not.toHaveBeenCalled();
  });

  it('preserves a captured outcome when the missing reference needs operator recovery', async () => {
    const { service, row } = fixture(PaymentStatus.CAPTURED);
    row.providerRef = null;
    expect(await service.confirm('AVL-OUTCOME', PaymentEventSource.API)).toMatchObject({ status: PaymentStatus.CAPTURED });
  });

  it('keeps the captured balance after a partial refund without polling the bank again', async () => {
    const { service, row, gateway } = fixture(PaymentStatus.PARTIALLY_REFUNDED);
    row.refundedMinor = 1000n;
    row.outcomeUnknownAt = null;
    const result = await service.confirm('AVL-OUTCOME', PaymentEventSource.CALLBACK);
    expect(result).toMatchObject({ status: PaymentStatus.PARTIALLY_REFUNDED, refundedMinor: '1000' });
    expect(gateway.getStatus).not.toHaveBeenCalled();
  });
  it('recovers a legacy local expiry when the bank captured the original attempt', async () => {
    const { service, gateway } = fixture(PaymentStatus.EXPIRED);
    const result = await service.confirm('AVL-OUTCOME', PaymentEventSource.RECONCILIATION);
    expect(gateway.getStatus).toHaveBeenCalledWith('reference');
    expect(result.status).toBe(PaymentStatus.CAPTURED);
  });

  it('does not turn a registration timeout into a definite unpaid failure', async () => {
    const { row, database, service, gateway } = fixture(PaymentStatus.CREATED);
    row.providerRef = null;
    database.payment.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    jest.mocked(gateway.registerOrder).mockRejectedValue(new Error('bank did not answer'));
    await expect(service.start(request)).rejects.toThrow();
    expect(gateway.registerOrder).toHaveBeenCalledTimes(1);
    expect(row.status).toBe(PaymentStatus.CREATED);
    expect(row.outcomeUnknownAt).not.toBeNull();
  });

  it('does not fulfill an attempt when the returned bank amount belongs to another purchase', async () => {
    const { service, gateway } = fixture(PaymentStatus.PENDING);
    jest.mocked(gateway.getStatus).mockResolvedValue({ outcome: { kind: 'captured', amountMinor: 1n }, raw: {} });
    await expect(service.confirm('AVL-OUTCOME', PaymentEventSource.API)).rejects.toThrow('amount');
  });

  it('clears historical failed-attempt uncertainty when the bank confirms that same definite failure', async () => {
    const { row, database, service, gateway } = fixture(PaymentStatus.FAILED);
    jest.mocked(gateway.getStatus).mockResolvedValue({ outcome: { kind: 'failed', reason: 'Bank confirms decline' }, raw: { definitive: true } });
    await service.confirm('AVL-OUTCOME', PaymentEventSource.RECONCILIATION);
    expect(row.outcomeUnknownAt).toBeNull();
    expect(database.paymentEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      fromStatus: PaymentStatus.FAILED, toStatus: PaymentStatus.FAILED, source: PaymentEventSource.RECONCILIATION,
    }) }));
  });

  it('retains the original claim when both writes of an accepted registration fail', async () => {
    const { row, database, service, gateway } = fixture(PaymentStatus.CREATED);
    row.providerRef = null;
    database.payment.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    database.payment.update.mockRejectedValue(new Error('synthetic storage failure'));
    jest.mocked(gateway.registerOrder).mockResolvedValue({ providerRef: 'accepted-order', redirectUrl: 'https://bank.test/pay' });
    await expect(service.start(request)).rejects.toThrow('outcome is unknown');
    expect(gateway.registerOrder).toHaveBeenCalledTimes(1);
    expect(database.payment.update).toHaveBeenCalledTimes(2);
    expect(row.status).toBe(PaymentStatus.CREATED);
    expect(row.registrationStartedAt).not.toBeNull();
    expect(row.outcomeUnknownAt).not.toBeNull();
  });
});
