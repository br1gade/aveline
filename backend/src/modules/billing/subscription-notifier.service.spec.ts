import { SubscriptionNotifierService } from './subscription-notifier.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CommunicationsService } from '../communications/communications.service';

describe('subscription payment notification failures', () => {
  it('leaves money settlement independent of a failed notification transaction', async () => {
    const prisma = { $transaction: jest.fn().mockRejectedValue(new Error('private provider details')) };
    const notifier = new SubscriptionNotifierService(prisma as unknown as PrismaService, {} as CommunicationsService);
    await expect(notifier.sendPaymentConfirmation('invoice')).resolves.toBe(false);
  });

  it('registers a guard for current paid invoices instead of trusting queued success text', () => {
    const communications = { checkBeforeSending: jest.fn() };
    const notifier = new SubscriptionNotifierService({} as PrismaService, communications as unknown as CommunicationsService);
    notifier.onModuleInit();
    expect(communications.checkBeforeSending).toHaveBeenCalledWith('subscription.paid', expect.any(Function));
  });
});
