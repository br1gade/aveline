import { Injectable, Logger } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { BANK_TIMEOUT_MS } from './payment-provider';
import {
  PaymentGateway,
  ProviderStatus,
  RegisterOrderParams,
  RegisteredOrder,
  toMajorUnits,
  toMinorUnits,
} from './payment-provider';

export interface AmeriabankConfig {
  baseUrl: string;
  clientId: string;
  username: string;
  password: string;
}

/**
 * Ameriabank vPOS.
 *
 * Test environment is servicestest.ameriabank.am, production is
 * services.ameriabank.am; the vPOS team issues credentials after a business
 * account is opened. Their test harness restricts OrderID to a narrow range
 * and the amount to 10 AMD, and requires at least five completed REST
 * payments before production access.
 *
 * ⚠ The field names below are our best reading of the published integration
 * and MUST be checked against the spec the bank sends you before go-live.
 * Everything that decides business outcomes lives in PaymentsService, so a
 * correction here stays local.
 */
@Injectable()
export class AmeriabankGateway implements PaymentGateway {
  readonly provider = PaymentProvider.AMERIABANK;
  private readonly logger = new Logger(AmeriabankGateway.name);

  constructor(private readonly config: AmeriabankConfig) {}

  async registerOrder(params: RegisterOrderParams): Promise<RegisteredOrder> {
    const body = await this.post('InitPayment', {
      ClientID: this.config.clientId,
      Username: this.config.username,
      Password: this.config.password,
      OrderID: params.orderNumber,
      Amount: toMajorUnits(params.amountMinor, params.currency),
      Currency: params.currency,
      BackURL: params.returnUrl,
      Description: params.description ?? '',
      Opaque: params.orderNumber,
    });

    const paymentId = asString(body.PaymentID);
    if (!paymentId) {
      throw new Error(`Ameriabank refused the order: ${asString(body.ResponseMessage) ?? 'unknown'}`);
    }

    const locale = params.locale ?? 'am';
    return {
      providerRef: paymentId,
      redirectUrl: `${this.config.baseUrl}/VPOS/Payments/Pay?id=${paymentId}&lang=${locale}`,
    };
  }

  async getStatus(providerRef: string): Promise<ProviderStatus> {
    const body = await this.post('GetPaymentDetails', {
      PaymentID: providerRef,
      Username: this.config.username,
      Password: this.config.password,
    });
    return { outcome: this.readOutcome(body), raw: body };
  }

  async refund(providerRef: string, amountMinor: bigint, currency: string): Promise<ProviderStatus> {
    const body = await this.post('RefundPayment', {
      PaymentID: providerRef,
      Username: this.config.username,
      Password: this.config.password,
      // In the payment's own currency: converted as AMD, a dollar refund was
      // a hundred times too large.
      Amount: toMajorUnits(amountMinor, currency),
    });
    // HTTP 200 carries declines too; only '00' means the money went back.
    if (asString(body.ResponseCode) !== '00') {
      throw new Error(`Ameriabank refused the refund: ${asString(body.ResponseMessage) ?? `code ${asString(body.ResponseCode) ?? 'none'}`}`);
    }
    return { outcome: { kind: 'refunded', refundedMinor: amountMinor }, raw: body };
  }

  async cancel(providerRef: string): Promise<ProviderStatus> {
    const body = await this.post('CancelPayment', {
      PaymentID: providerRef,
      Username: this.config.username,
      Password: this.config.password,
    });
    return { outcome: { kind: 'cancelled' }, raw: body };
  }

  /**
   * vPOS reports both a transport-level ResponseCode and a payment state.
   * '00' is the success code; anything else is a decline with a message.
   */
  private readOutcome(body: Record<string, unknown>): ProviderStatus['outcome'] {
    const responseCode = asString(body.ResponseCode);
    const amount = toMinorUnits(asString(body.Amount) ?? '0', asString(body.Currency) ?? 'AMD');

    if (responseCode === '00') return { kind: 'captured', amountMinor: amount };
    if (responseCode === undefined) return { kind: 'pending' };

    return {
      kind: 'failed',
      reason: asString(body.ResponseMessage) ?? `Ameriabank response code ${responseCode}`,
    };
  }

  private async post(method: string, payload: Record<string, unknown>) {
    const url = `${this.config.baseUrl}/VPOS/api/VPOS/${method}`;
    const response = await fetch(url, {
      method: 'POST',
      // A hanging bank must not hold a buyer's checkout, or every money sweep
      // behind it, open for Node's own default of minutes.
      signal: AbortSignal.timeout(BANK_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      this.logger.error(`${method} returned HTTP ${response.status}`);
      throw new Error(`Ameriabank ${method} failed with HTTP ${response.status}`);
    }
    return (await response.json()) as Record<string, unknown>;
  }
}

/**
 * Providers are not always consistent about types, and an object reaching
 * String() yields "[object Object]" — a value that looks like data and is not.
 * Only primitives convert; anything else is treated as absent.
 */
function asString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}
