import { PaymentProvider, PaymentPurpose, PaymentStatus } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { PaymentGatewayRegistry } from './payment-gateway.registry';
import { PrismaService } from '../../prisma/prisma.service';

describe('a retry during payment registration', () => {
  it('joins an existing registration rather than exposing its intermediate state', async () => {
    const pending = { id: 'payment', orderNumber: 'AVL-RETRY', amountMinor: 25000n, refundedMinor: 0n, currency: 'AMD', status: PaymentStatus.PENDING, redirectUrl: 'https://bank.example.test/pay' };
    const database = { payment: {
      findUnique: jest.fn().mockResolvedValue({ ...pending, status: PaymentStatus.CREATED, redirectUrl: null }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(pending),
    } };
    const gateways = new PaymentGatewayRegistry([]);
    const service = new PaymentsService(database as unknown as PrismaService, gateways);
    const result = await service.start({ organizationId: 'organization', purpose: PaymentPurpose.SUBSCRIPTION,
      provider: PaymentProvider.FAKE, amountMinor: '25000', currency: 'AMD', returnUrl: 'https://app.example.test/billing/return', idempotencyKey: 'invoice-retry' });
    expect(result).toMatchObject({ status: PaymentStatus.PENDING, redirectUrl: pending.redirectUrl });
  });
});
