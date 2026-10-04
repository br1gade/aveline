import { Injectable, Logger } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import {
  PaymentGateway,
  ProviderOutcome,
  ProviderStatus,
  RegisterOrderParams,
  RegisteredOrder,
} from './payment-provider';

export interface ArcaConfig {
  baseUrl: string;
  username: string;
  password: string;
}

/**
 * Inecobank eCommerce and IDBank's IDPay.
 *
 * Both run the ArCa gateway, which speaks the familiar register.do /
 * getOrderStatusExtended.do protocol, so one adapter serves both and only the
 * base URL and credentials differ. Test endpoints are ipaytest.inecobank.am
 * and the IDPay proxy respectively; both require merchant credentials issued
 * by the bank.
 *
 * ⚠ Verify parameter names against the spec your bank sends before go-live.
 *
 * Amounts go on the wire in minor units, which for AMD is whole drams.
 */
@Injectable()
export class ArcaGateway implements PaymentGateway {
  private readonly logger = new Logger(ArcaGateway.name);

  constructor(
    readonly provider: PaymentProvider,
    private readonly config: ArcaConfig,
  ) {}

  async registerOrder(params: RegisterOrderParams): Promise<RegisteredOrder> {
    const body = await this.call('register.do', {
      orderNumber: params.orderNumber,
      amount: params.amountMinor.toString(),
      currency: numericCurrency(params.currency),
      returnUrl: params.returnUrl,
      description: params.description ?? '',
      language: params.locale ?? 'hy',
    });

    const orderId = asString(body.orderId);
    const formUrl = asString(body.formUrl);
    if (!orderId || !formUrl) {
      throw new Error(
        `${this.provider} refused the order: ${asString(body.errorMessage) ?? 'unknown error'}`,
      );
    }
    return { providerRef: orderId, redirectUrl: formUrl };
  }

  async getStatus(providerRef: string): Promise<ProviderStatus> {
    const body = await this.call('getOrderStatusExtended.do', { orderId: providerRef });
    return { outcome: this.readOutcome(body), raw: body };
  }

  async refund(providerRef: string, amountMinor: bigint): Promise<ProviderStatus> {
    const body = await this.call('refund.do', {
      orderId: providerRef,
      amount: amountMinor.toString(),
    });
    return { outcome: { kind: 'refunded', refundedMinor: amountMinor }, raw: body };
  }

  async cancel(providerRef: string): Promise<ProviderStatus> {
    const body = await this.call('reverse.do', { orderId: providerRef });
    return { outcome: { kind: 'cancelled' }, raw: body };
  }

  /**
   * ArCa's orderStatus codes, mapped to our vocabulary here so nothing
   * downstream has to know a bank's numbering. A table rather than a switch,
   * so adding a code is adding a row.
   */
  private readOutcome(body: Record<string, unknown>): ProviderOutcome {
    const amountMinor = BigInt(asString(body.amount) ?? '0');
    const status = Number(body.orderStatus ?? -1);

    const read = ARCA_ORDER_STATUS[status];
    if (!read) return { kind: 'failed', reason: `Unrecognised orderStatus ${status}` };

    return read(amountMinor, asString(body.actionCodeDescription));
  }

  private async call(endpoint: string, params: Record<string, string>) {
    const query = new URLSearchParams({
      userName: this.config.username,
      password: this.config.password,
      ...params,
    });

    const response = await fetch(`${this.config.baseUrl}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: query.toString(),
    });

    if (!response.ok) {
      this.logger.error(`${endpoint} returned HTTP ${response.status}`);
      throw new Error(`${this.provider} ${endpoint} failed with HTTP ${response.status}`);
    }
    return (await response.json()) as Record<string, unknown>;
  }
}

type ArcaOutcomeReader = (amountMinor: bigint, declineReason?: string) => ProviderOutcome;

const ARCA_ORDER_STATUS: Record<number, ArcaOutcomeReader> = {
  0: () => ({ kind: 'pending' }), // registered, not yet paid
  5: () => ({ kind: 'pending' }), // 3-D Secure authentication under way
  1: (amountMinor) => ({ kind: 'authorized', amountMinor }), // pre-authorization hold
  2: (amountMinor) => ({ kind: 'captured', amountMinor }), // fully authorized
  3: () => ({ kind: 'cancelled' }),
  4: (amountMinor) => ({ kind: 'refunded', refundedMinor: amountMinor }),
  6: (_amountMinor, declineReason) => ({ kind: 'failed', reason: declineReason ?? 'Declined' }),
};

/** ArCa expects ISO 4217 numeric codes rather than letters. */
const NUMERIC_CURRENCY: Record<string, string> = {
  AMD: '051',
  USD: '840',
  EUR: '978',
  RUB: '643',
};

function numericCurrency(currency: string): string {
  return NUMERIC_CURRENCY[currency.toUpperCase()] ?? '051';
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
