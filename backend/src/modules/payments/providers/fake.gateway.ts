import { Injectable } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import {
  PaymentGateway,
  ProviderStatus,
  RegisterOrderParams,
  RegisteredOrder,
} from './payment-provider';

/**
 * An in-process gateway for local development and tests.
 *
 * It exists so the entire payment flow — registration, redirect, server-side
 * confirmation, reconciliation, refunds — is exercisable before any bank has
 * issued credentials, and remains testable afterwards without touching a real
 * sandbox. `PaymentsModule` refuses to select it when NODE_ENV is production.
 */
@Injectable()
export class FakeGateway implements PaymentGateway {
  readonly provider = PaymentProvider.FAKE;

  private readonly orders = new Map<string, { amountMinor: bigint; outcome: ProviderStatus }>();

  registerOrder(params: RegisterOrderParams): Promise<RegisteredOrder> {
    const providerRef = `fake_${params.orderNumber}`;
    this.orders.set(providerRef, {
      amountMinor: params.amountMinor,
      outcome: { outcome: { kind: 'pending' }, raw: { simulated: true } },
    });

    // Added to the query, before any fragment, so a return URL keeps its own
    // query and anchor. Not parsed: the DTOs accept a URL without a scheme.
    const [base, fragment] = params.returnUrl.split('#', 2);
    const separator = base.includes('?') ? '&' : '?';
    const redirectUrl = `${base}${separator}fakePayment=${providerRef}${fragment === undefined ? '' : `#${fragment}`}`;
    return Promise.resolve({ providerRef, redirectUrl });
  }

  getStatus(providerRef: string): Promise<ProviderStatus> {
    const order = this.orders.get(providerRef);
    if (!order) {
      return Promise.resolve({ outcome: { kind: 'failed', reason: 'Unknown order' }, raw: {} });
    }
    return Promise.resolve(order.outcome);
  }

  refund(providerRef: string, amountMinor: bigint): Promise<ProviderStatus> {
    return this.settle(providerRef, { kind: 'refunded', refundedMinor: amountMinor });
  }

  cancel(providerRef: string): Promise<ProviderStatus> {
    return this.settle(providerRef, { kind: 'cancelled' });
  }

  /** Test hook: drive an order to any outcome without a real bank. */
  simulate(providerRef: string, outcome: ProviderStatus['outcome']): void {
    const order = this.orders.get(providerRef);
    if (order) order.outcome = { outcome, raw: { simulated: outcome.kind } };
  }

  /** Test hook: the common case of a payer completing the form. */
  simulateSuccess(providerRef: string): void {
    const order = this.orders.get(providerRef);
    if (order) this.simulate(providerRef, { kind: 'captured', amountMinor: order.amountMinor });
  }

  private settle(providerRef: string, outcome: ProviderStatus['outcome']): Promise<ProviderStatus> {
    this.simulate(providerRef, outcome);
    return this.getStatus(providerRef);
  }
}
