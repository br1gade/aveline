import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SubscriptionsService } from '../../modules/billing/subscriptions.service';
import { PaymentsService } from '../../modules/payments/payments.service';
import { TicketingService } from '../../modules/ticketing/ticketing.service';
import { JobLockService, SCHEDULES } from './job-lock.service';

/**
 * The sweeps that keep money and what it bought in agreement.
 *
 * Reconciliation alone only updated the payment: a buyer who paid and never
 * came back to the site had a captured payment and no tickets, and a customer
 * who paid an invoice that way stayed unpaid (B36). So each run reconciles,
 * then settles what it found captured. Each sweep takes a Redis lock first,
 * so two API instances never run one twice at once.
 */
@Injectable()
export class MoneySweepService {
  private readonly logger = new Logger(MoneySweepService.name);

  constructor(
    private readonly lock: JobLockService,
    private readonly payments: PaymentsService,
    private readonly ticketing: TicketingService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcilePayments(): Promise<void> {
    await this.lock.runExclusively(
      { name: 'payments.reconcile', ttlSeconds: 280, crontab: SCHEDULES.everyFiveMinutes },
      async () => {
        const result = await this.payments.reconcile();
        if (result.changed > 0) this.logger.log(`payments: ${result.changed} of ${result.checked} changed`);

        // Captured becomes tickets — or a refund, when a late payment's seats
        // were sold meanwhile — and invoices paid.
        const tickets = await this.ticketing.settleCapturedPayments();
        const invoices = await this.subscriptions.settleCapturedInvoices();
        if (tickets.settled + invoices.settled > 0) {
          this.logger.log(`settled ${tickets.settled} ticket order(s), ${invoices.settled} invoice(s)`);
        }
      },
    );
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async releaseExpiredReservations(): Promise<void> {
    await this.lock.runExclusively(
      { name: 'tickets.release', ttlSeconds: 280, crontab: SCHEDULES.everyFiveMinutes },
      async () => {
        const result = await this.ticketing.releaseExpiredReservations();
        if (result.released > 0) this.logger.log(`tickets: released ${result.released} holds`);
        // A confirmation that failed to queue when the order settled.
        await this.ticketing.sendMissingNotices();
      },
    );
  }
}
