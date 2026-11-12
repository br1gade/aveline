import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentGatewayRegistry } from './payment-gateway.registry';
import { PaymentsService } from './payments.service';

/**
 * Answering as the fake bank marks an order paid, so it must not exist where
 * the fake gateway is not registered — which is everywhere but development
 * and test (payments.module.coverage.spec.ts).
 */
describe('Answering as the fake bank', () => {
  it('404s without reading a payment when the fake gateway is not registered', async () => {
    const findUnique = jest.fn();
    const service = new PaymentsService({ payment: { findUnique } } as unknown as PrismaService, new PaymentGatewayRegistry([]));

    await expect(service.answerAsFakeBank('AVL-1', 'PAID')).rejects.toThrow(NotFoundException);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
