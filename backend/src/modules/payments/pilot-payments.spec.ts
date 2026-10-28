import { PaymentProvider, PaymentPurpose } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentGatewayRegistry } from './payment-gateway.registry';
import { PaymentsService } from './payments.service';

describe('free pilot payment boundary', () => {
  const original = process.env.PILOT_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.PILOT_MODE;
    else process.env.PILOT_MODE = original;
  });

  it.each([PaymentPurpose.TICKET, PaymentPurpose.SUBSCRIPTION, PaymentPurpose.DEPOSIT])(
    'rejects a %s charge before reading or writing a payment or reaching a bank', async (purpose) => {
      process.env.PILOT_MODE = 'true';
      const findUnique = jest.fn().mockResolvedValue(null);
      const get = jest.fn();
      const prisma = { payment: { findUnique } } as unknown as PrismaService;
      const gateways = { get } as unknown as PaymentGatewayRegistry;
      const payments = new PaymentsService(prisma, gateways);
      await expect(payments.start({
        purpose, provider: PaymentProvider.AMERIABANK, organizationId: 'pilot',
        amountMinor: '1000', currency: 'AMD', returnUrl: 'https://aveline.am',
        idempotencyKey: 'pilot-charge',
      })).rejects.toThrow('Payments are disabled for the free pilot');
      expect(findUnique).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
    },
  );
});
