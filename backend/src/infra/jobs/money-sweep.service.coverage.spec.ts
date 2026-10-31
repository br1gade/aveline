import { Logger } from '@nestjs/common';
import type { SubscriptionsService } from '../../modules/billing/subscriptions.service';
import type { PaymentsService } from '../../modules/payments/payments.service';
import type { TicketingService } from '../../modules/ticketing/ticketing.service';
import type { JobLockService } from './job-lock.service';
import { MoneySweepService } from './money-sweep.service';

/**
 * B36: reconciliation alone only updated the payment, so a buyer who paid and
 * never came back had money taken and nothing delivered. The sweep must settle
 * after it reconciles, and must run on one instance at a time.
 */
describe('MoneySweepService', () => {
  const sweepWith = (options: { isLockAcquired: boolean }) => {
    const lock = {
      runExclusively: jest.fn((_job: { name: string }, work: () => Promise<void>) =>
        options.isLockAcquired ? work() : Promise.resolve()),
    };
    const payments = { reconcile: jest.fn().mockResolvedValue({ checked: 2, changed: 1 }) };
    const ticketing = {
      settleCapturedPayments: jest.fn().mockResolvedValue({ settled: 1 }),
      releaseExpiredReservations: jest.fn().mockResolvedValue({ released: 3 }),
      sendMissingNotices: jest.fn().mockResolvedValue(undefined),
    };
    const subscriptions = { settleCapturedInvoices: jest.fn().mockResolvedValue({ settled: 1 }) };
    const sweep = new MoneySweepService(
      lock as unknown as JobLockService,
      payments as unknown as PaymentsService,
      ticketing as unknown as TicketingService,
      subscriptions as unknown as SubscriptionsService,
    );
    return { sweep, lock, payments, ticketing, subscriptions };
  };

  beforeEach(() => jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('reconciles under the payments.reconcile lock', async () => {
    const { sweep, lock } = sweepWith({ isLockAcquired: true });

    await sweep.reconcilePayments();

    expect(lock.runExclusively).toHaveBeenCalledTimes(1);
    expect(lock.runExclusively.mock.calls[0][0]).toMatchObject({ name: 'payments.reconcile' });
    expect(lock.runExclusively.mock.calls[0][0]).toEqual(expect.objectContaining({ ttlSeconds: expect.any(Number) }));
  });

  it('settles ticket orders and then invoices only after reconciling', async () => {
    const { sweep, payments, ticketing, subscriptions } = sweepWith({ isLockAcquired: true });

    await sweep.reconcilePayments();

    const reconciled = payments.reconcile.mock.invocationCallOrder[0];
    const ticketsSettled = ticketing.settleCapturedPayments.mock.invocationCallOrder[0];
    const invoicesSettled = subscriptions.settleCapturedInvoices.mock.invocationCallOrder[0];
    expect(reconciled).toBeLessThan(ticketsSettled);
    expect(ticketsSettled).toBeLessThan(invoicesSettled);
  });

  it('does nothing when another instance holds the reconcile lock', async () => {
    const { sweep, payments, ticketing, subscriptions } = sweepWith({ isLockAcquired: false });

    await sweep.reconcilePayments();

    expect(payments.reconcile).not.toHaveBeenCalled();
    expect(ticketing.settleCapturedPayments).not.toHaveBeenCalled();
    expect(subscriptions.settleCapturedInvoices).not.toHaveBeenCalled();
  });

  it('does not settle anything when reconciliation fails', async () => {
    const { sweep, payments, ticketing, subscriptions } = sweepWith({ isLockAcquired: true });
    payments.reconcile.mockRejectedValueOnce(new Error('database gone'));

    await expect(sweep.reconcilePayments()).rejects.toThrow('database gone');

    expect(ticketing.settleCapturedPayments).not.toHaveBeenCalled();
    expect(subscriptions.settleCapturedInvoices).not.toHaveBeenCalled();
  });

  it('releases expired holds and then sends missing notices, under the tickets.release lock', async () => {
    const { sweep, lock, ticketing } = sweepWith({ isLockAcquired: true });

    await sweep.releaseExpiredReservations();

    expect(lock.runExclusively.mock.calls[0][0]).toMatchObject({ name: 'tickets.release' });
    expect(ticketing.releaseExpiredReservations.mock.invocationCallOrder[0])
      .toBeLessThan(ticketing.sendMissingNotices.mock.invocationCallOrder[0]);
  });

  it('releases nothing when another instance holds the release lock', async () => {
    const { sweep, ticketing } = sweepWith({ isLockAcquired: false });

    await sweep.releaseExpiredReservations();

    expect(ticketing.releaseExpiredReservations).not.toHaveBeenCalled();
    expect(ticketing.sendMissingNotices).not.toHaveBeenCalled();
  });
});
